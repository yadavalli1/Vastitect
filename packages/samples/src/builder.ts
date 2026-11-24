import { DEFAULT_MAPPINGS, emptyWorkspace, makeElement, makeRelationship, makeView, type Element, type LifecyclePhase, type PropertyValue, type Relationship, type View, type ViewNode, type Workspace } from "@vastitecture/core";

/** Portfolio facts for an application or system: who owns it, where it is in its life, what it costs, what data it holds. */
export interface Portfolio {
  owner?: string;
  tags?: string[];
  phase?: LifecyclePhase;
  /** Lifecycle dates (YYYY-MM-DD) by phase; they drive the as-is / to-be plateaus on the Insights page. */
  dates?: Partial<Record<LifecyclePhase, string>>;
  criticality?: "Mission critical" | "Business critical" | "Business operational" | "Administrative";
  technicalFit?: "Excellent" | "Adequate" | "Insufficient" | "Unreasonable";
  functionalFit?: "Excellent" | "Adequate" | "Insufficient" | "Unreasonable";
  annualCost?: number;
  monthlyCost?: number;
  /** The most sensitive data it holds: public, internal, confidential or restricted. */
  data?: "public" | "internal" | "confidential" | "restricted";
  /** Run by another organisation (a vendor, a partner, a regulator). */
  external?: boolean;
  admPhase?: string;
  technology?: string;
  kind?: "Database" | "Queue";
  links?: Element["links"];
  props?: Record<string, PropertyValue>;
  facets?: Element["facets"];
}

/** A node placed by hand: element, x, y, width, height, parent (positions are relative to the parent). */
export type Placed = [Element, number, number, number?, number?, Element?];

/** A box drawn around nested elements in an automatic layout. */
export interface Group {
  box: Element;
  rows: Cell[][];
}
export type Cell = Element | Group;

const isGroup = (c: Cell): c is Group => (c as Group).box !== undefined;

/** Default box sizes, by element type, so automatic layouts look like hand-drawn ones. */
function size(type: string): [number, number] {
  if (type === "c4:Person") return [150, 150];
  if (type.startsWith("c4:")) return [200, 110];
  if (type.startsWith("archimate:")) return [170, 70];
  if (type.startsWith("ddd:Command") || type.startsWith("ddd:DomainEvent") || type.startsWith("ddd:Policy") || type.startsWith("ddd:Aggregate") || type.startsWith("ddd:ReadModel")) return [140, 90];
  if (type.startsWith("ddd:")) return [190, 100];
  if (type.startsWith("togaf:")) return [200, 80];
  return [160, 70];
}

const GAP_X = 60;
const GAP_Y = 100;
const PAD = 24;
const HEADER = 44;

/**
 * Builds a sample workspace: elements, relationships, views (placed by hand or laid out in rows),
 * decisions, rules and saved filters. Every sample uses the same notations, so "model once, view many"
 * shows in each industry.
 */
export class SampleBuilder {
  readonly ws: Workspace;

  constructor(name: string) {
    this.ws = { ...emptyWorkspace(name, ["archimate", "c4", "ddd", "togaf", "generic"]), mappings: DEFAULT_MAPPINGS };
  }

  el(type: string, name: string, description: string, extra: Partial<Element> = {}): Element {
    const e = makeElement(type, name, { description, ...extra });
    this.ws.elements[e.id] = e;
    return e;
  }

  /** An element with portfolio facts: owner, lifecycle, fit, cost, data classification. */
  item(type: string, name: string, description: string, p: Portfolio = {}, parent?: Element): Element {
    const properties: Record<string, PropertyValue> = { ...p.props };
    const set = (k: string, v: PropertyValue | undefined) => v !== undefined && (properties[k] = v);
    set("criticality", p.criticality);
    set("technicalFit", p.technicalFit);
    set("functionalFit", p.functionalFit);
    set("annualCost", p.annualCost);
    set("monthlyCost", p.monthlyCost);
    set("dataClassification", p.data);
    set("admPhase", p.admPhase);
    set("technology", p.technology);
    set("kind", p.kind);
    if (p.external) (properties.external = true), (properties.location = "External");
    return this.el(type, name, description, {
      ...(parent ? { parent: parent.id } : {}),
      ...(p.owner ? { owner: p.owner } : {}),
      tags: [...(p.tags ?? []), ...(p.external ? ["external"] : [])],
      ...(p.phase || p.dates ? { lifecycle: { phase: p.phase ?? "active", ...(p.dates ? { dates: p.dates } : {}) } } : {}),
      properties,
      ...(p.links ? { links: p.links } : {}),
      ...(p.facets ? { facets: p.facets } : {}),
    });
  }

  system(name: string, description: string, p: Portfolio = {}) {
    return this.item("c4:SoftwareSystem", name, description, p);
  }

