import { definePlugin, type Element, type Workspace } from "@vastitecture/plugin-sdk";
import { parseCml, writeCml } from "./cml";

export * from "./cml";

/** How an element appears in DDD: its own type, an explicit facet, or the workspace mapping table. */
export function dddTypeOf(ws: Workspace) {
  return (el: Element): string | undefined => {
    if (el.type.startsWith("ddd:")) return el.type;
    const facet = el.facets?.ddd?.type;
    if (facet) return facet;
    for (const rule of ws.mappings) {
      if (!Object.values(rule.members).some((m) => m.includes(el.type))) continue;
      if (rule.members.ddd?.length) return rule.members.ddd[0];
    }
    return undefined;
  };
}

export default definePlugin({
  manifest: { id: "vastitecture.io.cml", name: "Context Mapper CML", version: "0.1.0", apiVersion: "1.0.0", capabilities: ["importer", "exporter"] },
  activate(ctx) {
    ctx.importers.register({ id: "cml", label: "Context Mapper CML", extensions: ["cml"], detect: (i) => /\b(ContextMap|BoundedContext)\s+\w/.test(i.text), import: (i) => parseCml(i.text) });
    ctx.exporters.register({ id: "cml", label: "Context Mapper CML", extension: "cml", scope: "workspace", export: (ws) => writeCml(ws, { typeOf: dddTypeOf(ws) }) });
    ctx.exporters.register({ id: "cml-view", label: "Context Mapper CML (this view)", extension: "cml", scope: "view", notations: ["ddd"], roundTripWith: "cml", language: "cml", export: (ws, o) => writeCml(ws, { view: o.view, typeOf: dddTypeOf(ws) }) });
  },
});
