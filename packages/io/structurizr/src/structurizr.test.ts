import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { ModelStore, emptyWorkspace, DEFAULT_MAPPINGS, makeElement, type ModelPatch, type Workspace } from "@vastitecture/core";
import { c4TypeOf, parseDsl, parseWorkspaceJson, writeDsl, writeWorkspaceJson } from "./index";

const require = createRequire(import.meta.url);

/** The published DSL templates shipped inside the `create-structurizr` npm package. */
function publishedTemplates(): Record<string, string> {
  const src = readFileSync(require.resolve("create-structurizr/index.js"), "utf8");
  const out: Record<string, string> = {};
  const re = /templateType === '(\w+)'\) \{\s*dslContent = `([\s\S]*?)`;|\} else \{\s*dslContent = `([\s\S]*?)`;/g;
  for (let m; (m = re.exec(src)); ) out[m[1] ?? "basic"] = (m[2] ?? m[3]).replace(/\$\{workspaceName\}/g, "Sample").trim();
  return out;
}

function apply(patch: ModelPatch, base: Workspace = emptyWorkspace("Imported", ["c4"])): Workspace {
  const store = new ModelStore(base);
  store.dispatch({ type: "applyPatch", patch });
  return store.state;
}

/** Notation-independent fingerprint of a model: what must survive a round trip. */
function fingerprint(ws: Workspace) {
  const name = (id: string | undefined) => (id ? ws.elements[id]?.name : undefined);
  return {
    elements: Object.values(ws.elements)
      .map((e) => [e.type, e.name, e.description ?? "", String(e.properties.technology ?? ""), name(e.parent) ?? ""].join(" | "))
      .sort(),
    relationships: Object.values(ws.relationships)
      .map((r) => [name(r.source), name(r.target), r.label ?? "", r.technology ?? ""].join(" | "))
      .sort(),
    views: Object.values(ws.views)
      .map((v) => `${v.viewpoint} ${name(v.subject) ?? "*"}: ${v.nodes.map((n) => `${name(n.element)}${n.parent ? "<" + name(n.parent) : ""}`).sort().join(", ")} / ${v.edges.length} edges`)
      .sort(),
  };
}

const roundTrip = (text: string) => {
  const first = apply(parseDsl(text));
  const dsl = writeDsl(first, { typeOf: c4TypeOf(first) });
  const second = apply(parseDsl(dsl));
  return { first, second, dsl };
};

