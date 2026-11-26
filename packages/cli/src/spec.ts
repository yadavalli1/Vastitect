/**
 * Model specs: a compact, name-based way to create and change a workspace, written for AI agents and
 * scripts. Elements are referred to by name (no ids), views list the elements they show (no
 * coordinates; they are laid out automatically), and every problem is reported with the valid choices
 * so an agent can correct itself. `apply` merges a spec into a workspace; `describe` turns a workspace
 * back into a spec, so reading and writing use the same format.
 */
import { parse as parseYaml, stringify } from "yaml";
import {
  LIFECYCLE_PHASES,
  makeElement,
  makeRelationship,
  makeView,
  type Element,
  type Id,
  type PropertyValue,
  type Registry,
  type Relationship,
  type View,
  type ViewNode,
  type Workspace,
} from "@vastitecture/core";

export interface ElementSpec {
  name: string;
  type?: string;
  /** Optional. Picks an existing element when names clash, renames it when `name` differs, or fixes the id of a new element. */
  id?: string;
  description?: string;
  parent?: string | null;
  owner?: string;
  tags?: string[];
  lifecycle?: { phase?: string; dates?: Record<string, string> };
  properties?: Record<string, PropertyValue>;
  links?: { kind?: string; href: string; label?: string }[];
}
export interface RelationshipSpec {
  from: string;
  to: string;
  type: string;
  label?: string;
  technology?: string;
  properties?: Record<string, PropertyValue>;
}
export interface ViewSpec {
  name: string;
  notation?: string;
  viewpoint?: string;
  description?: string;
  /** The element the view is about (context, container and component views; canvases). */
  subject?: string;
  /** Elements shown. Children of a shown element are drawn inside it. */
  elements?: string[];
  /** Elements shown, in rows from top to bottom (instead of `elements`). */
  rows?: string[][];
  /** Also draw relationships of these notations between the shown elements (e.g. ["c4"] on an ArchiMate view). */
  alsoShow?: string[];
  properties?: Record<string, PropertyValue>;
}
export interface DecisionSpec {
  title: string;
  id?: string;
  status?: string;
  date?: string;
  elements?: string[];
  body?: string;
}
export interface ModelSpec {
  workspace?: { name?: string };
  elements?: ElementSpec[];
  relationships?: RelationshipSpec[];
  views?: ViewSpec[];
  decisions?: DecisionSpec[];
  rules?: Record<string, unknown>[];
  remove?: { elements?: string[]; relationships?: { from: string; to: string; type?: string }[]; views?: string[]; decisions?: string[] };
}

export interface ApplyResult {
  workspace: Workspace;
  errors: string[];
  summary: { elements: { added: string[]; updated: string[]; removed: string[] }; relationships: { added: number; updated: number; removed: number }; views: { added: string[]; updated: string[]; removed: string[] }; decisions: { added: string[]; updated: string[] } };
}

/** Parse a spec from YAML or JSON text. */
export function parseSpec(text: string): ModelSpec {
  const doc = parseYaml(text);
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error("A model spec is a YAML or JSON object with elements, relationships, views, decisions, rules or remove");
  return doc as ModelSpec;
}

/** Close matches for a mistyped value, for "did you mean" hints. */
function suggest(value: string, options: string[], n = 5): string[] {
  const v = value.toLowerCase();
  const score = (o: string) => {
    const l = o.toLowerCase();
    if (l === v) return 0;
    if (l.endsWith(":" + v.split(":").pop()) || l.includes(v) || v.includes(l.split(":").pop() ?? l)) return 1;
    let common = 0;
    for (const ch of new Set(v)) if (l.includes(ch)) common++;
    return 10 - common / Math.max(1, new Set(v).size) * 5;
  };
  return [...options].sort((a, b) => score(a) - score(b)).slice(0, n);
}

const ARRAY_KEYS = ["elements", "relationships", "views", "decisions", "rules"] as const;
const TOP_KEYS = new Set<string>(["workspace", "remove", ...ARRAY_KEYS]);

/**
 * Merge a spec into a copy of the workspace. Elements, relationships, views and decisions are matched
 * by name (relationships by from, to and type) and updated; the rest are added. Nothing is applied when
 * there are errors: `errors` lists every problem with the valid choices.
 */
