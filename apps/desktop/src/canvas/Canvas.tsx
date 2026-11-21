import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  ConnectionMode,
  Controls,
  MiniMap,
  ViewportPortal,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { childrenOf, impact, impliedRelationships, presentationType, type Command, type Id, type TypeId, type View } from "@vastitecture/core";
import { absoluteRects, hiddenNodes } from "@vastitecture/render";
import { app, dispatch, model, registry, select, set, toast, useApp, useModel, useRegistryVersion } from "../state";
import { connect, createConnected, createElementInView, deleteSelection, drillDown, placeElement, sizeOf } from "../ops";
import { t } from "../i18n";
import { AnnotationNode, ShapeNode } from "./nodes";
import { ModelEdge } from "./edges";
import { CanvasContext } from "./context";
import { Chooser, type ChooserItem } from "./Chooser";

const nodeTypes = { shape: ShapeNode, annotation: AnnotationNode };
const edgeTypes = { model: ModelEdge };

export const DND_TYPE = "application/x-vastitecture-type";
export const DND_ELEMENT = "application/x-vastitecture-element";

function buildNodes(view: View, selected: Set<Id>): Node[] {
  const ws = model.state;
  const hidden = hiddenNodes(view);
  const present = new Set(view.nodes.map((n) => n.element));
  const parents = new Set(view.nodes.map((n) => n.parent).filter(Boolean) as Id[]);
  const depth = new Map<Id, number>();
  const byId = new Map(view.nodes.map((n) => [n.element, n]));
  const d = (id: Id, guard = 0): number => {
    if (depth.has(id)) return depth.get(id)!;
    const p = byId.get(id)?.parent;
    const v = p && byId.has(p) && guard < 50 ? d(p, guard + 1) + 1 : 0;
    depth.set(id, v);
    return v;
  };
  const out: Node[] = view.annotations.map((a) => ({
    id: `ann:${a.id}`,
    type: "annotation",
    position: { x: a.x, y: a.y },
    width: a.w,
    height: a.h,
    zIndex: a.kind === "group" ? -1 : 0,
    selected: selected.has(`ann:${a.id}`),
    data: { viewId: view.id, kind: a.kind, text: a.text ?? "" },
  }));
  for (const n of [...view.nodes].sort((a, b) => d(a.element) - d(b.element))) {
    const el = ws.elements[n.element];
    if (!el) continue;
    const hasKids = parents.has(n.element);
    out.push({
      id: n.element,
      type: "shape",
      position: { x: n.x, y: n.y },
      width: n.w,
      height: n.h,
      parentId: n.parent && byId.has(n.parent) ? n.parent : undefined,
      hidden: hidden.has(n.element),
      selected: selected.has(n.element),
      zIndex: d(n.element),
      ariaLabel: el.name,
      data: {
        viewId: view.id,
        notation: view.notation,
        hasKids,
        collapsed: !!n.collapsed,
        canExpand: !hasKids && childrenOf(ws, n.element).some((c) => !present.has(c.id)),
        fill: n.style?.fill as string | undefined,
      },
    });
  }
  return out;
}

function nestedIn(view: View, child: Id, ancestor: Id): boolean {
  for (let p = view.nodes.find((n) => n.element === child)?.parent, i = 0; p && i < 50; p = view.nodes.find((n) => n.element === p)?.parent, i++) if (p === ancestor) return true;
  return false;
}

function buildEdges(view: View, selected: Set<Id>): Edge[] {
  const ws = model.state;
  const hidden = hiddenNodes(view);
  const visible = new Set(view.nodes.filter((n) => !hidden.has(n.element)).map((n) => n.element));
  const out: Edge[] = [];
  for (const e of view.edges) {
    const r = ws.relationships[e.relationship];
    if (!r || e.hidden || !visible.has(r.source) || !visible.has(r.target)) continue;
    // Nesting already shows the relationship between a node and the node it sits inside.
    if (nestedIn(view, r.source, r.target) || nestedIn(view, r.target, r.source)) continue;
    out.push({ id: r.id, type: "model", source: r.source, target: r.target, selected: selected.has(r.id), data: { relationship: r.id, order: e.order, waypoints: e.waypoints }, zIndex: 1000 });
  }
  if (view.properties.showImplied !== false)
    for (const i of impliedRelationships(ws, view, registry, visible))
      out.push({ id: i.id, type: "model", source: i.source, target: i.target, selectable: false, data: { implied: true, via: i.via.length }, zIndex: 1000 });
  return out;
}

