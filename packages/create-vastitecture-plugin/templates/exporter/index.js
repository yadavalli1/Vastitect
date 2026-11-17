import { definePlugin } from "@vastitecture/plugin-sdk";

// Exports every element and relationship as JSON Lines. Return a string, bytes,
// or { "path/in/archive": content } for several files (delivered as a zip).
export default definePlugin({
  activate(ctx) {
    ctx.exporters.register({
      id: "__SLUG__",
      label: "__NAME__",
      extension: "jsonl",
      scope: "workspace",
      export(ws) {
        const lines = [];
        for (const e of Object.values(ws.elements)) lines.push(JSON.stringify({ kind: "element", id: e.id, type: e.type, name: e.name }));
        for (const r of Object.values(ws.relationships)) lines.push(JSON.stringify({ kind: "relationship", id: r.id, type: r.type, source: r.source, target: r.target }));
        return lines.join("\n") + "\n";
      },
    });
  },
});
