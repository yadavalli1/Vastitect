import type { Command } from "./store";
import type { Id, ModelPatch, TypeId, Workspace } from "./model";

/** Shapes are declarative so packs can run in a sandbox; the host renders them. */
export type ShapeKind =
  | "rect"
  | "rounded"
  | "ellipse"
  | "diamond"
  | "person"
  | "cylinder"
  | "hexagon"
  | "note"
  | "folder"
  | "sticky"
  | "component"
  | "parallelogram"
  | "pill"
  | "node3d"
  | "octagon"
  | "chevron"
  | "group"
  | "document"
  | "wave";

export interface PropertyDef {
  key: string;
  label: string;
  type: "string" | "text" | "number" | "boolean" | "enum" | "date" | "tags";
  options?: string[];
  /** Restrict to these element types (undefined = every element). */
  appliesTo?: TypeId[];
  group?: string;
}

export interface ElementTypeDef {
  id: TypeId;
  name: string;
  /** Palette group. */
  category?: string;
  shape: ShapeKind;
  /** CSS colour for the fill. Meaning is always carried by shape/icon/label too. */
  fill?: string;
  /** Short glyph or SVG path data (prefixed "path:") drawn in the corner. */
  icon?: string;
  /** Stereotype text under the name, e.g. "Container". */
  badge?: string;
  size?: [number, number];
  /** Can visually contain child nodes: any (true) or only the listed presentation types. */
  container?: boolean | TypeId[];
  /** Other nodes may be dropped inside it, without it being drawn as a boundary. */
  nestable?: boolean;
  properties?: PropertyDef[];
  /** Alternative looks chosen by a property value, e.g. a database-kind container drawn as a cylinder. */
  variants?: { property: string; values: Record<string, { shape?: ShapeKind; fill?: string; badge?: string }> }[];
}

/** Apply property-driven variants to a type definition. */
export function resolveLook(def: ElementTypeDef | undefined, properties: Record<string, unknown>): { shape: ShapeKind; fill?: string; badge?: string } {
  let look = { shape: def?.shape ?? ("rect" as ShapeKind), fill: def?.fill, badge: def?.badge };
  for (const v of def?.variants ?? []) {
    const hit = v.values[String(properties[v.property] ?? "")];
    if (hit) look = { ...look, ...hit };
  }
  return look;
}

export type Marker = "none" | "arrow" | "open" | "triangle" | "diamond" | "filledDiamond" | "circle" | "filledCircle" | "half";

export interface RelationshipTypeDef {
  id: TypeId;
  name: string;
  category?: string;
  line?: "solid" | "dashed" | "dotted";
  sourceMarker?: Marker;
  targetMarker?: Marker;
  /** Whether a relationship between children implies one between their parents. Default true. */
  rollup?: boolean;
  /**
   * Which end depends on the other, for impact analysis.
   * "forward": source depends on target. "reverse": target depends on source. "none": no dependency.
   */
  dependency?: "forward" | "reverse" | "none";
  /** Letters shown at the ends (DDD upstream/downstream). */
  endLabels?: [string, string];
  properties?: PropertyDef[];
}

export interface ViewpointDef {
  id: string;
  name: string;
  description?: string;
  /** Palette restriction. Undefined = every element type in the pack. */
  elementTypes?: TypeId[];
  relationshipTypes?: TypeId[];
  /** "board" and "form" are rendered by dedicated host views instead of the node canvas. */
  kind?: "diagram" | "board" | "form";
  layout?: { algorithm?: string; direction?: "DOWN" | "RIGHT" };
  /** For kind "form": the card's sections. Fields edit properties of the view's subject element. */
  form?: { subjectTypes: TypeId[]; sections: { title: string; fields: PropertyDef[] }[] };
  /** Draw a left-to-right timeline behind the diagram (event storming). */
  timeline?: boolean;
}

/** Relationship validity as data. Patterns are type ids, "*" or "category:<name>". */
export type Validity =
  | { mode: "permissive"; note?: string }
  | { mode: "rules"; rules: { source: string; target: string; types: TypeId[] }[]; note?: string }
  | { mode: "table"; table: Record<TypeId, Record<TypeId, TypeId[]>>; note?: string };

