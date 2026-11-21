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

import { readdirSync } from "node:fs";
import { discoverAws, discoverGit } from "./index";

describe("AWS", () => {
  it("turns read-only CLI output into account, network and service nodes", () => {
    const dir = new URL("../../../../fixtures/discovery/aws/", import.meta.url).pathname;
    const patch = discoverAws(readdirSync(dir).map((f) => file(dir + f, f)), { region: "eu-west-1" });
    const ws = apply(patch);
    valid(ws);
    const by = (n: string) => Object.values(ws.elements).find((e) => e.name === n)!;
    expect(by("api-1").parent).toBe(by("private-a").id);
    expect(by("private-a").parent).toBe(by("shop-vpc").id);
    expect(by("shop-vpc").parent).toBe(by("AWS account 123456789012").id);
    expect(by("orders-db")).toMatchObject({ type: "c4:InfrastructureNode", parent: by("shop-vpc").id, properties: { kind: "Database" } });
    expect(names(ws)).not.toContain("i-0dead");
    expect(names(ws)).toEqual(expect.arrayContaining(["notify-customer", "order-events", "shop-assets", "prod-eu"]));
    expect(patch.report![0]).toBe("AWS: 8 resource(s) in account 123456789012");
  });
});

describe("Git repository", () => {
  it("detects languages, dependencies and the remote, and links them to an element", () => {
    const files = [
      { name: "shop/.git/config", text: '[remote "origin"]\n\turl = git@github.com:acme/shop.git\n' },
      { name: "shop/package.json", text: JSON.stringify({ dependencies: { react: "18", express: "4" }, devDependencies: { vitest: "2" } }) },
      { name: "shop/api/requirements.txt", text: "fastapi==0.110\nuvicorn[standard]>=0.29 # server\n" },
      ...Array.from({ length: 30 }, (_, i) => ({ name: `shop/src/f${i}.ts`, text: "" })),
      ...Array.from({ length: 10 }, (_, i) => ({ name: `shop/api/m${i}.py`, text: "" })),
      ...Array.from({ length: 500 }, (_, i) => ({ name: `shop/node_modules/x/i${i}.js`, text: "" })),
    ];
    const patch = discoverGit(files, { element: "Web App" });
    const e = patch.elements![0];
    expect(e).toMatchObject({ name: "Web App", properties: { languages: ["TypeScript 75%", "Python 25%"], technology: "TypeScript", dependencies: ["express", "fastapi", "react", "uvicorn"], repository: "https://github.com/acme/shop" }, links: [{ kind: "repo", href: "https://github.com/acme/shop" }] });
    // an existing "Web App" container is updated rather than duplicated
    const existing = apply({ elements: [{ id: "existing", type: "c4:Container", name: "Web App", tags: [], links: [], properties: { owner: "x" } }] });
    const re = reconcilePatch(existing, patch);
    expect(re.elements![0]).toMatchObject({ id: "existing", properties: { owner: "x", technology: "TypeScript" } });
  });
});

import { discoverAzure, discoverGcp, fetchServiceNow, parseServiceNowFiles, serviceNowToPatch } from "./index";
const dirFiles = (sub: string) => {
  const dir = new URL(`../../../../fixtures/discovery/${sub}/`, import.meta.url).pathname;
  return readdirSync(dir).map((f) => file(dir + f, f));
};

