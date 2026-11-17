import { definePlugin, type NotationPack } from "@vastitecture/plugin-sdk";

const g = (name: string, shape: NotationPack["elementTypes"][number]["shape"], extra: Partial<NotationPack["elementTypes"][number]> = {}) => ({
  id: `generic:${name.replace(/\s+/g, "")}`,
  name,
  shape,
  category: "Shapes",
  size: [140, 70] as [number, number],
  ...extra,
});

export const pack: NotationPack = {
  id: "generic",
  name: "Generic",
  description: "Boxes, groups, notes and flowchart shapes for whiteboarding.",
  elementTypes: [
    g("Box", "rect"),
    g("Rounded Box", "rounded"),
    g("Group", "group", { container: true, size: [320, 220] }),
    g("Note", "note", { fill: "#fde68a" }),
    g("Image", "rect", { icon: "🖼", properties: [{ key: "href", label: "Image URL", type: "string" }] }),
    g("Start End", "pill", { category: "Flowchart", name: "Start / End" }),
    g("Process", "rect", { category: "Flowchart" }),
    g("Decision", "diamond", { category: "Flowchart", size: [130, 90] }),
    g("Data", "parallelogram", { category: "Flowchart" }),
    g("Document", "document", { category: "Flowchart" }),
    g("Database", "cylinder", { category: "Flowchart", size: [110, 90] }),
    g("Actor", "person", { category: "Flowchart", size: [110, 120] }),
  ],
  relationshipTypes: [
    { id: "generic:Arrow", name: "Arrow", targetMarker: "arrow" },
    { id: "generic:Dashed", name: "Dashed arrow", targetMarker: "arrow", line: "dashed" },
    { id: "generic:Line", name: "Line", targetMarker: "none", dependency: "none" },
  ],
  viewpoints: [
    { id: "generic:whiteboard", name: "Whiteboard" },
    { id: "generic:flowchart", name: "Flowchart", layout: { direction: "DOWN" } },
  ],
  validity: { mode: "permissive" },
  defaultRelationship: "generic:Arrow",
};

export default definePlugin({
  manifest: { id: "vastitecture.generic", name: "Generic notation", version: "0.1.0", apiVersion: "1.0.0", capabilities: ["notation"] },
  activate(ctx) {
    ctx.notations.register(pack);
  },
});
