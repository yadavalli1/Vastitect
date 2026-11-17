import { parse, stringify } from "yaml";
import { z } from "zod";
import { makeElement, makeRelationship, type Element, type Id, type ModelPatch, type PropertyValue, type Relationship, type View, type ViewNode, type Workspace } from "./model";
import { reconcilePatch, viewsContaining } from "./queries";
import type { Command } from "./store";

/**
 * Diagram as code. The native text form of a view is YAML listing the elements and relationships
 * it shows; edits are diffed against the model and returned as commands, so the canvas and the
 * text stay in sync both ways and every text edit is undoable.
 */

const Doc = z.object({
  view: z.string(),
  viewpoint: z.string().optional(),
  description: z.string().optional(),
  elements: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string(),
        type: z.string(),
        description: z.string().optional(),
        owner: z.string().optional(),
        tags: z.array(z.string()).optional(),
        properties: z.record(z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())])).optional(),
        in: z.string().optional(),
        at: z.tuple([z.number(), z.number()]).optional(),
        size: z.tuple([z.number(), z.number()]).optional(),
      }),
    )
    .nullish(),
  relationships: z
    .array(
      z.object({
        id: z.string().optional(),
        from: z.string(),
        to: z.string(),
        type: z.string(),
        label: z.string().optional(),
        technology: z.string().optional(),
      }),
    )
    .nullish(),
});

const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && !v.length) && !(typeof v === "object" && v !== null && !Array.isArray(v) && !Object.keys(v).length))) as T;

export function viewToCode(ws: Workspace, viewId: Id): string {
  const view = ws.views[viewId];
  if (!view) return "";
  const names = new Map<string, number>();
  for (const n of view.nodes) {
    const nm = ws.elements[n.element]?.name ?? "";
    names.set(nm, (names.get(nm) ?? 0) + 1);
  }
  const ref = (id: Id) => {
    const e = ws.elements[id];
    return e && names.get(e.name) === 1 ? e.name : id;
  };
  const nodes = [...view.nodes].filter((n) => ws.elements[n.element]).sort((a, b) => (a.parent ?? "").localeCompare(b.parent ?? "") || a.y - b.y || a.x - b.x || a.element.localeCompare(b.element));
  const doc = clean({
    view: view.name,
    viewpoint: view.viewpoint,
    description: view.description,
    elements: nodes.map((n) => {
      const e = ws.elements[n.element];
      return clean({
        name: e.name,
        type: e.type,
        description: e.description,
        owner: e.owner,
        tags: e.tags,
        properties: Object.fromEntries(Object.entries(e.properties).sort(([a], [b]) => a.localeCompare(b))),
        in: n.parent ? ref(n.parent) : undefined,
        at: [Math.round(n.x), Math.round(n.y)],
        size: [Math.round(n.w), Math.round(n.h)],
        id: e.id,
      });
    }),
    relationships: view.edges
      .map((e) => ws.relationships[e.relationship])
      .filter((r): r is Relationship => !!r && !!ws.elements[r.source] && !!ws.elements[r.target])
      .sort((a, b) => ref(a.source).localeCompare(ref(b.source)) || ref(a.target).localeCompare(ref(b.target)) || a.id.localeCompare(b.id))
      .map((r) => clean({ from: ref(r.source), to: ref(r.target), type: r.type, label: r.label, technology: r.technology, id: r.id })),
  });
  return stringify(doc, { lineWidth: 0, flowCollectionPadding: false }).replace(/^( +(?:at|size):)\n +- (-?\d+)\n +- (-?\d+)$/gm, "$1 [$2, $3]");
}

export class CodeError extends Error {}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Remove an element/relationship from the view; drop it from the model too when nothing else shows it. */
function dropElement(ws: Workspace, viewId: Id, id: Id): Command {
  return viewsContaining(ws, id).some((v) => v.id !== viewId) ? { type: "removeNode", view: viewId, element: id } : { type: "removeElement", id };
}
function dropRelationship(ws: Workspace, viewId: Id, id: Id): Command {
  const elsewhere = Object.values(ws.views).some((v) => v.id !== viewId && v.edges.some((e) => e.relationship === id));
  return elsewhere ? { type: "removeEdge", view: viewId, relationship: id } : { type: "removeRelationship", id };
}

/** First free grid slot for a node that was added in text without a position. */
function freeSlot(taken: { x: number; y: number; w: number; h: number; parent?: Id }[], w: number, h: number, parent?: Id) {
  const peers = taken.filter((n) => n.parent === parent);
  for (let row = 0; row < 200; row++)
    for (let col = 0; col < 6; col++) {
      const x = 40 + col * (w + 50);
      const y = (parent ? 50 : 40) + row * (h + 50);
      if (!peers.some((n) => x < n.x + n.w + 10 && n.x < x + w + 10 && y < n.y + n.h + 10 && n.y < y + h + 10)) return { x, y };
    }
  return { x: 40, y: 40 };
}

