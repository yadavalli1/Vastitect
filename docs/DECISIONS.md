# Vastitecture — Decisions

Defaults chosen without asking, newest last. Each can be reversed; say so in review.

## D-01 Product name vs repository name
The product is **Vastitecture** (per the build prompt); the repository is `Vastitect`. Package scope is `@vastitecture/*`, config file `vastitecture.yaml`, user folder `~/.vastitecture`. The repository is not renamed.

## D-02 Licence left unchanged pending confirmation
The repository was created with an MIT `LICENSE`; the prompt asks for Apache-2.0. Relicensing is the owner's call, so the file is untouched. Once confirmed, swap the file and add a `NOTICE`.

## D-03 UI runs in a plain browser build as well as in Tauri
All file access goes through a `WorkspaceFS` interface with Tauri and in-memory implementations. Playwright tests run against the Vite web build using the memory implementation. Reasons: the prompt already wants domain logic reusable in a future web build, and the development container has no WebKitGTK, so Tauri binaries cannot be built or launched there. Tauri builds are verified in GitHub Actions on all three operating systems.

## D-04 One primary type per element, other notations via mapping
An element has a single `type`. Appearing in another notation is resolved through the workspace mapping table or a per-element facet, not by storing several types. Keeps identity, validation and file diffs simple.

## D-05 One-to-many mappings are relationships, not aliases
"A business system is one or more bounded contexts" is modelled as separate elements linked by a realisation relationship declared in the mapping rule, since a single element cannot stand in for several.

## D-06 File names do not follow renames
Element files are named from the slug at creation. Renaming changes only the `name` field, giving a one-line diff. A "Tidy file names" command renames on demand.

## D-07 Relationships in one sorted file
As the prompt specifies. Sorted by (source, target, type, id) so concurrent additions usually merge cleanly. Revisit (shard by source element) if merge conflicts prove common.

## D-08 Element path includes the pack
`model/elements/<pack>/<type>/<slug>.yaml` (e.g. `c4/software-system/order-service.yaml`) rather than a flat `<type>` folder, because type ids are namespaced and `:` is not portable in file names.

## D-09 Shapes are declarative
Packs describe shapes as data (SVG path templates, label slots, icon) rendered by the host, instead of shipping React components. This is what lets packs run in a worker sandbox. Interactive custom views use a sandboxed iframe.

## D-10 Built-in packs run in-process until Milestone 5
M1–M4 register packs through the final registry interfaces but in the main thread. M5 moves them behind the worker boundary. The interfaces are async and data-only from the start so the move is mechanical.

## D-11 Immer for the immutable store
Structural sharing with ordinary-looking reducers; patches give inverses for undo cheaply.

## D-12 ArchiMate validity table is never authored by us
Permissive mode ships until tables from a licensed specification are supplied. The engine is tested against a small synthetic table.

## D-13 Git integration is read-only in v1
Status, diff and log in-app; pull/push/commit are left to the user's own Git tooling. The watcher picks up their results.

## D-14 ArchiMate 4 facts taken from the build prompt
The April 2026 release, the 60 → 42 concept reduction and the removed-concept mappings are implemented as stated in the prompt and its listed sources; they will be checked against the published summary when the pack's data files are written in M3, and any discrepancy reported rather than guessed.

## D-15 Plugin sandbox is a Web Worker with globals removed
Third-party plugins run in one module worker each. Network and storage globals are deleted before
the plugin's code is imported, its `@vastitecture/plugin-sdk` import is rewritten to a small shim, and
everything else goes through a structured-clone RPC whose host checks capabilities and permissions.
Built-ins run in a shared worker through the same RPC. UI-capable plugins get a script-less iframe
panel only; richer interactive plugin UI is a later step.

## D-16 Renderer-dependent exporters run in the app
PDF, the static HTML site and Markdown docs need the SVG renderer and every installed notation's
shapes, so they register (through the same plugin API) in the app rather than in the worker.
PDF pages are high-resolution JPEGs of each view, not vector graphics.

## D-17 The `ulid` package was replaced
It refuses to run in workers. `newId()` now generates ULIDs with `crypto.getRandomValues`.

## D-18 Fixture sources
Published samples are read from npm packages at test time rather than copied in (see
`fixtures/README.md`). Where no published sample was reachable (docker-compose, Kubernetes, Helm,
Terraform, AsyncAPI, draw.io) the fixtures were written for this project.

## D-19 ArchiMate 4 element list is unverified
The pack's element list follows the public summaries quoted in the build prompt because the
specification and the vendor change summaries could not be fetched from the build environment.
`packs/archimate/elements.json` is marked `"verified": false` and the problems panel says so.
