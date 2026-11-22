# Vastitecture — Architecture

Status: **draft for review**. No app code exists yet. Decisions referenced as `D-nn` are recorded in [DECISIONS.md](./DECISIONS.md).

Vastitecture is a local-first desktop app for modelling architecture in ArchiMate, C4, DDD and TOGAF in one workspace. The guiding idea is **model once, view many**: every shape on every diagram is a placement of one element in a single shared model.

## 1. System overview

```
┌──────────────────────────── apps/desktop (Tauri 2) ────────────────────────────┐
│  Rust shell (thin): fs, watch, git, keychain, plugin folder discovery, updater │
│  ───────────────────────────── IPC (typed) ──────────────────────────────────  │
│  Webview (React + TS)                                                          │
│   ┌──────────┐ ┌───────────┐ ┌──────────────┐ ┌───────────┐ ┌───────────────┐  │
│   │ Canvas   │ │ Inventory │ │ Code editor  │ │ Panels    │ │ Command       │  │
│   │ ReactFlow│ │ tables    │ │ Monaco       │ │ props/    │ │ palette       │  │
│   │          │ │           │ │              │ │ problems  │ │               │  │
│   └────┬─────┘ └─────┬─────┘ └──────┬───────┘ └─────┬─────┘ └──────┬────────┘  │
│        └─────────────┴──────── UI state (Zustand) ──┴──────────────┘           │
│                                   │ commands ▲ snapshots                       │
│   ┌───────────────────────────────▼──────────┴──────────────────────────────┐  │
│   │ packages/core: model store · commands · undo · validation · registry    │  │
│   │                queries (impact, implied rels) · workspace serialisation │  │
│   └───────▲───────────────────────▲──────────────────────────▲──────────────┘  │
│           │ Plugin API (versioned, typed, RPC)                │ WorkspaceFS    │
│   ┌───────┴────────┐  ┌───────────┴───────────┐   ┌───────────┴────────────┐   │
│   │ notation packs │  │ importers · exporters │   │ Tauri FS │ memory FS   │   │
│   │ (sandboxed)    │  │ connectors · layouts  │   │ (desktop)│ (tests/web) │   │
│   └────────────────┘  └───────────────────────┘   └────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────────┘
```

Three rules hold the design together:

1. **The folder is the source of truth.** Everything else (the in-memory store, the SQLite FTS index, layout caches) is derived and can be rebuilt.
2. **The core knows no notation.** `packages/core` deals in namespaced type strings and registries. A lint rule fails the build if core imports from `packages/notations/*` or contains a notation id literal.
3. **Built-ins are plugins.** Every notation pack, importer, exporter and connector registers through the same Plugin API third parties use.

## 2. Package layout

pnpm monorepo, TypeScript project references, one `vitest` workspace.

```
apps/
  desktop/                 Tauri 2 shell + React app
    src-tauri/             Rust: commands for fs, watch, git, keychain, plugins
    src/                   UI: canvas, panels, inventory, editor, i18n messages
    e2e/                   Playwright flows (run against the web build, D-03)
packages/
  core/                    metamodel, store, commands, validation, queries, fs format
  plugin-sdk/              public types, defineplugin helpers, RPC host/guest, test harness
  notations/
    generic/  c4/  archimate/  ddd/  togaf/
  io/
    structurizr/  archimate-exchange/  archi/  cml/  mermaid/  c4-plantuml/
    drawio/  tabular/ (CSV, Excel)  image/ (SVG, PNG, PDF)  site/ (Markdown, HTML)
  connectors/
    openapi/  compose/  kubernetes/  terraform/  backstage/  aws/  git/
  layout/                  ELK (layered, force, radial) in a worker
  schema/                  generated JSON Schema for the file format
  create-vastitecture-plugin/
packs/
  archimate/               JSON data: elements, icons, relationships, validity, viewpoints
samples/
  ecommerce/               first-launch workspace, modelled in all four notations
fixtures/                  real third-party sample files for round-trip tests
docs/
```

