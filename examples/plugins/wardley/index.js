import { definePlugin } from "@vastitecture/plugin-sdk";

const STAGES = ["Genesis", "Custom built", "Product", "Commodity"];
const evolution = { key: "evolution", label: "Evolution", type: "enum", options: STAGES };

/**
 * Example plugin. It adds a whole notation (element types, relationships, a viewpoint, validity
 * rules and property-driven looks), a validator that knows the notation's rules, and a side panel.
 * Nothing in Vastitecture's core knows about Wardley maps.
 */
export default definePlugin({
  activate(ctx) {
    ctx.notations.register({
      id: "wardley",
      name: "Wardley map",
      description: "Components on a value chain, positioned by evolution.",
      elementTypes: [
        { id: "wardley:User", name: "User", category: "Map", shape: "person", fill: "#fde68a", badge: "User need", size: [110, 120] },
        {
          id: "wardley:Component",
          name: "Component",
          category: "Map",
          shape: "ellipse",
          fill: "#e2e8f0",
          badge: "Component",
          size: [150, 70],
          properties: [evolution, { key: "visibility", label: "Visibility (0-1)", type: "number" }],
          variants: [{ property: "evolution", values: { Genesis: { fill: "#fecaca" }, "Custom built": { fill: "#fed7aa" }, Product: { fill: "#bfdbfe" }, Commodity: { fill: "#bbf7d0" } } }],
        },
        { id: "wardley:Pipeline", name: "Pipeline", category: "Map", shape: "pill", fill: "#f1f5f9", badge: "Pipeline", size: [260, 60], nestable: true },
      ],
      relationshipTypes: [
        { id: "wardley:DependsOn", name: "Depends on", targetMarker: "none", dependency: "forward" },
        { id: "wardley:Evolves", name: "Evolves to", targetMarker: "arrow", line: "dashed", dependency: "none" },
      ],
      viewpoints: [{ id: "wardley:map", name: "Wardley map", layout: { direction: "DOWN" } }],
      validity: {
        mode: "rules",
        rules: [
          { source: "wardley:User", target: "wardley:Component", types: ["wardley:DependsOn"] },
          { source: "wardley:Component", target: "wardley:Component", types: ["wardley:DependsOn", "wardley:Evolves"] },
        ],
      },
      defaultRelationship: "wardley:DependsOn",
    });

    ctx.validators.register({
      id: "wardley-evolution",
      run(ws) {
        const problems = [];
        for (const r of Object.values(ws.relationships)) {
          if (r.type !== "wardley:Evolves") continue;
          const a = ws.elements[r.source], b = ws.elements[r.target];
          if (!a || !b) continue;
          const from = STAGES.indexOf(a.properties.evolution), to = STAGES.indexOf(b.properties.evolution);
          if (from >= 0 && to >= 0 && to <= from)
            problems.push({ code: "wardley/evolves-backwards", severity: "warning", message: `"${a.name}" evolves to "${b.name}", which is not further along`, target: { kind: "relationship", id: r.id } });
        }
        return problems;
      },
    });

    ctx.panels.register({
      id: "wardley-summary",
      title: "Wardley summary",
      render(ws) {
        const counts = Object.fromEntries(STAGES.map((s) => [s, 0]));
        for (const e of Object.values(ws.elements)) if (e.type === "wardley:Component" && counts[e.properties.evolution] !== undefined) counts[e.properties.evolution]++;
        const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
        return `<table>${STAGES.map((s) => `<tr><td>${esc(s)}</td><td><b>${counts[s]}</b></td></tr>`).join("")}</table>`;
      },
    });
  },
});
