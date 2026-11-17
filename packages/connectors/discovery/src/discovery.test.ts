import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ModelStore, diffPatch, emptyWorkspace, reconcilePatch, type ImportInput, type ModelPatch, type Workspace } from "@vastitecture/core";
import { discoverApis, discoverBackstage, discoverCompose, discoverKubernetes, discoverTerraform } from "./index";

const require = createRequire(import.meta.url);
const file = (path: string, name = path.split("/").pop()!): ImportInput => ({ name, text: readFileSync(path, "utf8") });
const fixture = (rel: string) => file(new URL(`../../../../fixtures/discovery/${rel}`, import.meta.url).pathname, rel);
/** Published samples, read from their npm packages (not copied into this repository). */
const oas = (rel: string) => file(join(dirname(require.resolve("@readme/oas-examples/package.json")), rel));
const backstage = (rel: string) => file(join(dirname(require.resolve("@backstage/create-app/package.json")), "templates/default-app/examples", rel));

const apply = (patch: ModelPatch, base: Workspace = emptyWorkspace()) => {
  const s = new ModelStore(base);
  s.dispatch({ type: "applyPatch", patch });
  return s.state;
};
const names = (ws: Workspace, type?: string) => Object.values(ws.elements).filter((e) => !type || e.type === type).map((e) => e.name).sort();
const rels = (ws: Workspace) => Object.values(ws.relationships).map((r) => `${ws.elements[r.source].name} -> ${ws.elements[r.target].name}${r.label ? ` (${r.label})` : ""}`).sort();
const valid = (ws: Workspace) => {
  for (const r of Object.values(ws.relationships)) expect(ws.elements[r.source] && ws.elements[r.target], r.id).toBeTruthy();
  for (const e of Object.values(ws.elements)) if (e.parent) expect(ws.elements[e.parent], e.name).toBeTruthy();
};

describe("OpenAPI / AsyncAPI", () => {
  it("reads the published petstore specs (Swagger 2 and OpenAPI 3)", () => {
    const ws = apply(discoverApis([oas("3.0/yaml/petstore.yaml"), oas("2.0/json/petstore-expanded.json")]));
    valid(ws);
    const apis = Object.values(ws.elements).filter((e) => e.type === "archimate:ApplicationInterface");
    expect(apis.length).toBeGreaterThanOrEqual(1);
    const ops = apis.flatMap((a) => a.properties.operations as string[]);
    expect(ops).toEqual(expect.arrayContaining(["GET /pets", "POST /pets"]));
    expect(apis.every((a) => a.properties.protocol === "HTTP")).toBe(true);
    // each API belongs to a providing system
    expect(Object.values(ws.relationships).every((r) => r.type === "archimate:Composition")).toBe(true);
  });

  it("reads AsyncAPI 2 and 3 channels and their direction", () => {
    const ws = apply(discoverApis([fixture("asyncapi.yaml")]));
    valid(ws);
    expect(names(ws, "c4:Container")).toEqual(["orders.cancel-requests", "orders.placed", "shipping.shipped"]);
    expect(rels(ws)).toEqual(expect.arrayContaining(["Order Events -> orders.placed (Publishes to)", "orders.cancel-requests -> Order Events (Delivers to)", "Shipping Events -> shipping.shipped (Sends to)"]));
  });

  it("reports files it cannot use", () => {
    expect(discoverApis([{ name: "x.yaml", text: "foo: bar" }]).report!.join()).toMatch(/not an OpenAPI or AsyncAPI document/);
    expect(discoverApis([{ name: "x.yaml", text: "a: [" }]).report!.join()).toMatch(/could not be read/);
  });
});

describe("docker-compose", () => {
  it("turns services into containers, with relationships from depends_on and service URLs", () => {
    const ws = apply(discoverCompose([fixture("compose.yaml")]));
    valid(ws);
    expect(names(ws, "c4:SoftwareSystem")).toEqual(["Bookshop"]);
    expect(names(ws, "c4:Container")).toEqual(["Api", "Db", "Queue", "Redis", "Web", "Worker"]);
    const by = (n: string) => Object.values(ws.elements).find((e) => e.name === n)!;
    expect(by("Db").properties).toMatchObject({ kind: "Database", technology: "postgres" });
    expect(by("Queue").properties.kind).toBe("Queue");
    expect(by("Web").properties.technology).toBe("Built from source");
    expect(rels(ws)).toEqual(["Api -> Db (Reads from and writes to)", "Api -> Redis (Uses)", "Web -> Api (Uses)", "Worker -> Queue (Uses)"]);
  });
});

describe("Kubernetes / Helm", () => {
  it("turns workloads into containers in namespace nodes and wires Services and Ingresses", () => {
    const ws = apply(discoverKubernetes([fixture("k8s.yaml"), fixture("chart/Chart.yaml")], { cluster: "prod-eu" }));
    valid(ws);
    expect(names(ws, "c4:SoftwareSystem")).toEqual(["Shop"]);
    expect(names(ws, "c4:Container")).toEqual(["Kafka", "Nightly Report", "Orders", "Orders Db", "Postgresql", "Storefront"]);
    expect(names(ws, "c4:DeploymentNode")).toEqual(["Namespace reporting", "Namespace shop", "prod-eu"]);
    expect(rels(ws)).toEqual(
      expect.arrayContaining(["Ingress public -> Storefront (Routes shop.example.com/)", "Storefront -> Orders (Calls)", "Orders -> Orders Db (Calls)", "Shop -> Postgresql (Depends on (Helm))"]),
    );
    const orders = Object.values(ws.elements).find((e) => e.name === "Orders")!;
    expect(orders.properties).toMatchObject({ replicas: 2, workloadKind: "Deployment", namespace: "shop" });
    expect(Object.values(ws.elements).find((e) => e.name === "Orders Db")!.properties.kind).toBe("Database");
  });
});

