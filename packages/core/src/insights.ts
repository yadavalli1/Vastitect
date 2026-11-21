import { LIFECYCLE_PHASES, type Element, type Id, type LifecyclePhase, type Relationship, type Workspace } from "./model";
import { ancestors, dependencyEdge } from "./queries";
import type { Registry } from "./registry";

/* ------------------------------------------------------------------ plateaus (as-is / to-be) */

export type Presence = "planned" | LifecyclePhase | "retired" | "unknown";

/**
 * Where an element stands on a date, from its lifecycle dates: before its first dated phase it is
 * "planned" (not yet there), from its endOfLife date it is "retired", otherwise the latest phase that has
 * started. Elements without dates keep their current phase ("unknown" when they have none).
 */
export function presenceAt(e: Element, date: string): Presence {
  const dates = e.lifecycle?.dates ?? {};
  const dated = LIFECYCLE_PHASES.filter((p) => dates[p]).map((p) => [p, dates[p]] as const);
  if (!dated.length) return e.lifecycle?.phase ?? "unknown";
  const started = dated.filter(([, d]) => d <= date);
  if (!started.length) return "planned";
  const [phase] = started.sort((a, b) => a[1].localeCompare(b[1]) || LIFECYCLE_PHASES.indexOf(a[0]) - LIFECYCLE_PHASES.indexOf(b[0])).at(-1)!;
  return phase === "endOfLife" ? "retired" : phase;
}
export const exists = (p: Presence) => p !== "planned" && p !== "retired";

export interface PlateauDiff {
  from: string;
  to: string;
  introduced: Id[];
  retired: Id[];
  changed: { id: Id; from: Presence; to: Presence }[];
  /** Dependencies that are fine at `from` but broken at `to`: the dependent still exists, the dependency does not. */
  broken: { relationship: Id; dependent: Id; dependency: Id }[];
}

/** What a migration from one date to another involves. */
export function comparePlateaus(ws: Workspace, from: string, to: string, reg?: Registry): PlateauDiff {
  const d: PlateauDiff = { from, to, introduced: [], retired: [], changed: [], broken: [] };
  const at = new Map<Id, [Presence, Presence]>();
  for (const e of Object.values(ws.elements)) {
    const a = presenceAt(e, from), b = presenceAt(e, to);
    at.set(e.id, [a, b]);
    if (!exists(a) && exists(b)) d.introduced.push(e.id);
    else if (exists(a) && !exists(b)) d.retired.push(e.id);
    else if (exists(a) && exists(b) && a !== b) d.changed.push({ id: e.id, from: a, to: b });
  }
  for (const r of Object.values(ws.relationships)) {
    const edge = dependencyEdge(r, reg);
    if (!edge) continue;
    const [dependent, dependency] = edge;
    const [, depTo] = at.get(dependent) ?? [];
    const [, onTo] = at.get(dependency) ?? [];
    if (depTo && onTo && exists(depTo) && !exists(onTo)) d.broken.push({ relationship: r.id, dependent, dependency });
  }
  return d;
}

/* ------------------------------------------------------------------ structure metrics */

export interface ElementMetrics {
  fanIn: number;
  fanOut: number;
  /** fanOut / (fanIn + fanOut): 0 = stable (much depends on it), 1 = unstable. */
  instability: number;
  /** How many elements depend on it, directly or indirectly. */
  reach: number;
  /** Removing it disconnects other elements from each other. */
  cutVertex: boolean;
  /** Part of a dependency cycle. */
  inCycle: boolean;
}
export interface StructureReport {
  metrics: Map<Id, ElementMetrics>;
  cycles: Id[][];
  /** Elements ranked by how much depends on them (reach), then fan-in. */
  hotspots: Id[];
}

/** Dependencies only (containment and non-dependency relationships are ignored). */
function graph(ws: Workspace, reg?: Registry, ids?: Set<Id>) {
  const out = new Map<Id, Set<Id>>();
  const inn = new Map<Id, Set<Id>>();
  for (const r of Object.values(ws.relationships)) {
    const e = dependencyEdge(r, reg);
    if (!e) continue;
    const [a, b] = e;
    if (a === b || !ws.elements[a] || !ws.elements[b] || (ids && (!ids.has(a) || !ids.has(b)))) continue;
    if (!out.has(a)) out.set(a, new Set());
    if (!inn.has(b)) inn.set(b, new Set());
    out.get(a)!.add(b);
    inn.get(b)!.add(a);
  }
  return { out, inn };
}

