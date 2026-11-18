import { definePlugin, type Element, type Workspace } from "@vastitecture/plugin-sdk";
import { parseDsl, writeDsl } from "./dsl";
import { parseWorkspaceJson, writeWorkspaceJson } from "./json";

export * from "./dsl";
export * from "./json";

const C4_TYPES = ["c4:Person", "c4:SoftwareSystem", "c4:Container", "c4:Component", "c4:DeploymentNode", "c4:InfrastructureNode"];

/** How an element appears in C4: its own type, an explicit facet, or the workspace mapping table. */
export function c4TypeOf(ws: Workspace) {
  return (el: Element): string | undefined => {
    if (el.type.startsWith("c4:")) return el.type;
    const facet = el.facets?.c4?.type;
    if (facet) return facet;
    for (const rule of ws.mappings) {
      if (!Object.values(rule.members).some((m) => m.includes(el.type))) continue;
      const hit = rule.members.c4?.find((t) => C4_TYPES.includes(t));
      if (hit) return hit;
    }
    return undefined;
  };
}

export default definePlugin({
  manifest: { id: "vastitecture.io.structurizr", name: "Structurizr DSL and JSON", version: "0.1.0", apiVersion: "1.0.0", capabilities: ["importer", "exporter"] },
  activate(ctx) {
    ctx.importers.register({
      id: "structurizr-dsl",
      label: "Structurizr DSL",
      extensions: ["dsl"],
      detect: (i) => /\bworkspace\b[^{]*\{/.test(i.text) && /\bmodel\s*\{/.test(i.text),
      import: (i) => parseDsl(i.text),
    });
    ctx.importers.register({
      id: "structurizr-json",
      label: "Structurizr workspace JSON",
      extensions: ["json"],
      detect: (i) => /"softwareSystems"|"systemContextViews"|"people"/.test(i.text),
      import: (i) => parseWorkspaceJson(i.text),
    });
    ctx.exporters.register({ id: "structurizr-dsl", label: "Structurizr DSL", extension: "dsl", scope: "workspace", export: (ws) => writeDsl(ws, { typeOf: c4TypeOf(ws) }) });
    ctx.exporters.register({ id: "structurizr-dsl-view", label: "Structurizr DSL (this view)", extension: "dsl", scope: "view", notations: ["c4"], roundTripWith: "structurizr-dsl", language: "structurizr", export: (ws, o) => writeDsl(ws, { view: o.view, typeOf: c4TypeOf(ws) }) });
    ctx.exporters.register({ id: "structurizr-json", label: "Structurizr workspace JSON", extension: "json", scope: "workspace", export: (ws) => writeWorkspaceJson(ws, { typeOf: c4TypeOf(ws) }) });
  },
});