export function applySpec(base: Workspace, spec: ModelSpec, reg: Registry): ApplyResult {
  const ws: Workspace = structuredClone(base);
  const errors: string[] = [];
  const summary: ApplyResult["summary"] = { elements: { added: [], updated: [], removed: [] }, relationships: { added: 0, updated: 0, removed: 0 }, views: { added: [], updated: [], removed: [] }, decisions: { added: [], updated: [] } };
  for (const k of Object.keys(spec)) if (!TOP_KEYS.has(k)) errors.push(`Unknown top-level key "${k}". Use: ${[...TOP_KEYS].join(", ")}`);
  for (const k of ARRAY_KEYS) if (spec[k] !== undefined && !Array.isArray(spec[k])) errors.push(`"${k}" must be a list`);
  if (errors.length) return { workspace: base, errors, summary };

  const elementTypes = [...reg.packs.values()].flatMap((p) => p.elementTypes.map((t) => t.id));
  const relationshipTypes = [...reg.packs.values()].flatMap((p) => p.relationshipTypes.map((t) => t.id));
  const byName = () => {
    const m = new Map<string, Element[]>();
    for (const e of Object.values(ws.elements)) m.set(e.name, [...(m.get(e.name) ?? []), e]);
    return m;
  };
  let names = byName();
  const find = (name: string, where: string, type?: string): Element | undefined => {
    if (typeof name !== "string" || !name) {
      errors.push(`${where}: expected an element name`);
      return undefined;
    }
    if (ws.elements[name] && !names.has(name)) return ws.elements[name]; // an id, used where names clash
    const hits = names.get(name) ?? [];
    const typed = type ? hits.filter((e) => e.type === type) : hits;
    if (typed.length === 1) return typed[0];
    if (hits.length === 1) return hits[0];
    if (!hits.length) errors.push(`${where}: no element named "${name}". Close names: ${suggest(name, [...names.keys()]).map((s) => JSON.stringify(s)).join(", ") || "none"}`);
    else errors.push(`${where}: ${hits.length} elements are named "${name}" (${hits.map((e) => `${e.type} id ${e.id}`).join("; ")}). Refer to one by its id instead of its name`);
    return undefined;
  };

  if (spec.workspace?.name) ws.name = String(spec.workspace.name);

  // --- removals first, so a spec can replace something in one go
  for (const v of spec.remove?.views ?? []) {
    const view = Object.values(ws.views).find((x) => x.name === v);
    if (!view) errors.push(`remove.views: no view named "${v}"`);
    else (delete ws.views[view.id], summary.views.removed.push(v));
  }
  for (const r of spec.remove?.relationships ?? []) {
    const a = find(r.from, `remove.relationships ${r.from} → ${r.to}`), b = find(r.to, `remove.relationships ${r.from} → ${r.to}`);
    if (!a || !b) continue;
    const hits = Object.values(ws.relationships).filter((x) => x.source === a.id && x.target === b.id && (!r.type || x.type === r.type));
    if (!hits.length) errors.push(`remove.relationships: no relationship from "${r.from}" to "${r.to}"${r.type ? ` of type ${r.type}` : ""}`);
    for (const h of hits) removeRelationship(ws, h.id), summary.relationships.removed++;
  }
  for (const n of spec.remove?.elements ?? []) {
    const e = find(n, `remove.elements`);
    if (e) (removeElement(ws, e.id), summary.elements.removed.push(n));
  }
  for (const d of spec.remove?.decisions ?? []) {
    const adr = Object.values(ws.adrs).find((a) => a.title === d || a.id === d);
    if (!adr) errors.push(`remove.decisions: no decision "${d}"`);
    else delete ws.adrs[adr.id];
  }
  names = byName();

  // --- elements: create every new one first (so parents can be anywhere in the list), then set fields
  const touched: [ElementSpec, Element, number][] = [];
  (spec.elements ?? []).forEach((s, i) => {
    const where = `elements[${i}]${s && s.name ? ` "${s.name}"` : ""}`;
    if (!s || typeof s.name !== "string" || !s.name.trim()) return errors.push(`${where}: "name" is required`);
    if (s.type !== undefined && !elementTypes.includes(s.type)) return errors.push(`${where}: unknown type "${s.type}". Did you mean: ${suggest(s.type, elementTypes).join(", ")}? (\`vastitecture types\` lists them all)`);
    if (s.id !== undefined && !/^[A-Za-z0-9_-]{1,64}$/.test(String(s.id))) return errors.push(`${where}: "id" may contain only letters, digits, "_" and "-"`);
    let e = s.id ? ws.elements[s.id] : undefined;
    if (!e && !s.id) {
      const hits = (names.get(s.name) ?? []).filter((x) => !s.type || x.type === s.type);
      if (hits.length > 1) return errors.push(`${where}: ${hits.length} elements are named "${s.name}"; give "id" to choose one (${hits.map((x) => x.id).join(", ")})`);
      e = hits[0];
    }
    if (!e) {
      if (!s.type) return errors.push(`${where}: "type" is required for a new element (for example c4:SoftwareSystem, archimate:Capability)`);
      e = makeElement(s.type, s.name, s.id ? { id: String(s.id) } : {});
      ws.elements[e.id] = e;
      names.set(s.name, [...(names.get(s.name) ?? []), e]);
      summary.elements.added.push(s.name);
    } else summary.elements.updated.push(s.name);
    touched.push([s, e, i]);
  });
  for (const [s, e] of touched)
    if (s.id && e.name !== s.name) {
      summary.elements.updated[summary.elements.updated.indexOf(s.name)] = `${e.name} → ${s.name}`;
      e.name = s.name;
    }
  names = byName();
  for (const [s, e, i] of touched) {
    const where = `elements[${i}] "${s.name}"`;
    if (s.type && s.type !== e.type) e.type = s.type;
    if (s.description !== undefined) e.description = String(s.description);
    if (s.owner !== undefined) e.owner = String(s.owner);
    if (s.tags !== undefined) e.tags = Array.isArray(s.tags) ? s.tags.map(String) : (errors.push(`${where}: "tags" must be a list`), e.tags);
    if (s.properties !== undefined) {
      if (typeof s.properties !== "object" || Array.isArray(s.properties)) errors.push(`${where}: "properties" must be a map of key: value`);
      else for (const [k, v] of Object.entries(s.properties)) v === null ? delete e.properties[k] : (e.properties[k] = v);
    }
    if (s.lifecycle !== undefined) {
      const phase = s.lifecycle.phase ?? e.lifecycle?.phase ?? "active";
      if (!(LIFECYCLE_PHASES as readonly string[]).includes(phase)) errors.push(`${where}: lifecycle.phase must be one of ${LIFECYCLE_PHASES.join(", ")}`);
      const dates = { ...e.lifecycle?.dates, ...s.lifecycle.dates };
      for (const [k, d] of Object.entries(dates)) {
        if (!(LIFECYCLE_PHASES as readonly string[]).includes(k)) errors.push(`${where}: lifecycle.dates.${k} is not a phase (${LIFECYCLE_PHASES.join(", ")})`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d))) errors.push(`${where}: lifecycle.dates.${k} must be a date like 2027-06-30`);
      }
      e.lifecycle = { phase: phase as never, ...(Object.keys(dates).length ? { dates: Object.fromEntries(Object.entries(dates).map(([k, d]) => [k, String(d)])) } : {}) };
    }
    if (s.links !== undefined) e.links = (s.links ?? []).map((l) => ({ kind: (["repo", "runbook", "adr", "doc", "other"].includes(String(l.kind)) ? l.kind : "other") as never, href: String(l.href), ...(l.label ? { label: String(l.label) } : {}) }));
    if (s.parent === null) delete e.parent;
    else if (s.parent !== undefined) {
      const p = find(s.parent, `${where} parent`);
      if (p && p.id === e.id) errors.push(`${where}: an element cannot be its own parent`);
      else if (p) e.parent = p.id;
    }
  }

  // --- relationships
  (spec.relationships ?? []).forEach((r, i) => {
    const where = `relationships[${i}]${r?.from ? ` ${r.from} → ${r.to}` : ""}`;
    if (!r || !r.from || !r.to) return errors.push(`${where}: "from" and "to" are required`);
    if (!r.type) return errors.push(`${where}: "type" is required (for example c4:Uses, archimate:Serving, archimate:Realization)`);
    if (!relationshipTypes.includes(r.type)) return errors.push(`${where}: unknown relationship type "${r.type}". Did you mean: ${suggest(r.type, relationshipTypes).join(", ")}?`);
    const a = find(r.from, `${where} from`), b = find(r.to, `${where} to`);
    if (!a || !b) return;
    let rel = Object.values(ws.relationships).find((x) => x.source === a.id && x.target === b.id && x.type === r.type);
    if (rel) summary.relationships.updated++;
    else {
      rel = makeRelationship(r.type, a.id, b.id);
      ws.relationships[rel.id] = rel;
      summary.relationships.added++;
    }
    if (r.label !== undefined) rel.label = String(r.label);
    if (r.technology !== undefined) rel.technology = String(r.technology);
    if (r.properties) Object.assign(rel.properties, r.properties);
  });

  // --- views
  (spec.views ?? []).forEach((v, i) => {
    const where = `views[${i}]${v?.name ? ` "${v.name}"` : ""}`;
    if (!v || !v.name) return errors.push(`${where}: "name" is required`);
    let view = Object.values(ws.views).find((x) => x.name === v.name);
    const notation = v.notation ?? view?.notation ?? v.viewpoint?.split(":")[0];
    if (!notation || !reg.packs.has(notation)) return errors.push(`${where}: "notation" must be one of ${[...reg.packs.keys()].join(", ")}`);
    const viewpoints = reg.packs.get(notation)!.viewpoints.map((p) => p.id);
    const viewpoint = v.viewpoint ?? view?.viewpoint;
    if (viewpoint && !viewpoints.includes(viewpoint)) return errors.push(`${where}: unknown viewpoint "${viewpoint}" for ${notation}. Choose one of: ${viewpoints.join(", ")}`);
    const rows = v.rows ?? (v.elements ? chunk(v.elements, 4) : undefined);
    const listed = rows?.flat() ?? [];
    const els = listed.map((n) => find(n, `${where} elements`)).filter((e): e is Element => !!e);
    if (els.length !== listed.length) return;
    const subject = v.subject ? find(v.subject, `${where} subject`) : undefined;
    if (v.subject && !subject) return;
    if (!view) {
      view = makeView(notation, v.name);
      ws.views[view.id] = view;
      summary.views.added.push(v.name);
    } else summary.views.updated.push(v.name);
    view.notation = notation;
    if (viewpoint) view.viewpoint = viewpoint;
    if (v.description !== undefined) view.description = String(v.description);
    if (subject) view.subject = subject.id;
    if (v.properties) Object.assign(view.properties, v.properties);
    if (rows) {
      const keep = new Map(view.nodes.map((n) => [n.element, n]));
      const same = els.length === view.nodes.length && els.every((e) => keep.has(e.id));
      if (!same) view.nodes = layoutRows(ws, reg, rows.map((r) => r.map((n) => find(n, where)!)));
    }
    const present = new Set(view.nodes.map((n) => n.element));
    const notations = [notation, ...(v.alsoShow ?? [])];
    view.edges = Object.values(ws.relationships)
      .filter((r) => present.has(r.source) && present.has(r.target) && notations.some((n) => r.type.startsWith(n + ":")))
      .map((r) => ({ relationship: r.id, ...(view!.edges.find((e) => e.relationship === r.id) ?? {}) }));
  });

  // --- decisions
  (spec.decisions ?? []).forEach((d, i) => {
    const where = `decisions[${i}]`;
    if (!d || !d.title) return errors.push(`${where}: "title" is required`);
    const existing = Object.values(ws.adrs).find((a) => (d.id && a.id === d.id) || a.title === d.title);
    const elementIds = (d.elements ?? []).map((n) => find(n, `${where} elements`)?.id).filter((x): x is Id => !!x);
    const id = existing?.id ?? d.id ?? String(Math.max(0, ...Object.keys(ws.adrs).map((k) => Number(k) || 0)) + 1).padStart(4, "0");
    if (!/^[A-Za-z0-9-]+$/.test(id)) return errors.push(`${where}: "id" may contain only letters, digits and dashes`);
    ws.adrs[id] = {
      ...(existing ?? { body: "", elements: [], status: "proposed" }),
      id,
      title: String(d.title),
      ...(d.status ? { status: String(d.status) } : {}),
      ...(d.date ? { date: String(d.date) } : {}),
      ...(d.elements ? { elements: elementIds } : {}),
      ...(d.body !== undefined ? { body: String(d.body) } : {}),
    } as never;
    (existing ? summary.decisions.updated : summary.decisions.added).push(d.title);
  });

  // --- rules: replace by id, append new
  for (const r of spec.rules ?? []) {
    const id = (r as { id?: unknown }).id;
    const at = ws.rules.findIndex((x) => (x as { id?: unknown }).id === id);
    if (at >= 0) ws.rules[at] = r;
    else ws.rules.push(r);
  }

  return errors.length ? { workspace: base, errors, summary } : { workspace: ws, errors, summary };
}