describe("ServiceNow CMDB", () => {
  it("reads Table API JSON and CSV exports into applications, services, hosts and relationships", () => {
    const ws = apply(serviceNowToPatch(parseServiceNowFiles(dirFiles("servicenow"))));
    valid(ws);
    const by = (n: string) => Object.values(ws.elements).find((e) => e.name === n)!;
    expect(by("Online Shop")).toMatchObject({ type: "c4:SoftwareSystem", owner: "Priya Shah", lifecycle: { phase: "active" }, properties: { criticality: "Mission critical", cmdbClass: "cmdb_ci_business_app" } });
    expect(by("Legacy Billing").lifecycle?.phase).toBe("endOfLife");
    expect(by("shop-web")).toMatchObject({ type: "c4:Container", parent: by("Online Shop").id, properties: { version: "4.2" } });
    expect(by("shop-api").parent).toBe(by("Online Shop").id);
    expect(by("shop-db").properties.kind).toBe("Database");
    expect(by("Order Placement").type).toBe("archimate:Service");
    expect(by("lnx-db-01")).toMatchObject({ type: "c4:DeploymentNode", properties: { technology: "Red Hat Enterprise Linux 9" } });
    expect(names(ws)).not.toContain("Desk phone 42");
    expect(rels(ws)).toEqual(expect.arrayContaining(["shop-web -> shop-api (Depends on)", "shop-api -> shop-db (Depends on)", "Online Shop -> Order Placement (Provides)", "Online Shop -> Legacy Billing (Sends data to)"]));
    // "Runs on" places the application on its server in the deployment view
    const dep = Object.values(ws.views).find((v) => v.viewpoint === "c4:deployment")!;
    expect(ws.elements[dep.nodes.find((n) => n.element === by("shop-web").id)!.parent!].name).toBe("lnx-web-01");
    expect(Object.values(ws.views).map((v) => v.viewpoint).sort()).toEqual(["archimate:application", "c4:container", "c4:deployment", "c4:landscape"]);
  });

  it("reads live through the Table API with paging, Basic auth, and a clear error on refused access", async () => {
    const calls: { url: string; auth?: string }[] = [];
    const big = Array.from({ length: 500 }, (_, i) => ({ sys_id: `a${i}`, name: `App ${i}`, sys_class_name: "cmdb_ci_appl" }));
    const fake = async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push({ url, auth: init?.headers?.Authorization });
      const u = new URL(url);
      const table = u.pathname.split("/").pop();
      const offset = Number(u.searchParams.get("sysparm_offset"));
      if (table === "cmdb_ci_appl") return { status: 200, text: JSON.stringify({ result: offset === 0 ? big : [{ sys_id: "z", name: "Last", sys_class_name: "cmdb_ci_appl" }] }) };
      if (table === "cmdb_rel_ci") return { status: 200, text: JSON.stringify({ result: [{ parent: "a1", child: "z", type: "Depends on::Used by" }] }) };
      return { status: 404, text: "{}" };
    };
    const data = await fetchServiceNow(fake, { instance: "acme", username: "reader", password: "pw", query: "operational_status=1" });
    expect(data.instance).toBe("https://acme.service-now.com");
    expect(data.cis).toHaveLength(501);
    expect(calls[0].auth).toBe(`Basic ${btoa("reader:pw")}`);
    expect(calls.filter((c) => c.url.includes("cmdb_ci_appl")).map((c) => new URL(c.url).searchParams.get("sysparm_offset"))).toEqual(["0", "500"]);
    expect(new URL(calls[0].url).searchParams.get("sysparm_query")).toBe("operational_status=1");
    expect(calls.every((c) => c.url.startsWith("https://acme.service-now.com/api/now/table/"))).toBe(true);
    const patch = serviceNowToPatch(data, "ServiceNow (acme)");
    expect(patch.relationships).toHaveLength(1);
    expect(patch.elements![0].links[0].href).toMatch(/^https:\/\/acme\.service-now\.com\/nav_to\.do\?uri=/);

    await expect(fetchServiceNow(async () => ({ status: 401, text: "" }), { instance: "acme.service-now.com", token: "t" })).rejects.toThrow(/cmdb_read role/);
    await expect(fetchServiceNow(fake, { instance: "acme" })).rejects.toThrow(/username and password, or an OAuth token/);
  });
});

describe("Google Cloud", () => {
  it("turns gcloud output into project, network, subnet, VM and managed services", () => {
    const patch = discoverGcp(dirFiles("gcp"));
    const ws = apply(patch);
    valid(ws);
    const by = (n: string) => Object.values(ws.elements).find((e) => e.name === n)!;
    expect(by("api-1")).toMatchObject({ parent: by("private-eu").id, properties: { technology: "Compute Engine e2-standard-4", zone: "europe-west1-b" } });
    expect(by("private-eu").parent).toBe(by("shop-vpc").id);
    expect(by("shop-vpc").parent).toBe(by("GCP project shop-prod-123").id);
    expect(by("orders-db")).toMatchObject({ parent: by("shop-vpc").id, properties: { kind: "Database", technology: "Cloud SQL POSTGRES_16" } });
    expect(by("prod-gke").parent).toBe(by("shop-vpc").id);
    expect(names(ws)).toEqual(expect.arrayContaining(["checkout", "send-receipt", "order-events", "shop-assets"]));
    expect(patch.report![0]).toBe("Google Cloud: 9 resource(s) in project shop-prod-123");
  });
});