Dependency direction is strictly one way: `core` ← `plugin-sdk` ← `notations/*`, `io/*`, `connectors/*`, `layout` ← `apps/desktop`. Nothing depends on `apps/desktop`.

## 3. Metamodel

Zod schemas in `packages/core/src/schema` are the definition; TypeScript types and the published JSON Schema are generated from them.

```ts
type Id = string;            // ULID, lowercase
type TypeId = string;        // "<pack>:<Name>", e.g. "c4:Container"

interface Element {
  id: Id;
  type: TypeId;                         // primary type
  name: string;
  description?: string;
  properties: Record<string, PropertyValue>;   // typed by the pack's property schema
  tags: string[];
  lifecycle?: { phase?: LifecyclePhase; dates?: Partial<Record<LifecyclePhase, IsoDate>> };
  owner?: string;                       // free text or element id of a person/team
  links: { kind: "repo" | "runbook" | "adr" | "doc" | "other"; label?: string; href: string }[];
  parent?: Id;                          // model-level containment (system ⊃ container)
  facets?: Record<string, FacetOverride>;      // per-notation overrides, see §5
}

interface Relationship {
  id: Id;
  type: TypeId;                         // e.g. "archimate:Serving", "c4:Uses"
  source: Id;
  target: Id;
  label?: string;
  technology?: string;
  multiplicity?: { source?: string; target?: string };
  properties: Record<string, PropertyValue>;
}

interface View {
  id: Id;
  notation: string;                     // pack id
  viewpoint?: string;                   // pack-defined, e.g. "c4:container"
  name: string;
  subject?: Id;                         // element this view drills into
  nodes: NodePlacement[];               // { id, element, x, y, w, h, parent?, style?, collapsed? }
  edges: EdgeRoute[];                   // { relationship, waypoints?, style?, hidden? }
  annotations: Annotation[];            // notes, groups, images: view-local, not in the model
  properties: Record<string, PropertyValue>;   // e.g. TOGAF ADM phase tag
}

interface Workspace {
  format: 1;
  name: string;
  packs: string[];                      // enabled pack ids
  mappings: MappingRule[];              // cross-notation table, §5
  pluginSettings: Record<string, unknown>;
  elements: Map<Id, Element>;
  relationships: Map<Id, Relationship>;
  views: Map<Id, View>;
  adrs: Map<string, Adr>;
}
```

Points worth calling out:

- **Containment is in the model, nesting is in the view.** `Element.parent` says a container belongs to a system. `NodePlacement.parent` says a node is drawn inside another node in this view. Views may nest differently from the model (or not show the parent at all).
- **Annotations are not elements.** A note on a canvas is view-local. The Generic pack's boxes *are* elements (`generic:Box`), which is what makes **Formalise** a simple retype command.
- **Lifecycle, owner, links** are first-class because the inventory half of the product needs them on every element regardless of notation. Everything else (criticality, technical fit, cost, ADM phase) lives in `properties`, with schemas contributed by packs.
- **Property schemas** are declared by packs as data (`{ key, type: string|number|enum|date|bool|ref|markdown, ... }`), so the properties panel, fact-sheet columns and CSV import all derive from one definition.

### Implied relationships

Computed, never stored. `core/queries/implied.ts` lifts a relationship to the nearest visible ancestors of its endpoints: if view V shows systems A and B but not their containers, a relationship a₁→b₁ yields an implied A→B edge. Which relationship types roll up, and how the implied edge is typed and labelled, comes from the pack through a `rollup` rule on the relationship type definition, so core contains no notation logic. Implied edges are rendered distinctly and are read-only; a quick action materialises one into a real relationship.

## 4. Store, commands and undo

