# Vastitecture — Plan

Six milestones, built in order. At the end of each: all tests pass, the app runs, and work stops for review with a short summary, a TODO list and a demo script.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done

## Milestone 0 — Design (this document)

- [x] `docs/ARCHITECTURE.md`
- [x] `docs/PLAN.md`
- [x] `docs/DECISIONS.md`
- [x] Review and sign-off before any app code (owner said “start build”)

## Milestone 1 — Core and canvas

**Done when:** I can create a workspace, draw boxes and arrows, close and reopen it, and see clean YAML diffs in Git.

- [x] Monorepo scaffold: pnpm workspaces, TypeScript, Vitest, Playwright
- [ ] ESLint (core-purity and no-literal-strings rules) and CI for lint + test (moved to M6)
- [x] `core`: Zod schemas for Element, Relationship, View, Workspace; generated JSON Schema
- [x] `core`: immutable store, command reducers with inverses, composite commands, undo/redo
- [x] `core`: stable YAML serialiser and loader; `WorkspaceFS` interface with memory implementation
- [x] `core`: registry for notations, validators, importers, exporters (behind the worker sandbox since M5)
- [x] `notations/generic`: box, group, note, image, flowchart shapes
- [x] Desktop shell: Tauri 2 app, Rust fs + watcher commands, Tauri `WorkspaceFS`
- [x] Canvas: palette, create, connect, rename, delete, multi-select, minimap, zoom to fit
- [x] Properties panel with typed fields
- [x] Autosave, reload on outside change
- [x] New workspace / open workspace flow
- [x] SVG and PNG export of a view
- [x] i18n message file wired from the start; light and dark themes
- [x] Tests: command/undo property tests, byte-stable round-trip, Playwright draw-save-reopen flow

## Milestone 2 — C4 pack and diagram as code

**Done when:** a published Structurizr DSL sample imports, lays itself out, and exports back without losing elements or relationships.

- [x] `notations/c4`: Person, Software System, Container, Component, Deployment Node; shapes; property schemas
- [x] View types: System Landscape, System Context, Container, Component, Dynamic, Deployment
- [x] Drill-down with breadcrumbs; expand/collapse in place
- [x] Implied relationships (core query + pack rollup rules)
- [x] `layout`: ELK layered, force, radial in a worker; run after import and on demand
- [x] Monaco split view with two-way YAML sync
- [x] `io/structurizr`: DSL parser and writer, workspace JSON import and export
- [x] Structurizr DSL mode in the split view
- [x] Smart connectors (valid types for the pair, likeliest preselected)
- [x] Command palette; Tab-to-create and Enter-to-rename
- [x] Tests: round-trip on published Structurizr samples; C4 validation tests

## Milestone 3 — ArchiMate 4 pack

**Done when:** an Archi sample model imports, migrates to ArchiMate 4, renders, and round-trips through the exchange format.

- [x] `packs/archimate/*.json`: elements, icons, relationships, viewpoints (data only)
- [x] `notations/archimate`: loader, shapes, edge renderers, multiplicity
- [x] Validity: data-driven engine; **permissive mode until licensed tables are supplied** (TODO for owner)
- [ ] TODO: verify `packs/archimate/elements.json` against the ArchiMate 4 specification (marked unverified)
- [x] Viewpoints as view templates that restrict the palette
- [x] `io/archimate-exchange`: Model Exchange File Format 3.x import and export
- [ ] TODO: ArchiMate 4 exchange-format version, once The Open Group publishes its schema
- [x] `io/archi`: `.archimate` import including diagrams
- [x] 3.1/3.2 → 4 migration with change report
- [x] Live validation panel with quick fixes
- [x] Trademark notice in About and README
- [x] Tests: Archi sample import → migrate → exchange round-trip; validity engine tests against a synthetic table

## Milestone 4 — DDD, TOGAF and cross-notation mapping

**Done when:** one system appears in a C4 container view, an ArchiMate application view and a DDD context map, and renaming it in one updates all three.

- [x] `notations/ddd`: all element types; Context Map with strategic patterns and U/D markers
- [x] Bounded Context Canvas (form-backed card)
- [x] Event Storming board
- [x] `io/cml`: Context Mapper CML import and export; CML mode in split view
- [x] `notations/togaf`: ADM phase tagging, ABB/SBB, catalogs and matrices, repository view
- [x] Mapping table: defaults, resolution, facets, "create mapping" prompt, editor UI
- [x] Drop existing element into a view of another notation
- [x] Show in other views
- [x] Impact highlight (upstream/downstream), focus mode
- [x] Formalise action for generic boxes
- [x] Sample e-commerce workspace in all four notations; first-launch experience
- [x] Tests: mapping resolution, rename-propagates-everywhere Playwright flow, CML round-trip