describe("Azure", () => {
  it("turns az output into subscription, resource groups, VNet/subnet and resources, without duplicates or plumbing", () => {
    const patch = discoverAzure(dirFiles("azure"));
    const ws = apply(patch);
    valid(ws);
    const by = (n: string) => Object.values(ws.elements).filter((e) => e.name === n);
    expect(by("jumpbox")).toHaveLength(1); // listed by both `az vm list` and `az resource list`
    expect(by("jumpbox")[0]).toMatchObject({ type: "c4:DeploymentNode", parent: by("rg-shop")[0].id, properties: { size: "Standard_B2s" } });
    expect(by("rg-shop")[0].parent).toBe(by("Shop Production")[0].id);
    expect(by("aks-shop")[0].parent).toBe(by("aks")[0].id);
    expect(by("aks")[0].parent).toBe(by("vnet-shop")[0].id);
    expect(by("receipts")[0].properties.technology).toBe("Azure Functions");
    expect(by("pg-orders")[0].properties.kind).toBe("Database");
    expect(by("sb-shop")[0].properties.kind).toBe("Queue");
    expect(by("stshopassets")[0].parent).toBe(by("rg-other")[0].id);
    expect(names(ws)).not.toContain("jumpbox-nic");
    expect(patch.report![0]).toBe("Azure: 7 resource(s) in 2 resource group(s)");
  });
});

import { observeTraces, tracesToPatch } from "./index";
import { makeElement as mkEl, makeRelationship as mkRel } from "@vastitecture/core";

describe("Runtime traces", () => {
  const tr = (n: string) => fixture(`traces/${n}`);
  it("builds runtime dependencies from OpenTelemetry spans, through queues, databases and external hosts", () => {
    const obs = observeTraces([tr("otlp.json")]);
    const ws = apply(tracesToPatch(obs));
    valid(ws);
    expect(rels(ws)).toEqual([
      "shipping -> order-events (Consumes from)",
      "orders-service -> api.stripe.example (Calls)",
      "orders-service -> order-events (Publishes to)",
      "orders-service -> orders (Reads from and writes to)",
      "orders-service -> payments (Calls)",
      "web-frontend -> orders-service (Calls)",
    ].sort());
    const by = (n: string) => Object.values(ws.elements).find((e) => e.name === n)!;
    expect(by("orders")).toMatchObject({ type: "c4:Container", properties: { kind: "Database", technology: "postgresql" } });
    expect(by("order-events").properties.kind).toBe("Queue");
    expect(by("api.stripe.example")).toMatchObject({ type: "c4:SoftwareSystem", properties: { external: true } });
    expect(by("orders-service").properties.technology).toBe("java");
    const pay = Object.values(ws.relationships).find((r) => ws.elements[r.target].name === "payments")!;
    expect(pay.properties).toMatchObject({ observedCalls: 1, observedErrors: 1 });
  });

  it("reads Jaeger, Zipkin and Datadog formats", () => {
    const names = (files: string[]) => [...observeTraces(files.map(tr)).edges.values()].map((e) => `${e.from} -> ${e.to}`).sort();
    expect(names(["jaeger.json"])).toEqual(["catalog -> service:inventory"]);
    expect(observeTraces([tr("jaeger.json")]).edges.get("catalog|service:inventory")!.errors).toBe(1);
    expect(names(["zipkin.json"])).toEqual(["cart -> db:redis:redis"]);
    expect(names(["datadog-service-dependencies.json"])).toEqual(["orders-service -> service:payments", "web-frontend -> service:catalog", "web-frontend -> service:orders-service"]);
    expect(names(["jaeger-dependencies.json"])).toEqual(["catalog -> service:inventory", "web-frontend -> service:catalog"]);
  });

  it("matches services to the existing model and reports drift both ways", () => {
    const base = emptyWorkspace();
    const web = mkEl("c4:Container", "Web Frontend"), orders = mkEl("c4:Container", "Orders"), catalog = mkEl("c4:Container", "Catalog Service");
    for (const e of [web, orders, catalog]) base.elements[e.id] = e;
    for (const r of [mkRel("c4:Uses", web.id, orders.id, { label: "Places orders" }), mkRel("c4:Uses", orders.id, catalog.id, { label: "Looks up prices" })]) base.relationships[r.id] = r;
    const patch = tracesToPatch(observeTraces([tr("datadog-service-dependencies.json")]), base, { environment: "prod" });
    expect(patch.report).toEqual([
      "Traces (Datadog service dependencies): 4 service(s), 3 observed dependency(ies); 3 matched to existing elements",
      "Already modelled and confirmed by traces: 1",
      "Observed but not modelled (2, proposed below): Web Frontend → Catalog Service; Orders → payments",
      "Modelled but never observed (1, review by hand): Orders → Catalog Service",
    ]);
    // Existing elements are referenced, not duplicated or modified
    expect(patch.elements!.map((e) => e.name)).toEqual(["payments"]);
    const ws = apply(reconcilePatch(base, patch), base);
    expect(Object.keys(ws.elements)).toHaveLength(4);
    expect(Object.values(ws.views)[0].name).toBe("Runtime dependencies – prod");
    expect(Object.values(ws.views)[0].nodes).toHaveLength(4);
    expect(Object.values(ws.views)[0].edges).toHaveLength(3);
  });
});

