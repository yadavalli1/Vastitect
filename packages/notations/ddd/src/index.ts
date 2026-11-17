import { definePlugin, type NotationPack, type PropertyDef } from "@vastitecture/plugin-sdk";

const sticky = (name: string, fill: string, extra: object = {}) => ({ id: `ddd:${name.replace(/\s+/g, "")}`, name, category: "Tactical", shape: "sticky" as const, fill, size: [130, 90] as [number, number], ...extra });

const STRATEGIC = ["ddd:Partnership", "ddd:SharedKernel", "ddd:CustomerSupplier", "ddd:UpstreamDownstream", "ddd:Conformist", "ddd:AnticorruptionLayer", "ddd:OpenHostService", "ddd:PublishedLanguage", "ddd:SeparateWays", "ddd:BigBallOfMud"];
const CONTEXTS = ["ddd:BoundedContext", "ddd:ExternalSystem"];

const text = (key: string, label: string): PropertyDef => ({ key, label, type: "text" });

/** Stickies follow the usual event-storming colours, but every type also has its own label and badge. */
export const pack: NotationPack = {
  id: "ddd",
  name: "Domain-Driven Design",
  description: "Strategic context maps, the Bounded Context Canvas, tactical models and Event Storming boards.",
  elementTypes: [
    { id: "ddd:Domain", name: "Domain", category: "Strategic", shape: "group", container: true, size: [520, 320], badge: "Domain" },
    {
      id: "ddd:Subdomain",
      name: "Subdomain",
      category: "Strategic",
      shape: "rounded",
      fill: "#e2e8f0",
      badge: "Subdomain",
      size: [200, 110],
      container: ["ddd:BoundedContext"],
      properties: [{ key: "subdomainType", label: "Subdomain type", type: "enum", options: ["Core", "Supporting", "Generic"] }],
      variants: [{ property: "subdomainType", values: { Core: { fill: "#fbbf77", badge: "Core subdomain" }, Supporting: { fill: "#bfdbfe", badge: "Supporting subdomain" }, Generic: { fill: "#d4d4d8", badge: "Generic subdomain" } } }],
    },
    {
      id: "ddd:BoundedContext",
      name: "Bounded Context",
      category: "Strategic",
      shape: "ellipse",
      fill: "#c7e9c0",
      badge: "Bounded Context",
      size: [210, 120],
      nestable: true,
      properties: [
        { key: "contextType", label: "Context type", type: "enum", options: ["Feature", "Application", "System", "Team"] },
        { key: "implementationTechnology", label: "Implementation technology", type: "string" },
        { key: "bigBallOfMud", label: "Big Ball of Mud", type: "boolean" },
      ],
      variants: [{ property: "bigBallOfMud", values: { true: { shape: "wave", fill: "#d6ccc2", badge: "Bounded Context · Big Ball of Mud" } } }],
    },
    { id: "ddd:ExternalSystem", name: "External System", category: "Strategic", shape: "rect", fill: "#f9c5d1", badge: "External System", size: [180, 90] },
    { id: "ddd:Team", name: "Team", category: "Strategic", shape: "person", fill: "#ddd6fe", badge: "Team", size: [130, 130] },
    { id: "ddd:Module", name: "Module", category: "Tactical", shape: "folder", fill: "#f1f5f9", badge: "Module", size: [240, 160], container: true },
    sticky("Aggregate", "#fde68a", { badge: "Aggregate", nestable: true }),
    sticky("Entity", "#fef3c7", { badge: "Entity" }),
    sticky("Value Object", "#e0f2fe", { badge: "Value Object" }),
    sticky("Domain Event", "#fdba74", { badge: "Domain Event" }),
    sticky("Command", "#93c5fd", { badge: "Command" }),
    sticky("Policy", "#d8b4fe", { badge: "Policy" }),
    sticky("Read Model", "#86efac", { badge: "Read Model" }),
  ],
  relationshipTypes: [
    { id: "ddd:Partnership", name: "Partnership", category: "Strategic", targetMarker: "none", endLabels: ["P", "P"], dependency: "none" },
    { id: "ddd:SharedKernel", name: "Shared Kernel", category: "Strategic", targetMarker: "none", endLabels: ["SK", "SK"], dependency: "none" },
    // Upstream/downstream patterns: the source is upstream, the target downstream, so the target depends on the source.
    { id: "ddd:CustomerSupplier", name: "Customer/Supplier", category: "Strategic", targetMarker: "arrow", endLabels: ["U·S", "D·C"], dependency: "reverse" },
    { id: "ddd:UpstreamDownstream", name: "Upstream/Downstream", category: "Strategic", targetMarker: "arrow", endLabels: ["U", "D"], dependency: "reverse" },
    { id: "ddd:Conformist", name: "Conformist", category: "Strategic", targetMarker: "arrow", endLabels: ["U", "D·CF"], dependency: "reverse" },
    { id: "ddd:AnticorruptionLayer", name: "Anticorruption Layer", category: "Strategic", targetMarker: "arrow", endLabels: ["U", "D·ACL"], dependency: "reverse" },
    { id: "ddd:OpenHostService", name: "Open Host Service", category: "Strategic", targetMarker: "arrow", endLabels: ["U·OHS", "D"], dependency: "reverse" },
    { id: "ddd:PublishedLanguage", name: "Published Language", category: "Strategic", targetMarker: "arrow", endLabels: ["U·PL", "D"], dependency: "reverse" },
    { id: "ddd:SeparateWays", name: "Separate Ways", category: "Strategic", targetMarker: "none", line: "dotted", dependency: "none", rollup: false },
    { id: "ddd:BigBallOfMud", name: "Big Ball of Mud", category: "Strategic", targetMarker: "none", line: "dashed", dependency: "none" },
    { id: "ddd:Implements", name: "Implements", targetMarker: "triangle", line: "dashed", dependency: "none", rollup: false },
    { id: "ddd:Owns", name: "Owns", targetMarker: "open", dependency: "none", rollup: false },
    { id: "ddd:Triggers", name: "Triggers", targetMarker: "arrow", dependency: "reverse" },
    { id: "ddd:References", name: "References", targetMarker: "open", dependency: "forward" },
  ],
  viewpoints: [
    {
      id: "ddd:context-map",
      name: "Context Map",
      description: "Bounded contexts and the strategic patterns between them, with upstream and downstream markers.",
      elementTypes: ["ddd:BoundedContext", "ddd:ExternalSystem", "ddd:Team", "ddd:Domain", "ddd:Subdomain"],
      relationshipTypes: [...STRATEGIC, "ddd:Implements", "ddd:Owns"],
      layout: { direction: "RIGHT" },
    },
    {
      id: "ddd:canvas",
      name: "Bounded Context Canvas",
      description: "A form-backed card describing one bounded context.",
      kind: "form",
      elementTypes: [],
      form: {
        subjectTypes: ["ddd:BoundedContext"],
        sections: [
          { title: "Purpose", fields: [text("purpose", "Purpose")] },
          {
            title: "Strategic classification",
            fields: [
              { key: "domainClassification", label: "Domain", type: "enum", options: ["Core", "Supporting", "Generic"] },
              { key: "businessModel", label: "Business model", type: "enum", options: ["Revenue", "Engagement", "Compliance", "Cost reduction"] },
              { key: "evolution", label: "Evolution", type: "enum", options: ["Genesis", "Custom built", "Product", "Commodity"] },
            ],
          },
          { title: "Domain roles", fields: [{ key: "domainRoles", label: "Role types", type: "tags" }] },
          { title: "Inbound communication", fields: [text("inbound", "Messages received (commands, queries, events) and from whom")] },
          { title: "Outbound communication", fields: [text("outbound", "Messages sent and to whom")] },
          { title: "Ubiquitous language", fields: [text("ubiquitousLanguage", "Key terms and their meaning")] },
          { title: "Business decisions", fields: [text("businessDecisions", "Key rules and policies")] },
          { title: "Assumptions", fields: [text("assumptions", "Assumptions")] },
          { title: "Verification metrics", fields: [text("verificationMetrics", "How we know the boundary is right")] },
          { title: "Open questions", fields: [text("openQuestions", "Open questions")] },
        ],
      },
    },
    {
      id: "ddd:event-storming",
      name: "Event Storming",
      description: "Coloured stickies on a timeline.",
      elementTypes: ["ddd:DomainEvent", "ddd:Command", "ddd:Policy", "ddd:ReadModel", "ddd:Aggregate", "ddd:ExternalSystem", "ddd:Team"],
      relationshipTypes: ["ddd:Triggers"],
      layout: { direction: "RIGHT" },
      timeline: true,
    },
    {
      id: "ddd:tactical",
      name: "Tactical model",
      description: "Aggregates, entities and value objects inside one bounded context.",
      elementTypes: ["ddd:BoundedContext", "ddd:Module", "ddd:Aggregate", "ddd:Entity", "ddd:ValueObject", "ddd:DomainEvent", "ddd:Command", "ddd:Policy", "ddd:ReadModel"],
      relationshipTypes: ["ddd:References", "ddd:Triggers"],
    },
  ],
  validity: {
    mode: "rules",
    rules: [
      { source: "ddd:BoundedContext", target: "ddd:BoundedContext", types: STRATEGIC },
      ...CONTEXTS.flatMap((s) => CONTEXTS.filter((t) => s !== "ddd:BoundedContext" || t !== "ddd:BoundedContext").map((t) => ({ source: s, target: t, types: STRATEGIC.filter((x) => x !== "ddd:SharedKernel") }))),
      { source: "ddd:BoundedContext", target: "ddd:Subdomain", types: ["ddd:Implements"] },
      { source: "ddd:Team", target: "ddd:BoundedContext", types: ["ddd:Owns"] },
      { source: "category:Tactical", target: "category:Tactical", types: ["ddd:Triggers", "ddd:References"] },
      { source: "ddd:ExternalSystem", target: "category:Tactical", types: ["ddd:Triggers"] },
      { source: "category:Tactical", target: "ddd:ExternalSystem", types: ["ddd:Triggers"] },
      { source: "ddd:Team", target: "category:Tactical", types: ["ddd:Triggers"] },
    ],
  },
  defaultRelationship: "ddd:UpstreamDownstream",
  drillDown: [{ type: "ddd:BoundedContext", viewpoint: "ddd:tactical" }],
};

export default definePlugin({
  manifest: { id: "vastitecture.ddd", name: "Domain-Driven Design", version: "0.1.0", apiVersion: "1.0.0", capabilities: ["notation"] },
  activate(ctx) {
    ctx.notations.register(pack);
  },
});
