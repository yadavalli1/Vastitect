// Publish the workspace file format as JSON Schema, generated from the Zod schemas in packages/core.
import { writeFileSync } from "node:fs";
import { zodToJsonSchema } from "../packages/core/node_modules/zod-to-json-schema/dist/esm/index.js";
import { ElementSchema, RelationshipSchema, SettingsSchema, ViewSchema } from "../packages/core/src/model.ts";

const base = "https://github.com/yadavalli1/Vastitect/blob/main/packages/schema/";
const out = new URL("../packages/schema/", import.meta.url).pathname;
const files: Record<string, [unknown, string]> = {
  "settings.schema.json": [SettingsSchema, "vastitecture.yaml: workspace settings, enabled packs and the cross-notation mapping table"],
  "element.schema.json": [ElementSchema, "model/elements/<pack>/<type>/<slug>.yaml: one element"],
  "relationships.schema.json": [RelationshipSchema.array(), "model/relationships.yaml: every relationship, sorted"],
  "view.schema.json": [ViewSchema, "views/<notation>/<slug>.yaml: placements, routes and annotations of one view"],
};
for (const [name, [schema, description]] of Object.entries(files)) {
  const json = { $id: base + name, title: name.replace(".schema.json", ""), description, ...zodToJsonSchema(schema as never, { target: "jsonSchema7", $refStrategy: "none" }) };
  writeFileSync(out + name, JSON.stringify(json, null, 2) + "\n");
}
console.log(`Wrote ${Object.keys(files).length} schemas to packages/schema/`);