describe("Runtime traces matching", () => {
  it("never matches a traced service to a capability or other non-running element", () => {
    const base = emptyWorkspace();
    const cap = mkEl("archimate:Capability", "Payments");
    base.elements[cap.id] = cap;
    const patch = tracesToPatch(observeTraces([fixture("traces/datadog-service-dependencies.json")]), base);
    expect(patch.elements!.map((e) => e.name).sort()).toEqual(["catalog", "orders-service", "payments", "web-frontend"]);
  });
});

import { ardoqToPatch, codeOwners, leanixToPatch, linkWorkItems, parseGithubFiles, parseWorkItemFiles, reposToPatch, sparxToPatch, fetchGithub } from "./index";

describe("GitHub organisation", () => {
  it("turns repositories into containers grouped by system topic, owned through CODEOWNERS", () => {
    const files = ["gh-repo-list.json", "orders-api.CODEOWNERS", "storefront.CODEOWNERS"].map((n) => fixture(`github/${n}`));
    const patch = reposToPatch(parseGithubFiles(files));
    const ws = apply(patch);
    valid(ws);
    const by = (n: string) => Object.values(ws.elements).find((e) => e.name === n)!;
    expect(by("orders-api")).toMatchObject({ parent: by("Shop").id, owner: "acme/orders-team, jdoe", tags: ["pci"], properties: { technology: "Java" }, links: [{ kind: "repo", href: "https://github.com/acme/orders-api" }] });
    expect(by("storefront").owner).toBe("acme/web-team"); // no * rule: the first rule's owners
    expect(by("legacy-billing")).toMatchObject({ lifecycle: { phase: "endOfLife" } });
    expect(by("legacy-billing").parent).toBeUndefined();
    expect(patch.report).toEqual(["GitHub: 3 repository(ies), 1 archived", "1 repository(ies) have no system-<name> topic and are not grouped under a system", "1 repository(ies) have no CODEOWNERS file, so no owner was set"]);
    expect(codeOwners("# c\n/a/ @x\n* @y @z # all\n")).toEqual(["y", "z"]);
  });

  it("reads an organisation live, page by page, with each CODEOWNERS file", async () => {
    const urls: string[] = [];
    const fake = async (url: string) => {
      urls.push(url);
      if (url.includes("/orgs/acme/repos")) return { status: 200, text: JSON.stringify([{ name: "a", full_name: "acme/a", language: "Go", topics: ["system-x"], html_url: "https://github.com/acme/a", archived: false }]) };
      if (url.endsWith("/acme/a/contents/.github/CODEOWNERS")) return { status: 404, text: "{}" };
      if (url.endsWith("/acme/a/contents/CODEOWNERS")) return { status: 200, text: JSON.stringify({ encoding: "base64", content: btoa("* @acme/x-team\n") }) };
      return { status: 404, text: "{}" };
    };
    const repos = await fetchGithub(fake, { org: "https://github.com/acme" });
    expect(repos[0]).toMatchObject({ fullName: "acme/a", topics: ["system-x"], codeowners: "* @acme/x-team\n" });
    expect(urls.filter((u) => u.includes("docs/CODEOWNERS"))).toEqual([]);
    await expect(fetchGithub(fake, { org: "bad name!" })).rejects.toThrow(/organisation or user/);
  });
});

