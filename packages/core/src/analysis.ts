import type { Element, Id, Workspace } from "./model";
import { ancestors, impact } from "./queries";
import type { Registry } from "./registry";

export interface QueryResult {
  title: string;
  /** Plain-language answer, shown above the list. */
  summary: string;
  rows: { element: Id; detail: string; depth?: number }[];
}

const named = (ws: Workspace, id: Id) => ws.elements[id]?.name ?? id;

/** "What breaks if we retire X?" Everything that depends on X, directly or indirectly, and everything inside it. */
export function whatBreaks(ws: Workspace, id: Id, reg?: Registry): QueryResult {
  const hit = impact(ws, id, "usedBy", reg);
  const rows = [...hit.entries()]
    .map(([element, h]) => {
      const via = h.via ? ws.relationships[h.via] : undefined;
      const inside = ancestors(ws, element).includes(id);
      const detail = inside
        ? `part of ${named(ws, id)}`
        : via
          ? `${h.depth === 1 ? "directly" : `indirectly (${h.depth} steps)`}: ${named(ws, via.source)} → ${named(ws, via.target)}${via.label ? ` (${via.label})` : ""}`
          : "contained in an affected element";
      return { element, detail, depth: h.depth };
    })
    .sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0) || named(ws, a.element).localeCompare(named(ws, b.element)));
  const direct = rows.filter((r) => r.depth === 1).length;
  return {
    title: `What breaks if ${named(ws, id)} is retired`,
    summary: rows.length ? `${rows.length} element(s) are affected, ${direct} of them directly.` : `Nothing in the model depends on ${named(ws, id)}.`,
    rows,
  };
}

/** "Which applications use data object Y?" Elements with any relationship to Y (or its parts), lifted to the chosen types. */
export function whoUses(ws: Workspace, id: Id, types?: Set<string>): QueryResult {
  const targets = new Set([id, ...Object.values(ws.elements).filter((e) => ancestors(ws, e.id).includes(id)).map((e) => e.id)]);
  const out = new Map<Id, string[]>();
  for (const r of Object.values(ws.relationships)) {
    const other = targets.has(r.target) && !targets.has(r.source) ? r.source : targets.has(r.source) && !targets.has(r.target) ? r.target : undefined;
    if (!other) continue;
    const lifted = types ? [other, ...ancestors(ws, other)].find((x) => types.has(ws.elements[x]?.type)) : other;
    if (!lifted) continue;
    const how = `${r.label ?? r.type.slice(r.type.indexOf(":") + 1)}${typeof r.properties.accessType === "string" ? ` (${r.properties.accessType})` : ""}`;
    out.set(lifted, [...new Set([...(out.get(lifted) ?? []), how])]);
  }
  const rows = [...out].map(([element, how]) => ({ element, detail: how.join(", ") })).sort((a, b) => named(ws, a.element).localeCompare(named(ws, b.element)));
  return { title: `What uses ${named(ws, id)}`, summary: `${rows.length} element(s) use ${named(ws, id)}.`, rows };
}

export interface GapQuery {
  id: string;
  label: string;
  test(e: Element, ws: Workspace): boolean;
}

/** Data-quality questions over the inventory. */
export const GAP_QUERIES: GapQuery[] = [
  { id: "no-owner", label: "Which elements have no owner?", test: (e) => !e.owner },
  { id: "no-description", label: "Which elements have no description?", test: (e) => !e.description },
  { id: "no-lifecycle", label: "Which elements have no lifecycle phase?", test: (e) => !e.lifecycle?.phase },
  { id: "end-of-life", label: "Which elements are being phased out or are end of life?", test: (e) => e.lifecycle?.phase === "phaseOut" || e.lifecycle?.phase === "endOfLife" },
  { id: "unconnected", label: "Which elements have no relationships?", test: (e, ws) => !Object.values(ws.relationships).some((r) => r.source === e.id || r.target === e.id) },
];

export function gapQuery(ws: Workspace, q: GapQuery, types?: Set<string>): QueryResult {
  const rows = Object.values(ws.elements)
    .filter((e) => (!types || types.has(e.type)) && q.test(e, ws))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => ({ element: e.id, detail: e.type }));
  return { title: q.label, summary: `${rows.length} element(s).`, rows };
}

