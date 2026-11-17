import { definePlugin, type NotationPack, type PropertyDef } from "@vastitecture/plugin-sdk";

const technology: PropertyDef = { key: "technology", label: "Technology", type: "string" };
const location: PropertyDef = { key: "location", label: "Location", type: "enum", options: ["Internal", "External"] };
const external = { property: "location", values: { External: { fill: "#d4d4d8" } } };

/** Colour-blind-safe blues with distinct shapes and stereotype labels, so type never depends on colour alone. */
export const pack: NotationPack = {
  id: "c4",
  name: "C4 model",
  description: "Person, Software System, Container, Component and Deployment Node, with the six C4 view types.",
  elementTypes: [
    { id: "c4:Person", name: "Person", category: "Static", shape: "person", fill: "#9cc4f0", badge: "Person", size: [150, 150], properties: [location], variants: [external] },
    { id: "c4:SoftwareSystem", name: "Software System", category: "Static", shape: "rounded", fill: "#6ea8e5", badge: "Software System", size: [200, 110], container: ["c4:Container"], properties: [location], variants: [external] },
    {
      id: "c4:Container",
      name: "Container",
      category: "Static",
      shape: "rounded",
      fill: "#a5d3f2",
      badge: "Container",
      size: [190, 110],
      container: ["c4:Component"],
      properties: [technology, { key: "kind", label: "Kind", type: "enum", options: ["Application", "Database", "Queue", "Browser", "Mobile", "Folder"] }],
      variants: [
        {
          property: "kind",
          values: { Database: { shape: "cylinder" }, Queue: { shape: "pill" }, Browser: { shape: "folder" }, Mobile: { shape: "octagon" }, Folder: { shape: "folder" } },
        },
      ],
    },
    { id: "c4:Component", name: "Component", category: "Static", shape: "component", fill: "#cfe6f7", badge: "Component", size: [180, 100], properties: [technology] },
    {
      id: "c4:DeploymentNode",
      name: "Deployment Node",
      category: "Deployment",
      shape: "node3d",
      badge: "Deployment Node",
      size: [340, 220],
      container: true,
      properties: [technology, { key: "environment", label: "Environment", type: "string" }, { key: "instances", label: "Instances", type: "string" }],
    },
    { id: "c4:InfrastructureNode", name: "Infrastructure Node", category: "Deployment", shape: "hexagon", fill: "#e2e8f0", badge: "Infrastructure Node", size: [180, 90], properties: [technology] },
  ],
  relationshipTypes: [{ id: "c4:Uses", name: "Uses", targetMarker: "arrow", line: "dashed", dependency: "forward" }],
  viewpoints: [
    { id: "c4:landscape", name: "System Landscape", description: "People and software systems across the organisation.", elementTypes: ["c4:Person", "c4:SoftwareSystem"] },
    { id: "c4:context", name: "System Context", description: "One system, its users and the systems it talks to.", elementTypes: ["c4:Person", "c4:SoftwareSystem"] },
    { id: "c4:container", name: "Container", description: "The deployable units inside one system.", elementTypes: ["c4:Person", "c4:SoftwareSystem", "c4:Container"] },
    { id: "c4:component", name: "Component", description: "The building blocks inside one container.", elementTypes: ["c4:Person", "c4:SoftwareSystem", "c4:Container", "c4:Component"] },
    { id: "c4:dynamic", name: "Dynamic", description: "A numbered sequence of interactions.", elementTypes: ["c4:Person", "c4:SoftwareSystem", "c4:Container", "c4:Component"], layout: { direction: "RIGHT" } },
    { id: "c4:deployment", name: "Deployment", description: "Containers mapped onto infrastructure.", elementTypes: ["c4:DeploymentNode", "c4:InfrastructureNode", "c4:SoftwareSystem", "c4:Container"] },
  ],
  validity: { mode: "rules", rules: [{ source: "*", target: "*", types: ["c4:Uses"] }] },
  defaultRelationship: "c4:Uses",
  drillDown: [
    { type: "c4:SoftwareSystem", viewpoint: "c4:container" },
    { type: "c4:Container", viewpoint: "c4:component" },
  ],
};

export default definePlugin({
  manifest: { id: "vastitecture.c4", name: "C4 model", version: "0.1.0", apiVersion: "1.0.0", capabilities: ["notation"] },
  activate(ctx) {
    ctx.notations.register(pack);
  },
});
