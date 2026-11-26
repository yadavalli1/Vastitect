# Modelling guide

How to turn a description of a system or an organisation into a good Vastitecture model.

## Start from the question

| The user wants to know | Model | Views |
| --- | --- | --- |
| What systems exist and who uses them | C4 people and software systems | `c4:landscape`, `c4:context` |
| What a system is made of | C4 containers (apps, services, databases, queues) under the system | `c4:container` |
| What a container is made of | C4 components under the container | `c4:component` |
| Where it runs | `c4:DeploymentNode` and `c4:InfrastructureNode`, nested | `c4:deployment` |
| What the business can do, and how well | ArchiMate capabilities in a hierarchy, with `functionalFit` and `annualCost`; systems realise them | `archimate:capability-map` |
| How work flows | ArchiMate processes linked by `archimate:Triggering`, served by systems | `archimate:business-process-cooperation` |
| How value is delivered end to end | An `archimate:ValueStream` composed of stage value streams linked by `archimate:Flow`, served by capabilities | `archimate:value-stream` |
| Why: regulation, goals, requirements | `archimate:Driver` → `archimate:Goal` / `archimate:Requirement` (Influence); systems realise requirements | `archimate:motivation` (drivers, goals, requirements only), `archimate:requirements-realization` (requirements with the systems) |
| How systems cooperate | Systems with C4 dependencies shown on an ArchiMate view | `archimate:application` with `alsoShow: [c4]` |
| Domain boundaries and team ownership | `ddd:Domain` → `ddd:Subdomain` (Core, Supporting, Generic); systems implement subdomains; teams own systems; context-map patterns between systems | `ddd:context-map` |
| A business flow in detail | Event-storm stickies (`ddd:Command`, `ddd:Aggregate`, `ddd:DomainEvent`, `ddd:Policy`, `ddd:ReadModel`) as children of the system, linked by `ddd:Triggers` | `ddd:event-storming` |
| What one bounded context is responsible for | Canvas properties on the system | `ddd:canvas` with `subject` |
| Target architecture building blocks | `togaf:ArchitectureBuildingBlock` realised by `togaf:SolutionBuildingBlock`, which uses systems | `togaf:building-blocks` |
| A migration (as-is to to-be) | Lifecycle dates: the old system `phaseOut` → `endOfLife`; the new one `plan` → `phaseIn` → `active` | Insights page and roadmap in the app; a landscape showing both |

## Naming

- Use the names people use: "Payments Hub", not "payments-hub-svc". Containers are named by role:
  "Order API", "Orders DB".
- Names must be unique enough to refer to. If two things share a name, qualify one: "Payments
  (subdomain)" for the DDD subdomain beside the "Payments" capability.
- Relationship labels are verb phrases read from `from` to `to`: "Publishes OrderPlaced to",
  "Authenticates customers with".

## How much to model

- Prefer a correct small model over a large guessed one. Ask the user for missing facts that matter:
  owners, which system is the system of record, and what is being replaced.
- Each view should answer one question and hold 5 to 15 elements. Make another view rather than a
  crowded one.
- Model external parties (vendors, partners, regulators) as software systems with
  `location: External` and `external: true`. They appear grey in C4, and the data-flow insight treats
  them as outside the organisation.

## Building up a model in steps

1. A `c4:landscape` with the people and systems.
2. A `c4:container` view for the system the user cares most about.
3. A capability map, with systems realising capabilities.
4. Context-map relationships and an event storm for the core flow.
5. Lifecycle dates, owners and costs, so the app's portfolio pages and Insights have data.
6. Decisions for the choices the user tells you about.

Apply after each step and run `vastitecture check`. Smaller specs give clearer errors.

## Checking your work

- `vastitecture check <folder>` validates types, viewpoint membership, relationship validity (where the
  notation defines it) and the workspace's own rules.
- A warning `not-in-viewpoint` means an element type does not belong in that viewpoint. Use the
  suggested viewpoint or drop the element from the view.
- `vastitecture export <folder> --format mermaid-c4 --view "<name>"` gives a quick text rendering to
  show the user in chat.
