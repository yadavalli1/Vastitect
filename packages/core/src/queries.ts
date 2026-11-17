import { packOf, type Element, type Id, type ModelPatch, type Relationship, type TypeId, type View, type Workspace } from "./model";
import type { Registry } from "./registry";

/** Chain of ancestors by model containment, nearest first. */
export function ancestors(ws: Workspace, id: Id): Id[] {
  const out: Id[] = [];
  const seen = new Set([id]);
  for (let p = ws.elements[id]?.parent; p && ws.elements[p] && !seen.has(p); p = ws.elements[p].parent) {
    out.push(p);
    seen.add(p);
  }
  return out;
}

export function childrenOf(ws: Workspace, id: Id): Element[] {
  return Object.values(ws.elements).filter((e) => e.parent === id);
}

export function descendants(ws: Workspace, id: Id): Id[] {
  const byParent = new Map<Id, Id[]>();
  for (const e of Object.values(ws.elements)) if (e.parent) byParent.set(e.parent, [...(byParent.get(e.parent) ?? []), e.id]);
  const out: Id[] = [];
  const walk = (p: Id) => {
    for (const c of byParent.get(p) ?? []) {
      if (out.includes(c)) continue;
      out.push(c);
      walk(c);
    }
  };
  walk(id);
  return out;
}

/** Views that contain a placement of the element. */
export function viewsContaining(ws: Workspace, element: Id): View[] {
  return Object.values(ws.views).filter((v) => v.nodes.some((n) => n.element === element));
}

/**
 * How an element is presented in a notation: its own type if it belongs there, an explicit facet,
 * or the first candidate from the workspace mapping table. Undefined means "no mapping".
 */
export function presentationType(ws: Workspace, element: Element, notation: string, reg?: Registry): TypeId | undefined {
  if (packOf(element.type) === notation) return element.type;
  const facet = element.facets?.[notation]?.type;
  if (facet) return facet;
  for (const rule of ws.mappings) {
    const inRule = Object.values(rule.members).some((types) => types.includes(element.type));
    const candidates = rule.members[notation];
    if (inRule && candidates?.length) return candidates.find((c) => !reg || reg.elementType(c)) ?? candidates[0];
  }
  return undefined;
}

/** Types in other notations that the mapping table treats as the same concept as `type`. */
export function equivalentTypes(ws: Workspace, type: TypeId): TypeId[] {
  const out = new Set<TypeId>([type]);
  for (const rule of ws.mappings) {
    const all = Object.values(rule.members).flat();
    if (all.includes(type)) for (const t of all) out.add(t);
  }
  return [...out];
}

export interface ImpliedRelationship {
  id: string;
  source: Id;
  target: Id;
  /** The real relationships this one summarises. */
  via: Id[];
}

/**
 * Relationships between hidden descendants lifted to their nearest visible ancestors:
 * a link between two containers implies one between their parent systems.
 */
export function impliedRelationships(ws: Workspace, view: View, reg?: Registry): ImpliedRelationship[] {
  const visible = new Set(view.nodes.map((n) => n.element));
  const shown = new Set(view.edges.map((e) => e.relationship));
  const explicitPairs = new Set<string>();
  for (const id of shown) {
    const r = ws.relationships[id];
    if (r) explicitPairs.add(`${r.source}>${r.target}`);
  }
  const lift = (id: Id) => (visible.has(id) ? id : ancestors(ws, id).find((a) => visible.has(a)));
  const out = new Map<string, ImpliedRelationship>();
  for (const r of Object.values(ws.relationships)) {
    if (visible.has(r.source) && visible.has(r.target)) continue;
    if (reg?.relationshipType(r.type)?.rollup === false) continue;
    const s = lift(r.source);
    const t = lift(r.target);
    if (!s || !t || s === t) continue;
    if (ancestors(ws, s).includes(t) || ancestors(ws, t).includes(s)) continue;
    const key = `${s}>${t}`;
    if (explicitPairs.has(key)) continue;
    const cur = out.get(key);
    if (cur) cur.via.push(r.id);
    else out.set(key, { id: `implied:${key}`, source: s, target: t, via: [r.id] });
  }
  return [...out.values()];
}

export type Direction = "dependsOn" | "usedBy";

