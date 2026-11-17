import {
  ancestors,
  childrenOf,
  makeElement,
  makeRelationship,
  makeView,
  newId,
  presentationType,
  viewsContaining,
  type Command,
  type Id,
  type TypeId,
  type View,
  type ViewNode,
} from "@vastitecture/core";
import { DARK, LIGHT, absoluteRects, hiddenNodes, viewToSvg } from "@vastitecture/render";
import { createElkEngines } from "@vastitecture/layout";
import ELK from "elkjs/lib/elk-api.js";
import ElkWorker from "elkjs/lib/elk-worker.min.js?worker";
import { app, dispatch, model, registry, select, set, toast } from "./state";
import { saveFile } from "./platform";
import { t } from "./i18n";

/** ELK runs in a Web Worker so layout never blocks the canvas. */
export function registerLayouts() {
  const elk = new ELK({ workerFactory: () => new ElkWorker() });
  for (const e of createElkEngines(elk)) registry.registerLayout(e);
}

export const sizeOf = (type: TypeId): [number, number] => registry.elementType(type)?.size ?? [150, 80];

const uniqueName = (base: string) => {
  const names = new Set(Object.values(model.state.elements).map((e) => e.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
};

/** Commands that show an element's existing relationships to nodes already in the view. */
function edgesFor(view: View, element: Id, alsoPresent: Id[] = []): Command[] {
  const present = new Set([...view.nodes.map((n) => n.element), ...alsoPresent, element]);
  const shown = new Set(view.edges.map((e) => e.relationship));
  return Object.values(model.state.relationships)
    .filter((r) => (r.source === element || r.target === element) && present.has(r.source) && present.has(r.target) && !shown.has(r.id))
    .map((r) => ({ type: "putEdge" as const, view: view.id, edge: { relationship: r.id } }));
}

export function createElementInView(viewId: Id, type: TypeId, pos: { x: number; y: number }, name?: string, parentNode?: Id): Id {
  const view = model.state.views[viewId];
  const def = registry.elementType(type);
  const [w, h] = sizeOf(type);
  const el = makeElement(type, uniqueName(name ?? def?.name ?? "Element"), parentNode ? { parent: parentNode } : {});
  dispatch(
    [
      { type: "addElement", element: el },
      { type: "putNode", view: view.id, node: { element: el.id, x: pos.x, y: pos.y, w, h, ...(parentNode ? { parent: parentNode } : {}) } },
    ],
    t("Add {type}", { type: def?.name ?? type }),
  );
  select([el.id]);
  return el.id;
}

/** Place an existing model element into a view. Returns false when the notation has no mapping for it. */
export function placeElement(viewId: Id, elementId: Id, pos: { x: number; y: number }): boolean {
  const ws = model.state;
  const view = ws.views[viewId];
  const el = ws.elements[elementId];
  if (!view || !el) return false;
  if (view.nodes.some((n) => n.element === elementId)) {
    select([elementId]);
    toast(t("{name} is already in this view", { name: el.name }));
    return true;
  }
  const type = presentationType(ws, el, view.notation, registry);
  if (!type) return false;
  const [w, h] = sizeOf(type);
  dispatch([{ type: "putNode", view: viewId, node: { element: elementId, x: pos.x, y: pos.y, w, h } }, ...edgesFor(view, elementId)], t("Add to view"));
  select([elementId]);
  return true;
}

export function connect(viewId: Id, source: Id, target: Id, type: TypeId): Id {
  const rel = makeRelationship(type, source, target);
  dispatch(
    [
      { type: "addRelationship", relationship: rel },
      { type: "putEdge", view: viewId, edge: { relationship: rel.id } },
    ],
    t("Connect"),
  );
  select([], [rel.id]);
  return rel.id;
}

/** Tab: create an element of the same type connected to the selected one, ready to rename. */
export function createConnected(viewId: Id, from: Id) {
  const ws = model.state;
  const view = ws.views[viewId];
  const node = view.nodes.find((n) => n.element === from);
  const src = ws.elements[from];
  if (!node || !src) return;
  const type = presentationType(ws, src, view.notation, registry) ?? src.type;
  const [w, h] = sizeOf(type);
  const siblings = view.nodes.filter((n) => n.parent === node.parent);
  let y = node.y;
  const x = node.x + node.w + 80;
  while (siblings.some((n) => Math.abs(n.x - x) < w && Math.abs(n.y - y) < h + 10)) y += h + 30;
  const el = makeElement(type, uniqueName(registry.elementType(type)?.name ?? "Element"), src.parent ? { parent: src.parent } : {});
  const relType = registry.validRelationships(view.notation, type, type, view.viewpoint).types[0];
  const cmds: Command[] = [
    { type: "addElement", element: el },
    { type: "putNode", view: viewId, node: { element: el.id, x, y, w, h, ...(node.parent ? { parent: node.parent } : {}) } },
  ];
  if (relType) {
    const rel = makeRelationship(relType, from, el.id);
    cmds.push({ type: "addRelationship", relationship: rel }, { type: "putEdge", view: viewId, edge: { relationship: rel.id } });
  }
  dispatch(cmds, t("Add connected element"));
  select([el.id]);
  set({ renaming: el.id });
}

/**
 * Delete: removes from the model when the element lives only in this view, otherwise just from this view.
 * `fromModel` forces deletion everywhere.
 */
export function deleteSelection(fromModel = false) {
  const { selection, activeView } = app.getState();
  const ws = model.state;
  const cmds: Command[] = [];
  let kept = 0;
  for (const id of selection.relationships) {
    if (id.startsWith("implied:")) continue;
    cmds.push({ type: "removeRelationship", id });
  }
  for (const id of selection.elements) {
    const elsewhere = viewsContaining(ws, id).filter((v) => v.id !== activeView).length;
    if (fromModel || !elsewhere || !activeView) cmds.push({ type: "removeElement", id });
    else {
      cmds.push({ type: "removeNode", view: activeView, element: id });
      kept++;
    }
  }
  if (!cmds.length) return;
  dispatch(cmds, t("Delete"));
  select();
  if (kept) toast(t("Removed from this view. Still used in other views (Shift+Delete removes from the model)."));
}

export function createView(notation: string, viewpoint: string | undefined, name: string, extra: Partial<View> = {}): Id {
  const view = makeView(notation, name, { viewpoint, ...extra });
  dispatch({ type: "addView", view }, t("New view"));
  set({ activeView: view.id, page: "diagram" });
  select();
  return view.id;
}

/** Double-click: open (or create) the child view defined by the pack's drill-down rule. */
export function drillDown(viewId: Id, elementId: Id): boolean {
  const ws = model.state;
  const view = ws.views[viewId];
  const el = ws.elements[elementId];
  if (!view || !el) return false;
  const type = presentationType(ws, el, view.notation, registry) ?? el.type;
  const rule = registry.packs.get(view.notation)?.drillDown?.find((d) => d.type === type);
  if (!rule) return false;
  const existing = Object.values(ws.views).find((v) => v.subject === elementId && v.viewpoint === rule.viewpoint);
  if (existing) {
    set({ activeView: existing.id, cameFrom: { ...app.getState().cameFrom, [existing.id]: viewId } });
    select();
    return true;
  }
  const vp = registry.viewpoint(view.notation, rule.viewpoint);
  const kids = childrenOf(ws, elementId);
  const [pw, ph] = [Math.max(360, Math.ceil(Math.sqrt(kids.length || 1)) * 200 + 60), Math.max(240, Math.ceil(kids.length / Math.ceil(Math.sqrt(kids.length || 1))) * 130 + 80)];
  const cols = Math.ceil(Math.sqrt(kids.length || 1));
  const nodes: ViewNode[] = [
    { element: elementId, x: 200, y: 120, w: pw, h: ph },
    ...kids.map((k, i) => {
      const [w, h] = sizeOf(presentationType(ws, k, view.notation, registry) ?? k.type);
      return { element: k.id, x: 30 + (i % cols) * 200, y: 50 + Math.floor(i / cols) * 130, w, h, parent: elementId };
    }),
  ];
  const child = makeView(view.notation, `${el.name} – ${vp?.name ?? rule.viewpoint}`, { viewpoint: rule.viewpoint, subject: elementId, nodes });
  // Bring along neighbours the children talk to, and the relationships between everything shown.
  const inside = new Set([elementId, ...kids.map((k) => k.id)]);
  const neighbours = new Set<Id>();
  for (const r of Object.values(ws.relationships)) {
    const a = inside.has(r.source), b = inside.has(r.target);
    if (a !== b) {
      const other = a ? r.target : r.source;
      const top = [other, ...ancestors(ws, other)].find((x) => !ancestors(ws, x).length || !inside.has(ws.elements[x].parent!)) ?? other;
      if (!inside.has(top) && presentationType(ws, ws.elements[top], view.notation, registry)) neighbours.add(ws.elements[other].parent === elementId ? other : top);
    }
  }
  let i = 0;
  for (const n of neighbours) {
    const [w, h] = sizeOf(presentationType(ws, ws.elements[n], view.notation, registry)!);
    child.nodes.push({ element: n, x: 200 + i++ * 190, y: 120 + ph + 90, w, h });
  }
  const present = new Set(child.nodes.map((n) => n.element));
  child.edges = Object.values(ws.relationships)
    .filter((r) => present.has(r.source) && present.has(r.target))
    .map((r) => ({ relationship: r.id }));
  dispatch({ type: "addView", view: child }, t("Open child view"));
  set({ activeView: child.id, cameFrom: { ...app.getState().cameFrom, [child.id]: viewId } });
  select();
  void runLayout(child.id);
  return true;
}

/** Expand or collapse a container in place. Expanding a container with no child nodes pulls its model children in. */
export function toggleCollapse(viewId: Id, elementId: Id) {
  const ws = model.state;
  const view = ws.views[viewId];
  const node = view.nodes.find((n) => n.element === elementId);
  if (!node) return;
  const hasKids = view.nodes.some((n) => n.parent === elementId);
  if (hasKids) {
    dispatch({ type: "updateNodes", view: viewId, nodes: [{ element: elementId, collapsed: !node.collapsed }] }, node.collapsed ? t("Expand") : t("Collapse"));
    return;
  }
  const kids = childrenOf(ws, elementId).filter((k) => !view.nodes.some((n) => n.element === k.id) && presentationType(ws, k, view.notation, registry));
  if (!kids.length) return toast(t("Nothing to expand"));
  const cols = Math.ceil(Math.sqrt(kids.length));
  const cmds: Command[] = [];
  const ids: Id[] = [];
  kids.forEach((k, i) => {
    const [w, h] = sizeOf(presentationType(ws, k, view.notation, registry)!);
    ids.push(k.id);
    cmds.push({ type: "putNode", view: viewId, node: { element: k.id, x: 24 + (i % cols) * 180, y: 50 + Math.floor(i / cols) * 120, w, h, parent: elementId } });
  });
  cmds.unshift({
    type: "updateNodes",
    view: viewId,
    nodes: [{ element: elementId, w: Math.max(node.w, cols * 180 + 40), h: Math.max(node.h, Math.ceil(kids.length / cols) * 120 + 70), collapsed: undefined }],
  });
  for (const k of ids) cmds.push(...edgesFor(view, k, ids));
  const seen = new Set<string>();
  dispatch(cmds.filter((c) => c.type !== "putEdge" || (!seen.has(c.edge.relationship) && seen.add(c.edge.relationship))), t("Expand"));
}

/** Auto-layout. Manual positions are only replaced when the user asks (or after an import). */
export async function runLayout(viewId: Id, algorithm?: string, silent = false) {
  const view = model.state.views[viewId];
  if (!view) return;
  const vp = registry.viewpoint(view.notation, view.viewpoint);
  const engine = registry.layouts.get(algorithm ?? vp?.layout?.algorithm ?? "layered");
  if (!engine) return;
  const hidden = hiddenNodes(view);
  const hasKids = new Set(view.nodes.filter((n) => n.parent && !hidden.has(n.element)).map((n) => n.parent!));
  const result = await engine.layout({
    direction: vp?.layout?.direction ?? "DOWN",
    nodes: view.nodes.filter((n) => !hidden.has(n.element)).map((n) => ({ id: n.element, w: n.w, h: n.h, parent: n.parent })),
    edges: view.edges
      .map((e) => model.state.relationships[e.relationship])
      .filter(Boolean)
      .map((r) => ({ id: r.id, source: r.source, target: r.target })),
  });
  const nodes = Object.entries(result).map(([element, p]) => ({ element, x: p.x, y: p.y, ...(hasKids.has(element) && p.w ? { w: p.w, h: p.h } : {}) }));
  const cmds: Command[] = [
    { type: "updateNodes", view: viewId, nodes },
    ...view.edges.filter((e) => e.waypoints?.length).map((e) => ({ type: "putEdge" as const, view: viewId, edge: { ...e, waypoints: undefined } })),
  ];
  if (silent) model.dispatch(cmds, { label: t("Auto-layout"), coalesce: false, context: { view: viewId } });
  else dispatch(cmds, t("Auto-layout"));
  window.dispatchEvent(new CustomEvent("vastitecture:fit"));
}

export function alignSelection(mode: "left" | "right" | "top" | "bottom" | "hcenter" | "vcenter" | "hspace" | "vspace") {
  const { activeView, selection } = app.getState();
  const view = activeView && model.state.views[activeView];
  if (!view) return;
  const nodes = view.nodes.filter((n) => selection.elements.includes(n.element));
  if (nodes.length < 2) return toast(t("Select at least two elements"));
  const min = (f: (n: ViewNode) => number) => Math.min(...nodes.map(f));
  const max = (f: (n: ViewNode) => number) => Math.max(...nodes.map(f));
  let patch: (n: ViewNode, i: number) => Partial<ViewNode>;
  switch (mode) {
    case "left": { const v = min((n) => n.x); patch = () => ({ x: v }); break; }
    case "right": { const v = max((n) => n.x + n.w); patch = (n) => ({ x: v - n.w }); break; }
    case "top": { const v = min((n) => n.y); patch = () => ({ y: v }); break; }
    case "bottom": { const v = max((n) => n.y + n.h); patch = (n) => ({ y: v - n.h }); break; }
    case "hcenter": { const v = (min((n) => n.x) + max((n) => n.x + n.w)) / 2; patch = (n) => ({ x: v - n.w / 2 }); break; }
    case "vcenter": { const v = (min((n) => n.y) + max((n) => n.y + n.h)) / 2; patch = (n) => ({ y: v - n.h / 2 }); break; }
    case "hspace": {
      const sorted = [...nodes].sort((a, b) => a.x - b.x);
      const gap = (max((n) => n.x + n.w) - min((n) => n.x) - sorted.reduce((s, n) => s + n.w, 0)) / (sorted.length - 1);
      let x = sorted[0].x;
      const xs = new Map(sorted.map((n) => { const v = x; x += n.w + gap; return [n.element, v]; }));
      patch = (n) => ({ x: xs.get(n.element)! });
      break;
    }
    case "vspace": {
      const sorted = [...nodes].sort((a, b) => a.y - b.y);
      const gap = (max((n) => n.y + n.h) - min((n) => n.y) - sorted.reduce((s, n) => s + n.h, 0)) / (sorted.length - 1);
      let y = sorted[0].y;
      const ys = new Map(sorted.map((n) => { const v = y; y += n.h + gap; return [n.element, v]; }));
      patch = (n) => ({ y: ys.get(n.element)! });
      break;
    }
  }
  dispatch({ type: "updateNodes", view: view.id, nodes: nodes.map((n, i) => ({ element: n.element, ...patch(n, i) })) }, t("Align"));
}

export function addAnnotation(viewId: Id, kind: "note" | "group" | "text", pos: { x: number; y: number }) {
  const size = kind === "group" ? { w: 300, h: 200 } : kind === "note" ? { w: 160, h: 90 } : { w: 160, h: 30 };
  dispatch({ type: "putAnnotation", view: viewId, annotation: { id: newId(), kind, ...pos, ...size, text: kind === "group" ? t("Group") : t("Note") } }, t("Add annotation"));
}

export function svgOf(viewId: Id): string {
  return viewToSvg(model.state, model.state.views[viewId], registry, app.getState().theme === "dark" ? DARK : LIGHT);
}

export async function svgToPng(svg: string, scale = 2): Promise<Blob> {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("Could not rasterise SVG"));
    img.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = img.width * scale;
  canvas.height = img.height * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("PNG encoding failed"))), "image/png"));
}

const fileBase = (viewId: Id) => model.state.views[viewId].name.replace(/[^\w.-]+/g, "-").toLowerCase() || "view";

export async function exportSvg(viewId: Id) {
  await saveFile(`${fileBase(viewId)}.svg`, svgOf(viewId), "image/svg+xml");
}
export async function exportPng(viewId: Id) {
  await saveFile(`${fileBase(viewId)}.png`, await svgToPng(svgOf(viewId)), "image/png");
}

/** Absolute position of a node in a view (stored positions are parent-relative). */
export function absolutePosition(view: View, element: Id) {
  return absoluteRects(view).get(element);
}

export function renameElement(id: Id, name: string) {
  const cur = model.state.elements[id];
  if (cur && name.trim() && cur.name !== name.trim()) dispatch({ type: "updateElement", id, patch: { name: name.trim() } }, t("Rename"));
}

/** Formalise: turn an element into a typed element of another pack, keeping its identity and placements. */
export function retype(id: Id, type: TypeId) {
  dispatch({ type: "updateElement", id, patch: { type } }, t("Change type"));
}
