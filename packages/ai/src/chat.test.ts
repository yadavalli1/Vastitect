import { describe, expect, it } from "vitest";
import { DEFAULT_MAPPINGS, ModelStore, Registry, emptyWorkspace, makeElement, makeRelationship, makeView, diffPatch, type ModelPatch, type Workspace } from "@vastitecture/core";
import { pack as c4 } from "../../notations/c4/src/index";
import { chatTurn, describeModel, draftAdr, type Fetcher } from "./index";

const reg = new Registry();
reg.registerPack(c4);
const cfg = { baseUrl: "http://llm.test/v1", model: "m" };
function endpoint(...answers: unknown[]) {
  const calls: { messages: { role: string; content: string }[] }[] = [];
  const f: Fetcher = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    const a = answers[Math.min(calls.length - 1, answers.length - 1)];
    return { status: 200, text: JSON.stringify({ choices: [{ message: { content: typeof a === "string" ? a : JSON.stringify(a) } }] }) };
  };
  return { f, calls };
}
function shop() {
  const ws: Workspace = { ...emptyWorkspace("Shop", ["c4"]), mappings: DEFAULT_MAPPINGS };
  const sys = makeElement("c4:SoftwareSystem", "Shop", { owner: "Team A" });
  const api = makeElement("c4:Container", "Order API", { parent: sys.id, lifecycle: { phase: "active" } });
  const db = makeElement("c4:Container", "Orders DB", { parent: sys.id, properties: { kind: "Database" } });
  for (const e of [sys, api, db]) ws.elements[e.id] = e;
  const r = makeRelationship("c4:Uses", api.id, db.id, { label: "stores orders" });
  ws.relationships[r.id] = r;
  const v = makeView("c4", "Containers", { viewpoint: "c4:container" });
  v.nodes = [api, db].map((e, i) => ({ element: e.id, x: i * 300, y: 0, w: 190, h: 100 }));
  v.edges = [{ relationship: r.id }];
  ws.views[v.id] = v;
  return { ws, sys, api, db, v };
}
const apply = (ws: Workspace, patch: ModelPatch) => {
  const s = new ModelStore(ws);
  s.dispatch({ type: "applyPatch", patch });
  return s.state;
};

describe("assistant chat", () => {
  it("answers questions from the model it is given, with the view and selection as context", async () => {
    const { ws, v, api } = shop();
    const { f, calls } = endpoint({ answer: "**Order API** stores orders in Orders DB.", changes: null });
    const r = await chatTurn(cfg, f, ws, reg, [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }], "What does this do?", { viewId: v.id, selection: [api.id] });
    expect(r).toEqual({ answer: "**Order API** stores orders in Orders DB." });
    const sent = calls[0].messages;
    expect(sent.map((m) => m.role)).toEqual(["system", "system", "user", "assistant", "user"]);
    expect(sent[1].content).toContain('- Order API [Container] in Shop lifecycle: active');
    expect(sent[1].content).toContain('- Order API -> Orders DB [Uses] "stores orders"');
    expect(sent[1].content).toContain('looking at view "Containers"');
    expect(sent[1].content).toContain("Selected: Order API.");
  });

  it("turns proposed changes into a reviewable patch placed in the current view", async () => {
    const { ws, v, api, db } = shop();
    const { f } = endpoint({
      answer: "Added a cache and retired the DB.",
      changes: {
        elements: [{ name: "Order cache", type: "c4:Container", parent: "Shop", description: "Redis" }, { name: "Bad", type: "c4:Nope" }],
        relationships: [{ source: "Order API", target: "Order cache", type: "c4:Uses", label: "caches orders" }],
        updates: [{ name: "Orders DB", lifecycle: "phaseOut", owner: "DBA team" }, { name: "Ghost", owner: "x" }],
        remove: [],
      },
    });
    const r = await chatTurn(cfg, f, ws, reg, [], "Add a cache in front of the database and mark the DB as phasing out", { viewId: v.id });
    expect(r.patch!.report![0]).toBe("The assistant proposes 1 new element(s), 1 relationship(s), 1 update(s) and 0 removal(s). Review before applying.");
    expect(r.patch!.report).toEqual(expect.arrayContaining(['Skipped "Bad": unknown type c4:Nope', 'Skipped an update: "Ghost" is not an element']));
    const diff = diffPatch(ws, r.patch!);
    expect(diff.added.map((a) => a.label)).toEqual(["Order cache (c4:Container)", "Order API → Order cache (caches orders)"]);
    expect(diff.changed.map((c) => `${c.label}: ${c.fields.map((x) => x.field).sort().join(",")}`)).toEqual(["Orders DB: lifecycle,owner", "Containers: edges,nodes"]);
    const after = apply(ws, r.patch!);
    expect(after.views[v.id].nodes).toHaveLength(3);
    expect(after.elements[db.id]).toMatchObject({ owner: "DBA team", lifecycle: { phase: "phaseOut" } });
    expect(after.elements[api.id]).toEqual(ws.elements[api.id]);
  });

  it("tolerates prose instead of JSON and never proposes an empty change", async () => {
    const { ws } = shop();
    expect(await chatTurn(cfg, endpoint("I'm not sure, the model has no deployment data.").f, ws, reg, [], "Where is it deployed?")).toEqual({ answer: "I'm not sure, the model has no deployment data." });
    const r = await chatTurn(cfg, endpoint({ answer: "Done.", changes: { remove: ["Nothing here"] } }).f, ws, reg, [], "remove it");
    expect(r.patch).toBeUndefined();
    expect(r.answer).toContain('Skipped a removal: "Nothing here" is not an element');
  });

  it("drafts an ADR for review, linked to the selected elements", async () => {
    const { ws, db } = shop();
    ws.adrs["0003"] = { id: "0003", title: "Old", status: "accepted", elements: [], body: "" };
    const { f, calls } = endpoint({ title: "Replace Orders DB with a managed service", body: "## Context\nThe DB is self-hosted (assumption)." });
    const patch = await draftAdr(cfg, f, ws, reg, { elements: [db.id], topic: "move the orders database to a managed service", today: "2026-11-21" });
    expect(patch.adrs![0]).toEqual({ id: "0004", title: "Replace Orders DB with a managed service", status: "proposed", date: "2026-11-21", elements: [db.id], body: "## Context\nThe DB is self-hosted (assumption)." });
    expect(calls[0].messages[2].content).toContain("It concerns: Orders DB");
    expect(diffPatch(ws, patch).added).toEqual([{ kind: "decision", id: "0004", label: "0004 Replace Orders DB with a managed service" }]);
  });

  it("trims very large models to the parts that matter", () => {
    const { ws, api } = shop();
    for (let i = 0; i < 600; i++) {
      const e = makeElement("c4:Container", `Filler ${i}`);
      ws.elements[e.id] = e;
    }
    const text = describeModel(ws, reg, { selection: [api.id] });
    expect(text).toContain("(showing 400 most relevant elements)");
    expect(text).toContain("- Order API [Container]");
  });
});