function removeRelationship(ws: Workspace, id: Id) {
  delete ws.relationships[id];
  for (const v of Object.values(ws.views)) v.edges = v.edges.filter((e) => e.relationship !== id);
}

function removeElement(ws: Workspace, id: Id) {
  for (const child of Object.values(ws.elements).filter((e) => e.parent === id)) delete child.parent;
  for (const r of Object.values(ws.relationships)) if (r.source === id || r.target === id) removeRelationship(ws, r.id);
  for (const v of Object.values(ws.views)) {
    v.nodes = v.nodes.filter((n) => n.element !== id).map((n) => (n.parent === id ? { ...n, parent: undefined } : n));
    if (v.subject === id) delete v.subject;
  }
  for (const a of Object.values(ws.adrs)) a.elements = a.elements.filter((e) => e !== id);
  delete ws.elements[id];
}

const chunk = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

const GAP_X = 60, GAP_Y = 100, PAD = 24, HEADER = 44;

/**
 * Lay elements out in rows. An element whose parent is also shown is drawn inside the parent's box,
 * itself laid out in rows of up to three, so boundaries (a system around its containers) come out right.
 */
export function layoutRows(ws: Workspace, reg: Registry, rows: Element[][]): ViewNode[] {
  const all = new Set(rows.flat().map((e) => e.id));
  const kids = (id: Id) => rows.flat().filter((e) => e.parent === id);
  const size = (e: Element): [number, number] => reg.elementType(e.type)?.size ?? (e.type === "c4:Person" ? [150, 150] : e.type.startsWith("c4:") ? [200, 110] : [170, 80]);
  const nodes: ViewNode[] = [];
  const place = (cells: Element[][], parent: Id | undefined, x0: number, y0: number): [number, number] => {
    let y = y0, width = 0;
    for (const row of cells) {
      let x = x0, height = 0;
      for (const e of row) {
        const inner = kids(e.id);
        const node: ViewNode = { element: e.id, x, y, w: 0, h: 0, ...(parent ? { parent } : {}) };
        nodes.push(node);
        if (inner.length) {
          const [w, h] = place(chunk(inner, 3), e.id, PAD, HEADER);
          node.w = Math.max(PAD + w + PAD, size(e)[0]);
          node.h = Math.max(HEADER + h + PAD, size(e)[1]);
        } else [node.w, node.h] = size(e);
        x += node.w + GAP_X;
        height = Math.max(height, node.h);
      }
      width = Math.max(width, x - GAP_X - x0);
      y += height + GAP_Y;
    }
    return [width, y - GAP_Y - y0];
  };
  // elements drawn inside a shown parent are placed with it, not in their own row
  place(rows.map((r) => r.filter((e) => !e.parent || !all.has(e.parent))).filter((r) => r.length), undefined, 40, 40);
  return nodes;
}