export interface NotationPack {
  id: string;
  name: string;
  description?: string;
  elementTypes: ElementTypeDef[];
  relationshipTypes: RelationshipTypeDef[];
  viewpoints: ViewpointDef[];
  validity?: Validity;
  /** Relationship type preselected when several are valid. */
  defaultRelationship?: TypeId;
  /** Double-clicking an element of `type` opens (or creates) a view with `viewpoint`. */
  drillDown?: { type: TypeId; viewpoint: string }[];
  /** Property definitions contributed to elements of any pack (e.g. TOGAF ADM phase). */
  globalProperties?: PropertyDef[];
  /** Property definitions for views. */
  viewProperties?: PropertyDef[];
  /** Extra tabular reports generated from the model. */
  reports?: ReportDef[];
}

export interface ReportDef {
  id: string;
  name: string;
  kind: "catalog" | "matrix";
  /** Catalog: element types listed. Matrix: row types. Entries are type ids or "concept:<mapping concept>". */
  rows: string[];
  /** Matrix only: column types, same syntax as rows. */
  columns?: string[];
  /** Catalog columns: property keys or built-ins (name, description, owner, lifecycle, tags). */
  fields?: string[];
}

export interface Problem {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  target: { kind: "element" | "relationship" | "view" | "workspace"; id?: Id };
  view?: Id;
  fixes?: { label: string; commands: Command[] }[];
}

export interface ImportInput {
  name: string;
  text: string;
  bytes?: Uint8Array;
}

export interface Importer {
  id: string;
  label: string;
  extensions: string[];
  /** Cheap content sniff used when several importers share an extension. */
  detect?(input: ImportInput): boolean | Promise<boolean>;
  import(input: ImportInput, ws: Workspace): Promise<ModelPatch> | ModelPatch;
}

export type ExportResult = string | Uint8Array | Record<string, string | Uint8Array>;

export interface Exporter {
  id: string;
  label: string;
  extension: string;
  scope: "view" | "workspace";
  /** Notations this exporter can handle for view scope (undefined = any). */
  notations?: string[];
  /** Id of the importer that reads this format back. A view-scoped pair becomes an editable language in the split view. */
  roundTripWith?: string;
  /** Editor language id for syntax highlighting. */
  language?: string;
  export(ws: Workspace, opts: { view?: Id }): Promise<ExportResult> | ExportResult;
}

export interface ConnectorField {
  key: string;
  label: string;
  type: "string" | "files";
  placeholder?: string;
}

/** Read-only discovery: returns a draft patch the user reviews as a diff. */
export interface Connector {
  id: string;
  label: string;
  description?: string;
  fields: ConnectorField[];
  discover(input: { files: ImportInput[]; config: Record<string, string> }, ws: Workspace): Promise<ModelPatch> | ModelPatch;
}

export interface LayoutGraph {
  nodes: { id: string; w: number; h: number; parent?: string }[];
  edges: { id: string; source: string; target: string }[];
  direction?: "DOWN" | "RIGHT";
}
export type LayoutResult = Record<string, { x: number; y: number; w?: number; h?: number }>;

export interface LayoutEngine {
  id: string;
  label: string;
  layout(graph: LayoutGraph): Promise<LayoutResult>;
}

export interface Validator {
  id: string;
  run(ws: Workspace): Promise<Problem[]> | Problem[];
}

export interface Theme {
  id: string;
  label: string;
  dark?: boolean;
  /** CSS custom properties applied to the app root. */
  vars: Record<string, string>;
}

export interface SidePanel {
  id: string;
  title: string;
  /** Static HTML shown in a sandboxed, script-less iframe. */
  html?: string;
  /** Or: produce the HTML from the current model; called again whenever the model changes. */
  render?(ws: Workspace): string | Promise<string>;
}

type Unregister = () => void;

/** Everything the app knows about notations and I/O arrives through this registry. */
export class Registry {
  packs = new Map<string, NotationPack>();
  importers = new Map<string, Importer>();
  exporters = new Map<string, Exporter>();
  connectors = new Map<string, Connector>();
  layouts = new Map<string, LayoutEngine>();
  validators = new Map<string, Validator>();
  themes = new Map<string, Theme>();
  panels = new Map<string, SidePanel>();

