import { describe, expect, it } from "vitest";
import { emptyWorkspace, makeElement, makeRelationship, type Element, type Workspace } from "./model";
import { comparePlateaus, costRollup, dataExposure, presenceAt, structure } from "./insights";

function ws(els: Element[], rels: [Element, Element, Record<string, unknown>?][] = []): Workspace {
  const w = emptyWorkspace();
  for (const e of els) w.elements[e.id] = e;
  for (const [a, b, p] of rels) {
    const r = makeRelationship("x:Uses", a.id, b.id, { properties: (p ?? {}) as never });
    w.relationships[r.id] = r;
  }
  return w;
}
const el = (name: string, extra: Partial<Element> = {}) => makeElement("x:Thing", name, extra);

describe("plateaus", () => {
  const crm = el("Old CRM", { lifecycle: { phase: "phaseOut", dates: { active: "2015-01-01", phaseOut: "2026-06-01", endOfLife: "2027-06-30" } } });
  const next = el("New CRM", { lifecycle: { phase: "phaseIn", dates: { plan: "2026-09-01", phaseIn: "2027-01-01", active: "2027-04-01" } } });
  const shop = el("Shop", { lifecycle: { phase: "active" } });
  const portal = el("Portal", { lifecycle: { dates: { active: "2020-01-01" } } });
  it("works out each element's phase on a date", () => {
    expect([crm, next, shop].map((e) => presenceAt(e, "2026-01-01"))).toEqual(["active", "planned", "active"]);
    expect([crm, next].map((e) => presenceAt(e, "2026-10-01"))).toEqual(["phaseOut", "plan"]);
    expect([crm, next].map((e) => presenceAt(e, "2027-07-01"))).toEqual(["retired", "active"]);
    expect(presenceAt(el("x"), "2027-01-01")).toBe("unknown");
  });
  it("compares as-is with to-be and finds dependencies the migration breaks", () => {
    const w = ws([crm, next, shop, portal], [[shop, crm], [portal, next]]);
    const d = comparePlateaus(w, "2026-01-01", "2027-07-01");
    expect(d.introduced).toEqual([next.id]);
    expect(d.retired).toEqual([crm.id]);
    expect(d.broken.map((b) => [w.elements[b.dependent].name, w.elements[b.dependency].name])).toEqual([["Shop", "Old CRM"]]);
  });
});

describe("structure metrics", () => {
  it("finds cycles, cut vertices, hotspots and instability", () => {
    const [a, b, c, d, e] = ["A", "B", "C", "D", "E"].map((n) => el(n));
    // A → B → C → A (cycle), C → D, E → D ; D is used by C and E; C is a cut vertex joining {A,B} to {D,E}
    const w = ws([a, b, c, d, e], [[a, b], [b, c], [c, a], [c, d], [e, d]]);
    const s = structure(w);
    expect(s.cycles.map((cy) => cy.map((id) => w.elements[id].name).sort())).toEqual([["A", "B", "C"]]);
    expect(s.metrics.get(c.id)).toMatchObject({ fanIn: 1, fanOut: 2, cutVertex: true, inCycle: true });
    expect(s.metrics.get(d.id)).toMatchObject({ fanIn: 2, fanOut: 0, instability: 0, reach: 4, cutVertex: true });
    expect(s.metrics.get(e.id)).toMatchObject({ instability: 1, reach: 0, cutVertex: false });
    expect(w.elements[s.hotspots[0]].name).toBe("D");
  });
});

describe("data classification", () => {
  it("follows restricted data to elements cleared for less and to external systems", () => {
    const db = el("Card vault", { properties: { dataClassification: "restricted" } });
    const pay = el("Payments", { properties: { dataClassification: "restricted" } });
    const shop = el("Shop", { properties: { dataClassification: "internal" } });
    const crm = el("CRM SaaS", { properties: { external: true } });
    const ana = el("Analytics");
    const w = ws([db, pay, shop, crm, ana], [[pay, db], [shop, pay], [pay, crm], [ana, shop], [ana, db, { dataFlow: "none" }]]);
    const x = dataExposure(w);
    const name = (id: string) => w.elements[id].name;
    expect(x.findings.map((f) => [name(f.element), f.level, f.cleared ?? (f.external ? "external" : ""), f.path.map(name).join(" › ")])).toEqual([
      ["Shop", "restricted", "internal", "Card vault › Payments › Shop"],
      ["CRM SaaS", "restricted", "external", "Card vault › Payments › CRM SaaS"],
    ]);
    // the internal Shop is a boundary: restricted data is not assumed to travel on to Analytics
    expect(x.handles.get(ana.id)?.level).toBe("internal");
  });
});

describe("costs", () => {
  it("rolls costs up through containment", () => {
    const sys = el("Shop", { properties: { monthlyCost: 100 } });
    const api = el("API", { parent: sys.id, properties: { monthlyCost: 250.5 } });
    const db = el("DB", { parent: api.id, properties: { monthlyCost: 49.5 } });
    const r = costRollup(ws([db, api, sys]));
    expect(r.get(sys.id)).toEqual({ own: 100, total: 400 });
    expect(r.get(api.id)).toEqual({ own: 250.5, total: 300 });
  });
});

import { ModelStore } from "./store";
import { fromFiles, toFiles } from "./serialize";

describe("comments", () => {
  it("are stored one per file, round-trip, and go away with their element", () => {
    const e = el("Shop");
    const s = new ModelStore(ws([e]));
    s.dispatch({ type: "putComment", comment: { id: "01AAA", target: { kind: "element", id: e.id }, author: "Ana", date: "2026-11-21", text: "Who owns this?" } });
    s.dispatch({ type: "putComment", comment: { id: "01AAB", target: { kind: "element", id: e.id }, author: "Bo", date: "2026-11-21", text: "Team A", replyTo: "01AAA" } });
    const { files } = toFiles(s.state);
    expect(Object.keys(files).filter((p) => p.startsWith("comments/")).sort()).toEqual(["comments/01aaa.yaml", "comments/01aab.yaml"]);
    expect(files["comments/01aab.yaml"]).toContain("replyTo: 01AAB".replace("AAB", "AAA"));
    expect(fromFiles(files).workspace.comments).toEqual(s.state.comments);
    s.dispatch({ type: "removeElement", id: e.id });
    expect(s.state.comments).toEqual({});
  });
});
