# Model spec format

A model spec is a YAML (or JSON) document with any of these top-level keys. Every key is optional.
`vastitecture apply` merges it into the workspace, and `vastitecture show` prints a workspace in the
same format, so you can read, edit and re-apply.

```yaml
workspace: { name: "Acme architecture" }
elements: [...]
relationships: [...]
views: [...]
decisions: [...]
rules: [...]
remove: { elements: [...], relationships: [...], views: [...], decisions: [...] }
```

## elements

| Key | Required | Meaning |
| --- | --- | --- |
| `name` | yes | The element's name. It is how the rest of the spec refers to it. An existing element with this name is updated. |
| `type` | for new elements | A type id from `vastitecture types`, for example `c4:SoftwareSystem` or `archimate:Capability`. |
| `id` | no | Chooses between existing elements that share a name (`show` prints ids when names clash). With a different `name` it renames the element. For a new element it fixes the id. Anywhere an element name is expected you may give an id instead. |
| `description` | no | One or two sentences. |
| `parent` | no | Name of the containing element. Use `null` to clear it. |
| `owner` | no | Team or person accountable. |
| `tags` | no | List of strings. Replaces the existing tags. |
| `lifecycle` | no | `{ phase, dates }`. `phase` is one of `plan`, `phaseIn`, `active`, `phaseOut` or `endOfLife`. `dates` maps a phase to `YYYY-MM-DD`; the dates drive roadmaps and the as-is / to-be comparison. |
| `properties` | no | Map of key to value (text, number, boolean or list of text). Merged into existing properties; `null` deletes a key. |
| `links` | no | `[{ kind: repo\|runbook\|adr\|doc\|other, href, label }]`. |

Useful properties:
- **Any element:**
  - `criticality` (Mission critical, Business critical, Business operational, Administrative);
  - `technicalFit` and `functionalFit` (Excellent, Adequate, Insufficient, Unreasonable);
  - `annualCost` and `monthlyCost` (numbers);
  - `dataClassification` (public, internal, confidential, restricted);
  - `external` (true for systems run by another organisation);
  - `admPhase`, a TOGAF ADM phase such as `"C: Information Systems Architectures"`.
- **C4:** `technology` and `location` (Internal or External). `kind: Database` or `kind: Queue` on a
  container changes its shape.
- **ArchiMate:** `domain` (Business, Application, Technology or Implementation) on common-domain
  elements such as `archimate:Service`, `archimate:Process` and `archimate:Function`.
- **DDD:**
  - `subdomainType` (Core, Supporting, Generic) on `ddd:Subdomain`;
  - on a bounded context or software system, the canvas fields: `purpose`, `domainClassification`,
    `businessModel`, `evolution`, `ubiquitousLanguage` and `businessDecisions`.

## relationships

| Key | Required | Meaning |
| --- | --- | --- |
| `from`, `to` | yes | Element names. `from` depends on or acts on `to`. |
| `type` | yes | A relationship type id, for example `c4:Uses`, `archimate:Serving`, `archimate:Realization`, `archimate:Triggering`, `ddd:CustomerSupplier` or `togaf:Realizes`. |
| `label` | no | Verb phrase, for example "Places orders via". |
| `technology` | no | Protocol or format, for example "JSON/HTTPS" or "Kafka". |
| `properties` | no | For example `accessType: Read` on `archimate:Access`, `downstreamRoles: ACL` on DDD patterns, or `dataFlow: none` where no data passes. |

A relationship is matched by `from`, `to` and `type`. Applying it again updates the label.

Notation conventions:
- **C4:** `c4:Uses` between people, systems, containers and components.
- **ArchiMate:**
  - a system realises a capability: `archimate:Realization` from system to capability;
  - a service serves a process or actor: `archimate:Serving`;
  - process steps trigger each other: `archimate:Triggering`;
  - value stream stages flow: `archimate:Flow`;
  - a value stream is made of stages: `archimate:Composition`;
  - a driver influences a goal or requirement: `archimate:Influence`;
  - a system realises a requirement: `archimate:Realization`.
- **DDD:** `ddd:Implements` (system → subdomain), `ddd:Owns` (team → system), context-map patterns
  between systems (`ddd:CustomerSupplier`, `ddd:Conformist`, `ddd:AnticorruptionLayer`,
  `ddd:OpenHostService`, `ddd:PublishedLanguage`, `ddd:Partnership`, `ddd:SharedKernel`,
  `ddd:SeparateWays`), and `ddd:Triggers` between event-storm stickies.
- **TOGAF:** `togaf:Realizes` (solution building block → architecture building block), `togaf:Uses`.

## views

| Key | Required | Meaning |
| --- | --- | --- |
| `name` | yes | View name. An existing view with this name is updated. |
| `notation` | for new views, unless `viewpoint` is given | `c4`, `archimate`, `ddd`, `togaf` or `generic`. |
| `viewpoint` | recommended | A viewpoint id, for example `c4:container` or `archimate:capability-map`. |
| `subject` | for focused views | The element the view is about (C4 context, container or component; DDD canvas). |
| `rows` | one of `rows` or `elements` | Element names in rows, top to bottom: `[[A, B], [C]]`. |
| `elements` | | Element names; laid out four per row. |
| `alsoShow` | no | Other notations whose relationships to draw, for example `[c4]` on an ArchiMate view. |
| `description`, `properties` | no | For example `properties: { admPhase: "B: Business Architecture" }`. |

Children listed together with their parent are drawn inside it, so you can list a system and its
containers in one row. Relationships of the view's notation between listed elements are drawn
automatically. A view listed again with the same elements keeps its manual layout from the app.

`ddd:canvas` views need only `subject`. The canvas reads the subject's properties.

## decisions

```yaml
decisions:
  - title: Use an event bus between ordering and fulfilment
    status: accepted        # proposed, accepted, deprecated, superseded
    date: 2026-02-12
    elements: [Order API, Event Bus]
    body: |
      ## Context
      ...
      ## Decision
      ...
      ## Consequences
      ...
```

A decision with the same title (or `id`) is updated. New decisions are numbered after the highest
existing number.

## rules

Architecture rules are added to `vastitecture.yaml` and replaced by `id`. Examples:

```yaml
rules:
  - id: systems-have-owners
    description: Every system has an owner.
    severity: warning
    match: { type: c4:SoftwareSystem }
    require: [owner, lifecycle]
  - id: no-new-legacy-dependencies
    forbid: { from: { lifecycle: [plan, phaseIn] }, to: { tag: legacy } }
```

## remove

```yaml
remove:
  elements: [Old CRM]
  relationships: [{ from: Web App, to: Old CRM, type: c4:Uses }]
  views: [Old landscape]
  decisions: ["0003"]
```

Removals happen before additions, so a spec can replace something in one go.
