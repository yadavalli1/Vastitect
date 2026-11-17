import { definePlugin, type NotationPack } from "@vastitecture/plugin-sdk";

export const ADM_PHASES = [
  "Preliminary",
  "A: Architecture Vision",
  "B: Business Architecture",
  "C: Information Systems Architectures",
  "D: Technology Architecture",
  "E: Opportunities and Solutions",
  "F: Migration Planning",
  "G: Implementation Governance",
  "H: Architecture Change Management",
  "Requirements Management",
];
export const DOMAINS = ["Business", "Data", "Application", "Technology"];

/**
 * TOGAF support is mostly cross-cutting: ADM phase tags on any element or view, building blocks,
 * and catalogs and matrices generated from the model whatever notation it was drawn in.
 */
export const pack: NotationPack = {
  id: "togaf",
  name: "TOGAF",
  description: "ADM phase tagging, building blocks, catalogs and matrices.",
  elementTypes: [
    { id: "togaf:ArchitectureBuildingBlock", name: "Architecture Building Block", category: "Building blocks", shape: "rect", fill: "#e0e7ff", badge: "ABB", size: [190, 80], nestable: true },
    { id: "togaf:SolutionBuildingBlock", name: "Solution Building Block", category: "Building blocks", shape: "component", fill: "#ccfbf1", badge: "SBB", size: [190, 80] },
  ],
  relationshipTypes: [
    { id: "togaf:Realizes", name: "Realizes", line: "dashed", targetMarker: "triangle", dependency: "reverse" },
    { id: "togaf:Uses", name: "Uses", targetMarker: "arrow", dependency: "forward" },
  ],
  viewpoints: [{ id: "togaf:building-blocks", name: "Building blocks", description: "Architecture building blocks and the solution building blocks that realise them." }],
  validity: {
    mode: "rules",
    rules: [
      { source: "togaf:SolutionBuildingBlock", target: "togaf:ArchitectureBuildingBlock", types: ["togaf:Realizes"] },
      { source: "*", target: "*", types: ["togaf:Uses"] },
    ],
  },
  defaultRelationship: "togaf:Uses",
  globalProperties: [
    { key: "admPhase", label: "ADM phase", type: "enum", options: ADM_PHASES, group: "TOGAF" },
    { key: "buildingBlock", label: "Building block", type: "enum", options: ["Architecture (ABB)", "Solution (SBB)"], group: "TOGAF" },
  ],
  viewProperties: [
    { key: "admPhase", label: "ADM phase", type: "enum", options: ADM_PHASES },
    { key: "architectureDomain", label: "Architecture domain", type: "enum", options: DOMAINS },
  ],
  reports: [
    { id: "togaf:application-portfolio", name: "Application Portfolio Catalog", kind: "catalog", rows: ["concept:business-system"], fields: ["name", "type", "description", "owner", "lifecycle", "criticality", "technicalFit", "annualCost", "admPhase"] },
    { id: "togaf:application-function", name: "Application/Function Matrix", kind: "matrix", rows: ["concept:business-system"], columns: ["archimate:Function", "archimate:Process", "archimate:Capability"] },
    { id: "togaf:application-interaction", name: "Application Interaction Matrix", kind: "matrix", rows: ["concept:business-system"] },
    { id: "togaf:building-blocks", name: "Building Blocks Catalog", kind: "catalog", rows: ["togaf:ArchitectureBuildingBlock", "togaf:SolutionBuildingBlock"], fields: ["name", "type", "description", "owner", "admPhase"] },
    { id: "togaf:technology-portfolio", name: "Technology Portfolio Catalog", kind: "catalog", rows: ["concept:infrastructure", "archimate:SystemSoftware"], fields: ["name", "type", "description", "technology", "owner", "lifecycle"] },
    { id: "togaf:role-catalog", name: "Actor/Role Catalog", kind: "catalog", rows: ["concept:person-or-team"], fields: ["name", "type", "description"] },
  ],
};

export default definePlugin({
  manifest: { id: "vastitecture.togaf", name: "TOGAF", version: "0.1.0", apiVersion: "1.0.0", capabilities: ["notation"] },
  activate(ctx) {
    ctx.notations.register(pack);
  },
});