/** A workspace as a spec: what an agent reads before changing it. Ids are left out unless names clash. */
export function describe(ws: Workspace, opts: { view?: string } = {}): ModelSpec {
  const els = Object.values(ws.elements).sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  const dup = new Set(els.map((e) => e.name).filter((n, i, a) => a.indexOf(n) !== i));
  // refer to elements by name, or by id when several share the name
  const name = (id: Id | undefined) => (id && ws.elements[id] ? (dup.has(ws.elements[id].name) ? id : ws.elements[id].name) : undefined);
  const only = opts.view ? Object.values(ws.views).find((v) => v.name === opts.view) : undefined;
  const shown = only ? new Set(only.nodes.map((n) => n.element)) : undefined;
  const clean = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length) && !(typeof v === "object" && v && !Array.isArray(v) && !Object.keys(v).length))) as T;
  return clean({
    workspace: { name: ws.name },
    elements: els.filter((e) => !shown || shown.has(e.id)).map((e) =>
      clean<ElementSpec>({ name: e.name, type: e.type, ...(dup.has(e.name) ? { id: e.id } : {}), description: e.description, parent: name(e.parent), owner: e.owner, tags: e.tags, lifecycle: e.lifecycle as ElementSpec["lifecycle"], properties: e.properties, links: e.links }),
    ),
    relationships: Object.values(ws.relationships)
      .filter((r) => !shown || (shown.has(r.source) && shown.has(r.target)))
      .map((r) => clean<RelationshipSpec>({ from: name(r.source)!, to: name(r.target)!, type: r.type, label: r.label, technology: r.technology, properties: r.properties }))
      .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
    views: Object.values(ws.views)
      .filter((v) => !only || v === only)
      .sort((a, b) => a.notation.localeCompare(b.notation) || a.name.localeCompare(b.name))
      .map((v) => clean<ViewSpec>({ name: v.name, notation: v.notation, viewpoint: v.viewpoint, description: v.description, subject: name(v.subject), elements: v.nodes.map((n) => name(n.element)!).filter(Boolean) })),
    decisions: only ? undefined : Object.values(ws.adrs).sort((a, b) => a.id.localeCompare(b.id)).map((a) => clean<DecisionSpec>({ id: a.id, title: a.title, status: a.status, date: a.date, elements: a.elements.map((id) => name(id)!).filter(Boolean) })),
    rules: only ? undefined : (ws.rules as Record<string, unknown>[]),
  });
}

