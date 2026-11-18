import { definePlugin, makeElement, makeRelationship, makeView } from "@vastitecture/plugin-sdk";

// Imports a tiny line format:  "A -> B: label"  (one relationship per line).
// The importer never edits the model: it returns a patch the user reviews as a diff.
export default definePlugin({
  activate(ctx) {
    ctx.importers.register({
      id: "__SLUG__",
      label: "__NAME__",
      extensions: ["arrows"],
      detect: (input) => /->/.test(input.text),
      import(input) {
        const byName = new Map();
        const el = (name) => byName.get(name) ?? byName.set(name, makeElement("generic:Box", name)).get(name);
        const relationships = [];
        for (const line of input.text.split("\n")) {
          const m = /^\s*(.+?)\s*->\s*(.+?)\s*(?::\s*(.*))?$/.exec(line);
          if (m) relationships.push(makeRelationship("generic:Arrow", el(m[1]).id, el(m[2]).id, m[3] ? { label: m[3] } : {}));
        }
        const elements = [...byName.values()];
        const view = makeView("generic", input.name, {
          viewpoint: "generic:whiteboard",
          nodes: elements.map((e) => ({ element: e.id, x: 0, y: 0, w: 140, h: 70 })),
          edges: relationships.map((r) => ({ relationship: r.id })),
        });
        return { elements, relationships, views: [view], layout: [view.id], report: [`${elements.length} boxes, ${relationships.length} arrows`] };
      },
    });
  },
});