describe("Work items", () => {
  const ws = () => {
    const base = emptyWorkspace();
    for (const e of [mkEl("c4:Container", "Order API"), mkEl("c4:Container", "Orders DB"), mkEl("c4:Container", "Search", { properties: { workItemKey: "legacy-search" } })]) base.elements[e.id] = e;
    return base;
  };
  it("links Jira CSV and JSON issues and Azure DevOps items to the elements they name", () => {
    const base = ws();
    const items = parseWorkItemFiles(["jira-export.csv", "jira-search.json", "azure-devops.json"].map((n) => fixture(`workitems/${n}`)));
    expect(items.map((w) => `${w.key}:${w.category}`)).toEqual(["SHOP-101:doing", "SHOP-102:todo", "SHOP-103:done", "MKT-9:todo", "SHOP-200:todo", "51:doing", "52:done"]);
    const patch = linkWorkItems(base, items, "Jira");
    expect(patch.report![0]).toBe("Jira: 7 work item(s), 5 linked to 3 element(s)");
    expect(patch.report![1]).toContain("marketing (1)");
    const after = apply(reconcilePatch(base, patch), base);
    const by = (n: string) => Object.values(after.elements).find((e) => e.name === n)!;
    expect(by("Order API").properties).toMatchObject({ workItems: "2 to do, 1 in progress, 0 done (Jira)", nextDue: "2026-12-01" });
    expect(by("Order API").links.map((l) => l.label)).toEqual(["SHOP-200: Cache order lookups"]); // CSV rows carry no URL
    expect(by("Orders DB").links[0].href).toBe("https://dev.azure.com/acme/Shop/_workitems/edit/51");
    expect(by("Orders DB").properties.nextDue).toBe("2027-03-31");
    expect(by("Search").properties.workItems).toBe("0 to do, 0 in progress, 1 done (Jira)");
    expect(Object.keys(after.elements)).toHaveLength(3);
    // Running it again changes nothing
    expect(linkWorkItems(after, items, "Jira").elements).toEqual([]);
  });
});

describe("Enterprise architecture tools", () => {
  const ent = (n: string) => fixture(`enterprise/${n}`);
  const typed = (ws: Workspace) => Object.values(ws.elements).map((e) => `${e.name} [${e.type.slice(10)}]`).sort();
  it("imports LeanIX fact sheets and relations from GraphQL and CSV", () => {
    const patch = leanixToPatch([ent("leanix-graphql.json"), ent("leanix-export.csv")]);
    const ws = apply(patch);
    valid(ws);
    expect(typed(ws)).toEqual(["Customers [Role]", "Legacy Billing [ApplicationComponent]", "Online Shop [ApplicationComponent]", "Order Capture [Capability]", "Order Management [Capability]", "PostgreSQL 16 [SystemSoftware]", "Stripe [BusinessActor]"]);
    expect(rels(ws)).toEqual(["Online Shop -> Order Management", "PostgreSQL 16 -> Online Shop"]);
    const by = (n: string) => Object.values(ws.elements).find((e) => e.name === n)!;
    expect(by("Order Capture").parent).toBe(by("Order Management").id);
    expect(by("Legacy Billing").lifecycle?.phase).toBe("endOfLife");
    expect(by("Online Shop").properties.criticality).toBe("missionCritical");
    expect(patch.report).toContain("Fact sheet types not imported: CustomThing (1)");
  });

  it("imports Ardoq components and references, mapping types by name", () => {
    const patch = ardoqToPatch([ent("ardoq-components.json"), ent("ardoq-references.json")]);
    const ws = apply(patch);
    expect(typed(ws)).toEqual(["Cart [ApplicationComponent]", "Checkout Service [ApplicationComponent]", "Payments [Capability]", "k8s-prod [Node]"]);
    expect(rels(ws)).toEqual(["Checkout Service -> Payments (Supports)", "k8s-prod -> Checkout Service (Depends on)"]);
    expect(patch.report).toContain("Component types not recognised (rename them or map by hand): Widget (1)");
  });

  it("imports UML from a Sparx EA XMI export", () => {
    const patch = sparxToPatch([ent("sparx.xmi")]);
    const ws = apply(patch);
    valid(ws);
    expect(typed(ws)).toEqual(["App Server [Node]", "Order API [ApplicationComponent]", "Order DB [ApplicationComponent]", "Order [DataObject]", "Orders REST [ApplicationInterface]", "Shop [Grouping]", "Special Order [DataObject]"]);
    expect(rels(ws)).toEqual(["App Server -> Order API", "Order API -> Orders REST", "Order DB -> Order API (reads and writes)", "Special Order -> Order"]);
    const by = (n: string) => Object.values(ws.elements).find((e) => e.name === n)!;
    expect(by("Order API")).toMatchObject({ description: "Takes orders", parent: by("Shop").id });
    expect(patch.report![0]).toBe("Sparx EA: 6 element(s) in 1 package(s), 4 relationship(s)");
    expect(patch.report).toContain("UML element types not imported: UseCase (1)");
  });
});