export const specToYaml = (spec: ModelSpec) => stringify(spec, { lineWidth: 0 });

/** The notation vocabulary an agent may use: element and relationship types, viewpoints and properties. */
export function vocabulary(reg: Registry, notation?: string) {
  return [...reg.packs.values()]
    .filter((p) => !notation || p.id === notation)
    .map((p) => ({
      notation: p.id,
      name: p.name,
      elementTypes: p.elementTypes.map((t) => ({ id: t.id, name: t.name, ...(t.category ? { category: t.category } : {}), ...(t.container ? { container: true } : {}), ...(t.properties?.length ? { properties: t.properties.map((d) => d.key + (d.options ? ` (${d.options.join(" | ")})` : "")) } : {}) })),
      relationshipTypes: p.relationshipTypes.map((t) => ({ id: t.id, name: t.name })),
      viewpoints: p.viewpoints.map((v) => ({ id: v.id, name: v.name, ...(v.kind && v.kind !== "diagram" ? { kind: v.kind } : {}), ...(v.elementTypes ? { elementTypes: v.elementTypes } : {}) })),
      ...(p.globalProperties?.length ? { globalProperties: p.globalProperties.map((d) => d.key + (d.options ? ` (${d.options.join(" | ")})` : "")) } : {}),
    }));
}

