import { z } from "zod";
import { ulid } from "ulid";

/** Identifier: lowercase ULID. */
export type Id = string;
/** Namespaced type id, "<pack>:<Name>". */
export type TypeId = string;

export const newId = (): Id => ulid().toLowerCase();

export const LIFECYCLE_PHASES = ["plan", "phaseIn", "active", "phaseOut", "endOfLife"] as const;
export type LifecyclePhase = (typeof LIFECYCLE_PHASES)[number];

const PropertyValue = z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]);
export type PropertyValue = z.infer<typeof PropertyValue>;
const Properties = z.record(PropertyValue);

export const LinkSchema = z.object({
  kind: z.enum(["repo", "runbook", "adr", "doc", "other"]),
  label: z.string().optional(),
  href: z.string(),
});

export const ElementSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  description: z.string().optional(),
  parent: z.string().optional(),
  owner: z.string().optional(),
  tags: z.array(z.string()).default([]),
  lifecycle: z
    .object({
      phase: z.enum(LIFECYCLE_PHASES).optional(),
      dates: z.record(z.string()).optional(),
    })
    .optional(),
  properties: Properties.default({}),
  links: z.array(LinkSchema).default([]),
  /** Per-notation overrides: explicit presentation type and extra properties. */
  facets: z.record(z.object({ type: z.string().optional(), properties: Properties.optional() })).optional(),
});
export type Element = z.infer<typeof ElementSchema>;

export const RelationshipSchema = z.object({
  id: z.string(),
  type: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string().optional(),
  technology: z.string().optional(),
  multiplicity: z.object({ source: z.string().optional(), target: z.string().optional() }).optional(),
  properties: Properties.default({}),
});
export type Relationship = z.infer<typeof RelationshipSchema>;

const Style = z.record(z.union([z.string(), z.number()]));

export const NodeSchema = z.object({
  /** Element id. One placement per element per view. */
  element: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  /** Element id of the node this one is drawn inside. */
  parent: z.string().optional(),
  collapsed: z.boolean().optional(),
  style: Style.optional(),
});
export type ViewNode = z.infer<typeof NodeSchema>;

export const EdgeSchema = z.object({
  relationship: z.string(),
  waypoints: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
  hidden: z.boolean().optional(),
  /** Sequence number for dynamic views. */
  order: z.number().optional(),
  style: Style.optional(),
});
export type ViewEdge = z.infer<typeof EdgeSchema>;

export const AnnotationSchema = z.object({
  id: z.string(),
  kind: z.enum(["note", "group", "text", "image"]),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  text: z.string().optional(),
  href: z.string().optional(),
  style: Style.optional(),
});
export type Annotation = z.infer<typeof AnnotationSchema>;

export const ViewSchema = z.object({
  id: z.string(),
  notation: z.string(),
  viewpoint: z.string().optional(),
  name: z.string(),
  description: z.string().optional(),
  /** Element this view drills into. */
  subject: z.string().optional(),
  properties: Properties.default({}),
  nodes: z.array(NodeSchema).default([]),
  edges: z.array(EdgeSchema).default([]),
  annotations: z.array(AnnotationSchema).default([]),
});
export type View = z.infer<typeof ViewSchema>;

export const MappingRuleSchema = z.object({
  concept: z.string(),
  label: z.string().optional(),
  /** notation id -> candidate type ids, likeliest first. */
  members: z.record(z.array(z.string())),
});
export type MappingRule = z.infer<typeof MappingRuleSchema>;

export const AdrSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string().default("proposed"),
  date: z.string().optional(),
  elements: z.array(z.string()).default([]),
  body: z.string().default(""),
});
export type Adr = z.infer<typeof AdrSchema>;

export const SavedFilterSchema = z.object({
  name: z.string(),
  query: z.string().default(""),
  types: z.array(z.string()).default([]),
});
export type SavedFilter = z.infer<typeof SavedFilterSchema>;

export const SettingsSchema = z.object({
  format: z.literal(1).default(1),
  name: z.string(),
  packs: z.array(z.string()).default([]),
  mappings: z.array(MappingRuleSchema).default([]),
  pluginSettings: z.record(z.unknown()).default({}),
  savedFilters: z.array(SavedFilterSchema).default([]),
});
export type Settings = z.infer<typeof SettingsSchema>;

export interface Workspace extends Settings {
  elements: Record<Id, Element>;
  relationships: Record<Id, Relationship>;
  views: Record<Id, View>;
  adrs: Record<string, Adr>;
}

export function emptyWorkspace(name = "Untitled", packs: string[] = []): Workspace {
  return {
    format: 1,
    name,
    packs,
    mappings: [],
    pluginSettings: {},
    savedFilters: [],
    elements: {},
    relationships: {},
    views: {},
    adrs: {},
  };
}

/** A set of changes produced by importers, connectors and the AI assistant. Reviewed as a diff, applied as one command. */
export interface ModelPatch {
  elements?: Element[];
  relationships?: Relationship[];
  views?: View[];
  adrs?: Adr[];
  removeElements?: Id[];
  removeRelationships?: Id[];
  removeViews?: Id[];
  /** Human-readable notes, e.g. migration report lines. */
  report?: string[];
}

export const packOf = (type: TypeId): string => type.slice(0, type.indexOf(":"));
export const localName = (type: TypeId): string => type.slice(type.indexOf(":") + 1);

export function makeElement(type: TypeId, name: string, extra: Partial<Element> = {}): Element {
  return { id: newId(), type, name, tags: [], properties: {}, links: [], ...extra };
}
export function makeRelationship(type: TypeId, source: Id, target: Id, extra: Partial<Relationship> = {}): Relationship {
  return { id: newId(), type, source, target, properties: {}, ...extra };
}
export function makeView(notation: string, name: string, extra: Partial<View> = {}): View {
  return { id: newId(), notation, name, properties: {}, nodes: [], edges: [], annotations: [], ...extra };
}
