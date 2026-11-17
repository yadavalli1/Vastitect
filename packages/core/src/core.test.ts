import { describe, expect, it } from "vitest";
import {
  MemoryFS,
  ModelStore,
  Persister,
  Registry,
  diffPatch,
  emptyWorkspace,
  fromFiles,
  impact,
  impliedRelationships,
  makeElement,
  makeRelationship,
  makeView,
  presentationType,
  reconcilePatch,
  toFiles,
  validate,
  DEFAULT_MAPPINGS,
  type Workspace,
} from "./index";

function sample() {
  const store = new ModelStore(emptyWorkspace("Shop", ["generic"]));
  const sysA = makeElement("x:System", "Shop");
  const sysB = makeElement("x:System", "Payments");
  const web = makeElement("x:Container", "Web", { parent: sysA.id, description: "UI" });
  const api = makeElement("x:Container", "Pay API", { parent: sysB.id });
  const rel = makeRelationship("x:Uses", web.id, api.id, { label: "charges" });
  const view = makeView("x", "Landscape", {
    nodes: [
      { element: sysA.id, x: 10.4, y: 20, w: 120, h: 60 },
      { element: sysB.id, x: 300, y: 20, w: 120, h: 60 },
    ],
  });
  store.dispatch([
    { type: "addElement", element: sysA },
    { type: "addElement", element: sysB },
    { type: "addElement", element: web },
    { type: "addElement", element: api },
    { type: "addRelationship", relationship: rel },
    { type: "addView", view },
  ]);
  return { store, sysA, sysB, web, api, rel, view };
}

describe("store", () => {
  it("undo restores the exact previous snapshot and redo reapplies", () => {
    const { store, web } = sample();
    const before = store.state;
    store.dispatch({ type: "updateElement", id: web.id, patch: { name: "Storefront" } });
    expect(store.state.elements[web.id].name).toBe("Storefront");
    store.undo();
    expect(store.state).toEqual(before);
    store.redo();
    expect(store.state.elements[web.id].name).toBe("Storefront");
  });

  it("removing an element cascades to relationships, placements and children as one undo step", () => {
    const { store, sysA, web, rel, view } = sample();
    const before = store.state;
    store.dispatch({ type: "removeElement", id: sysA.id });
    expect(store.state.views[view.id].nodes).toHaveLength(1);
    expect(store.state.elements[web.id].parent).toBeUndefined();
    store.dispatch({ type: "removeElement", id: web.id });
    expect(store.state.relationships[rel.id]).toBeUndefined();
    store.undo();
    store.undo();
    expect(store.state).toEqual(before);
  });

  it("apply-then-undo is identity for every command kind", () => {
    const { store, sysA, rel, view } = sample();
    const before = store.state;
    const note = { id: "n1", kind: "note" as const, x: 0, y: 0, w: 10, h: 10, text: "hi" };
    const cmds = [
      { type: "updateRelationship", id: rel.id, patch: { label: undefined, technology: "HTTPS" } },
      { type: "putNode", view: view.id, node: { element: rel.source, x: 1, y: 2, w: 3, h: 4, parent: sysA.id } },
      { type: "updateNodes", view: view.id, nodes: [{ element: sysA.id, x: 99 }] },
      { type: "putEdge", view: view.id, edge: { relationship: rel.id } },
      { type: "putAnnotation", view: view.id, annotation: note },
      { type: "removeNode", view: view.id, element: sysA.id },
      { type: "setMappings", mappings: DEFAULT_MAPPINGS },
      { type: "putAdr", adr: { id: "0001", title: "Use YAML", status: "accepted", elements: [sysA.id], body: "Because." } },
      { type: "removeRelationship", id: rel.id },
      { type: "removeView", id: view.id },
    ] as const;
    for (const c of cmds) store.dispatch(c as never);
    while (store.canUndo) store.undo();
    expect(store.state).toEqual(emptyWorkspace("Shop", ["generic"]));
    while (store.canRedo) store.redo();
    while (store.canUndo) store.undo();
    expect(before).not.toBe(store.state);
  });
});