  private elementTypes = new Map<TypeId, ElementTypeDef>();
  private relationshipTypes = new Map<TypeId, RelationshipTypeDef>();
  private listeners = new Set<() => void>();
  version = 0;

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };
  private changed() {
    this.elementTypes.clear();
    this.relationshipTypes.clear();
    for (const p of this.packs.values()) {
      for (const t of p.elementTypes) this.elementTypes.set(t.id, t);
      for (const t of p.relationshipTypes) this.relationshipTypes.set(t.id, t);
    }
    this.version++;
    for (const l of this.listeners) l();
  }
  private add<T extends { id: string }>(map: Map<string, T>, item: T): Unregister {
    map.set(item.id, item);
    this.changed();
    return () => {
      if (map.get(item.id) === item) map.delete(item.id);
      this.changed();
    };
  }

  registerPack = (p: NotationPack) => this.add(this.packs, p);
  registerImporter = (i: Importer) => this.add(this.importers, i);
  registerExporter = (e: Exporter) => this.add(this.exporters, e);
  registerConnector = (c: Connector) => this.add(this.connectors, c);
  registerLayout = (l: LayoutEngine) => this.add(this.layouts, l);
  registerValidator = (v: Validator) => this.add(this.validators, v);
  registerTheme = (t: Theme) => this.add(this.themes, t);
  registerPanel = (p: SidePanel) => this.add(this.panels, p);

  elementType = (id: TypeId) => this.elementTypes.get(id);
  relationshipType = (id: TypeId) => this.relationshipTypes.get(id);
  viewpoint(notation: string, id: string | undefined): ViewpointDef | undefined {
    return this.packs.get(notation)?.viewpoints.find((v) => v.id === id);
  }

  /** Element types offered in the palette for a view. */
  paletteFor(notation: string, viewpoint?: string): ElementTypeDef[] {
    const pack = this.packs.get(notation);
    if (!pack) return [];
    const allowed = this.viewpoint(notation, viewpoint)?.elementTypes;
    return allowed ? pack.elementTypes.filter((t) => allowed.includes(t.id)) : pack.elementTypes;
  }

  /** All property definitions that apply to an element type: its own plus global ones from every pack. */
  propertiesFor(type: TypeId): PropertyDef[] {
    const own = this.elementType(type)?.properties ?? [];
    const global = [...this.packs.values()].flatMap((p) => p.globalProperties ?? []).filter((d) => !d.appliesTo || d.appliesTo.includes(type));
    const seen = new Set<string>();
    return [...own, ...global].filter((d) => !seen.has(d.key) && seen.add(d.key));
  }

  private matches(pattern: string, type: TypeId): boolean {
    if (pattern === "*" || pattern === type) return true;
    if (pattern.startsWith("category:")) return this.elementType(type)?.category === pattern.slice(9);
    return false;
  }

  /**
   * Relationship types valid between two (presented) element types in a notation, likeliest first.
   * Returns `strict: false` when the pack is in permissive mode.
   */
  validRelationships(notation: string, sourceType: TypeId, targetType: TypeId, viewpoint?: string): { types: TypeId[]; strict: boolean } {
    const pack = this.packs.get(notation);
    if (!pack) return { types: [], strict: false };
    const vp = this.viewpoint(notation, viewpoint)?.relationshipTypes;
    const all = pack.relationshipTypes.map((r) => r.id).filter((id) => !vp || vp.includes(id));
    const first = (ids: TypeId[]) =>
      pack.defaultRelationship && ids.includes(pack.defaultRelationship) && ids[0] !== pack.defaultRelationship && pack.validity?.mode !== "rules"
        ? [pack.defaultRelationship, ...ids.filter((i) => i !== pack.defaultRelationship)]
        : ids;
    const v = pack.validity ?? { mode: "permissive" as const };
    if (v.mode === "permissive") return { types: first(all), strict: false };
    if (v.mode === "table") return { types: first((v.table[sourceType]?.[targetType] ?? []).filter((t) => all.includes(t))), strict: true };
    const out: TypeId[] = [];
    for (const r of v.rules)
      if (this.matches(r.source, sourceType) && this.matches(r.target, targetType))
        for (const t of r.types) if (all.includes(t) && !out.includes(t)) out.push(t);
    return { types: out, strict: true };
  }
}