describe("kubectl output", () => {
  it("reads the List that `kubectl get … -o json` returns", async () => {
    const { parseAllDocuments } = await import("yaml");
    const items = parseAllDocuments(fixture("k8s.yaml").text).map((d) => d.toJS()).filter(Boolean);
    const fromKubectl = discoverKubernetes([{ name: "kubectl-get.json", text: JSON.stringify({ apiVersion: "v1", kind: "List", items }) }], { cluster: "prod" });
    const fromFiles = discoverKubernetes([fixture("k8s.yaml")], { cluster: "prod" });
    expect(fromKubectl.report![0]).toBe(fromFiles.report![0]);
    expect(fromKubectl.elements!.map((e) => e.name).sort()).toEqual(fromFiles.elements!.map((e) => e.name).sort());
  });
});

import { applyServiceNowWriteBack, planServiceNowWriteBack } from "./index";

describe("ServiceNow write-back", () => {
  const A = "a".repeat(32), B = "b".repeat(32), C = "c".repeat(32);
  function fakeInstance(opts: { relType?: boolean } = {}) {
    const sent: { method: string; url: string; body?: any }[] = [];
    const cmdb: Record<string, { name: string; short_description: string }> = { [A]: { name: "shop-web", short_description: "Web front end" }, [B]: { name: "shop-api", short_description: "" } };
    const fetch = async (url: string, init?: { method?: string; body?: string }) => {
      const u = new URL(url);
      const method = init?.method ?? "GET";
      sent.push({ method, url: u.pathname + u.search, body: init?.body ? JSON.parse(init.body) : undefined });
      const table = u.pathname.split("/")[4];
      if (method !== "GET") return { status: method === "POST" ? 201 : 200, text: "{}" };
      const q = u.searchParams.get("sysparm_query") ?? "";
      if (table === "cmdb_ci") return { status: 200, text: JSON.stringify({ result: Object.entries(cmdb).filter(([id]) => q.includes(id)).map(([sys_id, r]) => ({ sys_id, ...r })) }) };
      if (table === "cmdb_rel_ci") return { status: 200, text: JSON.stringify({ result: [] }) };
      if (table === "cmdb_rel_type") return { status: 200, text: JSON.stringify({ result: opts.relType === false ? [] : [{ sys_id: "d".repeat(32) }] }) };
      return { status: 404, text: "{}" };
    };
    return { fetch, sent };
  }
  function model() {
    const ws = emptyWorkspace();
    const web = mkEl("c4:Container", "Shop web", { description: "Web front end", properties: { externalId: `servicenow:${A}` } });
    const api = mkEl("c4:Container", "shop-api", { description: "Order and cart API", properties: { externalId: `servicenow:${B}` } });
    const gone = mkEl("c4:Container", "old", { properties: { externalId: `servicenow:${C}` } });
    const local = mkEl("c4:Container", "Not in CMDB");
    for (const e of [web, api, gone, local]) ws.elements[e.id] = e;
    for (const r of [mkRel("c4:Uses", web.id, api.id), mkRel("c4:Uses", web.id, local.id)]) ws.relationships[r.id] = r;
    return ws;
  }

  it("plans renames, descriptions and missing dependencies against the live CMDB, and never deletes", async () => {
    const { fetch, sent } = fakeInstance();
    const plan = await planServiceNowWriteBack(fetch, { instance: "acme", username: "u", password: "p" }, model());
    expect(plan.items.map((i) => [i.label, i.request.method, i.request.path, i.request.body])).toEqual([
      ['Rename "shop-web" to "Shop web"', "PATCH", `/api/now/table/cmdb_ci/${A}`, { name: "Shop web" }],
      ['Description of "shop-api"', "PATCH", `/api/now/table/cmdb_ci/${B}`, { short_description: "Order and cart API" }],
      ['"Shop web" depends on "shop-api"', "POST", "/api/now/table/cmdb_rel_ci", { parent: A, child: B, type: "d".repeat(32) }],
    ]);
    expect(plan.report).toEqual(["3 element(s) came from ServiceNow; 3 change(s) to write", "1 element(s) point at CIs that no longer exist in ServiceNow; they were skipped"]);
    expect(sent.every((s) => s.method === "GET")).toBe(true);
  });

  it("sends only the reviewed items, refuses anything outside the CMDB, and reports each result", async () => {
    const { fetch, sent } = fakeInstance();
    const plan = await planServiceNowWriteBack(fetch, { instance: "acme", token: "t" }, model());
    sent.length = 0;
    const tampered = { ...plan.items[0], id: "x", label: "Delete users", request: { method: "PATCH" as const, path: "/api/now/table/sys_user/" + A, body: {} } };
    const results = await applyServiceNowWriteBack(fetch, { instance: "acme", token: "t" }, [plan.items[0], plan.items[2], tampered]);
    expect(results).toEqual(['✓ Rename "shop-web" to "Shop web"', '✓ "Shop web" depends on "shop-api"', "✗ Delete users: refused (not a CMDB update)"]);
    expect(sent.map((s) => `${s.method} ${s.url}`)).toEqual([`PATCH /api/now/table/cmdb_ci/${A}`, "POST /api/now/table/cmdb_rel_ci"]);
  });

  it("explains when nothing came from ServiceNow or the dependency type is missing", async () => {
    expect((await planServiceNowWriteBack(fakeInstance().fetch, { instance: "acme", token: "t" }, emptyWorkspace())).report[0]).toMatch(/Discover from ServiceNow first/);
    const plan = await planServiceNowWriteBack(fakeInstance({ relType: false }).fetch, { instance: "acme", token: "t" }, model());
    expect(plan.report).toContain('The relationship type "Depends on::Used by" was not found, so 1 new dependency(ies) cannot be written');
  });
});