function Inner({ viewId }: { viewId: Id }) {
  const view = useModel((ws) => ws.views[viewId]);
  const elements = useModel((ws) => ws.elements);
  const relationships = useModel((ws) => ws.relationships);
  const mappings = useModel((ws) => ws.mappings);
  const regVersion = useRegistryVersion();
  const selection = useApp((s) => s.selection);
  const impactMode = useApp((s) => s.impact);
  const focus = useApp((s) => s.focus);
  const presenting = useApp((s) => s.presenting);
  const rf = useReactFlow();
  const wrap = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [chooser, setChooser] = useState<{ x: number; y: number; title: string; items: ChooserItem[]; search?: string } | null>(null);

  // Model -> canvas. Local state only exists so drags stay smooth; the model is authoritative.
  useEffect(() => {
    if (!view) return;
    const sel = new Set([...app.getState().selection.elements, ...app.getState().selection.relationships]);
    setNodes((prev) => {
      const extra = new Set(prev.filter((n) => n.selected && n.id.startsWith("ann:")).map((n) => n.id));
      return buildNodes(view, new Set([...sel, ...extra]));
    });
    setEdges(buildEdges(view, sel));
  }, [view, elements, relationships, mappings, regVersion]);

  useEffect(() => {
    const sel = new Set([...selection.elements, ...selection.relationships]);
    setNodes((ns) => ns.map((n) => (n.id.startsWith("ann:") || n.selected === sel.has(n.id) ? n : { ...n, selected: sel.has(n.id) })));
    setEdges((es) => es.map((e) => (e.selected === sel.has(e.id) ? e : { ...e, selected: sel.has(e.id) })));
  }, [selection]);

  useEffect(() => {
    const fit = () => setTimeout(() => rf.fitView({ padding: 0.15, duration: 200, maxZoom: 1.2 }), 60);
    fit();
    window.addEventListener("vastitecture:fit", fit);
    return () => window.removeEventListener("vastitecture:fit", fit);
  }, [viewId, rf]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((ns) => applyNodeChanges(changes, ns));
      const v = model.state.views[viewId];
      if (!v) return;
      const moved: { element: Id; x: number; y: number }[] = [];
      const cmds: Command[] = [];
      for (const c of changes) {
        if (c.type !== "position" || c.dragging || !c.position) continue;
        if (c.id.startsWith("ann:")) {
          const a = v.annotations.find((x) => `ann:${x.id}` === c.id);
          if (a && (a.x !== c.position.x || a.y !== c.position.y)) cmds.push({ type: "putAnnotation", view: viewId, annotation: { ...a, x: c.position.x, y: c.position.y } });
          continue;
        }
        const n = v.nodes.find((x) => x.element === c.id);
        if (n && (Math.round(n.x) !== Math.round(c.position.x) || Math.round(n.y) !== Math.round(c.position.y)))
          moved.push({ element: c.id, x: Math.round(c.position.x), y: Math.round(c.position.y) });
      }
      if (moved.length) cmds.push({ type: "updateNodes", view: viewId, nodes: moved });
      if (cmds.length) dispatch(cmds, t("Move"));
      const selected = changes.some((c) => c.type === "select");
      if (selected) queueMicrotask(syncSelection);
    },
    [viewId],
  );

  const syncSelection = useCallback(() => {
    select(
      rf.getNodes().filter((n) => n.selected && !n.id.startsWith("ann:")).map((n) => n.id),
      rf.getEdges().filter((e) => e.selected).map((e) => e.id),
    );
  }, [rf]);

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((es) => applyEdgeChanges(changes, es));
      if (changes.some((c) => c.type === "select")) queueMicrotask(syncSelection);
    },
    [syncSelection],
  );

  /** After a drag, nest the node into the container it was dropped on (or lift it out). */
  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      const v = model.state.views[viewId];
      const me = v?.nodes.find((n) => n.element === node.id);
      if (!v || !me) return;
      const rects = absoluteRects(v);
      const r = rects.get(node.id)!;
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const isDesc = (id: Id): boolean => {
        for (let p = v.nodes.find((n) => n.element === id)?.parent; p; p = v.nodes.find((n) => n.element === p)?.parent) if (p === node.id) return true;
        return false;
      };
      const hidden = hiddenNodes(v);
      const target = v.nodes
        .filter((n) => n.element !== node.id && !isDesc(n.element) && !hidden.has(n.element) && !n.collapsed)
        .filter((n) => {
          const el = model.state.elements[n.element];
          const def = el && registry.elementType(presentationType(model.state, el, v.notation, registry) ?? el.type);
          const mine = model.state.elements[node.id];
          const myType = mine && (presentationType(model.state, mine, v.notation, registry) ?? mine.type);
          if (Array.isArray(def?.container)) return def.container.includes(myType);
          return def?.container || def?.nestable || (v.nodes.some((k) => k.parent === n.element) && mine?.parent === n.element);
        })
        .map((n) => ({ n, r: rects.get(n.element)! }))
        .filter(({ r: c }) => cx > c.x && cx < c.x + c.w && cy > c.y && cy < c.y + c.h)
        .sort((a, b) => a.r.w * a.r.h - b.r.w * b.r.h)[0];
      const newParent = target?.n.element;
      if (newParent === me.parent) return;
      const base = newParent ? rects.get(newParent)! : { x: 0, y: 0 };
      const cmds: Command[] = [{ type: "updateNodes", view: viewId, nodes: [{ element: node.id, parent: newParent, x: Math.round(r.x - base.x), y: Math.round(r.y - base.y) }] }];
      const el = model.state.elements[node.id];
      // Model containment follows the drawing only when that is unambiguous: no parent yet, or moved between containers in this view.
      if (newParent && el && el.parent !== newParent && (!el.parent || v.nodes.some((n) => n.element === el.parent))) cmds.push({ type: "updateElement", id: node.id, patch: { parent: newParent } });
      model.dispatch(cmds, { label: t("Move"), coalesce: true, context: { view: viewId } });
    },
    [viewId],
  );

  const typeOf = (id: Id) => {
    const el = model.state.elements[id];
    return el ? presentationType(model.state, el, view.notation, registry) ?? el.type : "";
  };

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      const { types, strict } = registry.validRelationships(view.notation, typeOf(c.source), typeOf(c.target), view.viewpoint);
      if (!types.length) return toast(strict ? t("No relationship is valid between these two elements") : t("This notation defines no relationships"));
      if (types.length === 1) return void connect(viewId, c.source, c.target, types[0]);
      const { source, target } = c;
      setChooser({
        x: pointer.current.x,
        y: pointer.current.y,
        title: t("Relationship type"),
        items: types.map((ty) => ({ id: ty, label: registry.relationshipType(ty)?.name ?? ty, run: () => connect(viewId, source, target, ty) })),
      });
    },
    [view?.notation, view?.viewpoint, viewId],
  );

  /** Items for quick-add: palette types first, then existing elements that can be shown here. */
  const quickAddItems = useCallback(
    (pos: { x: number; y: number }): ChooserItem[] => {
      const palette = registry.paletteFor(view.notation, view.viewpoint);
      const present = new Set(view.nodes.map((n) => n.element));
      return [
        ...palette.map((d) => ({ id: d.id, label: d.name, hint: d.category ?? t("New"), run: () => (createElementInView(viewId, d.id, pos), set({ renaming: app.getState().selection.elements[0] })) })),
        ...Object.values(model.state.elements)
          .filter((e) => !present.has(e.id) && presentationType(model.state, e, view.notation, registry))
          .slice(0, 400)
          .map((e) => ({ id: e.id, label: e.name, hint: t("Existing: {type}", { type: registry.elementType(e.type)?.name ?? e.type }), run: () => void placeElement(viewId, e.id, pos) })),
      ];
    },
    [view, viewId],
  );

  const dropExisting = (id: Id, pos: { x: number; y: number }, at: { x: number; y: number }) => {
    if (placeElement(viewId, id, pos)) return;
    // No mapping for this notation: offer to create one.
    const el = model.state.elements[id];
    const options = registry.paletteFor(view.notation, view.viewpoint);
    setChooser({
      x: at.x,
      y: at.y,
      title: t("No mapping from {type} to {notation}. Show it as:", { type: registry.elementType(el.type)?.name ?? el.type, notation: registry.packs.get(view.notation)?.name ?? view.notation }),
      items: options.flatMap((d) => [
        {
          id: d.id,
          label: d.name,
          hint: t("This element only"),
          run: () => {
            dispatch({ type: "updateElement", id, patch: { facets: { ...el.facets, [view.notation]: { ...el.facets?.[view.notation], type: d.id } } } }, t("Set presentation"));
            placeElement(viewId, id, pos);
          },
        },
        {
          id: d.id + "#rule",
          label: d.name,
          hint: t("Every {type} (add mapping rule)", { type: registry.elementType(el.type)?.name ?? el.type }),
          run: () => {
            const pack = el.type.slice(0, el.type.indexOf(":"));
            dispatch({ type: "setMappings", mappings: [...model.state.mappings, { concept: `${el.type}=${d.id}`.replace(/[^\w=-]+/g, "-").toLowerCase(), members: { [pack]: [el.type], [view.notation]: [d.id] } }] }, t("Add mapping"));
            placeElement(viewId, id, pos);
          },
        },
      ]),
    });
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const type = e.dataTransfer.getData(DND_TYPE) as TypeId;
    const existing = e.dataTransfer.getData(DND_ELEMENT);
    if (type) {
      const [w, h] = sizeOf(type);
      createElementInView(viewId, type, { x: Math.round(pos.x - w / 2), y: Math.round(pos.y - h / 2) });
    } else if (existing) dropExisting(existing, { x: Math.round(pos.x - 70), y: Math.round(pos.y - 35) }, { x: e.clientX, y: e.clientY });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target !== document.body && !wrap.current?.contains(target)) return;
    if (target.closest("input, textarea, select, [contenteditable], [role='dialog']")) return;
    const sel = app.getState().selection;
    if (e.key === "Delete" || e.key === "Backspace") {
      const anns = nodes.filter((n) => n.selected && n.id.startsWith("ann:"));
      if (anns.length) dispatch(anns.map((n) => ({ type: "removeAnnotation" as const, view: viewId, id: n.id.slice(4) })), t("Delete annotation"));
      deleteSelection(e.shiftKey);
      e.preventDefault();
    } else if (e.key === "Enter" || e.key === "F2") {
      if (sel.elements.length === 1) {
        set({ renaming: sel.elements[0] });
        e.preventDefault();
      }
    } else if (e.key === "Tab" && sel.elements.length === 1) {
      createConnected(viewId, sel.elements[0]);
      e.preventDefault();
    } else if (e.key.startsWith("Arrow") && !e.altKey && !e.ctrlKey && !e.metaKey) {
      // Keyboard navigation: with Shift, nudge the selection; otherwise move to the nearest node in that direction,
      // preferring nodes connected to the current one.
      const v = model.state.views[viewId];
      const dx = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
      const dy = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
      e.preventDefault();
      if (e.shiftKey && sel.elements.length) {
        const nodesSel = v.nodes.filter((n) => sel.elements.includes(n.element));
        dispatch({ type: "updateNodes", view: viewId, nodes: nodesSel.map((n) => ({ element: n.element, x: n.x + dx * 10, y: n.y + dy * 10 })) }, t("Move"), { coalesce: true });
        return;
      }
      const rects = absoluteRects(v);
      const hidden = hiddenNodes(v);
      const cur = sel.elements[0] && rects.get(sel.elements[0]);
      const candidates = v.nodes.filter((n) => !hidden.has(n.element) && n.element !== sel.elements[0]);
      if (!cur) {
        const first = candidates.sort((a, b) => rects.get(a.element)!.y - rects.get(b.element)!.y || rects.get(a.element)!.x - rects.get(b.element)!.x)[0];
        if (first) select([first.element]);
        return;
      }
      const cx = cur.x + cur.w / 2, cy = cur.y + cur.h / 2;
      const linked = new Set(Object.values(model.state.relationships).flatMap((r) => (r.source === sel.elements[0] ? [r.target] : r.target === sel.elements[0] ? [r.source] : [])));
      const best = candidates
        .map((n) => {
          const r = rects.get(n.element)!;
          const ox = r.x + r.w / 2 - cx, oy = r.y + r.h / 2 - cy;
          const along = ox * dx + oy * dy;
          const across = Math.abs(ox * dy) + Math.abs(oy * dx);
          return { n, along, score: along + across * 2 - (linked.has(n.element) ? 200 : 0) };
        })
        .filter((c) => c.along > 5)
        .sort((a, b) => a.score - b.score)[0];
      if (best) {
        select([best.n.element]);
        const r = rects.get(best.n.element)!;
        rf.setCenter(r.x + r.w / 2, r.y + r.h / 2, { duration: 150, zoom: rf.getZoom() });
        const el = model.state.elements[best.n.element];
        const live = document.getElementById("canvas-live");
        if (live && el) live.textContent = `${registry.elementType(el.type)?.name ?? el.type}: ${el.name}${linked.has(best.n.element) ? ", " + t("connected") : ""}`;
      }
    } else if (e.key === "Escape") {
      select();
      setChooser(null);
    } else if (e.key.length === 1 && /[\p{L}\p{N}]/u.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Press a key and type to search the palette and the model.
      const box = wrap.current!.getBoundingClientRect();
      const inside = pointer.current.x > box.left && pointer.current.x < box.right && pointer.current.y > box.top && pointer.current.y < box.bottom;
      const at = inside ? pointer.current : { x: box.left + box.width / 2, y: box.top + box.height / 3 };
      const pos = rf.screenToFlowPosition(at);
      setChooser({ ...at, title: t("Add element"), search: e.key, items: quickAddItems({ x: Math.round(pos.x), y: Math.round(pos.y) }) });
      e.preventDefault();
    }
  };

  const keyRef = useRef(onKeyDown);
  keyRef.current = onKeyDown;
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // Impact highlight and focus mode: both reduce to "which elements stay lit".
  const highlight = useMemo(() => {
    if (!selection.elements.length || (!impactMode && !focus)) return null;
    const lit = new Set<Id>(selection.elements);
    for (const id of selection.elements) {
      if (impactMode) for (const k of impact(model.state, id, impactMode, registry).keys()) lit.add(k);
      else for (const r of Object.values(relationships)) if (r.source === id || r.target === id) lit.add(r.source).add(r.target);
    }
    // Keep containers of lit nodes visible.
    for (const n of view?.nodes ?? []) if (lit.has(n.element)) for (let p = n.parent; p; p = view!.nodes.find((x) => x.element === p)?.parent) lit.add(p);
    return lit;
  }, [selection.elements, impactMode, focus, relationships, elements, view]);
  const overlay = useApp((s) => s.overlay);
  const ctx = useMemo(() => ({ highlight, overlay }), [highlight, overlay]);

  if (!view) return null;
  return (
    <div
      ref={wrap}
      className="w-full h-full"
      data-testid="canvas"
      tabIndex={0}
      role="application"
      aria-roledescription={t("diagram")}
      aria-label={t("Diagram {name}. Arrow keys move between elements, Shift+arrows move them, Enter renames, Tab adds a connected element, a letter searches the palette.", { name: view?.name ?? "" })}
      onMouseMove={(e) => (pointer.current = { x: e.clientX, y: e.clientY })}
      onDragOver={(e) => (e.preventDefault(), (e.dataTransfer.dropEffect = "copy"))}
      onDrop={onDrop}
    >
      <CanvasContext.Provider value={ctx}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          onNodeDoubleClick={(_, n) => {
            if (n.id.startsWith("ann:")) return;
            if (!drillDown(viewId, n.id)) set({ renaming: n.id });
          }}
          onPaneClick={() => (select(), setChooser(null), wrap.current?.focus())}
          onNodeClick={() => wrap.current?.focus()}
          connectionMode={ConnectionMode.Loose}
          connectionRadius={28}
          deleteKeyCode={null}
          multiSelectionKeyCode={["Shift", "Meta", "Control"]}
          selectionOnDrag={false}
          minZoom={0.05}
          maxZoom={3}
          snapToGrid
          snapGrid={[5, 5]}
          elevateNodesOnSelect={false}
          proOptions={{ hideAttribution: true }}
          aria-label={t("Diagram canvas: {name}", { name: view.name })}
        >
          <Background gap={20} />
          {registry.viewpoint(view.notation, view.viewpoint)?.timeline && (
            <ViewportPortal>
              <div aria-label={t("Timeline")} data-testid="timeline" style={{ position: "absolute", left: -100, top: -46, width: 6000, pointerEvents: "none", color: "var(--muted)", fontSize: 12 }}>
                <div style={{ borderTop: "2px dashed var(--muted)", position: "relative" }}>
                  <span style={{ position: "absolute", right: -10, top: -11 }}>▶</span>
                </div>
                <span>{t("time")} →</span>
              </div>
            </ViewportPortal>
          )}
          {!presenting && <Controls showInteractive={false} position="bottom-left" />}
          {!presenting && <MiniMap pannable zoomable position="bottom-right" nodeColor="var(--muted)" maskColor="color-mix(in srgb, var(--bg) 70%, transparent)" ariaLabel={t("Minimap")} />}
        </ReactFlow>
      </CanvasContext.Provider>
      {overlay && !presenting && (
        <div className="overlay-banner" role="status" data-testid="overlay-banner">
          {overlay.title} <button className="btn ghost" onClick={() => set({ overlay: undefined })}>{t("Clear")}</button>
        </div>
      )}
      {chooser && <Chooser {...chooser} onClose={() => (setChooser(null), wrap.current?.focus())} />}
      <div id="canvas-live" aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }} />
    </div>
  );
}

export function Canvas({ viewId }: { viewId: Id }) {
  return (
    <ReactFlowProvider key={viewId}>
      <Inner viewId={viewId} />
    </ReactFlowProvider>
  );
}