function dependencyEdge(r: Relationship, reg?: Registry): [Id, Id] | undefined {
  const dep = reg?.relationshipType(r.type)?.dependency ?? "forward";
  if (dep === "none") return undefined;
  return dep === "forward" ? [r.source, r.target] : [r.target, r.source];
}

/**
 * Transitive impact. "usedBy": everything that (directly or indirectly) depends on the element —
 * what breaks if it is retired. "dependsOn": everything the element needs.
 * A dependency on a child counts as a dependency on its parent, and retiring a parent retires its children.
 */
export function impact(ws: Workspace, start: Id, direction: Direction, reg?: Registry): Map<Id, { depth: number; via?: Id }> {
  const fwd = new Map<Id, { to: Id; rel: Id }[]>();
  for (const r of Object.values(ws.relationships)) {
    const e = dependencyEdge(r, reg);
    if (!e) continue;
    const [dependent, dependency] = e;
    const [from, to] = direction === "dependsOn" ? [dependent, dependency] : [dependency, dependent];
    fwd.set(from, [...(fwd.get(from) ?? []), { to, rel: r.id }]);
  }
  const result = new Map<Id, { depth: number; via?: Id }>();
  const queue: { id: Id; depth: number }[] = [{ id: start, depth: 0 }];
  const seen = new Set<Id>([start]);
  const push = (id: Id, depth: number, via?: Id) => {
    if (seen.has(id) || !ws.elements[id]) return;
    seen.add(id);
    result.set(id, { depth, via });
    queue.push({ id, depth });
  };
  while (queue.length) {
    const { id, depth } = queue.shift()!;
    // Containment: children go with the parent (retire), and a parent needs what its children need.
    for (const c of childrenOf(ws, id)) push(c.id, depth, undefined);
    for (const { to, rel } of fwd.get(id) ?? []) {
      push(to, depth + 1, rel);
      if (direction === "usedBy") for (const a of ancestors(ws, to)) push(a, depth + 1, rel);
    }
  }
  return result;
}

export interface PatchDiff {
  added: { kind: "element" | "relationship" | "view"; id: Id; label: string }[];
  changed: { kind: "element" | "relationship" | "view"; id: Id; label: string; fields: { field: string; before: unknown; after: unknown }[] }[];
  removed: { kind: "element" | "relationship" | "view"; id: Id; label: string }[];
}

const relLabel = (ws: Workspace, r: Relationship, extra: Record<Id, Element> = {}) =>
  `${(ws.elements[r.source] ?? extra[r.source])?.name ?? r.source} → ${(ws.elements[r.target] ?? extra[r.target])?.name ?? r.target}${r.label ? ` (${r.label})` : ""}`;

