import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { ModelStore, Registry, emptyWorkspace, validate, DEFAULT_MAPPINGS, makeElement, makeRelationship, type ModelPatch, type Workspace } from "@vastitecture/core";
import { buildPack, migrateElementType, pack, toArchimate3Type } from "@vastitecture/notation-archimate";
import { archimateTypeOf, parseArchi, parseExchange, writeExchange } from "./index";

const require = createRequire(import.meta.url);
/** The ArchiSurance sample as published in the `mcp-archimate` npm package (not copied into this repo). */
const sample = (file: string) => readFileSync(require.resolve(`mcp-archimate/data/${file}`), "utf8");

const apply = (patch: ModelPatch, base: Workspace = emptyWorkspace("Imported", ["archimate"])) => {
  const store = new ModelStore(base);
  store.dispatch({ type: "applyPatch", patch });
  return store.state;
};
const count = (re: RegExp, s: string) => (s.match(re) ?? []).length;

describe("ArchiMate 4 pack", () => {
  it("is built entirely from the data files", () => {
    expect(pack.elementTypes).toHaveLength(43); // 42 concepts + the junction connector
    expect(pack.relationshipTypes).toHaveLength(11);
    expect(pack.validity).toMatchObject({ mode: "permissive" });
    const custom = buildPack({
      elements: { domains: { X: "#fff" }, elements: [{ id: "archimate:Thing", name: "Thing", domain: "X", aspect: "active", shape: "rect" }] },
      relationships: { relationships: [{ id: "archimate:Serving", name: "Serving" }] },
      viewpoints: { viewpoints: [{ id: "archimate:x", name: "X", elements: ["domain:X"] }] },
      validity: { mode: "table", table: { "archimate:Thing": { "archimate:Thing": ["archimate:Serving"] } } },
    });
    expect(custom.elementTypes.map((t) => t.id)).toEqual(["archimate:Thing"]);
    expect(custom.viewpoints[0].elementTypes).toContain("archimate:Thing");
    expect(custom.validity).toMatchObject({ mode: "table" });
  });

  it("restricts the palette per viewpoint and expands domain references", () => {
    const reg = new Registry();
    reg.registerPack(pack);
    const motivation = reg.paletteFor("archimate", "archimate:motivation").map((t) => t.name);
    expect(motivation).toContain("Stakeholder");
    expect(motivation).toContain("Grouping");
    expect(motivation).not.toContain("Node");
    expect(reg.paletteFor("archimate", "archimate:layered")).toHaveLength(43);
  });

  it("validates relationships from a data table once one is supplied (synthetic table)", () => {
    const reg = new Registry();
    reg.registerPack(
      buildPack({
        elements: { domains: {}, elements: [{ id: "archimate:A", name: "A", domain: "D", aspect: "active", shape: "rect" }, { id: "archimate:B", name: "B", domain: "D", aspect: "active", shape: "rect" }] },
        relationships: { relationships: [{ id: "archimate:Serving", name: "Serving" }, { id: "archimate:Flow", name: "Flow" }] },
        viewpoints: { viewpoints: [] },
        validity: { mode: "table", table: { "archimate:A": { "archimate:B": ["archimate:Serving"] } } },
      }),
    );
    expect(reg.validRelationships("archimate", "archimate:A", "archimate:B")).toEqual({ types: ["archimate:Serving"], strict: true });
    expect(reg.validRelationships("archimate", "archimate:B", "archimate:A").types).toEqual([]);
    const a = makeElement("archimate:A", "a", { description: "x" }), b = makeElement("archimate:B", "b", { description: "x" });
    const ok = makeRelationship("archimate:Serving", a.id, b.id), bad = makeRelationship("archimate:Flow", a.id, b.id);
    const ws = apply({ elements: [a, b], relationships: [ok, bad] });
    const problems = validate(ws, reg).filter((p) => p.code === "invalid-relationship");
    expect(problems).toHaveLength(1);
    expect(problems[0].target.id).toBe(bad.id);
    expect(problems[0].fixes![0].label).toBe("Change to Serving");
  });

  it("is permissive, and says so, until the licensed table is supplied", () => {
    const reg = new Registry();
    reg.registerPack(pack);
    expect(reg.validRelationships("archimate", "archimate:Goal", "archimate:Node").strict).toBe(false);
    const notes = validate(emptyWorkspace("x", ["archimate"]), reg).filter((p) => p.code === "validity-note");
    expect(notes[0].message).toMatch(/permissive/);
  });

  it("maps the seven removed concepts and the merged ones, and back again for 3.x export", () => {
    expect(migrateElementType("BusinessInteraction")).toMatchObject({ type: "archimate:Process", properties: { domain: "Business", archimate3Type: "BusinessInteraction" }, change: { kind: "removed" } });
    expect(migrateElementType("ApplicationInteraction").type).toBe("archimate:Process");
    expect(migrateElementType("TechnologyInteraction").type).toBe("archimate:Process");
    expect(migrateElementType("Representation").type).toBe("archimate:Material");
    expect(migrateElementType("Contract").type).toBe("archimate:BusinessObject");
    expect(migrateElementType("Constraint").type).toBe("archimate:Requirement");
    expect(migrateElementType("Gap").type).toBe("archimate:Assessment");
    expect(migrateElementType("ApplicationService")).toMatchObject({ type: "archimate:Service", properties: { domain: "Application" }, change: { kind: "merged" } });
    expect(migrateElementType("Goal")).toEqual({ type: "archimate:Goal", properties: {} });
    expect(toArchimate3Type("archimate:Service", { domain: "Technology" })).toBe("TechnologyService");
    expect(toArchimate3Type("archimate:Requirement", { archimate3Type: "Constraint" })).toBe("Constraint");
    expect(toArchimate3Type("archimate:Role", {})).toBe("BusinessRole");
    expect(toArchimate3Type("archimate:Junction", { junctionType: "or" })).toBe("OrJunction");
  });
});

