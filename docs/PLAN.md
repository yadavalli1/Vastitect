# Vastitecture — Plan

Six milestones, built in order. At the end of each: all tests pass, the app runs, and work stops for review with a short summary, a TODO list and a demo script.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done

## Milestone 0 — Design (this document)

- [x] `docs/ARCHITECTURE.md`
- [x] `docs/PLAN.md`
- [x] `docs/DECISIONS.md`
- [ ] Review and sign-off before any app code

## Milestone 1 — Core and canvas

**Done when:** I can create a workspace, draw boxes and arrows, close and reopen it, and see clean YAML diffs in Git.

- [ ] Monorepo scaffold: pnpm workspaces, TS project references, ESLint (incl. core-purity and no-literal-strings rules), Vitest, Playwright, CI for lint + test
- [ ] `core`: Zod schemas for Element, Relationship, View, Workspace; generated JSON Schema
- [ ] `core`: immutable store, command reducers with inverses, composite commands, undo/redo
- [ ] `core`: stable YAML serialiser and loader; `WorkspaceFS` interface with memory implementation
- [ ] `core`: registry for notations, validators, importers, exporters (in-process for now; moved behind the sandbox in M5)
- [ ] `notations/generic`: box, group, note, image, flowchart shapes
- [ ] Desktop shell: Tauri 2 app, Rust fs + watcher commands, Tauri `WorkspaceFS`
- [ ] Canvas: palette, create, connect, rename, delete, multi-select, minimap, zoom to fit
- [ ] Properties panel with typed fields
- [ ] Autosave, reload on outside change
- [ ] New workspace / open workspace flow
- [ ] SVG and PNG export of a view
- [ ] i18n message file wired from the start; light and dark themes
- [ ] Tests: command/undo property tests, byte-stable round-trip, Playwright draw-save-reopen flow

## Milestone 2 — C4 pack and diagram as code

**Done when:** a published Structurizr DSL sample imports, lays itself out, and exports back without losing elements or relationships.

- [ ] `notations/c4`: Person, Software System, Container, Component, Deployment Node; shapes; property schemas
- [ ] View types: System Landscape, System Context, Container, Component, Dynamic, Deployment
- [ ] Drill-down with breadcrumbs; expand/collapse in place
- [ ] Implied relationships (core query + pack rollup rules)
- [ ] `layout`: ELK layered, force, radial in a worker; run after import and on demand
- [ ] Monaco split view with two-way YAML sync
- [ ] `io/structurizr`: DSL parser and writer, workspace JSON import and export
- [ ] Structurizr DSL mode in the split view
- [ ] Smart connectors (valid types for the pair, likeliest preselected)
- [ ] Command palette; Tab-to-create and Enter-to-rename
- [ ] Tests: round-trip on published Structurizr samples; C4 validation tests

## Milestone 3 — ArchiMate 4 pack

**Done when:** an Archi sample model imports, migrates to ArchiMate 4, renders, and round-trips through the exchange format.

- [ ] `packs/archimate/*.json`: elements, icons, relationships, viewpoints (data only)
- [ ] `notations/archimate`: loader, shapes, edge renderers, multiplicity
- [ ] Validity: data-driven engine; **permissive mode until licensed tables are supplied** (TODO for owner)
- [ ] Viewpoints as view templates that restrict the palette
- [ ] `io/archimate-exchange`: Model Exchange File Format 3.x import and export (and 4 if published)
- [ ] `io/archi`: `.archimate` import including diagrams
- [ ] 3.1/3.2 → 4 migration with change report
- [ ] Live validation panel with quick fixes
- [ ] Trademark notice in About and README
- [ ] Tests: Archi sample import → migrate → exchange round-trip; validity engine tests against a synthetic table

## Milestone 4 — DDD, TOGAF and cross-notation mapping

**Done when:** one system appears in a C4 container view, an ArchiMate application view and a DDD context map, and renaming it in one updates all three.

- [ ] `notations/ddd`: all element types; Context Map with strategic patterns and U/D markers
- [ ] Bounded Context Canvas (form-backed card)
- [ ] Event Storming board
- [ ] `io/cml`: Context Mapper CML import and export; CML mode in split view
- [ ] `notations/togaf`: ADM phase tagging, ABB/SBB, catalogs and matrices, repository view
- [ ] Mapping table: defaults, resolution, facets, "create mapping" prompt, editor UI
- [ ] Drop existing element into a view of another notation
- [ ] Show in other views
- [ ] Impact highlight (upstream/downstream), focus mode
- [ ] Formalise action for generic boxes
- [ ] Sample e-commerce workspace in all four notations; first-launch experience
- [ ] Tests: mapping resolution, rename-propagates-everywhere Playwright flow, CML round-trip

## Milestone 5 — Plugin API and discovery connectors

**Done when:** a plugin made with the scaffolder adds a new notation without any change to core code.

- [ ] `plugin-sdk`: public types, `definePlugin`, RPC host/guest, test harness, API versioning
- [ ] Worker and iframe sandboxes; permission model and install approval UI
- [ ] Plugin discovery (user and workspace folders), developer-mode hot reload
- [ ] Move every built-in pack, importer and exporter behind the sandbox boundary
- [ ] `create-vastitecture-plugin` scaffolder; documented example plugin; authoring guide
- [ ] Connectors with diff preview: OpenAPI, AsyncAPI, docker-compose, Kubernetes, Helm, Terraform, Backstage
- [ ] Remaining importers/exporters: Mermaid, C4-PlantUML, draw.io, CSV, Excel, PDF, Markdown/HTML site
- [ ] Tests: scaffolded plugin end-to-end; connector fixtures; sandbox escape tests

## Milestone 6 — Inventory, analysis and AI

**Done when:** the sample workspace answers "what breaks if we retire X" and CI produces installers for macOS, Windows and Linux.

- [ ] Fact sheets: table, inline edit, saved filters, bulk edit
- [ ] Business capability map with heat-mapping
- [ ] Lifecycle roadmap
- [ ] Impact analysis query panel
- [ ] ADRs: storage, linking, properties-panel display
- [ ] Reports to CSV, Excel, Markdown
- [ ] AWS and Git repository connectors
- [ ] AI assistant (off by default): OpenAI-compatible endpoint, keychain storage, all changes as reviewable diffs
- [ ] SQLite FTS5 search
- [ ] Merge view for conflicting edits
- [ ] Presentation mode, align/distribute
- [ ] Packaging: macOS universal, Windows MSI, Linux AppImage and .deb via GitHub Actions; auto-updater
- [ ] Accessibility audit; performance budget verified in CI
- [ ] CONTRIBUTING.md, code of conduct

## Inputs needed from the owner

| Item | Needed by | Blocking? |
| --- | --- | --- |
| Licence: repo currently has MIT, prompt says Apache-2.0 | M1 | No (defaulting to leave as is until confirmed) |
| ArchiMate 4 relationship validity tables from a licensed spec | M3 | No (permissive mode ships meanwhile) |
| Code-signing certificates (Apple Developer ID, Windows) and updater key as CI secrets | M6 | Only for *signed* installers; unsigned builds work without |
