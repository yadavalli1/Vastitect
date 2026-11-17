import { definePlugin, type NotationPack } from "@vastitecture/plugin-sdk";

/** Portfolio attributes shared by every element, whatever notation it was created in. Contributes no shapes. */
export const pack: NotationPack = {
  id: "inventory",
  name: "Inventory",
  description: "Fact-sheet attributes: criticality, fit and cost.",
  elementTypes: [],
  relationshipTypes: [],
  viewpoints: [],
  globalProperties: [
    { key: "criticality", label: "Business criticality", type: "enum", options: ["Mission critical", "Business critical", "Business operational", "Administrative"], group: "Portfolio" },
    { key: "technicalFit", label: "Technical fit", type: "enum", options: ["Excellent", "Adequate", "Insufficient", "Unreasonable"], group: "Portfolio" },
    { key: "functionalFit", label: "Functional fit", type: "enum", options: ["Excellent", "Adequate", "Insufficient", "Unreasonable"], group: "Portfolio" },
    { key: "annualCost", label: "Annual cost", type: "number", group: "Portfolio" },
  ],
};

export default definePlugin({
  manifest: { id: "vastitecture.inventory", name: "Inventory attributes", version: "0.1.0", apiVersion: "1.0.0", capabilities: ["notation"] },
  activate(ctx) {
    ctx.notations.register(pack);
  },
});