describe("Structurizr DSL", () => {
  const templates = publishedTemplates();

  it("finds the published templates", () => {
    expect(Object.keys(templates).sort()).toEqual(["advanced", "basic"]);
    expect(templates.advanced).toContain("softwareSystem");
  });

  it.each(["basic", "advanced"])("imports the published %s template and exports it back without losing elements or relationships", (key) => {
    const patch = parseDsl(templates[key]);
    expect(patch.report!.filter((l) => /skipped|not found|not supported/.test(l))).toEqual([]);
    const { first, second } = roundTrip(templates[key]);
    const fp = fingerprint(first);
    expect(fp.elements.length).toBe(key === "advanced" ? 6 : 4);
    expect(fp.relationships.length).toBe(key === "advanced" ? 4 : 2);
    expect(fp.views).toHaveLength(2);
    expect(fingerprint(second)).toEqual(fp);
    expect(patch.layout).toHaveLength(2);
  });

  it("reads the advanced template's structure correctly", () => {
    const ws = apply(parseDsl(templates.advanced));
    const by = (n: string) => Object.values(ws.elements).find((e) => e.name === n)!;
    expect(by("Database").type).toBe("c4:Container");
    expect(by("Database").properties.kind).toBe("Database");
    expect(by("Database").properties.technology).toBe("SQL");
    expect(by("API").parent).toBe(by("My Software System").id);
    expect(by("Employee").tags).toContain("Staff");
    expect(by("Customer").properties.group).toBe("Organization");
    const context = Object.values(ws.views).find((v) => v.viewpoint === "c4:context")!;
    expect(context.nodes.map((n) => ws.elements[n.element].name).sort()).toEqual(["Customer", "Employee", "My Software System"]);
    const containers = Object.values(ws.views).find((v) => v.viewpoint === "c4:container")!;
    expect(containers.nodes.filter((n) => n.parent === by("My Software System").id)).toHaveLength(3);
    expect(containers.properties.autoLayout).toBe("lr");
  });

  it("round-trips a workspace with components, deployment, dynamic views and groups", () => {
    const text = readFileSync(new URL("../../../../fixtures/structurizr/internet-banking.dsl", import.meta.url), "utf8");
    const patch = parseDsl(text);
    expect(patch.report!.slice(1)).toEqual([]);
    const { first, second, dsl } = roundTrip(text);
    const fp = fingerprint(first);
    expect(fp.elements).toHaveLength(20);
    expect(fp.relationships).toHaveLength(13);
    expect(fp.views).toHaveLength(6);
    expect(fingerprint(second)).toEqual(fp);
    expect(dsl).toContain('deploymentEnvironment "Live"');
    expect(dsl).toMatch(/containerInstance internetBankingSystem\.database/);
    const dyn = Object.values(first.views).find((v) => v.viewpoint === "c4:dynamic")!;
    expect(dyn.edges.map((e) => e.order)).toEqual([1, 2, 3]);
    const dep = Object.values(first.views).find((v) => v.viewpoint === "c4:deployment")!;
    const db = Object.values(first.elements).find((e) => e.name === "Database")!;
    expect(first.elements[dep.nodes.find((n) => n.element === db.id)!.parent!].name).toBe("Oracle - Primary");
    // the component view keeps sibling containers as containers and lifts everything else to systems
    const comp = fp.views.find((v) => v.startsWith("c4:component"))!;
    expect(comp).toContain("Single-Page Application");
    expect(comp).toContain("Mainframe Banking System");
  });

  it("reports unsupported syntax instead of failing or silently dropping it", () => {
    const patch = parseDsl(`workspace { model { a = person "A"\n a -> nobody "x"\n !include other.dsl\n } views { filtered "x" include "y" } }`.replace(/ \{ /g, " {\n").replace(/ \} /g, "\n}\n"));
    expect(patch.elements).toHaveLength(1);
    expect(patch.report!.join("\n")).toMatch(/unknown element "nobody"/);
    expect(patch.report!.join("\n")).toMatch(/!include/);
    expect(patch.report!.join("\n")).toMatch(/filtered/);
  });

  it("exports elements from other notations through the mapping table", () => {
    const ws: Workspace = { ...emptyWorkspace("X"), mappings: DEFAULT_MAPPINGS };
    const app = makeElement("archimate:ApplicationComponent", "Billing");
    const actor = makeElement("archimate:BusinessActor", "Clerk");
    ws.elements[app.id] = app;
    ws.elements[actor.id] = actor;
    const dsl = writeDsl(ws, { typeOf: c4TypeOf(ws) });
    expect(dsl).toContain('billing = softwareSystem "Billing"');
    expect(dsl).toContain('clerk = person "Clerk"');
  });

  it("exports one view on its own for the split editor", () => {
    const text = readFileSync(new URL("../../../../fixtures/structurizr/internet-banking.dsl", import.meta.url), "utf8");
    const ws = apply(parseDsl(text));
    const ctx = Object.values(ws.views).find((v) => v.viewpoint === "c4:context")!;
    const dsl = writeDsl(ws, { view: ctx.id, typeOf: c4TypeOf(ws) });
    expect(dsl).not.toContain("container ");
    expect(dsl).toContain("systemContext internetBankingSystem");
    expect(apply(parseDsl(dsl)).views).not.toEqual({});
  });
});

describe("Structurizr workspace JSON", () => {
  it("round-trips elements, relationships, views and positions", () => {
    const text = readFileSync(new URL("../../../../fixtures/structurizr/internet-banking.dsl", import.meta.url), "utf8");
    const first = apply(parseDsl(text));
    // give one view real positions so the JSON carries them
    const landscape = Object.values(first.views).find((v) => v.viewpoint === "c4:landscape")!;
    const store = new ModelStore(first);
    store.dispatch({ type: "updateNodes", view: landscape.id, nodes: landscape.nodes.map((n, i) => ({ element: n.element, x: i * 220, y: 110 })) });
    const json = writeWorkspaceJson(store.state, { typeOf: c4TypeOf(store.state) });
    const patch = parseWorkspaceJson(json);
    const second = apply(patch);
    expect(fingerprint(second)).toEqual(fingerprint(store.state));
    const again = Object.values(second.views).find((v) => v.viewpoint === "c4:landscape")!;
    expect(again.nodes.map((n) => n.x).sort((a, b) => a - b)).toEqual(landscape.nodes.map((_, i) => i * 220));
    expect(patch.layout).not.toContain(again.id);
    expect(JSON.parse(json).model.deploymentNodes[0].environment).toBe("Live");
  });
});