export function structure(ws: Workspace, reg?: Registry, only?: Id[]): StructureReport {
  const ids = only ? new Set(only) : undefined;
  const nodes = Object.keys(ws.elements).filter((id) => !ids || ids.has(id));
  const { out, inn } = graph(ws, reg, ids);

  // Tarjan's strongly connected components (iterative) for cycles.
  const index = new Map<Id, number>(), low = new Map<Id, number>(), on = new Set<Id>(), stack: Id[] = [];
  const cycles: Id[][] = [];
  let i = 0;
  for (const root of nodes) {
    if (index.has(root)) continue;
    const work: [Id, Id[]][] = [[root, [...(out.get(root) ?? [])]]];
    index.set(root, i), low.set(root, i++), stack.push(root), on.add(root);
    while (work.length) {
      const [v, rest] = work[work.length - 1];
      if (rest.length) {
        const w = rest.pop()!;
        if (!index.has(w)) {
          index.set(w, i), low.set(w, i++), stack.push(w), on.add(w);
          work.push([w, [...(out.get(w) ?? [])]]);
        } else if (on.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
        continue;
      }
      work.pop();
      if (work.length) low.set(work[work.length - 1][0], Math.min(low.get(work[work.length - 1][0])!, low.get(v)!));
      if (low.get(v) === index.get(v)) {
        const comp: Id[] = [];
        let w: Id;
        do (w = stack.pop()!), on.delete(w), comp.push(w);
        while (w !== v);
        if (comp.length > 1) cycles.push(comp.reverse());
      }
    }
  }
  const inCycle = new Set(cycles.flat());

  // Articulation points of the undirected dependency graph (Hopcroft–Tarjan, iterative).
  const und = new Map<Id, Set<Id>>();
  for (const [a, bs] of out) for (const b of bs) (und.get(a) ?? und.set(a, new Set()).get(a)!).add(b), (und.get(b) ?? und.set(b, new Set()).get(b)!).add(a);
  const disc = new Map<Id, number>(), lo = new Map<Id, number>(), cut = new Set<Id>();
  let t = 0;
  for (const root of und.keys()) {
    if (disc.has(root)) continue;
    disc.set(root, t), lo.set(root, t++);
    let children = 0;
    const work: [Id, Id | undefined, Id[]][] = [[root, undefined, [...und.get(root)!]]];
    while (work.length) {
      const [v, parent, rest] = work[work.length - 1];
      if (rest.length) {
        const w = rest.pop()!;
        if (!disc.has(w)) {
          disc.set(w, t), lo.set(w, t++);
          if (v === root) children++;
          work.push([w, v, [...und.get(w)!]]);
        } else if (w !== parent) lo.set(v, Math.min(lo.get(v)!, disc.get(w)!));
        continue;
      }
      work.pop();
      if (parent !== undefined) {
        lo.set(parent, Math.min(lo.get(parent)!, lo.get(v)!));
        if (parent !== root && lo.get(v)! >= disc.get(parent)!) cut.add(parent);
      }
    }
    if (children > 1) cut.add(root);
  }

  // Reach: how many elements depend on each one (reverse BFS), capped for very large models.
  const reach = new Map<Id, number>();
  for (const id of nodes) {
    if (!inn.has(id)) {
      reach.set(id, 0);
      continue;
    }
    const seen = new Set<Id>([id]);
    const q = [id];
    while (q.length && seen.size < 5000) for (const p of inn.get(q.shift()!) ?? []) if (!seen.has(p)) seen.add(p), q.push(p);
    reach.set(id, seen.size - 1);
  }
  const metrics = new Map<Id, ElementMetrics>();
  for (const id of nodes) {
    const fanIn = inn.get(id)?.size ?? 0, fanOut = out.get(id)?.size ?? 0;
    metrics.set(id, { fanIn, fanOut, instability: fanIn + fanOut ? Math.round((fanOut / (fanIn + fanOut)) * 100) / 100 : 0, reach: reach.get(id) ?? 0, cutVertex: cut.has(id), inCycle: inCycle.has(id) });
  }
  const hotspots = nodes.filter((id) => metrics.get(id)!.reach > 0).sort((a, b) => metrics.get(b)!.reach - metrics.get(a)!.reach || metrics.get(b)!.fanIn - metrics.get(a)!.fanIn);
  return { metrics, cycles, hotspots };
}

/* ------------------------------------------------------------------ data classification */

/** Ordered from least to most sensitive. */
export const CLASSIFICATIONS = ["public", "internal", "confidential", "restricted"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];
const rank = (c: unknown) => CLASSIFICATIONS.indexOf(String(c ?? "").toLowerCase() as Classification);

export interface DataExposure {
  /** The most sensitive data each element handles: its own classification or what reaches it. */
  handles: Map<Id, { level: Classification; from: Id; path: Id[] }>;
  /** Sensitive data reaching an element cleared for less, or an element marked external. */
  findings: { element: Id; level: Classification; cleared?: Classification; from: Id; path: Id[]; external: boolean }[];
}

/**
 * Follow classified data along relationships. Data moves both ways along a dependency (a caller sends
 * requests and receives answers), so any connected element can see what a classified element holds,
 * except where a relationship says `dataFlow: none`. `dataClassification` on an element is what it
 * holds (or is cleared for); `external: true` marks systems outside the organisation.
 */
export function dataExposure(ws: Workspace): DataExposure {
  const adj = new Map<Id, Relationship[]>();
  for (const r of Object.values(ws.relationships)) {
    if (r.properties.dataFlow === "none" || !ws.elements[r.source] || !ws.elements[r.target]) continue;
    for (const id of [r.source, r.target]) (adj.get(id) ?? adj.set(id, []).get(id)!).push(r);
  }
  const handles = new Map<Id, { level: Classification; from: Id; path: Id[] }>();
  const sources = Object.values(ws.elements).filter((e) => rank(e.properties.dataClassification) > 0).sort((a, b) => rank(b.properties.dataClassification) - rank(a.properties.dataClassification));
  for (const s of sources) {
    const level = CLASSIFICATIONS[rank(s.properties.dataClassification)];
    const q: Id[][] = [[s.id]];
    const seen = new Set([s.id]);
    while (q.length) {
      const path = q.shift()!;
      const id = path[path.length - 1];
      const cur = handles.get(id);
      // Already reached by data at least as sensitive: nothing new to spread from here (a source always spreads its own).
      if (id !== s.id && cur && rank(cur.level) >= rank(level) && cur.from !== s.id) continue;
      if (!cur || rank(cur.level) < rank(level)) handles.set(id, { level, from: s.id, path });
      // A boundary that is cleared for less stops the spread past it (it is reported, not traversed).
      if (id !== s.id && rank(ws.elements[id].properties.dataClassification) >= 0 && rank(ws.elements[id].properties.dataClassification) < rank(level)) continue;
      if (ws.elements[id].properties.external === true && id !== s.id) continue;
      for (const r of adj.get(id) ?? []) {
        const next = r.source === id ? r.target : r.source;
        if (seen.has(next)) continue;
        seen.add(next);
        q.push([...path, next]);
      }
    }
  }
  const findings: DataExposure["findings"] = [];
  for (const [id, h] of handles) {
    if (id === h.from) continue;
    const e = ws.elements[id];
    const cleared = rank(e.properties.dataClassification) >= 0 ? CLASSIFICATIONS[rank(e.properties.dataClassification)] : undefined;
    const external = e.properties.external === true;
    if ((rank(h.level) >= rank("confidential") && external) || (cleared && rank(cleared) < rank(h.level))) findings.push({ element: id, level: h.level, cleared, from: h.from, path: h.path, external });
  }
  return { handles, findings: findings.sort((a, b) => rank(b.level) - rank(a.level)) };
}

/* ------------------------------------------------------------------ costs */

/** An element's own cost plus everything inside it (properties.monthlyCost, a number). */
export function costRollup(ws: Workspace): Map<Id, { own: number; total: number }> {
  const out = new Map<Id, { own: number; total: number }>();
  for (const e of Object.values(ws.elements)) {
    const own = Number(e.properties.monthlyCost ?? 0) || 0;
    const cur = out.get(e.id) ?? { own: 0, total: 0 };
    cur.own = own;
    cur.total += own;
    out.set(e.id, cur);
    if (!own) continue;
    for (const a of ancestors(ws, e.id)) {
      const p = out.get(a) ?? { own: 0, total: 0 };
      p.total += own;
      out.set(a, p);
    }
  }
  return out;
}