import { costsToPatch, parseCostFiles } from "./index";

describe("Cloud costs", () => {
  it("matches Azure cost lines to resources found by the Azure connector and to tagged elements, per month", () => {
    const base = apply(discoverAzure(dirFiles("azure")));
    const patch = costsToPatch(base, parseCostFiles([fixture("costs/azure-cost-details.csv")]));
    const ws = apply(reconcilePatch(base, patch), base);
    const by = (n: string) => Object.values(ws.elements).find((e) => e.name === n)!;
    // Two months (1 Sep – 31 Oct), so 600 EUR becomes 300 EUR a month
    expect(by("pg-orders").properties).toMatchObject({ monthlyCost: 300, costCurrency: "EUR", costPeriod: "2026-09-01 – 2026-10-31" });
    expect(by("aks-shop").properties.monthlyCost).toBe(600);
    expect(by("Shop Production").properties.monthlyCost).toBe(20); // tag system=Shop Production, no resource id
    expect(patch.report![0]).toBe("Cloud costs: 5 line(s) over 2 month(s); 920 EUR/month matched to 3 element(s)");
    expect(patch.report![1]).toMatch(/^4 EUR\/month could not be matched/);
  });

  it("reads an AWS Cost and Usage Report with tag columns", () => {
    const base = emptyWorkspace();
    const db = mkEl("c4:Container", "orders", { properties: { externalId: "aws:rds:orders" } });
    const shop = mkEl("c4:SoftwareSystem", "Online Shop");
    for (const e of [db, shop]) base.elements[e.id] = e;
    const patch = costsToPatch(base, parseCostFiles([fixture("costs/aws-cur.csv")]));
    expect(patch.elements!.map((e) => [e.name, e.properties.monthlyCost, e.properties.costCurrency])).toEqual([["orders", 95.5, "USD"], ["Online Shop", 4.5, "USD"]]);
  });
});
