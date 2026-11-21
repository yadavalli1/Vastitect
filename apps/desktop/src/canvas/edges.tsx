import { memo, useContext } from "react";
import { EdgeLabelRenderer, useInternalNode, type Edge, type EdgeProps } from "@xyflow/react";
import type { Id } from "@vastitecture/core";
import { dashArray, edgePoints, markerGeom, midPoint, pointsToPath } from "@vastitecture/render";
import { registry, useModel } from "../state";
import { CanvasContext } from "./context";

export type ModelEdgeData = { relationship?: Id; implied?: boolean; via?: number; order?: number; waypoints?: { x: number; y: number }[] };
export type ModelEdgeType = Edge<ModelEdgeData, "model">;

/** Floating edge: clipped to the node borders, with the pack's line style and end markers. */
export const ModelEdge = memo(function ModelEdge({ source, target, data, selected }: EdgeProps<ModelEdgeType>) {
  const s = useInternalNode(source);
  const tg = useInternalNode(target);
  const rel = useModel((ws) => (data?.relationship ? ws.relationships[data.relationship] : undefined));
  const { highlight, overlay } = useContext(CanvasContext);
  if (!s || !tg) return null;
  const rect = (n: NonNullable<typeof s>) => ({
    x: n.internals.positionAbsolute.x,
    y: n.internals.positionAbsolute.y,
    w: n.measured.width ?? n.width ?? 0,
    h: n.measured.height ?? n.height ?? 0,
  });
  const pts = edgePoints(rect(s), rect(tg), data?.waypoints);
  const def = rel ? registry.relationshipType(rel.type) : undefined;
  const stroke = selected ? "var(--accent)" : "var(--node-stroke)";
  const dim = highlight && !(highlight.has(source) && highlight.has(target));
  const markers = [
    markerGeom(data?.implied ? "open" : def?.targetMarker ?? "arrow", pts[pts.length - 1], pts[pts.length - 2]),
    markerGeom(def?.sourceMarker, pts[0], pts[1]),
  ];
  const mid = midPoint(pts);
  const text = data?.implied
    ? ""
    : [data?.order !== undefined ? `${data.order}.` : "", rel?.label ?? "", rel?.technology ? `[${rel.technology}]` : ""].filter(Boolean).join(" ");
  const ends = def?.endLabels;
  const d = pointsToPath(pts);
  return (
    <g role="img" className={`vedge${dim ? " dim" : ""}${rel && overlay?.relationships?.[rel.id] ? ` tone-${overlay.relationships[rel.id]}` : ""}`} aria-label={rel ? `${def?.name ?? rel.type}${rel.label ? `: ${rel.label}` : ""}` : "implied relationship"}>
      <path d={d} fill="none" stroke="transparent" strokeWidth={14} className="react-flow__edge-interaction" />
      <path d={d} fill="none" stroke={stroke} strokeWidth={selected ? 2.2 : 1.3} strokeDasharray={data?.implied ? "2 4" : dashArray(def?.line)} />
      {markers.map((m, i) => m && <path key={i} d={m.d} stroke={stroke} strokeWidth={1.3} fill={m.fill === "stroke" ? stroke : m.fill === "bg" ? "var(--bg)" : "none"} />)}
      <EdgeLabelRenderer>
        {text && (
          <div className="vedge-label nodrag nopan" style={{ transform: `translate(-50%,-50%) translate(${mid.x}px,${mid.y}px)`, opacity: dim ? 0.15 : 1 }}>
            {text}
          </div>
        )}
        {ends &&
          [0, 1].map((i) => {
            const a = i ? pts[pts.length - 1] : pts[0];
            const b = i ? pts[pts.length - 2] : pts[1];
            const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            const x = a.x + ((b.x - a.x) / len) * 16;
            const y = a.y + ((b.y - a.y) / len) * 16;
            return (
              <div key={i} className="vedge-label" style={{ transform: `translate(-50%,-50%) translate(${x}px,${y}px)`, fontWeight: 700, border: "1px solid var(--node-stroke)" }}>
                {ends[i]}
              </div>
            );
          })}
      </EdgeLabelRenderer>
    </g>
  );
});