/** Turn edited YAML into the commands that bring the model and the view in line with it. */
export function codeToCommands(ws: Workspace, viewId: Id, text: string, sizeOf: (type: string) => [number, number] = () => [150, 80]): Command[] {
  const view = ws.views[viewId];
  if (!view) return [];
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (e) {
    throw new CodeError(e instanceof Error ? e.message : String(e));
  }
  const parsed = Doc.safeParse(raw);
  if (!parsed.success) throw new CodeError(parsed.error.issues.map((i) => `${i.path.join(".") || "document"}: ${i.message}`).join("; "));
  const doc = parsed.data;
  const cmds: Command[] = [];
  const els = doc.elements ?? [];

  // Resolve every listed element to a model element (existing by id, existing by type+name, or new).
  const inView = new Set(view.nodes.map((n) => n.element));
  const claimed = new Set<Id>();
  const resolved: { id: Id; isNew: boolean }[] = els.map((d) => {
    if (d.id && ws.elements[d.id] && !claimed.has(d.id)) return (claimed.add(d.id), { id: d.id, isNew: false });
    const existing = Object.values(ws.elements).find((e) => e.name === d.name && e.type === d.type && !claimed.has(e.id) && !inView.has(e.id));
    if (existing) return (claimed.add(existing.id), { id: existing.id, isNew: false });
    const el = makeElement(d.type, d.name);
    claimed.add(el.id);
    return { id: el.id, isNew: true };
  });
  const byRef = new Map<string, Id>();
  els.forEach((d, i) => {
    if (!byRef.has(d.name)) byRef.set(d.name, resolved[i].id);
  });
  for (const r of resolved) byRef.set(r.id, r.id);
  // A rename in the elements list must not break relationships that still use the old name.
  for (const r of resolved) {
    const previous = ws.elements[r.id]?.name;
    if (previous && !byRef.has(previous)) byRef.set(previous, r.id);
  }
  const lookup = (ref: string, what: string): Id => {
    const id = byRef.get(ref);
    if (!id) throw new CodeError(`${what}: "${ref}" is not an element in this view`);
    return id;
  };

  const placed: ViewNode[] = view.nodes.map((n) => ({ ...n }));
  els.forEach((d, i) => {
    const { id, isNew } = resolved[i];
    const parent = d.in ? lookup(d.in, `${d.name}.in`) : undefined;
    if (parent === id) throw new CodeError(`${d.name} cannot be inside itself`);
    const fields = { name: d.name, type: d.type, description: d.description, owner: d.owner, tags: d.tags ?? [], properties: (d.properties ?? {}) as Record<string, PropertyValue> };
    if (isNew) cmds.push({ type: "addElement", element: { ...makeElement(d.type, d.name), id, ...clean(fields), tags: fields.tags, properties: fields.properties, ...(parent ? { parent } : {}) } });
    else {
      const cur = ws.elements[id];
      const patch: Partial<Element> = {};
      for (const k of ["name", "type", "description", "owner", "tags", "properties"] as const) if (!same(cur[k], fields[k])) (patch as Record<string, unknown>)[k] = fields[k];
      if (parent && !cur.parent) patch.parent = parent;
      if (Object.keys(patch).length) cmds.push({ type: "updateElement", id, patch });
    }
    const node = view.nodes.find((n) => n.element === id);
    const [dw, dh] = sizeOf(d.type);
    const w = d.size?.[0] ?? node?.w ?? dw;
    const h = d.size?.[1] ?? node?.h ?? dh;
    const at = d.at ? { x: d.at[0], y: d.at[1] } : node ? { x: node.x, y: node.y } : freeSlot(placed, w, h, parent);
    const next: ViewNode = { ...(node ?? {}), element: id, x: at.x, y: at.y, w, h, ...(parent ? { parent } : {}) };
    if (!parent) delete next.parent;
    if (!node) {
      placed.push(next);
      cmds.push({ type: "putNode", view: viewId, node: next });
    } else if (!same(node, next)) cmds.push({ type: "putNode", view: viewId, node: next });
  });
  for (const n of view.nodes) if (!claimed.has(n.element)) cmds.push(dropElement(ws, viewId, n.element));

  const kept = new Set<Id>();
  for (const d of doc.relationships ?? []) {
    const source = lookup(d.from, "relationship.from");
    const target = lookup(d.to, "relationship.to");
    const cur =
      (d.id && ws.relationships[d.id] && !kept.has(d.id) ? ws.relationships[d.id] : undefined) ??
      Object.values(ws.relationships).find((r) => !kept.has(r.id) && r.source === source && r.target === target && r.type === d.type && (r.label ?? "") === (d.label ?? ""));
    if (cur) {
      kept.add(cur.id);
      const patch: Partial<Relationship> = {};
      if (cur.source !== source) patch.source = source;
      if (cur.target !== target) patch.target = target;
      if (cur.type !== d.type) patch.type = d.type;
      if ((cur.label ?? "") !== (d.label ?? "")) patch.label = d.label;
      if ((cur.technology ?? "") !== (d.technology ?? "")) patch.technology = d.technology;
      if (Object.keys(patch).length) cmds.push({ type: "updateRelationship", id: cur.id, patch });
      if (!view.edges.some((e) => e.relationship === cur.id)) cmds.push({ type: "putEdge", view: viewId, edge: { relationship: cur.id } });
    } else {
      const rel = makeRelationship(d.type, source, target, clean({ label: d.label, technology: d.technology }));
      kept.add(rel.id);
      cmds.push({ type: "addRelationship", relationship: rel }, { type: "putEdge", view: viewId, edge: { relationship: rel.id } });
    }
  }
  for (const e of view.edges) if (!kept.has(e.relationship)) cmds.push(dropRelationship(ws, viewId, e.relationship));

  const vp: Partial<View> = {};
  if (doc.view !== view.name) vp.name = doc.view;
  if ((doc.viewpoint ?? "") !== (view.viewpoint ?? "")) vp.viewpoint = doc.viewpoint;
  if ((doc.description ?? "") !== (view.description ?? "")) vp.description = doc.description;
  if (Object.keys(vp).length) cmds.push({ type: "updateView", id: viewId, patch: vp });
  return cmds;
}