describe("Terraform", () => {
  it("turns state into deployment and infrastructure nodes, placed in their network", () => {
    const patch = discoverTerraform([fixture("terraform-show.json")]);
    const ws = apply(patch);
    valid(ws);
    const by = (n: string) => Object.values(ws.elements).find((e) => e.name === n)!;
    expect(names(ws, "c4:DeploymentNode")).toEqual(["api-1", "private-a", "shop-vpc"]);
    expect(names(ws, "c4:InfrastructureNode")).toEqual(["cdn", "notify-customer", "order-events", "orders-db"]);
    expect(by("api-1").parent).toBe(by("private-a").id);
    expect(by("private-a").parent).toBe(by("shop-vpc").id);
    expect(by("orders-db").properties).toMatchObject({ kind: "Database", engine: "postgres", terraformAddress: "aws_db_instance.orders" });
    expect(rels(ws)).toEqual(expect.arrayContaining(["api-1 -> orders-db (Depends on)", "notify-customer -> order-events (Uses)"]));
    expect(patch.report!.join()).toMatch(/Not modelled: aws_iam_role \(1\)/);
  });

  it("explains how to produce input it understands", () => {
    expect(discoverTerraform([{ name: "main.tf", text: 'resource "aws_vpc" "x" {}' }]).report!.join()).toMatch(/terraform show -json/);
  });
});

describe("Backstage", () => {
  it("reads the example catalog shipped with Backstage", () => {
    const ws = apply(discoverBackstage([backstage("entities.yaml"), backstage("org.yaml")]));
    valid(ws);
    const by = (n: string) => Object.values(ws.elements).find((e) => e.name === n)!;
    expect(by("Examples").type).toBe("c4:SoftwareSystem");
    expect(by("Example Website")).toMatchObject({ type: "c4:Container", parent: by("Examples").id, lifecycle: { phase: "phaseIn" } });
    expect(by("Example Grpc Api").type).toBe("archimate:ApplicationInterface");
    expect(rels(ws)).toContain("Example Website -> Example Grpc Api (Provides)");
    expect(by("Example Website").owner).toBeTruthy();
  });
});

describe("re-running a connector", () => {
  it("updates the same elements instead of adding duplicates, and keeps user edits", () => {
    const discovered = apply(discoverCompose([fixture("compose.yaml")]));
    // the user documents one container, then the compose file changes and discovery runs again
    const api = Object.values(discovered.elements).find((e) => e.name === "Api")!;
    const first = { ...discovered, elements: { ...discovered.elements, [api.id]: { ...api, description: "Written by a human", owner: "Team Books" } } };
    const changed = fixture("compose.yaml");
    changed.text = changed.text.replace("bookshop-api:1.4.2", "bookshop-api:1.5.0") + "  search:\n    image: opensearchproject/opensearch:2\n";
    const patch = reconcilePatch(first, discoverCompose([changed]));
    const diff = diffPatch(first, patch);
    expect(diff.added.map((a) => a.label)).toEqual(["Search (c4:Container)"]);
    expect(patch.layout).toHaveLength(2);
    const changedElements = diff.changed.filter((c) => c.kind === "element");
    expect(changedElements.map((c) => c.label)).toEqual(["Api"]);
    expect(changedElements[0].fields.map((f) => f.field)).toEqual(["properties"]);
    // the reused draft views gain the new container
    expect(diff.changed.filter((c) => c.kind === "view").map((c) => c.fields.map((f) => f.field).join())).toEqual(["nodes", "nodes"]);
    const second = apply(patch, first);
    expect(second.elements[api.id]).toMatchObject({ description: "Written by a human", owner: "Team Books", properties: { image: "ghcr.io/example/bookshop-api:1.5.0" } });
    expect(Object.keys(second.elements)).toHaveLength(Object.keys(first.elements).length + 1);
    expect(Object.keys(second.relationships)).toHaveLength(Object.keys(first.relationships).length);
    // the draft views from the first run are reused, not duplicated
    expect(Object.keys(second.views)).toHaveLength(Object.keys(first.views).length);
    expect(diff.added.filter((a) => a.kind === "view")).toEqual([]);
  });

  it("drafts a container view and a deployment view with containers inside their host", () => {
    const ws = apply(discoverKubernetes([fixture("k8s.yaml")]));
    const dep = Object.values(ws.views).find((v) => v.viewpoint === "c4:deployment")!;
    const parentName = (name: string) => {
      const el = Object.values(ws.elements).find((e) => e.name === name)!;
      return ws.elements[dep.nodes.find((n) => n.element === el.id)!.parent!].name;
    };
    expect(parentName("Orders")).toBe("Namespace shop");
    expect(parentName("Nightly Report")).toBe("Namespace reporting");
    expect(parentName("Namespace shop")).toBe("Kubernetes cluster");
    const con = Object.values(ws.views).find((v) => v.viewpoint === "c4:container")!;
    expect(con.nodes.filter((n) => n.parent === con.subject)).toHaveLength(4);
  });
});