/** The vocabulary as Markdown, for the agent skill's reference file. */
export function vocabularyMarkdown(reg: Registry): string {
  const out = ["# Notation vocabulary", "", "Generated from the app's notation packs by `vastitecture types --format markdown`. Use these ids in model specs.", ""];
  for (const n of vocabulary(reg)) {
    out.push(`## ${n.name} (\`${n.notation}\`)`, "", "### Element types", "", "| Id | Name | Notes |", "| --- | --- | --- |");
    const cell = (x: string) => x.replace(/\|/g, "\\|");
    for (const t of n.elementTypes) out.push(`| \`${t.id}\` | ${t.name} | ${cell([t.category, t.container ? "can contain other elements" : "", t.properties ? `properties: ${t.properties.join(", ")}` : ""].filter(Boolean).join("; "))} |`);
    out.push("", "### Relationship types", "", n.relationshipTypes.map((t) => `\`${t.id}\` (${t.name})`).join(", ") || "none", "", "### Viewpoints", "", "| Id | Name | Element types allowed |", "| --- | --- | --- |");
    for (const v of n.viewpoints) out.push(`| \`${v.id}\` | ${v.name}${v.kind ? ` (${v.kind})` : ""} | ${v.elementTypes ? v.elementTypes.map((x) => `\`${x}\``).join(", ") : "any of this notation"} |`);
    if (n.globalProperties) out.push("", `Properties for elements of any notation: ${n.globalProperties.join(", ")}`);
    out.push("");
  }
  return out.join("\n");
}

export type { Relationship, View };