- The model is an **immutable snapshot** (structural sharing via Immer). UI subscribes with selectors; a rename re-renders only nodes whose element changed.
- All mutation goes through **commands**: plain serialisable objects `{ type, payload }` handled by pure reducers that return the new snapshot plus the inverse command. Composite commands group edits into one undo step (for example "delete element" also removes its relationships and placements).
- **Undo/redo** is a single stack covering model and layout. Each entry records the originating view so undo can restore focus.
- **Yjs readiness (later):** commands are the only write path and are expressed as fine-grained operations on keyed maps (`setElementField`, `moveNode`), not whole-document replacement. A later Yjs binding maps those onto `Y.Map`s without changing callers. We do not ship Yjs in v1.
- **Validation** runs incrementally after each command over the changed ids and their neighbours. Validators are registered by packs and by core (core provides only notation-agnostic ones: orphans, missing descriptions, duplicate names, dangling references). Each problem carries `{ severity, target, message key, fixes[] }`, where a fix is a command.

## 5. Cross-notation mapping

This is the core differentiator, so it gets a precise definition.

An element has **one primary type** and may be *presented* in other notations. The workspace `mappings` table says how:

```yaml
mappings:
  - concept: business-system
    members:
      archimate: [archimate:ApplicationComponent]
      c4:        [c4:SoftwareSystem]
      ddd:       [ddd:BoundedContext]
      cardinality: { ddd: many }        # one system may map to several contexts
  - concept: deployable-unit
    members:
      archimate: [archimate:ApplicationComponent, archimate:SystemSoftware]
      c4:        [c4:Container]
      ddd:       [ddd:Module]
    when: { archimate: { nested: true } }
  # data-store, person-or-team, api, infrastructure …
```

Resolution when element E (primary type T) is placed in a view of notation N:

1. If T belongs to N, render as T.
2. Else if `E.facets[N].type` is set, render as that (the user chose explicitly).
3. Else find mapping rules whose members include T; take the first candidate in N's list (respecting `when`). Render with that type's shape.
4. Else prompt: *"No mapping from T to N. Create one?"* The dialog writes either a workspace-wide rule or a per-element facet.

`facets` also carries per-notation extras that have no home in the primary type (for example a C4 `technology` string on an ArchiMate-primary element).

One-to-many cases (a system realised by several bounded contexts) are **not** type aliasing; they are separate elements joined by a `core:Realizes` relationship that the mapping rule declares. Dropping the system on a context map offers "show its bounded contexts" rather than drawing the system as one context.

Where a concept maps to a relationship rather than an element (an API in C4 is a relationship with technology), the rule carries a `projection` that a pack implements: the C4 pack renders an `archimate:ApplicationInterface` between two components as an edge labelled with the interface name and technology.

The default table ships as data in `packages/core/defaults/mappings.yaml` (ids only, interpreted generically) and is copied into `vastitecture.yaml` on workspace creation so it is user-editable and diffable.

## 6. Workspace on disk

```
my-workspace/
  vastitecture.yaml                   settings, enabled packs, mappings, plugin settings
  model/
    elements/<pack>/<type>/<slug>.yaml   one file per element
    relationships.yaml                sorted by (source, target, type, id)
  views/<notation>/<slug>.yaml        placements, routes, annotations
  adrs/0001-<title>.md                Markdown with YAML front matter
  .vastitecture/
    plugins/                          workspace-local plugins (committed)
    cache/                            FTS index, thumbnails (gitignored)
```

Example element:

```yaml
id: 01jc8z4t5q9v7m3k2x6hbn0wre
type: c4:SoftwareSystem
name: Order Service
description: Accepts and tracks customer orders.
lifecycle:
  phase: active
owner: team-checkout
tags: [checkout, tier-1]
properties:
  criticality: high
links:
  - kind: repo
    href: https://example.com/acme/orders
```

**Stable serialisation rules** (the Git-friendliness requirement):

- Keys in a fixed canonical order per schema, then alphabetical for open maps. Lists that are semantically sets (tags, nodes, edges) are sorted; ordered lists keep order.
- Defaults and empty collections are omitted. Block style only, 2-space indent, LF, trailing newline, no anchors, strings quoted only when YAML requires it.
- Coordinates are integers (snapped to a 1px grid on save) so a nudge is a one-line diff.
- File names are slugs of the name at creation; **the id inside the file is the identity**. Renaming an element does not rename the file by default (avoids rename churn in diffs); a "Tidy file names" command does it on demand (D-06).
- One element per file keeps merges independent. Relationships share one file because they are small and frequently created in bulk; its strict sort order makes concurrent additions merge cleanly in most cases (D-07, revisit if conflicts prove common).

