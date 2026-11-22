# Vastitecture

An open-source, local-first desktop app for modelling architecture in **ArchiMate**, **C4**,
**Domain-Driven Design** and **TOGAF** in one workspace.

**Model once, view many.** Every box on every diagram is a view of one element in a single shared
model. Rename a system on a C4 container diagram and it is renamed on its ArchiMate application view,
its DDD context map and its fact-sheet row.

- **Interactive**: direct manipulation, smart connectors that offer only valid relationships, live
  validation with quick fixes, drill-down with breadcrumbs, impact highlighting, keyboard-first editing,
  diagram as code (YAML, Structurizr DSL, Context Mapper CML) in a split view, synced both ways.
- **Plug and play**: opens on a sample workspace with zero configuration; imports what you already
  have; every notation, importer, exporter and connector is a plugin.
- **Git-friendly**: a workspace is a folder of small, sorted YAML files that diff and merge cleanly.
  Outside edits (a `git pull`) reload into the open canvas; conflicting edits open a merge view.
- **Inventory and analysis** on the same model: fact sheets, capability heat maps, lifecycle roadmaps,
  "what breaks if we retire X", ADRs, catalogs and matrices.
- **Private by default**: no account, no server, no telemetry. No network access unless you run a
  discovery connector or switch on the optional AI assistant.

## What's in the box

| Area | Supported |
| --- | --- |
| Notations | ArchiMate 4 (viewpoints, data-driven validity, 3.x migration), C4 (all six view types), DDD (context map, Bounded Context Canvas, Event Storming, tactical model), TOGAF (ADM tagging, building blocks, catalogs, matrices, repository), generic whiteboard shapes |
| Import | ArchiMate Model Exchange File Format, Archi `.archimate`, Structurizr DSL and JSON, Context Mapper CML, Mermaid (C4 and flowchart), C4-PlantUML, draw.io, CSV, Excel |
| Export | All of the above except Archi, plus SVG, PNG, PDF, a static HTML site and Markdown docs |
| Insights | What changed since a commit or another copy (marked on the diagrams), as-is/to-be plateaus from lifecycle dates with the dependencies a migration breaks, dependency hotspots, cycles and single points of failure, where classified data flows, and monthly cloud cost rolled up through the model (from AWS, Azure or Google Cloud billing exports) |
| Comments | Review comments on elements, stored in the workspace one file each, so they travel through Git |
| Architecture rules | Checks written as data in `vastitecture.yaml` (required owners, forbidden dependencies, boundaries, fan-in/fan-out limits), shown live in the app and enforced in CI by the `vastitecture` command-line tool, which also diffs and exports workspaces ([docs/CLI.md](docs/CLI.md)) |
| Discovery (read-only, with a diff preview) | OpenAPI and AsyncAPI, docker-compose, Kubernetes and Helm, Terraform state or plan, Backstage catalog, AWS, Google Cloud and Azure (through your own `aws`/`gcloud`/`az` CLI sign-in in the desktop app, or their saved JSON output), ServiceNow CMDB (live Table API in the desktop app, or JSON/CSV exports; reviewed write-back of names, descriptions and dependencies), runtime traces from OpenTelemetry, Jaeger, Zipkin or Datadog (compared with the model to show undocumented and unused dependencies), live Kubernetes through `kubectl`, GitHub organisations (CODEOWNERS as owners), Git repositories |
| Delivery and other EA tools | Jira and Azure DevOps work items linked to the elements they change; imports from LeanIX, Ardoq and Sparx Enterprise Architect (XMI) |
| Plugins | Notation packs, importers, exporters, validators, connectors, layouts, themes and side panels in sandboxed workers with declared permissions. See [docs/PLUGINS.md](docs/PLUGINS.md) |
| AI (optional, off by default) | Any OpenAI-compatible endpoint (Ollama, LiteLLM, hosted). Drafts models, suggests relationships, explains views, reviews the model, and a chat beside the canvas answers questions about the model, makes changes on request and drafts decision records. Every change arrives as a reviewable diff |

## Workspace on disk

```
my-workspace/
  vastitecture.yaml                     settings, enabled packs, cross-notation mappings
  model/elements/<pack>/<type>/<slug>.yaml   one file per element
  model/relationships.yaml              every relationship, sorted
  views/<notation>/<slug>.yaml          placements and routes only
  adrs/0001-<title>.md                  decisions, Markdown with front matter
  .vastitecture/plugins/                workspace plugins (commit them; each needs your approval)
```

JSON Schemas for these files are in [`packages/schema`](packages/schema).

## Develop

Requirements: Node 22, pnpm 10, Rust (stable), and on Linux the WebKitGTK 4.1 development packages.

```bash
pnpm install
```

```bash
pnpm dev            # the app in a browser (workspaces in browser storage, or a folder in Chromium)
```

```bash
pnpm tauri dev      # the desktop app
```

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm e2e
```

Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · Plan: [docs/PLAN.md](docs/PLAN.md) ·
Decisions: [docs/DECISIONS.md](docs/DECISIONS.md) · Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)

## Trademarks

ArchiMate® and TOGAF® are registered trademarks of The Open Group. Vastitecture is not affiliated with
or endorsed by The Open Group. No text from The Open Group's specifications is included; the
ArchiMate relationship validity table is not shipped and must be supplied from a licensed copy of the
specification (see `packs/archimate/validity.json`). C4, Structurizr, Archi, Context Mapper, Mermaid,
PlantUML, draw.io, Backstage, Terraform, Kubernetes, AWS, Google Cloud, Microsoft Azure and ServiceNow are the property of their respective owners.

## Licence

See [LICENSE](LICENSE).