/** What applying a patch would change, for the review dialog. */
export function diffPatch(ws: Workspace, patch: ModelPatch): PatchDiff {
  const d: PatchDiff = { added: [], changed: [], removed: [] };
  const incoming = Object.fromEntries((patch.elements ?? []).map((e) => [e.id, e]));
  const fields = (a: object, b: object) =>
    [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .filter((k) => JSON.stringify((a as Record<string, unknown>)[k]) !== JSON.stringify((b as Record<string, unknown>)[k]))
      .map((k) => ({ field: k, before: (a as Record<string, unknown>)[k], after: (b as Record<string, unknown>)[k] }));
  for (const e of patch.elements ?? []) {
    const cur = ws.elements[e.id];
    if (!cur) d.added.push({ kind: "element", id: e.id, label: `${e.name} (${e.type})` });
    else {
      const f = fields(cur, e);
      if (f.length) d.changed.push({ kind: "element", id: e.id, label: cur.name, fields: f });
    }
  }
  for (const r of patch.relationships ?? []) {
    const cur = ws.relationships[r.id];
    if (!cur) d.added.push({ kind: "relationship", id: r.id, label: relLabel(ws, r, incoming) });
    else {
      const f = fields(cur, r);
      if (f.length) d.changed.push({ kind: "relationship", id: r.id, label: relLabel(ws, cur), fields: f });
    }
  }
  for (const v of patch.views ?? []) {
    const cur = ws.views[v.id];
    if (!cur) d.added.push({ kind: "view", id: v.id, label: `${v.name} (${v.notation})` });
    else {
      const f = fields(cur, v);
      if (f.length) d.changed.push({ kind: "view", id: v.id, label: cur.name, fields: f });
    }
  }
  for (const id of patch.removeElements ?? []) if (ws.elements[id]) d.removed.push({ kind: "element", id, label: ws.elements[id].name });
  for (const id of patch.removeRelationships ?? [])
    if (ws.relationships[id]) d.removed.push({ kind: "relationship", id, label: relLabel(ws, ws.relationships[id]) });
  for (const id of patch.removeViews ?? []) if (ws.views[id]) d.removed.push({ kind: "view", id, label: ws.views[id].name });
  return d;
}

/**
 * Re-key a freshly discovered patch onto existing model ids so re-running a connector updates
 * instead of duplicating. Elements match on `properties.externalId`, else on type + name;
 * relationships on type + source + target. User-edited fields the patch leaves empty are kept.
 */
export function reconcilePatch(ws: Workspace, patch: ModelPatch): ModelPatch {
  const byExternal = new Map<string, Element>();
  const byName = new Map<string, Element>();
  for (const e of Object.values(ws.elements)) {
    if (typeof e.properties.externalId === "string") byExternal.set(e.properties.externalId, e);
    byName.set(`${e.type}|${e.name}`, e);
  }
  const remap = new Map<Id, Id>();
  const elements = (patch.elements ?? []).map((e) => {
    const match = (typeof e.properties.externalId === "string" && byExternal.get(e.properties.externalId)) || byName.get(`${e.type}|${e.name}`);
    if (!match) return e;
    remap.set(e.id, match.id);
    return {
      ...match,
      ...e,
      id: match.id,
      description: e.description ?? match.description,
      owner: e.owner ?? match.owner,
      tags: [...new Set([...match.tags, ...e.tags])],
      properties: { ...match.properties, ...e.properties },
      links: e.links.length ? e.links : match.links,
      lifecycle: e.lifecycle ?? match.lifecycle,
      facets: e.facets ?? match.facets,
    };
  });
  const m = (id: Id) => remap.get(id) ?? id;
  for (const e of elements) if (e.parent) e.parent = m(e.parent);
  const existing = new Map(Object.values(ws.relationships).map((r) => [`${r.type}|${r.source}|${r.target}`, r]));
  const relationships = (patch.relationships ?? []).map((r) => {
    const next = { ...r, source: m(r.source), target: m(r.target) };
    const match = existing.get(`${next.type}|${next.source}|${next.target}`);
    return match ? { ...match, ...next, id: match.id, label: next.label ?? match.label } : next;
  });
  const relMap = new Map((patch.relationships ?? []).map((r, i) => [r.id, relationships[i].id]));
  const views = (patch.views ?? []).map((v) => ({
    ...v,
    subject: v.subject && m(v.subject),
    nodes: v.nodes.map((n) => ({ ...n, element: m(n.element), parent: n.parent && m(n.parent) })),
    edges: v.edges.map((e) => ({ ...e, relationship: relMap.get(e.relationship) ?? e.relationship })),
  }));
  return { ...patch, elements, relationships, views };
}

/** Free-text + field search over elements. Supports `type:`, `tag:`, `owner:`, `phase:` and `no:owner|description`. */
export function searchElements(ws: Workspace, query: string): Element[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return Object.values(ws.elements).filter((e) =>
    terms.every((t) => {
      const [k, v] = t.includes(":") ? [t.slice(0, t.indexOf(":")), t.slice(t.indexOf(":") + 1)] : ["", t];
      switch (k) {
        case "type":
          return e.type.toLowerCase().includes(v);
        case "tag":
          return e.tags.some((x) => x.toLowerCase().includes(v));
        case "owner":
          return (e.owner ?? "").toLowerCase().includes(v);
        case "phase":
          return (e.lifecycle?.phase ?? "").toLowerCase() === v;
        case "no":
          return v === "owner" ? !e.owner : v === "description" ? !e.description : true;
        default:
          return `${e.name} ${e.description ?? ""} ${e.type} ${e.tags.join(" ")}`.toLowerCase().includes(t);
      }
    }),
  );
}