**Loading and watching.** `WorkspaceFS` is an interface (`read`, `write`, `list`, `watch`, `stat`) with a Tauri implementation and an in-memory implementation. Autosave debounces at 500 ms and writes only changed files, atomically (temp file + rename). Each write records a content hash so the watcher ignores our own echoes. An outside change (editor, `git pull`) is parsed and applied as a `reload` command. If the same entity has unsaved local edits, the app opens a three-way merge view (base = last loaded, ours = memory, theirs = disk). Files containing Git conflict markers are detected on load and routed to the same merge view.

**Search index.** SQLite FTS5 in the app's own cache folder (one file per workspace, named by a hash of its path), built by the Rust side from the files, keyed by content hash. It is never stored in the workspace, so a workspace cannot ship a prepared index or redirect it with a link. Deleting it is always safe.

**Schema versioning.** `format: 1` in `vastitecture.yaml`. Migrations are pure functions `vN → vN+1` in core, run on load, written back only on the next save.

## 7. Plugin API

A plugin is a folder:

```
my-plugin/
  plugin.json     { id, name, version, apiVersion, entry, capabilities[], permissions{} }
  index.js        ES module, default export from definePlugin()
  assets/         icons, JSON data
```

```ts
export default definePlugin({
  activate(ctx) {
    ctx.notations.register({ id, elementTypes, relationshipTypes, viewpoints, shapes, validity });
    ctx.importers.register({ id, label, extensions, detect, import });   // → ModelPatch
    ctx.exporters.register({ id, label, scope, export });
    ctx.validators.register({ id, run });                                // → Problem[]
    ctx.connectors.register({ id, configSchema, discover });             // → ModelPatch
    ctx.layouts.register({ id, layout });
    ctx.themes.register({ … });
    ctx.panels.register({ id, title, render });                          // iframe
  },
});
```

Design points:

- **Capabilities are declarative where possible.** A notation pack is mostly data: element types, property schemas, relationship types with `rollup` rules, viewpoints (palette restrictions), a validity function or table, and shapes. Shapes are described in a small declarative shape language (SVG path templates + label slots + icon) that the host renders, so packs do not ship React code into the main thread and work identically from a worker. Packs needing custom interactive UI (Bounded Context Canvas form, Event Storming board) use a `panel`/`custom view` capability rendered in a sandboxed iframe.
- **Importers and connectors never touch the store.** They return a `ModelPatch` (adds, updates, removes). The host shows it as a diff and applies it as one undoable command. This is also how AI changes arrive.
- **Sandbox.** Logic capabilities run in a dedicated Web Worker per plugin; UI capabilities run in an `<iframe sandbox>` with a strict CSP. Both talk to the host over a `MessageChannel` RPC generated from the SDK types. No DOM, no Tauri IPC, no ambient `fetch`.
- **Permissions.** `permissions: { fs: ["read:workspace", "read:pick"], network: ["api.example.com"], secrets: ["my-token"] }`. Host-mediated `ctx.fs` / `ctx.net` / `ctx.secrets` enforce them; the user approves at install and on any permission increase. Built-in plugins are pre-approved but declare permissions the same way.
- **Versioning.** `apiVersion` is semver; the host supports the current major and refuses others with a clear message. `plugin-sdk` ships a headless test harness so plugins are unit-testable without the app.
- **Loading.** The Rust side enumerates `~/.vastitecture/plugins` and `<workspace>/.vastitecture/plugins` and serves files over a custom protocol scoped to the plugin folder. Nothing is fetched remotely. Developer mode watches plugin folders and hot-reloads.
- **Built-ins** live in this repo and are bundled, but are loaded by the same host through the same RPC boundary. A CI test loads each built-in pack through the public harness only.

### ArchiMate pack specifics

