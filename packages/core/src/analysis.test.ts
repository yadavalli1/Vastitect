import { describe, expect, it } from "vitest";
import { GAP_QUERIES, emptyWorkspace, gapQuery, makeElement, makeRelationship, whatBreaks, whoUses, type Workspace } from "./index";

function ws() {
  const w: Workspace = emptyWorkspace();
  const add = (type: string, name: string, extra = {}) => ((w.elements[name] = { ...makeElement(type, name, extra), id: name }), name);
  const rel = (type: string, a: string, b: string, extra = {}) => {
    const r = makeRelationship(type, a, b, extra);
    w.relationships[r.id] = r;
  };
  add("c4:SoftwareSystem", "Shop", { owner: "A" });
  add("c4:Container", "Shop API", { parent: "Shop" });
  add("c4:SoftwareSystem", "Warehouse", { owner: "B", lifecycle: { phase: "phaseOut" } });
  add("c4:Container", "WMS DB", { parent: "Warehouse" });
  add("c4:SoftwareSystem", "Reporting");
  add("archimate:DataObject", "Order");
  rel("c4:Uses", "Shop API", "WMS DB", { label: "reads stock" });
  rel("c4:Uses", "Reporting", "Shop", { label: "pulls sales" });
  rel("archimate:Access", "Shop", "Order", { properties: { accessType: "ReadWrite" } });
  rel("archimate:Access", "Warehouse", "Order", { properties: { accessType: "Read" } });
  return w;
}

describe("impact analysis", () => {
  it("answers what breaks if an element is retired, through containment and transitively", () => {
    const r = whatBreaks(ws(), "Warehouse");
    expect(r.rows.map((x) => x.element)).toEqual(["WMS DB", "Shop", "Shop API", "Reporting"]);
    expect(r.rows.find((x) => x.element === "WMS DB")!.detail).toBe("part of Warehouse");
    expect(r.rows.find((x) => x.element === "Shop API")!.detail).toMatch(/directly: Shop API → WMS DB \(reads stock\)/);
    expect(r.rows.find((x) => x.element === "Reporting")!.detail).toMatch(/indirectly \(2 steps\)/);
    expect(whatBreaks(ws(), "Reporting").summary).toBe("Nothing in the model depends on Reporting.");
  });

  it("answers which applications use a data object", () => {
    const r = whoUses(ws(), "Order", new Set(["c4:SoftwareSystem"]));
    expect(r.rows).toEqual([{ element: "Shop", detail: "Access (ReadWrite)" }, { element: "Warehouse", detail: "Access (Read)" }]);
  });

  it("answers data-quality questions", () => {
    const noOwner = GAP_QUERIES.find((q) => q.id === "no-owner")!;
    expect(gapQuery(ws(), noOwner, new Set(["c4:SoftwareSystem"])).rows.map((r) => r.element)).toEqual(["Reporting"]);
    expect(gapQuery(ws(), GAP_QUERIES.find((q) => q.id === "end-of-life")!).rows.map((r) => r.element)).toEqual(["Warehouse"]);
  });
});
