import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { DEFAULT_MAPPINGS, ModelStore, Registry, emptyWorkspace, makeElement, validate, type ModelPatch, type Workspace } from "@vastitecture/core";
import { pack } from "../../../notations/ddd/src/index";
import { dddTypeOf, parseCml, writeCml } from "./index";

const require = createRequire(import.meta.url);
/** The example CML file published in the README of the `context-mapper-mcp` npm package. */
function publishedSample(): string {
  const readme = readFileSync(require.resolve("context-mapper-mcp/README.md"), "utf8");
  return /## Example CML File\s+```cml\n([\s\S]*?)```/.exec(readme)![1];
}
const apply = (patch: ModelPatch) => {
  const store = new ModelStore(emptyWorkspace("Imported", ["ddd"]));
  store.dispatch({ type: "applyPatch", patch });
  return store.state;
};
const fp = (ws: Workspace) => {
  const n = (id?: string) => (id ? ws.elements[id]?.name : "");
  return {
    elements: Object.values(ws.elements).map((e) => `${e.type}|${e.name}|${e.description ?? ""}|${n(e.parent)}|${JSON.stringify(Object.entries(e.properties).sort())}|${e.owner ?? ""}`).sort(),
    relationships: Object.values(ws.relationships).map((r) => `${r.type}|${n(r.source)}|${n(r.target)}|${r.label ?? ""}|${r.technology ?? ""}|${JSON.stringify(Object.entries(r.properties).sort())}`).sort(),
    views: Object.values(ws.views).map((v) => `${v.name}|${v.nodes.map((x) => n(x.element)).sort().join(",")}|${v.edges.length}|${JSON.stringify(v.properties)}`).sort(),
  };
};
const roundTrip = (text: string) => {
  const first = apply(parseCml(text));
  const out = writeCml(first, { typeOf: dddTypeOf(first) });
  return { first, out, second: apply(parseCml(out)) };
};

describe("Context Mapper CML", () => {
  it("imports the published sample: contexts, upstream/downstream roles and tactical elements", () => {
    const patch = parseCml(publishedSample());
    expect(patch.report!.slice(1)).toEqual([]);
    const ws = apply(patch);
    const by = (name: string, type?: string) => Object.values(ws.elements).find((e) => e.name === name && (!type || e.type === type))!;
    expect(Object.values(ws.elements).filter((e) => e.type === "ddd:BoundedContext").map((e) => e.name).sort()).toEqual(["CustomerManagement", "Inventory", "OrderManagement"]);
    const rels = Object.values(ws.relationships);
    expect(rels).toHaveLength(2);
    const acl = rels.find((r) => r.type === "ddd:AnticorruptionLayer")!;
    // source is upstream, target downstream
    expect(ws.elements[acl.source].name).toBe("CustomerManagement");
    expect(ws.elements[acl.target].name).toBe("OrderManagement");
    expect(acl.properties).toMatchObject({ upstreamRoles: "OHS,PL", downstreamRoles: "ACL" });
    expect(rels.find((r) => r.type === "ddd:Conformist")).toBeTruthy();
    expect(by("CustomerManagement").description).toBe("Manages customer data");
    expect(by("Customer", "ddd:Aggregate").parent).toBe(by("CustomerManagement").id);
    expect(by("Customer", "ddd:Entity").properties.aggregateRoot).toBe(true);
    expect(by("Address").type).toBe("ddd:ValueObject");
    expect(by("CustomerRegistered").type).toBe("ddd:DomainEvent");
    expect(by("RegisterCustomer").type).toBe("ddd:Command");
    const map = Object.values(ws.views)[0];
    expect(map).toMatchObject({ name: "ECommerceContextMap", viewpoint: "ddd:context-map", properties: { cmlType: "AS_IS" } });
    expect(map.nodes).toHaveLength(3);
    expect(patch.layout).toEqual([map.id]);
  });

  it("round-trips the published sample without losing elements or relationships", () => {
    const { first, second, out } = roundTrip(publishedSample());
    expect(fp(second)).toEqual(fp(first));
    expect(out).toContain("CustomerManagement [U,OHS,PL]->[D,ACL] OrderManagement");
    expect(out).toContain("String customerId");
  });

  it("round-trips every relationship form, domains, modules and implements", () => {
    const text = readFileSync(new URL("../../../../fixtures/cml/insurance.cml", import.meta.url), "utf8");
    const patch = parseCml(text);
    expect(patch.report!.slice(1).join("\n")).toMatch(/Service CustomerLookup .* is not imported/);
    expect(patch.report!.slice(1).join("\n")).toMatch(/UseCase is not imported/);
    const { first, second } = roundTrip(text);
    const f = fp(first);
    expect(f.relationships.filter((r) => !r.startsWith("ddd:Implements"))).toHaveLength(7);
    expect(f.relationships.filter((r) => r.startsWith("ddd:Implements"))).toHaveLength(6);
    expect(f.relationships.map((r) => r.split("|").slice(0, 3).join("|"))).toEqual(
      expect.arrayContaining([
        "ddd:CustomerSupplier|CustomerManagementContext|CustomerSelfServiceContext",
        "ddd:AnticorruptionLayer|PrintingContext|CustomerManagementContext",
        "ddd:Conformist|CustomerManagementContext|PolicyManagementContext",
        "ddd:Partnership|RiskManagementContext|PolicyManagementContext",
        "ddd:SharedKernel|PolicyManagementContext|DebtCollection",
        "ddd:CustomerSupplier|PrintingContext|DebtCollection",
        "ddd:UpstreamDownstream|RiskManagementContext|DebtCollection",
      ]),
    );
    expect(f.elements.some((e) => e.startsWith("ddd:Subdomain|CustomerManagementDomain") && e.includes('"subdomainType","Core"'))).toBe(true);
    expect(f.elements.some((e) => e.startsWith("ddd:Module|customers"))).toBe(true);
    expect(fp(second)).toEqual(f);
  });

  it("passes the DDD pack's validity rules, and flags a pattern between the wrong things", () => {
    const reg = new Registry();
    reg.registerPack(pack);
    const ws = apply(parseCml(publishedSample()));
    expect(validate(ws, reg).filter((p) => p.severity === "error")).toEqual([]);
    expect(reg.validRelationships("ddd", "ddd:BoundedContext", "ddd:BoundedContext", "ddd:context-map").types).toContain("ddd:SharedKernel");
    expect(reg.validRelationships("ddd", "ddd:Entity", "ddd:BoundedContext").types).toEqual([]);
    expect(reg.validRelationships("ddd", "ddd:Command", "ddd:Aggregate").types).toContain("ddd:Triggers");
    expect(reg.paletteFor("ddd", "ddd:event-storming").map((t) => t.name)).toEqual(expect.arrayContaining(["Domain Event", "Command", "Policy", "Read Model"]));
  });

  it("exports a C4 system as a bounded context through the mapping table", () => {
    const ws: Workspace = { ...emptyWorkspace("Shop"), mappings: DEFAULT_MAPPINGS };
    const sys = makeElement("c4:SoftwareSystem", "Online Shop", { description: "Sells things" });
    ws.elements[sys.id] = sys;
    const out = writeCml(ws, { typeOf: dddTypeOf(ws) });
    expect(out).toContain("BoundedContext OnlineShop {");
    expect(out).toContain('domainVisionStatement = "Sells things"');
    expect(out).toContain("contains OnlineShop");
  });
});
