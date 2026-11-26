---
name: vastitecture-modeling
description: Create and change architecture models in a Vastitecture workspace (C4, ArchiMate, DDD and TOGAF in one model) by writing a name-based model spec and applying it with the vastitecture CLI. Use when the user asks to model, document, diagram or map a system, application landscape, capabilities, bounded contexts, a migration or decision records, or when a folder contains vastitecture.yaml.
---

# Vastitecture modelling

Vastitecture keeps one architecture model and shows it in several notations: a system is one element
that can appear in a C4 container view, an ArchiMate application view and a DDD context map. A
workspace is a folder of YAML files (`vastitecture.yaml`, `model/`, `views/`, `adrs/`) kept in Git.

**Do not write those YAML files by hand.** They carry generated ids and diagram coordinates. Write a
short **model spec** that names things and let `vastitecture apply` validate it, merge it into the
model and lay the views out.

## 1. Find the command

Use the first that works:

1. `vastitecture` on the PATH.
2. `node <repo>/packages/cli/dist/vastitecture.mjs` inside a Vastitecture checkout (build it first with
   `pnpm --filter @vastitecture/cli build` if `dist/` is missing).
3. `node vastitecture.mjs`, after downloading `vastitecture.mjs` from the latest GitHub release of
   Vastitecture. It is one file and runs on Node 20 or later.

If the tool offers MCP tools named `list_types`, `show_model`, `apply_model_spec` and `check_model`,
use those instead: they are the same commands, served by `vastitecture mcp`.

Below, `vastitecture` stands for whichever you found.

## 2. Workflow

1. **Workspace.** If there is no `vastitecture.yaml`, create one: `vastitecture new <folder>` (blank), or
   `vastitecture new <folder> --sample banking` to start from an industry sample (`vastitecture samples`
   lists them).
2. **Read before you write.** Run `vastitecture show <folder>` to see what exists. Reuse existing names
   exactly. An element with the same name is updated, not duplicated.
3. **Look up the vocabulary.** Run `vastitecture types` (or `--notation c4`, or `--format json`). Use
   only the ids it lists. The full list is in [reference/notations.md](reference/notations.md).
4. **Write a spec** in a YAML file. The format is in [reference/spec-format.md](reference/spec-format.md),
   and there are complete examples in [examples/](examples/).
5. **Dry run:** `vastitecture apply <folder> spec.yaml --dry-run`. If it reports problems, fix the spec.
   Every error names the valid choices; nothing is written while there are errors.
6. **Apply:** `vastitecture apply <folder> spec.yaml`. Apply is idempotent: running the same spec again
   changes nothing.
7. **Check:** `vastitecture check <folder>`. Resolve errors; mention warnings to the user.
8. **Tell the user** what you added. They can open the folder in the Vastitecture app, or export a view,
   for example `vastitecture export <folder> --format mermaid-c4 --view "<view name>"`.

## 3. A minimal spec

```yaml
elements:
  - name: Customer
    type: c4:Person
    description: Buys from the shop.
  - name: Online Shop
    type: c4:SoftwareSystem
    description: Lets customers browse and order.
    owner: Team Checkout
    lifecycle: { phase: active }
  - name: Web App
    type: c4:Container
    parent: Online Shop
    properties: { technology: React }
  - name: Payment Provider
    type: c4:SoftwareSystem
    properties: { location: External }
relationships:
  - { from: Customer, to: Web App, type: c4:Uses, label: Orders with, technology: HTTPS }
  - { from: Web App, to: Payment Provider, type: c4:Uses, label: Takes payment via }
views:
  - name: Online Shop – containers
    viewpoint: c4:container
    subject: Online Shop
    rows: [[Customer], [Online Shop, Web App], [Payment Provider]]
```

## 4. Modelling rules that matter

- **One element, many views.** Model a system once and add it to C4, ArchiMate and DDD views. Do not
  create "Online Shop (ArchiMate)" next to "Online Shop".
- **Pick the notation by question:**
  - C4 for "what are the systems and containers and how do they talk";
  - ArchiMate for capabilities, business processes, value streams, motivation (drivers, goals,
    requirements) and layered views;
  - DDD for domains, subdomains, bounded contexts, team ownership, context-map patterns and event
    storms;
  - TOGAF for building blocks and ADM phases.

  See [reference/modeling-guide.md](reference/modeling-guide.md).
- **Nesting** uses `parent`. A container's parent is its software system; a sub-capability's parent is
  its capability. In a view, a child is drawn inside its parent when both are listed.
- **Relationships read as sentences**, from the dependent to the dependency: "Web App → Orders DB:
  Reads and writes". Give `technology` for protocols.
- **Views stay small:** 5 to 15 elements. Use `rows` for a readable top-to-bottom order: people at the
  top, the subject in the middle, external systems at the bottom.
- **Portfolio facts go in `owner`, `lifecycle` and `properties`:**
  - `criticality`, `technicalFit`, `functionalFit`, `annualCost` and `monthlyCost`;
  - `dataClassification` (public, internal, confidential, restricted);
  - `location: External` for third parties in C4, and `external: true` for data-flow analysis.

  The app's fact sheets, heat maps, roadmaps and Insights read them.
- **Decisions:** record significant choices as `decisions` (architecture decision records) linked to
  the elements they affect.
- **Do not invent facts.** If the user has not said who owns something or what it costs, leave it out
  or ask.

## 5. Changing and removing

- Update: list the element by its existing name with only the fields to change. `properties` are merged;
  set a property to `null` to remove it.
- Rename: give the element's `id` (from `vastitecture show --format json` or the files in `model/`)
  with the new `name`. Its relationships, views and decisions follow.
- Duplicate names: when two elements share a name (a "Payments" system and a "Payments"
  capability), `show` prints their ids. Refer to them by id in `from`, `to`, `parent` and view lists.
- Remove: `remove: { elements: [...], relationships: [{ from, to, type }], views: [...], decisions: [...] }`.
  Removing an element also removes its relationships and takes it out of views.
- Re-listing a view with the same elements keeps its layout. Listing different elements lays the view
  out again.
