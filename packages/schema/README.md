# Workspace file format: JSON Schema

Generated from the Zod schemas in `packages/core/src/model.ts` by `pnpm schema`. Point your editor at
these to get completion and validation when editing workspace files by hand:

```yaml
# yaml-language-server: $schema=https://github.com/yadavalli1/Vastitect/blob/main/packages/schema/element.schema.json
```

| File | Schema |
| --- | --- |
| `vastitecture.yaml` | `settings.schema.json` |
| `model/elements/<pack>/<type>/<slug>.yaml` | `element.schema.json` |
| `model/relationships.yaml` | `relationships.schema.json` |
| `views/<notation>/<slug>.yaml` | `view.schema.json` |
| `adrs/NNNN-title.md` | Markdown with YAML front matter: `id`, `title`, `status`, `date`, `elements` |