  container(parent: Element, name: string, description: string, technology: string, p: Portfolio = {}) {
    return this.item("c4:Container", name, description, { owner: parent.owner, ...p, technology }, parent);
  }

  person(name: string, description: string) {
    return this.el("c4:Person", name, description);
  }

  /** A capability, optionally inside a parent capability, with a functional fit for the heat map. */
  capability(name: string, description: string, parent?: Element, fit?: Portfolio["functionalFit"], annualCost?: number) {
    return this.item("archimate:Capability", name, description, { functionalFit: fit, annualCost }, parent);
  }

  rel(type: string, a: Element, b: Element, label?: string, technology?: string, properties?: Relationship["properties"]): Relationship {
    const r = makeRelationship(type, a.id, b.id, { ...(label ? { label } : {}), ...(technology ? { technology } : {}), ...(properties ? { properties } : {}) });
    this.ws.relationships[r.id] = r;
    return r;
  }

  /** A chain of triggers, as in an event storm: a → b → c … */
  chain(type: string, ...items: Element[]) {
    for (let i = 1; i < items.length; i++) this.rel(type, items[i - 1], items[i]);
  }

  /** A view with nodes placed by hand. Edges are every relationship of the view's notation (and `alsoShow`) between its nodes. */
  view(notation: string, viewpoint: string, name: string, nodes: Placed[], extra: Partial<View> = {}): View {
    return this.addView(notation, viewpoint, name, nodes.map(([e, x, y, w, h, parent]): ViewNode => ({ element: e.id, x, y, w: w ?? size(e.type)[0], h: h ?? size(e.type)[1], ...(parent ? { parent: parent.id } : {}) })), extra);
  }

  /** A view laid out in rows, left to right and top to bottom. Groups become boxes with their rows inside. */
  rows(notation: string, viewpoint: string, name: string, rows: Cell[][], extra: Partial<View> = {}): View {
    const nodes: ViewNode[] = [];
    const place = (cells: Cell[][], parent: Element | undefined, x0: number, y0: number): [number, number] => {
      let y = y0;
      let width = 0;
      for (const row of cells) {
        let x = x0;
        let height = 0;
        for (const c of row) {
          if (isGroup(c)) {
            const node: ViewNode = { element: c.box.id, x, y, w: 0, h: 0, ...(parent ? { parent: parent.id } : {}) };
            nodes.push(node);
            const [w, h] = place(c.rows, c.box, PAD, HEADER);
            // the children start at (PAD, HEADER), so the box is that offset plus their extent plus a margin
            node.w = Math.max(PAD + w + PAD, size(c.box.type)[0]);
            node.h = Math.max(HEADER + h + PAD, size(c.box.type)[1]);
            x += node.w + GAP_X;
            height = Math.max(height, node.h);
          } else {
            const [w, h] = size(c.type);
            nodes.push({ element: c.id, x, y, w, h, ...(parent ? { parent: parent.id } : {}) });
            x += w + GAP_X;
            height = Math.max(height, h);
          }
        }
        width = Math.max(width, x - GAP_X - x0);
        y += height + GAP_Y;
      }
      return [width, y - GAP_Y - y0];
    };
    place(rows, undefined, 40, 40);
    return this.addView(notation, viewpoint, name, nodes, extra);
  }

  private addView(notation: string, viewpoint: string, name: string, nodes: ViewNode[], extra: Partial<View>): View {
    const v = makeView(notation, name, { viewpoint, ...extra });
    v.nodes = nodes;
    const present = new Set(nodes.map((n) => n.element));
    const also = (extra.properties?.alsoShow as string | undefined)?.split(",") ?? [];
    if (v.properties.alsoShow) delete v.properties.alsoShow;
    v.edges = Object.values(this.ws.relationships)
      .filter((r) => present.has(r.source) && present.has(r.target) && [notation, ...also].some((n) => r.type.startsWith(n + ":")))
      .map((r) => ({ relationship: r.id }));
    this.ws.views[v.id] = v;
    return v;
  }

  /** A Bounded Context Canvas for one system: it reads everything from the element itself. */
  canvas(name: string, subject: Element) {
    const v = makeView("ddd", name, { viewpoint: "ddd:canvas", subject: subject.id });
    this.ws.views[v.id] = v;
    return v;
  }

  adr(id: string, title: string, status: "proposed" | "accepted" | "deprecated" | "superseded", date: string, elements: Element[], body: string) {
    this.ws.adrs[id] = { id, title, status, date, elements: elements.map((e) => e.id), body };
  }
}

/** A box with rows of elements inside it, for `rows()` layouts: `group(system, [containerA, containerB])`. */
export const group = (box: Element, ...rows: Cell[][]): Group => ({ box, rows });