## Milestone 5 — Plugin API and discovery connectors

**Done when:** a plugin made with the scaffolder adds a new notation without any change to core code.

- [x] `plugin-sdk`: public types, `definePlugin`, RPC host/guest, test harness, API versioning
- [x] Worker and iframe sandboxes; permission model and install approval UI
- [x] Plugin discovery (user and workspace folders), developer-mode hot reload
- [x] Move every built-in pack, importer and exporter behind the sandbox boundary
- [x] `create-vastitecture-plugin` scaffolder; documented example plugin; authoring guide
- [x] Connectors with diff preview: OpenAPI, AsyncAPI, docker-compose, Kubernetes, Helm, Terraform, Backstage
- [x] `docs/PLUGINS.md` authoring guide
- [x] Remaining importers/exporters: Mermaid, C4-PlantUML, draw.io, CSV, Excel, PDF (raster pages), Markdown/HTML site
- [x] Tests: scaffolded plugin end-to-end; connector fixtures; sandbox escape tests

## Milestone 6 — Inventory, analysis and AI

**Done when:** the sample workspace answers "what breaks if we retire X" and CI produces installers for macOS, Windows and Linux.

- [x] Fact sheets: table, inline edit, saved filters, bulk edit
- [x] Business capability map with heat-mapping
- [x] Lifecycle roadmap
- [x] Impact analysis query panel
- [x] ADRs: storage, linking, properties-panel display, editor with preview
- [x] Reports to CSV, Excel, Markdown
- [x] AWS and Git repository connectors
- [x] ServiceNow CMDB (Table API or exports), Google Cloud and Azure connectors (read-only CLI or saved output)
- [x] AI assistant (off by default): OpenAI-compatible endpoint, keychain storage, all changes as reviewable diffs
- [x] Search: in-memory everywhere, SQLite FTS5 index on desktop
- [x] Merge view for conflicting edits
- [x] Presentation mode, align/distribute
- [x] ESLint (core purity, translatable text) and CI for lint, types, unit, UI and Rust tests
- [x] Release workflow: macOS universal, Windows MSI, Linux AppImage and .deb, optional signing and updater
- [ ] TODO (owner): signing certificates and the updater key as repository secrets; the updater public key in tauri.conf.json
- [ ] TODO: the release workflow has not run on GitHub's macOS and Windows runners yet; only the Linux .deb was built locally
- [x] Accessibility: keyboard navigation between connected elements, labels on every node and control, no colour-only meaning
- [ ] TODO: a screen-reader pass with NVDA/VoiceOver, and colour contrast checks in the dark theme
- [x] Performance budget verified in tests (open 5,000 elements/200 views, 300-node layout, 300-node pan)
- [x] CONTRIBUTING.md, code of conduct, README, published JSON Schema, message extraction

## Milestone 7 — Governance, runtime truth and assistant chat

- [x] Architecture rules as data in `vastitecture.yaml`; rules page; violations in the Problems panel
- [x] `@vastitecture/cli`: check (text, JSON, GitHub annotations, Markdown), diff, export, rules init; example workflow
- [x] Runtime-trace discovery (OpenTelemetry, Jaeger, Zipkin, Datadog) with drift report
- [x] Assistant chat beside the canvas; ask-the-model; draft an ADR (all changes through the review dialog)
- [x] Connectors: GitHub organisation scan, live Kubernetes (`kubectl get`), Jira / Azure DevOps, LeanIX / Ardoq / Sparx EA
- [ ] TODO: check the LeanIX, Ardoq and Sparx mappings against real exports (built from public documentation and hand-written fixtures)
- [x] ServiceNow write-back: names, descriptions and new dependencies, compared live, picked and confirmed
- [x] Plateaus (as-is / to-be), cost overlay (cloud billing exports), data classification and flow, coupling metrics
- [x] Visual model diff (Git commit or another folder), comments stored in the repository
- [ ] Vector PDF; automated colour-contrast checks

## Inputs needed from the owner

| Item | Needed by | Blocking? |
| --- | --- | --- |
| Licence: repo currently has MIT, prompt says Apache-2.0 | Now | No (left as MIT until you confirm) |
| ArchiMate 4 relationship validity tables from a licensed spec | M3 | No (permissive mode ships meanwhile) |
| Code-signing certificates (Apple Developer ID, Windows) and updater key as CI secrets | M6 | Only for *signed* installers; unsigned builds work without |