- Elements, icons, relationship types, viewpoints and the validity table load from `packs/archimate/*.json`. No concept list is hard-coded in TypeScript.
- **The validity table will not be invented.** Until a table from a licensed spec is supplied, the pack ships `validity.mode: "permissive"` (every relationship allowed, a single info-level notice in the problems panel) and this is tracked as a TODO.
- 3.x → 4 migration is a data-driven rule set (`migrations/3-to-4.json`) producing a per-change report. The seven removed concepts map as specified in the build prompt.
- No specification text is copied. Trademark notice appears in About and the README.

## 8. Canvas and UI

- **React Flow** with one generic node renderer driven by pack shape definitions, plus custom edge renderers (ArchiMate line ends, DDD upstream/downstream markers). Only visible nodes render; node components are memoised on `(element version, placement, selection)`.
- **Layout** runs ELK in a worker. Manual positions are authoritative; layout runs only on explicit request or after an import, and is one undo step.
- **Diagram as code.** Monaco in a split pane. Native mode edits the view YAML plus referenced elements as a projected document; edits are parsed, diffed against the model and applied as commands (debounced, with parse errors shown inline and the canvas left untouched while the text is invalid). Structurizr DSL and CML modes go through the corresponding importer/exporter pair, scoped to the view.
- **Navigation.** Double-click opens the element's child view (creating one from a template if none exists), breadcrumbs follow `View.subject` up the containment chain. "Show in other views" is an index lookup maintained by the store.
- **Impact highlight** and focus mode are graph traversals in `core/queries`, shared with the inventory's impact analysis panel.
- **Accessibility.** Every node and edge has an ARIA label built from type and name; the canvas has a keyboard navigation model (arrow keys move between connected nodes, Tab creates a connected element, Enter renames). Type is always conveyed by shape or icon, never colour alone. Default palette is colour-blind safe.
- **i18n.** All strings in `apps/desktop/src/messages/en.json` (ICU MessageFormat). Packs contribute their own message bundles. A lint rule bans string literals in JSX.

## 9. Rust shell

Kept deliberately small; each item is a Tauri command with a typed TS wrapper:

| Area | Responsibility |
| --- | --- |
| Filesystem | scoped read/write/list, atomic write, folder picker |
| Watcher | `notify`-based, debounced change events |
| Git | status, diff, log for the workspace (`git2`); no push/pull in v1 |
| Keychain | `keyring` crate for AI endpoint keys and plugin secrets |
| Search | SQLite FTS5 index build and query |
| Plugins | folder discovery, manifest read, scoped asset protocol |
| Network | permission-checked HTTP proxy for plugins and the AI assistant |
| Updater | Tauri updater plugin |

## 10. Security and privacy

- No network access at all unless the user runs a connector or enables the AI assistant. No telemetry, no account.
- Webview CSP forbids remote scripts. Plugins load only from local folders.
- Secrets live only in the OS keychain; they are never written to the workspace or logs.
- Connectors are read-only and return patches that the user reviews.

## 11. Testing

| Layer | Tool | What |
| --- | --- | --- |
| Core | Vitest | commands and inverses (property-based: apply then undo is identity), serialisation stability (load → save is byte-identical), validation, implied relationships, mapping resolution |
| Notation packs | Vitest | validity and viewpoint tests per pack, loaded via the plugin harness |
| Importers/exporters | Vitest | round-trip on real published sample files in `fixtures/` (element and relationship sets preserved) |
| UI | Playwright | create/connect/rename/delete, drill-down, split-view sync, reopen workspace |
| Performance | Vitest bench + Playwright trace | 5,000 elements / 200 views load < 2 s; 300-node layout < 1 s; pan/zoom frame time |
| Desktop | GitHub Actions | `tauri build` on macOS, Windows, Linux; smoke launch |

## 12. Performance budget

- **Open 5,000 elements / 200 views in < 2 s:** read files in parallel on the Rust side and return one batched payload; parse YAML in a worker; views are parsed eagerly (they are small) but rendered lazily.
- **60 fps at 300 nodes:** viewport culling, memoised nodes, no per-frame store writes during drag (positions commit on drop), simplified rendering below a zoom threshold.
- **Layout of 300 nodes < 1 s:** ELK in a worker with layered as default; measured in CI.
