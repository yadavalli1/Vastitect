import { definePlugin, type Element, type Workspace } from "@vastitecture/plugin-sdk";
import { pack } from "@vastitecture/notation-archimate";
import { parseArchi } from "./archi";
import { parseExchange, writeExchange } from "./exchange";

export * from "./archi";
export * from "./exchange";

const known = new Set(pack.elementTypes.map((t) => t.id));

/** How an element appears in ArchiMate: its own type, an explicit facet, or the workspace mapping table. */
export function archimateTypeOf(ws: Workspace) {
  return (el: Element): string | undefined => {
    if (el.type.startsWith("archimate:")) return el.type;
    const facet = el.facets?.archimate?.type;
    if (facet) return facet;
    for (const rule of ws.mappings) {
      if (!Object.values(rule.members).some((m) => m.includes(el.type))) continue;
      const hit = rule.members.archimate?.find((t) => known.has(t));
      if (hit) return hit;
    }
    return undefined;
  };
}

export default definePlugin({
  manifest: { id: "vastitecture.io.archimate", name: "ArchiMate exchange format and Archi", version: "0.1.0", apiVersion: "1.0.0", capabilities: ["importer", "exporter"] },
  activate(ctx) {
    ctx.importers.register({
      id: "archimate-exchange",
      label: "ArchiMate Model Exchange File Format",
      extensions: ["xml"],
      detect: (i) => i.text.includes("opengroup.org/xsd/archimate"),
      import: (i) => parseExchange(i.text),
    });
    ctx.importers.register({
      id: "archi",
      label: "Archi model",
      extensions: ["archimate"],
      detect: (i) => i.text.includes("archimatetool.com/archimate"),
      import: (i) => parseArchi(i.text),
    });
    ctx.exporters.register({
      id: "archimate-exchange",
      label: "ArchiMate Model Exchange File Format (3.x)",
      extension: "xml",
      scope: "workspace",
      export: (ws) => writeExchange(ws, { typeOf: archimateTypeOf(ws) }),
    });
  },
});
