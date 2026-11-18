# Writing a Vastitecture plugin

Every notation, importer, exporter, validator and discovery connector in Vastitecture is a plugin,
including the built-in ones. They all use the API described here.

## Quick start

```bash
npx create-vastitecture-plugin my-notation --template notation --id acme.my-notation
```

Templates: `notation` (default), `importer`, `exporter`, `validator`, `connector`. The result is a
folder of plain ES modules; there is no build step.

Install by copying the folder to one of:

| Folder | Scope |
| --- | --- |
| `~/.vastitecture/plugins/<name>/` | every workspace on this computer |
| `<workspace>/.vastitecture/plugins/<name>/` | one workspace, shared with your team through Git |

Then open **Plugins** and press **Rescan plugin folders**. With **Developer mode** on, the app reloads
a plugin whenever its files change. In the web build, use **Install from files…** and select
`plugin.json` and the entry file together.

A complete example lives in [`examples/plugins/wardley`](../examples/plugins/wardley): a Wardley-map
notation with a validator and a side panel.

## plugin.json

```json
{
  "id": "acme.my-notation",
  "name": "My notation",
  "version": "0.1.0",
  "apiVersion": "1.0.0",
  "description": "Shown to the user when they approve the plugin.",
  "entry": "index.js",
  "capabilities": ["notation", "validator"],
  "permissions": { "network": ["api.example.com"], "secrets": ["example-token"], "fs": [] }
}
```

- `id`: lowercase letters, digits, `.`, `-`, `_`.
- `apiVersion`: the plugin API major version you target. The app refuses other majors with a clear message.
- `capabilities`: what the plugin may register: `notation`, `importer`, `exporter`, `validator`,
  `connector`, `layout`, `theme`, `panel`. Registering anything else fails the plugin.
- `permissions.network`: host names `ctx.net.fetch` may contact (`*.example.com` matches subdomains).
- `permissions.secrets`: names of OS-keychain secrets `ctx.secrets.get` may read.

The user sees the capabilities and permissions and must approve them before any plugin code runs.
Approval covers that exact set; asking for more in a later version requires approval again.

## The sandbox

Each third-party plugin runs in its own Web Worker. Before its code loads, the app removes `fetch`,
`XMLHttpRequest`, `WebSocket`, `importScripts`, `indexedDB` and similar globals, so the only way out
is through `ctx`. Everything crosses the boundary by structured cloning:

- Definitions you register are copied as plain data. Their functions stay in the worker and are
  called by the app across the boundary, so they may be `async` and always look `async` from outside.
- `ctx.net.fetch(url, init)` and `ctx.secrets.get(name)` are checked against `plugin.json` by the app.
- Side panels render HTML into an `<iframe sandbox>` with scripts disabled.

No code is ever loaded from the network.

## The context

```js
import { definePlugin, makeElement, makeRelationship, makeView, newId } from "@vastitecture/plugin-sdk";

export default definePlugin({
  activate(ctx) {
    ctx.notations.register(pack);
    ctx.importers.register(importer);
    ctx.exporters.register(exporter);
    ctx.validators.register(validator);
    ctx.connectors.register(connector);
    ctx.layouts.register(layoutEngine);
    ctx.themes.register(theme);
    ctx.panels.register(panel);
    // ctx.net.fetch, ctx.secrets.get, ctx.log
  },
});
```

Inside the sandbox, `@vastitecture/plugin-sdk` provides `definePlugin`, `makeElement`,
`makeRelationship`, `makeView`, `newId`, `slugify`, `packOf` and `localName`. TypeScript types for
everything below are exported from the same package.

## Notation packs

A notation is data: the app draws it, validates it and builds the palette from it.

```js
{
  id: "mynotation",                       // prefix of every type id
  name: "My notation",
  elementTypes: [{
    id: "mynotation:Thing", name: "Thing", category: "Basics",
    shape: "rounded",                     // see below
    fill: "#c7d2fe", icon: "★", badge: "Thing", size: [160, 80],
    container: true,                      // or a list of type ids it may contain
    properties: [{ key: "tier", label: "Tier", type: "enum", options: ["1", "2", "3"] }],
    variants: [{ property: "tier", values: { "1": { fill: "#fecaca" } } }],
  }],
  relationshipTypes: [{
    id: "mynotation:Uses", name: "Uses",
    line: "solid" | "dashed" | "dotted",
    sourceMarker, targetMarker,           // none, arrow, open, triangle, diamond, filledDiamond, circle, filledCircle, half
    dependency: "forward" | "reverse" | "none",   // for impact analysis
    rollup: true,                         // implied relationships between parents
    endLabels: ["U", "D"],
  }],
  viewpoints: [{ id: "mynotation:main", name: "Main", elementTypes: [...], relationshipTypes: [...] }],
  validity: { mode: "rules", rules: [{ source: "mynotation:Thing", target: "*", types: ["mynotation:Uses"] }] },
  defaultRelationship: "mynotation:Uses",
  drillDown: [{ type: "mynotation:Thing", viewpoint: "mynotation:main" }],
  globalProperties: [...],                // properties added to elements of every notation
  viewProperties: [...],
  reports: [{ id, name, kind: "catalog" | "matrix", rows: [...], columns: [...], fields: [...] }],
}
```

Shapes: `rect`, `rounded`, `ellipse`, `diamond`, `person`, `cylinder`, `hexagon`, `note`, `folder`,
`sticky`, `component`, `parallelogram`, `pill`, `node3d`, `octagon`, `chevron`, `group`, `document`,
`wave`.

Validity is `{ mode: "permissive" }`, `{ mode: "rules", rules }` (patterns are type ids, `*` or
`category:<name>`), or `{ mode: "table", table: { source: { target: [types] } } }`. Smart connectors
offer only valid types, likeliest first; the problems panel flags invalid relationships with quick fixes.

To let elements of your notation appear in other notations' views, add rows to the workspace's
**Cross-notation mapping** (or ship them in your docs for users to add).

## Importers, exporters and connectors

Importers and connectors never change the model. They return a `ModelPatch`:

```js
{ elements, relationships, views, adrs, removeElements, removeRelationships, removeViews,
  layout: [viewIds to auto-lay out], report: ["lines shown above the diff"] }
```

The user reviews it as a diff and applies it as one undoable change.

- Connectors should set `properties.externalId` on every element they create. Running the connector
  again then updates those elements instead of duplicating them, keeps fields the user edited, and
  reuses draft views with the same name.
- An importer's `detect(input)` sniffs content when several importers share an extension.
- An exporter returns a string, bytes, or `{ "path": content }` for several files (saved as a zip).
  A view-scoped exporter with `roundTripWith: "<importer id>"` becomes an editable language in the
  diagram-as-code split view.

## Validators and panels

```js
ctx.validators.register({ id, run(ws) { return [{ code, severity, message, target: { kind, id }, fixes: [{ label, commands }] }]; } });
ctx.panels.register({ id, title, render(ws) { return "<table>…</table>"; } });
```

Quick fixes are model commands (`updateElement`, `removeRelationship`, …) applied as one undo step.

## Testing

`@vastitecture/plugin-sdk` exports `PluginHost` and `guestMain`; the scaffolder's test
(`packages/create-vastitecture-plugin/create.test.ts`) shows how to load a plugin folder through the
real sandbox protocol in Vitest.
