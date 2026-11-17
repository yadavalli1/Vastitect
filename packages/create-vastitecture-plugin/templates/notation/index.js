import { definePlugin } from "@vastitecture/plugin-sdk";

// Type ids are namespaced: "<notation id>:<Name>". Shapes are declarative (rect, rounded, ellipse,
// diamond, person, cylinder, hexagon, note, folder, sticky, component, parallelogram, pill, node3d,
// octagon, chevron, group, document, wave) so the plugin never touches the DOM.
export default definePlugin({
  activate(ctx) {
    ctx.notations.register({
      id: "__NS__",
      name: "__NAME__",
      elementTypes: [
        { id: "__NS__:Thing", name: "Thing", category: "Basics", shape: "rounded", fill: "#c7d2fe", badge: "Thing", size: [160, 80] },
        { id: "__NS__:Store", name: "Store", category: "Basics", shape: "cylinder", fill: "#bbf7d0", badge: "Store", size: [130, 90] },
        { id: "__NS__:Area", name: "Area", category: "Basics", shape: "group", container: true, size: [360, 240] },
      ],
      relationshipTypes: [
        { id: "__NS__:Uses", name: "Uses", targetMarker: "arrow" },
        { id: "__NS__:Feeds", name: "Feeds", targetMarker: "arrow", line: "dashed" },
      ],
      viewpoints: [{ id: "__NS__:main", name: "Main" }],
      // Only offer relationships that make sense; "*" matches any element type.
      validity: {
        mode: "rules",
        rules: [
          { source: "__NS__:Thing", target: "*", types: ["__NS__:Uses"] },
          { source: "__NS__:Store", target: "__NS__:Thing", types: ["__NS__:Feeds"] },
        ],
      },
      defaultRelationship: "__NS__:Uses",
    });
  },
});