/**
 * Sync a view from text in another language (Structurizr DSL, CML…). The importer produces a patch;
 * it is re-keyed onto the existing model by name so identities and positions survive each edit.
 */
export function syncViewFromPatch(ws: Workspace, viewId: Id, patch: ModelPatch, sizeOf: (type: string) => [number, number] = () => [150, 80]): Command[] {
  const view = ws.views[viewId];
  if (!view) return [];
  const p = reconcilePatch(ws, patch);
  const cmds: Command[] = [];
  const elements = (p.elements ?? []).filter((e) => !same(ws.elements[e.id], e));
  const relationships = (p.relationships ?? []).filter((r) => !same(ws.relationships[r.id], r));
  if (elements.length || relationships.length) cmds.push({ type: "applyPatch", patch: { elements, relationships } });

  const source = p.views?.[0];
  const members = new Map<Id, Id | undefined>();
  if (source) for (const n of source.nodes) members.set(n.element, n.parent);
  else for (const e of p.elements ?? []) members.set(e.id, undefined);
  const placed: ViewNode[] = view.nodes.map((n) => ({ ...n }));
  const types = new Map((p.elements ?? []).map((e) => [e.id, e.type]));
  for (const [id, parent] of members) {
    const cur = view.nodes.find((n) => n.element === id);
    if (cur) continue;
    const [w, h] = sizeOf(types.get(id) ?? ws.elements[id]?.type ?? "");
    const node: ViewNode = { element: id, ...freeSlot(placed, w, h, parent), w, h, ...(parent && members.has(parent) ? { parent } : {}) };
    placed.push(node);
    cmds.push({ type: "putNode", view: viewId, node });
  }
  for (const n of view.nodes) if (!members.has(n.element)) cmds.push({ type: "removeNode", view: viewId, element: n.element });

  const edges = new Set(source ? source.edges.map((e) => e.relationship) : (p.relationships ?? []).map((r) => r.id));
  const orders = new Map(source?.edges.map((e) => [e.relationship, e.order]));
  for (const id of edges) {
    const cur = view.edges.find((e) => e.relationship === id);
    if (!cur || cur.order !== orders.get(id)) cmds.push({ type: "putEdge", view: viewId, edge: { ...(cur ?? {}), relationship: id, ...(orders.get(id) !== undefined ? { order: orders.get(id) } : {}) } });
  }
  for (const e of view.edges) if (!edges.has(e.relationship)) cmds.push(dropRelationship(ws, viewId, e.relationship));
  if (source && source.name !== view.name && source.properties.key === undefined) cmds.push({ type: "updateView", id: viewId, patch: { name: source.name } });
  return cmds;
}
