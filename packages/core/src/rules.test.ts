import { describe, expect, it } from "vitest";
import { Registry } from "./registry";
import { emptyWorkspace, makeElement, makeRelationship, makeView, type Workspace } from "./model";
import { checkRules, parseRules } from "./rules";
import { STARTER_RULES } from "./defaults";
import { fromFiles, toFiles } from "./serialize";
import { validate } from "./validate";

function shop(): Workspace {
  const ws = emptyWorkspace("Shop");
  const shopSys = makeElement("c4:SoftwareSystem", "Shop", { owner: "Team A", description: "x" });
  const billing = makeElement("c4:SoftwareSystem", "Billing");
  const api = makeElement("c4:Container", "Shop API", { parent: shopSys.id, description: "x" });
  const db = makeElement("c4:Container", "Shop DB", { parent: shopSys.id, properties: { kind: "Database" }, description: "x" });
  const legacy = makeElement("c4:SoftwareSystem", "Legacy CRM", { owner: "Team B", description: "x", lifecycle: { phase: "endOfLife" } });
  const worker = makeElement("c4:Container", "Billing worker", { parent: billing.id, lifecycle: { phase: "active" } });
  for (const e of [shopSys, billing, api, db, legacy, worker]) ws.elements[e.id] = e;
  for (const r of [makeRelationship("c4:Uses", api.id, db.id), makeRelationship("c4:Uses", worker.id, db.id, { label: "reads orders" }), makeRelationship("c4:Uses", worker.id, legacy.id)]) ws.relationships[r.id] = r;
  const v = makeView("c4", "Landscape", { viewpoint: "c4:landscape" });
  v.nodes.push({ element: shopSys.id, x: 0, y: 0, w: 100, h: 60 });
  ws.views[v.id] = v;
  ws.rules = STARTER_RULES;
  return ws;
}
const msgs = (ws: Workspace, id: string) => checkRules(ws).find((r) => r.rule.id === id)!.problems.map((p) => p.message);

describe("architecture rules", () => {
  it("checks required fields, forbidden dependencies and boundaries", () => {
    const ws = shop();
    expect(msgs(ws, "systems-have-owners")).toEqual(['Every software system has an owner: "Billing" has no owner']);
    expect(msgs(ws, "no-new-dependencies-on-retiring")).toEqual(['Nothing active depends on something being retired: "Billing worker" → "Legacy CRM"']);
    // Shop API → Shop DB is inside one system; the billing worker reaching into it is not.
    expect(msgs(ws, "no-shared-databases")).toEqual(['Databases are only used from inside their own system: "Billing worker" → "Shop DB" (reads orders)']);
    expect(checkRules(ws).find((r) => r.rule.id === "no-shared-databases")!.checked).toBe(2);
  });

  it("supports wildcards, tags, properties, links, limits and disabling", () => {
    const ws = shop();
    ws.rules = [
      { id: "in-view", match: { type: "c4:*", name: "^shop$" }, require: ["inView", "tag:pci", "link:repo", "property:tier"] },
      { id: "fan-in", severity: "error", match: { property: { kind: "Database" } }, maxDependents: 1 },
      { id: "off", enabled: false, require: ["owner"] },
    ];
    expect(msgs(ws, "in-view")).toEqual(['in-view: "Shop" has no tag "pci", has no link "repo", has no property "tier"']);
    expect(msgs(ws, "fan-in")).toEqual(['fan-in: "Shop DB" is used by 2 elements (limit 1)']);
    expect(checkRules(ws).map((r) => r.rule.id)).not.toContain("off");
    expect(validate(ws, new Registry()).filter((p) => p.code === "rule:fan-in")[0]).toMatchObject({ severity: "error" });
  });

  it("reports broken rules without stopping the others", () => {
    const { rules, problems } = parseRules([{ id: "Bad Id", require: ["owner"] }, { id: "nothing" }, { id: "ok", require: ["owner"] }]);
    expect(rules.map((r) => r.id)).toEqual(["ok"]);
    expect(problems.map((p) => p.message)).toEqual([expect.stringContaining("Rule Bad Id"), expect.stringContaining("needs require, forbid")]);
  });

  it("round-trips through vastitecture.yaml and leaves rule-less files unchanged", () => {
    const ws = shop();
    const { files } = toFiles(ws);
    expect(files["vastitecture.yaml"]).toContain("rules:\n  - id: systems-have-owners");
    expect(fromFiles(files).workspace.rules).toEqual(ws.rules);
    expect(toFiles({ ...ws, rules: [] }).files["vastitecture.yaml"]).not.toContain("rules");
  });
});