describe("serialisation", () => {
  it("round-trips and is byte-stable", () => {
    const { store } = sample();
    store.dispatch({ type: "putAdr", adr: { id: "0001", title: "Use YAML", status: "accepted", elements: [], body: "Because diffs." } });
    const a = toFiles(store.state);
    const loaded = fromFiles(a.files);
    expect(loaded.issues).toEqual([]);
    const b = toFiles(loaded.workspace, loaded.index);
    expect(b.files).toEqual(a.files);
    expect(Object.keys(a.files).some((p) => p.startsWith("model/elements/x/system/"))).toBe(true);
    expect(a.files["adrs/0001-use-yaml.md"]).toContain("Because diffs.");
  });

  it("a rename is a one-line diff and does not move the file", () => {
    const { store, web } = sample();
    const a = toFiles(store.state);
    store.dispatch({ type: "updateElement", id: web.id, patch: { name: "Storefront" } });
    const b = toFiles(store.state, a.index);
    const changed = Object.keys(b.files).filter((p) => a.files[p] !== b.files[p]);
    expect(changed).toEqual([a.index[web.id]]);
    const before = a.files[changed[0]].split("\n");
    const after = b.files[changed[0]].split("\n");
    expect(after.filter((l, i) => l !== before[i])).toEqual(["name: Storefront"]);
  });

  it("stores integer coordinates and omits empty fields", () => {
    const { store, view } = sample();
    const { files, index } = toFiles(store.state);
    expect(files[index[view.id]]).toContain("x: 10\n");
    expect(files[index[view.id]]).not.toContain("annotations");
  });

  it("reports unparsable files and conflict markers instead of failing", () => {
    const { store, web } = sample();
    const { files, index } = toFiles(store.state);
    files[index[web.id]] = "<<<<<<< HEAD\nname: a\n=======\nname: b\n>>>>>>> x\n";
    const r = fromFiles(files);
    expect(r.issues).toHaveLength(1);
    expect(r.workspace.elements[web.id]).toBeUndefined();
  });
});

describe("persister", () => {
  it("writes only changed files, ignores its own echoes and picks up outside edits", async () => {
    const { store, web, sysB } = sample();
    const fs = new MemoryFS();
    const p = new Persister(fs);
    await p.load();
    expect((await p.save(store.state)).length).toBeGreaterThan(4);
    expect(await p.save(store.state)).toEqual([]);
    expect(await p.checkExternal(store.state)).toBeUndefined();

    const path = Object.keys(fs.files).find((f) => fs.files[f].includes("name: Web"))!;
    fs.externalWrite(path, fs.files[path].replace("name: Web", "name: Web UI"));
    const ext = await p.checkExternal(store.state);
    expect(ext!.workspace.elements[web.id].name).toBe("Web UI");
    expect(ext!.conflicts).toEqual([]);

    // unsaved local edit to the same file + another outside edit = conflict
    store.reset(ext!.workspace);
    store.dispatch({ type: "updateElement", id: web.id, patch: { name: "Mine" } });
    store.dispatch({ type: "updateElement", id: sysB.id, patch: { name: "Pay" } });
    fs.externalWrite(path, fs.files[path].replace("name: Web UI", "name: Theirs"));
    const c = await p.checkExternal(store.state);
    expect(c!.conflicts.map((x) => x.path)).toEqual([path]);
    expect(c!.workspace.elements[web.id].name).toBe("Mine");
    expect(c!.workspace.elements[sysB.id].name).toBe("Pay");
  });
});