describe("Archi sample model (ArchiSurance)", () => {
  const archi = sample("archisurance.archimate");
  const patch = parseArchi(archi);

  it("imports every element, relationship and diagram", () => {
    const rels = count(/xsi:type="archimate:\w+Relationship"/g, archi);
    const diagrams = count(/xsi:type="archimate:ArchimateDiagramModel"/g, archi);
    const elements = count(/<element /g, archi) - rels - diagrams;
    expect(patch.elements).toHaveLength(elements);
    expect(patch.views).toHaveLength(diagrams);
    const skipped = Number(/(\d+) relationship\(s\) skipped/.exec(patch.report!.join("\n"))?.[1] ?? 0);
    expect(patch.relationships!.length + skipped).toBe(rels);
    expect(patch.relationships!.length).toBeGreaterThan(380);
  });

  it("migrates to ArchiMate 4 with a report of every change", () => {
    const types = new Set(patch.elements!.map((e) => e.type));
    for (const t of types) expect(pack.elementTypes.some((d) => d.id === t), t).toBe(true);
    expect([...types].some((t) => /Business(Process|Function|Event)|Application(Service|Process|Function)|Technology(Service|Function)/.test(t))).toBe(false);
    const report = patch.report!.join("\n");
    expect(report).toMatch(/Merged into the Common Domain: BusinessProcess → Process \(11 elements/);
    expect(report).toMatch(/ApplicationService → Service \(8 elements/);
    const proc = patch.elements!.find((e) => e.type === "archimate:Process")!;
    expect(["Business", "Application", "Technology"]).toContain(proc.properties.domain);
  });

  it("renders: every view places real elements with sizes, nested where Archi nested them", () => {
    const ws = apply(patch);
    const reg = new Registry();
    reg.registerPack(pack);
    const problems = validate(ws, reg).filter((p) => p.severity === "error");
    expect(problems).toEqual([]);
    const nodes = Object.values(ws.views).flatMap((v) => v.nodes);
    expect(nodes.length).toBeGreaterThan(400);
    expect(nodes.every((n) => ws.elements[n.element] && n.w > 0 && n.h > 0)).toBe(true);
    expect(nodes.some((n) => n.parent)).toBe(true);
    expect(Object.values(ws.views).flatMap((v) => v.edges).every((e) => ws.relationships[e.relationship])).toBe(true);
    expect(Object.values(ws.views).some((v) => v.annotations.some((a) => a.kind === "group"))).toBe(true);
  });

  it("round-trips through the exchange format", () => {
    const first = apply(patch);
    const xml = writeExchange(first, { typeOf: archimateTypeOf(first) });
    const second = apply(parseExchange(xml));
    const fp = (ws: Workspace) => ({
      elements: Object.values(ws.elements).map((e) => `${e.id}|${e.type}|${e.name}|${e.description ?? ""}|${JSON.stringify(Object.entries(e.properties).sort())}`).sort(),
      relationships: Object.values(ws.relationships).map((r) => `${r.id}|${r.type}|${r.source}|${r.target}|${r.label ?? ""}|${r.properties.accessType ?? ""}`).sort(),
      views: Object.values(ws.views).map((v) => `${v.id}|${v.name}|${v.nodes.map((n) => `${n.element}@${n.x},${n.y},${n.w},${n.h}^${n.parent ?? ""}`).sort().join(";")}|${v.edges.map((e) => e.relationship).sort().join(";")}|${v.annotations.map((a) => `${a.kind}@${a.x},${a.y}:${a.text ?? ""}`).sort().join(";")}`).sort(),
    });
    expect(fp(second)).toEqual(fp(first));
    // the 3.x file uses 3.x type names again
    expect(xml).toContain('xsi:type="BusinessProcess"');
    expect(xml).not.toContain('xsi:type="Process"');
  });
});

describe("Model Exchange File Format sample (ArchiSurance)", () => {
  const xml = sample("archisurance.xml");
  const patch = parseExchange(xml);

  it("imports the published exchange file and reports removed concepts", () => {
    expect(patch.elements).toHaveLength(count(/<element identifier=/g, xml));
    expect(patch.views).toHaveLength(count(/xsi:type="Diagram"/g, xml));
    const report = patch.report!.join("\n");
    expect(report).toMatch(/Removed concept: .*Representation → Material/);
    expect(report).toMatch(/Removed concept: .*TechnologyInteraction → Process/);
    expect(patch.elements!.find((e) => e.properties.archimate3Type === "Representation")!.type).toBe("archimate:Material");
    expect(patch.elements!.some((e) => e.properties["Capability Level"] !== undefined)).toBe(true);
  });

  it("exports and re-imports without losing elements, relationships or placements", () => {
    const first = apply(patch);
    const second = apply(parseExchange(writeExchange(first, { typeOf: archimateTypeOf(first) })));
    expect(Object.keys(second.elements).sort()).toEqual(Object.keys(first.elements).sort());
    expect(Object.keys(second.relationships).sort()).toEqual(Object.keys(first.relationships).sort());
    for (const id of Object.keys(first.elements)) expect(second.elements[id]).toEqual(first.elements[id]);
    for (const v of Object.values(first.views)) {
      const w = second.views[v.id];
      expect(w.nodes.map((n) => [n.element, n.x, n.y, n.w, n.h, n.parent]).sort()).toEqual(v.nodes.map((n) => [n.element, n.x, n.y, n.w, n.h, n.parent]).sort());
      expect(w.edges.length).toBe(v.edges.length);
      expect(w.edges.filter((e) => e.waypoints).length).toBe(v.edges.filter((e) => e.waypoints).length);
    }
  });

  it("exports elements from other notations through the mapping table", () => {
    const ws: Workspace = { ...emptyWorkspace("X"), mappings: DEFAULT_MAPPINGS };
    const sys = makeElement("c4:SoftwareSystem", "Billing");
    ws.elements[sys.id] = sys;
    const out = writeExchange(ws, { typeOf: archimateTypeOf(ws) });
    expect(out).toContain('xsi:type="ApplicationComponent"');
    expect(out).toContain("<name xml:lang=\"en\">Billing</name>");
  });
});
