import { definePlugin, type Element, type Workspace } from "@vastitecture/plugin-sdk";
import { parseC4Text, writeC4Text } from "./c4text";
import { parseMermaidFlowchart, writeMermaidFlowchart } from "./flowchart";
import { parseDrawio, writeDrawio } from "./drawio";
import { inventoryTable, parseInventoryCsv, parseInventoryXlsx, tableToCsv, tableToXlsx } from "./tabular";

export * from "./c4text";
export * from "./flowchart";
export * from "./drawio";
export * from "./tabular";
export * from "./xlsx";
export * from "./zip";

const C4 = ["c4:Person", "c4:SoftwareSystem", "c4:Container", "c4:Component", "c4:DeploymentNode", "c4:InfrastructureNode"];
const c4TypeOf = (ws: Workspace) => (el: Element) => {
  if (el.type.startsWith("c4:")) return el.type;
  if (el.facets?.c4?.type) return el.facets.c4.type;
  for (const rule of ws.mappings) if (Object.values(rule.members).some((m) => m.includes(el.type))) return rule.members.c4?.find((t) => C4.includes(t));
  return undefined;
};
const isMermaidC4 = (t: string) => /^\s*(```\s*mermaid\s*)?\s*C4(Context|Container|Component|Dynamic|Deployment)\b/m.test(t);

export default definePlugin({
  manifest: { id: "vastitecture.io.formats", name: "Mermaid, PlantUML, draw.io, CSV and Excel", version: "0.1.0", apiVersion: "1.0.0", capabilities: ["importer", "exporter"] },
  activate(ctx) {
    ctx.importers.register({ id: "mermaid-c4", label: "Mermaid C4", extensions: ["mmd", "mermaid", "md"], detect: (i) => isMermaidC4(i.text), import: (i) => parseC4Text(i.text, "mermaid") });
    ctx.importers.register({ id: "mermaid-flowchart", label: "Mermaid flowchart", extensions: ["mmd", "mermaid", "md"], detect: (i) => /^\s*(```\s*mermaid\s*)?\s*(graph|flowchart)\s/m.test(i.text), import: (i) => parseMermaidFlowchart(i.text) });
    ctx.importers.register({ id: "c4-plantuml", label: "C4-PlantUML", extensions: ["puml", "plantuml", "iuml", "wsd"], detect: (i) => /@startuml/.test(i.text) && /\b(Person|System|Container|Component)(_Ext|Db|Queue)?\s*\(/.test(i.text), import: (i) => parseC4Text(i.text, "plantuml") });
    ctx.importers.register({ id: "drawio", label: "draw.io (as generic shapes)", extensions: ["drawio", "xml"], detect: (i) => /<mxfile|<mxGraphModel/.test(i.text), import: (i) => parseDrawio(i.text, i.name) });
    ctx.importers.register({ id: "inventory-csv", label: "Inventory CSV", extensions: ["csv"], import: (i, ws) => parseInventoryCsv(i.text, ws) });
    ctx.importers.register({
      id: "inventory-xlsx",
      label: "Inventory Excel",
      extensions: ["xlsx"],
      import: (i, ws) => {
        if (!i.bytes) throw new Error("Excel import needs the file's bytes");
        return parseInventoryXlsx(i.bytes, ws);
      },
    });

    const view = (o: { view?: string }) => {
      if (!o.view) throw new Error("Open a view first");
      return o.view;
    };
    ctx.exporters.register({ id: "mermaid-c4", label: "Mermaid C4 (this view)", extension: "mmd", scope: "view", notations: ["c4"], roundTripWith: "mermaid-c4", export: (ws, o) => writeC4Text(ws, view(o), "mermaid", c4TypeOf(ws)) });
    ctx.exporters.register({ id: "mermaid-flowchart", label: "Mermaid flowchart (this view)", extension: "mmd", scope: "view", export: (ws, o) => writeMermaidFlowchart(ws, view(o)) });
    ctx.exporters.register({ id: "c4-plantuml", label: "C4-PlantUML (this view)", extension: "puml", scope: "view", notations: ["c4"], roundTripWith: "c4-plantuml", export: (ws, o) => writeC4Text(ws, view(o), "plantuml", c4TypeOf(ws)) });
    ctx.exporters.register({ id: "drawio-view", label: "draw.io (this view)", extension: "drawio", scope: "view", export: (ws, o) => writeDrawio(ws, [view(o)]) });
    ctx.exporters.register({ id: "drawio", label: "draw.io (all views)", extension: "drawio", scope: "workspace", export: (ws) => writeDrawio(ws, Object.values(ws.views).filter((v) => v.nodes.length).sort((a, b) => a.name.localeCompare(b.name)).map((v) => v.id)) });
    ctx.exporters.register({ id: "inventory-csv", label: "Inventory CSV", extension: "csv", scope: "workspace", export: (ws) => tableToCsv(inventoryTable(ws)) });
    ctx.exporters.register({ id: "inventory-xlsx", label: "Inventory Excel", extension: "xlsx", scope: "workspace", export: (ws) => tableToXlsx(inventoryTable(ws)) });
  },
});
export * from "./pdf";
