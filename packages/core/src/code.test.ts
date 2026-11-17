import { describe, expect, it } from "vitest";
import { CodeError, ModelStore, codeToCommands, emptyWorkspace, makeElement, makeRelationship, makeView, syncViewFromPatch, viewToCode } from "./index";

function setup() {
  const store = new ModelStore(emptyWorkspace("W"));
  const a = makeElement("x:Box", "Web", { description: "UI", properties: { technology: "React" } });
  const b = makeElement("x:Box", "API");
  const r = makeRelationship("x:Uses", a.id, b.id, { label: "calls" });
  const v = makeView("x", "Main", { nodes: [{ element: a.id, x: 10, y: 20, w: 100, h: 50 }, { element: b.id, x: 200, y: 20, w: 100, h: 50 }], edges: [{ relationship: r.id }] });
  const other = makeView("x", "Other", { nodes: [{ element: b.id, x: 0, y: 0, w: 100, h: 50 }] });
  store.dispatch([{ type: "addElement", element: a }, { type: "addElement", element: b }, { type: "addRelationship", relationship: r }, { type: "addView", view: v }, { type: "addView", view: other }]);
  return { store, a, b, r, v, other };
}

describe("diagram as code (YAML)", () => {
  it("is a fixed point: unchanged text produces no commands", () => {
    const { store, v } = setup();
    const text = viewToCode(store.state, v.id);
    expect(text).toContain("at: [10, 20]");
    expect(text).toContain("from: Web");
    expect(codeToCommands(store.state, v.id, text)).toEqual([]);
  });

  it("applies renames, moves, new elements and new relationships from text", () => {
    const { store, v, a } = setup();
    let text = viewToCode(store.state, v.id).replace("name: Web", "name: Storefront").replace("from: Web", "from: Storefront").replace("at: [10, 20]", "at: [15, 25]");
    text = text.replace("relationships:", "  - name: Queue\n    type: x:Box\n    in: API\nrelationships:\n  - from: API\n    to: Queue\n    type: x:Uses");
    store.dispatch(codeToCommands(store.state, v.id, text), { label: "Edit code" });
    const ws = store.state;
    expect(ws.elements[a.id].name).toBe("Storefront");
    expect(ws.views[v.id].nodes.find((n) => n.element === a.id)).toMatchObject({ x: 15, y: 25 });
    const q = Object.values(ws.elements).find((e) => e.name === "Queue")!;
    expect(ws.views[v.id].nodes.find((n) => n.element === q.id)!.parent).toBe(ws.views[v.id].nodes[1].element);
    expect(ws.views[v.id].edges).toHaveLength(2);
    // regenerated text is again a fixed point, and the whole edit is one undo step
    expect(codeToCommands(ws, v.id, viewToCode(ws, v.id))).toEqual([]);
    store.undo();
    expect(Object.keys(store.state.elements)).toHaveLength(2);
  });

  it("removing from text hides shared elements and deletes ones shown nowhere else", () => {
    const { store, v, a, b, r } = setup();
    store.dispatch(codeToCommands(store.state, v.id, "view: Main\nelements: []\n"));
    expect(store.state.elements[a.id]).toBeUndefined(); // only in this view
    expect(store.state.elements[b.id]).toBeDefined(); // also in "Other"
    expect(store.state.relationships[r.id]).toBeUndefined();
    expect(store.state.views[v.id].nodes).toEqual([]);
  });

  it("a rename in the elements list keeps relationships that still use the old name", () => {
    const { store, v, a, r } = setup();
    const text = viewToCode(store.state, v.id).replace("name: Web", "name: Storefront");
    expect(text).toContain("from: Web");
    store.dispatch(codeToCommands(store.state, v.id, text));
    expect(store.state.elements[a.id].name).toBe("Storefront");
    expect(store.state.relationships[r.id].source).toBe(a.id);
    expect(viewToCode(store.state, v.id)).toContain("from: Storefront");
  });

  it("rejects invalid text without touching the model", () => {
    const { store, v } = setup();
    expect(() => codeToCommands(store.state, v.id, "view: [unclosed")).toThrow(CodeError);
    expect(() => codeToCommands(store.state, v.id, "elements: []")).toThrow(/view/);
    expect(() => codeToCommands(store.state, v.id, "view: Main\nrelationships:\n  - from: Nope\n    to: Web\n    type: x:Uses\n")).toThrow(/Nope/);
  });

  it("re-keys a patch from another language onto the existing view", () => {
    const { store, v, a, b } = setup();
    const web = makeElement("x:Box", "Web", { description: "New text" });
    const cache = makeElement("x:Box", "Cache");
    const rel = makeRelationship("x:Uses", web.id, cache.id);
    store.dispatch(syncViewFromPatch(store.state, v.id, { elements: [web, cache], relationships: [rel] }));
    const ws = store.state;
    expect(ws.elements[a.id].description).toBe("New text");
    expect(ws.elements[a.id].properties.technology).toBe("React");
    expect(ws.views[v.id].nodes.find((n) => n.element === a.id)).toMatchObject({ x: 10, y: 20 });
    expect(ws.views[v.id].nodes.some((n) => n.element === b.id)).toBe(false);
    expect(ws.elements[b.id]).toBeDefined();
    expect(ws.views[v.id].nodes).toHaveLength(2);
    expect(ws.views[v.id].edges).toHaveLength(1);
  });
});