describe("queries", () => {
  it("rolls relationships between hidden children up to visible parents", () => {
    const { store, sysA, sysB, rel, view } = sample();
    const implied = impliedRelationships(store.state, store.state.views[view.id]);
    expect(implied).toHaveLength(1);
    expect(implied[0]).toMatchObject({ source: sysA.id, target: sysB.id, via: [rel.id] });
  });

  it("answers what breaks if an element is retired", () => {
    const { store, sysA, sysB, web, api } = sample();
    const hit = impact(store.state, sysB.id, "usedBy");
    expect([...hit.keys()].sort()).toEqual([api.id, web.id, sysA.id].sort());
    expect([...impact(store.state, web.id, "dependsOn").keys()]).toEqual([api.id]);
  });

  it("resolves presentation through facets and the mapping table", () => {
    const ws: Workspace = { ...emptyWorkspace(), mappings: DEFAULT_MAPPINGS };
    const sys = makeElement("c4:SoftwareSystem", "Shop");
    expect(presentationType(ws, sys, "c4")).toBe("c4:SoftwareSystem");
    expect(presentationType(ws, sys, "archimate")).toBe("archimate:ApplicationComponent");
    expect(presentationType(ws, sys, "ddd")).toBe("ddd:BoundedContext");
    expect(presentationType(ws, { ...sys, facets: { ddd: { type: "ddd:ExternalSystem" } } }, "ddd")).toBe("ddd:ExternalSystem");
    expect(presentationType(ws, makeElement("generic:Box", "x"), "c4")).toBeUndefined();
  });

  it("reconciles a rediscovered patch onto existing ids and diffs it", () => {
    const { store, web } = sample();
    const again = makeElement("x:Container", "Web", { properties: { image: "nginx" } });
    const fresh = makeElement("x:Container", "Worker");
    const patch = reconcilePatch(store.state, { elements: [again, fresh], relationships: [makeRelationship("x:Uses", again.id, fresh.id)] });
    expect(patch.elements![0].id).toBe(web.id);
    expect(patch.elements![0].description).toBe("UI");
    expect(patch.relationships![0].source).toBe(web.id);
    const d = diffPatch(store.state, patch);
    expect(d.added.map((a) => a.kind)).toEqual(["element", "relationship"]);
    expect(d.changed[0].fields.map((f) => f.field)).toEqual(["properties"]);
  });
});

describe("validation", () => {
  const reg = new Registry();
  reg.registerPack({
    id: "x",
    name: "X",
    elementTypes: [
      { id: "x:System", name: "System", shape: "rect", category: "sys" },
      { id: "x:Container", name: "Container", shape: "rect" },
    ],
    relationshipTypes: [{ id: "x:Uses", name: "Uses" }, { id: "x:Owns", name: "Owns" }],
    viewpoints: [{ id: "x:systems", name: "Systems", elementTypes: ["x:System"] }],
    validity: { mode: "rules", rules: [{ source: "x:Container", target: "x:Container", types: ["x:Uses"] }, { source: "category:sys", target: "*", types: ["x:Owns"] }] },
  });

  it("offers only valid relationship types for a pair", () => {
    expect(reg.validRelationships("x", "x:Container", "x:Container").types).toEqual(["x:Uses"]);
    expect(reg.validRelationships("x", "x:System", "x:Container").types).toEqual(["x:Owns"]);
    expect(reg.validRelationships("x", "x:Container", "x:System").types).toEqual([]);
    expect(reg.paletteFor("x", "x:systems").map((t) => t.id)).toEqual(["x:System"]);
  });

  it("flags invalid relationships, duplicates, viewpoint violations and dangling refs with fixes", () => {
    const { store, sysA, web, api, view } = sample();
    const bad = makeRelationship("x:Uses", sysA.id, api.id);
    const dup = makeElement("x:Container", "web", { parent: sysA.id });
    store.dispatch([
      { type: "addRelationship", relationship: bad },
      { type: "addElement", element: dup },
      { type: "updateView", id: view.id, patch: { viewpoint: "x:systems" } },
      { type: "putNode", view: view.id, node: { element: web.id, x: 0, y: 0, w: 1, h: 1 } },
    ]);
    const problems = validate(store.state, reg);
    const codes = problems.map((p) => p.code);
    expect(codes).toContain("invalid-relationship");
    expect(codes.filter((c) => c === "duplicate-name")).toHaveLength(2);
    expect(codes).toContain("not-in-viewpoint");
    const fix = problems.find((p) => p.code === "invalid-relationship")!.fixes![0];
    expect(fix.label).toBe("Change to Owns");
    store.dispatch(fix.commands);
    expect(validate(store.state, reg).some((p) => p.code === "invalid-relationship")).toBe(false);
  });
});
