import { memo, useContext, useEffect, useRef, useState } from "react";
import { Handle, NodeResizer, Position, useConnection, type Node, type NodeProps } from "@xyflow/react";
import { presentationType, type Id } from "@vastitecture/core";
import { shapeGeom } from "@vastitecture/render";
import { app, dispatch, model, registry, set, useApp, useModel } from "../state";
import { renameElement, toggleCollapse } from "../ops";
import { t } from "../i18n";
import { CanvasContext } from "./context";

export const focusCanvas = () => document.querySelector<HTMLElement>('[data-testid="canvas"]')?.focus({ preventScroll: true });

export type ShapeNodeData = { viewId: Id; notation: string; hasKids: boolean; canExpand: boolean; collapsed: boolean; fill?: string };
export type ShapeNodeType = Node<ShapeNodeData, "shape">;

function RenameInput({ id, name }: { id: Id; name: string }) {
  const [value, setValue] = useState(name);
  const ref = useRef<HTMLInputElement>(null);
  const mounted = useRef(performance.now());
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const done = (commit: boolean) => {
    if (commit) renameElement(id, value);
    if (app.getState().renaming === id) set({ renaming: undefined });
    focusCanvas();
  };
  return (
    <input
      ref={ref}
      className="input nodrag nopan"
      aria-label={t("Element name")}
      style={{ pointerEvents: "all", textAlign: "center", fontWeight: 600 }}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      // The canvas may remount a freshly created node once it is measured; that must not end the rename.
      onBlur={() => performance.now() - mounted.current > 300 && ref.current?.isConnected && done(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") done(true);
        if (e.key === "Escape") done(false);
      }}
    />
  );
}

/** One renderer for every notation: the pack's declarative shape decides how the element looks. */
export const ShapeNode = memo(function ShapeNode({ id, data, selected, width, height }: NodeProps<ShapeNodeType>) {
  const el = useModel((ws) => ws.elements[id]);
  const mappings = useModel((ws) => ws.mappings);
  const renaming = useApp((s) => s.renaming === id);
  const { highlight } = useContext(CanvasContext);
  const connecting = useConnection((c) => c.inProgress);
  if (!el) return null;
  const w = width ?? 150;
  const h = height ?? 80;
  void mappings; // re-render when the mapping table changes
  const type = presentationType(model.state, el, data.notation, registry) ?? el.type;
  const def = registry.elementType(type) ?? registry.elementType(el.type);
  const g = shapeGeom(def?.shape ?? "rect", w, h);
  const fill = data.fill ?? def?.fill;
  const top = g.top || def?.container || data.hasKids;
  const tech = typeof el.properties.technology === "string" ? el.properties.technology : "";
  const dim = highlight && !highlight.has(id);
  const label = `${def?.name ?? el.type}: ${el.name}`;
  return (
    <div className={`vnode${dim ? " dim" : ""}`} role="group" aria-label={label} title={el.description || label} data-element={id} data-type={type}>
      <NodeResizer
        isVisible={!!selected}
        minWidth={40}
        minHeight={30}
        lineStyle={{ borderColor: "transparent" }}
        handleStyle={{ width: 7, height: 7, borderRadius: 1 }}
        onResizeEnd={(_, p) =>
          dispatch({ type: "updateNodes", view: data.viewId, nodes: [{ element: id, x: p.x, y: p.y, w: p.width, h: p.height }] }, t("Resize"))
        }
      />
      <svg width={w} height={h} style={{ position: "absolute", inset: 0, overflow: "visible" }} aria-hidden>
        {g.parts.map((p, i) =>
          p.role === "shade" ? (
            <path key={i} d={p.d} fill="#000" fillOpacity={0.15} />
          ) : (
            <path
              key={i}
              className="shape-body"
              d={p.d}
              fill={p.role === "detail" || g.dashed ? "transparent" : fill ?? "var(--node-fill)"}
              stroke="var(--node-stroke)"
              strokeWidth={1.5}
              strokeDasharray={g.dashed ? "6 4" : undefined}
            />
          ),
        )}
      </svg>
      <div
        className={`vnode-label${top ? " top" : ""}`}
        style={{ left: g.label.x, top: g.label.y, width: g.label.w, height: g.label.h, color: fill && !g.dashed ? "#0f172a" : "var(--text)" }}
      >
        {renaming ? (
          <RenameInput id={id} name={el.name} />
        ) : (
          <>
            <span className="vnode-name">{el.name}</span>
            {def?.badge && <span className="vnode-badge">[{def.badge}{tech ? `: ${tech}` : ""}]</span>}
            {!top && el.description && h > 105 && <span className="vnode-desc">{el.description}</span>}
          </>
        )}
      </div>
      {def?.icon && !def.icon.startsWith("path:") && <span className="vnode-icon" style={{ color: fill ? "#0f172a" : undefined }}>{def.icon}</span>}
      {(data.hasKids || data.canExpand) && (
        <button
          className="vnode-toggle nodrag"
          aria-label={data.collapsed || !data.hasKids ? t("Expand") : t("Collapse")}
          onClick={(e) => {
            e.stopPropagation();
            toggleCollapse(data.viewId, id);
          }}
        >
          {data.collapsed || !data.hasKids ? "+" : "−"}
        </button>
      )}
      {[Position.Top, Position.Right, Position.Bottom, Position.Left].map((p) => (
        <Handle key={p} id={p} className="vnode-handle" type="source" position={p} />
      ))}
      <Handle id="in" className="vnode-target" type="target" position={Position.Top} isConnectableStart={false} style={{ pointerEvents: connecting ? "all" : "none" }} />
    </div>
  );
});

export type NoteNodeType = Node<{ viewId: Id; kind: string; text: string }, "annotation">;

export const AnnotationNode = memo(function AnnotationNode({ id, data, selected, width, height }: NodeProps<NoteNodeType>) {
  const [editing, setEditing] = useState(false);
  const update = (patch: object) => {
    const cur = model.state.views[data.viewId]?.annotations.find((a) => a.id === id);
    if (cur) dispatch({ type: "putAnnotation", view: data.viewId, annotation: { ...cur, ...patch } }, t("Edit annotation"));
  };
  const style: React.CSSProperties =
    data.kind === "note"
      ? { background: "#fde68a", color: "#1f2937", border: "1px solid #b45309" }
      : data.kind === "group"
        ? { border: "1.5px dashed var(--muted)", borderRadius: 6 }
        : {};
  return (
    <div style={{ width: width ?? 160, height: height ?? 60, padding: 6, fontSize: 12, whiteSpace: "pre-wrap", ...style }} onDoubleClick={() => setEditing(true)} aria-label={t("Annotation")}>
      <NodeResizer isVisible={!!selected} minWidth={40} minHeight={20} onResizeEnd={(_, p) => update({ x: p.x, y: p.y, w: p.width, h: p.height })} />
      {editing ? (
        <textarea
          autoFocus
          className="nodrag nopan"
          style={{ width: "100%", height: "100%", background: "transparent", border: 0, resize: "none", color: "inherit" }}
          defaultValue={data.text}
          onKeyDown={(e) => e.stopPropagation()}
          onBlur={(e) => {
            setEditing(false);
            if (e.target.value !== data.text) update({ text: e.target.value });
          }}
        />
      ) : (
        data.text
      )}
    </div>
  );
});
