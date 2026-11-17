import type { Marker, ShapeKind } from "@vastitecture/core";

export interface ShapePart {
  d: string;
  /** body: filled + stroked. detail: stroked only. shade: darker overlay. */
  role: "body" | "detail" | "shade";
}
export interface ShapeGeom {
  parts: ShapePart[];
  /** Box the label is centred in. */
  label: { x: number; y: number; w: number; h: number };
  /** Label anchored to the top (containers). */
  top?: boolean;
  dashed?: boolean;
}

const rr = (x: number, y: number, w: number, h: number, r: number) => {
  r = Math.min(r, w / 2, h / 2);
  return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
};
const ell = (cx: number, cy: number, rx: number, ry: number) => `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
const poly = (pts: [number, number][]) => "M" + pts.map((p) => `${p[0]} ${p[1]}`).join("L") + "Z";

/** Geometry for a declarative shape at a given size. Shared by the canvas and the SVG exporter. */
export function shapeGeom(kind: ShapeKind, w: number, h: number): ShapeGeom {
  const full = { x: 6, y: 4, w: w - 12, h: h - 8 };
  switch (kind) {
    case "rounded":
      return { parts: [{ d: rr(0, 0, w, h, 12), role: "body" }], label: full };
    case "pill":
      return { parts: [{ d: rr(0, 0, w, h, h / 2), role: "body" }], label: full };
    case "ellipse":
      return { parts: [{ d: ell(w / 2, h / 2, w / 2, h / 2), role: "body" }], label: { x: w * 0.15, y: h * 0.15, w: w * 0.7, h: h * 0.7 } };
    case "diamond":
      return { parts: [{ d: poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]), role: "body" }], label: { x: w * 0.2, y: h * 0.25, w: w * 0.6, h: h * 0.5 } };
    case "person": {
      const r = Math.min(w, h) * 0.19;
      const top = r * 1.7;
      return {
        parts: [
          { d: rr(0, top, w, h - top, 14), role: "body" },
          { d: ell(w / 2, r, r, r), role: "body" },
        ],
        label: { x: 6, y: top + r * 0.35, w: w - 12, h: h - top - r * 0.35 - 4 },
      };
    }
    case "cylinder": {
      const ry = Math.min(12, h * 0.15);
      return {
        parts: [
          { d: `M0 ${ry}A${w / 2} ${ry} 0 0 1 ${w} ${ry}V${h - ry}A${w / 2} ${ry} 0 0 1 0 ${h - ry}Z`, role: "body" },
          { d: `M0 ${ry}A${w / 2} ${ry} 0 0 0 ${w} ${ry}`, role: "detail" },
        ],
        label: { x: 6, y: ry * 2, w: w - 12, h: h - ry * 3 },
      };
    }
    case "hexagon": {
      const o = Math.min(w * 0.18, 24);
      return { parts: [{ d: poly([[o, 0], [w - o, 0], [w, h / 2], [w - o, h], [o, h], [0, h / 2]]), role: "body" }], label: { x: o, y: 4, w: w - 2 * o, h: h - 8 } };
    }
    case "octagon": {
      const o = Math.min(w, h) * 0.22;
      return { parts: [{ d: poly([[o, 0], [w - o, 0], [w, o], [w, h - o], [w - o, h], [o, h], [0, h - o], [0, o]]), role: "body" }], label: full };
    }
    case "note": {
      const f = Math.min(16, w / 4, h / 4);
      return {
        parts: [
          { d: poly([[0, 0], [w - f, 0], [w, f], [w, h], [0, h]]), role: "body" },
          { d: `M${w - f} 0V${f}H${w}`, role: "detail" },
        ],
        label: full,
      };
    }
    case "folder": {
      const t = Math.min(14, h / 4);
      return {
        parts: [{ d: `M0 0H${w * 0.4}L${w * 0.4 + t} ${t}H${w}V${h}H0Z`, role: "body" }, { d: `M0 ${t}H${w * 0.4 + t}`, role: "detail" }],
        label: { x: 6, y: t + 2, w: w - 12, h: h - t - 6 },
        top: true,
      };
    }
    case "component":
      return {
        parts: [
          { d: rr(8, 0, w - 8, h, 3), role: "body" },
          { d: rr(0, h * 0.2, 16, 9, 1), role: "body" },
          { d: rr(0, h * 0.2 + 16, 16, 9, 1), role: "body" },
        ],
        label: { x: 20, y: 4, w: w - 26, h: h - 8 },
      };
    case "parallelogram": {
      const o = Math.min(18, w / 5);
      return { parts: [{ d: poly([[o, 0], [w, 0], [w - o, h], [0, h]]), role: "body" }], label: { x: o, y: 4, w: w - 2 * o, h: h - 8 } };
    }
    case "node3d": {
      const o = Math.min(10, w / 8, h / 8);
      return {
        parts: [
          { d: poly([[0, o], [o, 0], [w, 0], [w, h - o], [w - o, h], [0, h]]), role: "body" },
          { d: `M0 ${o}H${w - o}V${h}M${w - o} ${o}L${w} 0`, role: "detail" },
        ],
        label: { x: 6, y: o + 2, w: w - o - 12, h: h - o - 6 },
        top: true,
      };
    }
    case "chevron": {
      const o = Math.min(18, w / 5);
      return { parts: [{ d: poly([[0, 0], [w - o, 0], [w, h / 2], [w - o, h], [0, h], [o, h / 2]]), role: "body" }], label: { x: o, y: 4, w: w - 2 * o, h: h - 8 } };
    }
    case "document":
    case "wave": {
      const a = Math.min(10, h / 6);
      return {
        parts: [{ d: `M0 0H${w}V${h - a}C${w * 0.75} ${h - 3 * a} ${w * 0.25} ${h + a} 0 ${h - a}Z`, role: "body" }],
        label: { x: 6, y: 4, w: w - 12, h: h - 2 * a - 6 },
      };
    }
    case "group":
      return { parts: [{ d: rr(0, 0, w, h, 6), role: "body" }], label: { x: 8, y: 4, w: w - 16, h: h - 8 }, top: true, dashed: true };
    case "sticky":
      return { parts: [{ d: rr(0, 0, w, h, 2), role: "body" }, { d: poly([[w - 14, h], [w, h - 14], [w, h]]), role: "shade" }], label: full };
    case "rect":
    default:
      return { parts: [{ d: rr(0, 0, w, h, 2), role: "body" }], label: full };
  }
}

export interface Point {
  x: number;
  y: number;
}
export interface Rect extends Point {
  w: number;
  h: number;
}

/** Point where the segment from the rect centre towards `to` crosses the rect border. */
export function borderPoint(r: Rect, to: Point): Point {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = to.x - cx;
  const dy = to.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const s = Math.min(dx ? r.w / 2 / Math.abs(dx) : Infinity, dy ? r.h / 2 / Math.abs(dy) : Infinity);
  return { x: cx + dx * s, y: cy + dy * s };
}

const centre = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Poly-line for an edge between two rects through optional waypoints, clipped to the borders. */
export function edgePoints(source: Rect, target: Rect, waypoints: Point[] = []): Point[] {
  const first = waypoints[0] ?? centre(target);
  const last = waypoints[waypoints.length - 1] ?? centre(source);
  return [borderPoint(source, first), ...waypoints, borderPoint(target, last)];
}

export const pointsToPath = (pts: Point[]) => "M" + pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join("L");

export function midPoint(pts: Point[]): Point {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  let half = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (half <= seg && seg > 0) {
      const t = half / seg;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
    }
    half -= seg;
  }
  return pts[0];
}

export interface MarkerGeom {
  d: string;
  /** stroke: filled with the line colour. bg: filled with the background. none: open. */
  fill: "stroke" | "bg" | "none";
}

/** Arrowhead drawn at `tip`, pointing away from `from`. */
export function markerGeom(kind: Marker | undefined, tip: Point, from: Point): MarkerGeom | undefined {
  if (!kind || kind === "none") return undefined;
  const a = Math.atan2(tip.y - from.y, tip.x - from.x);
  const p = (len: number, off: number): string => {
    const x = tip.x - Math.cos(a) * len + Math.sin(a) * off;
    const y = tip.y - Math.sin(a) * len - Math.cos(a) * off;
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  };
  switch (kind) {
    case "arrow":
      return { d: `M${p(11, 4.5)}L${p(0, 0)}L${p(11, -4.5)}Z`, fill: "stroke" };
    case "open":
      return { d: `M${p(11, 5)}L${p(0, 0)}L${p(11, -5)}`, fill: "none" };
    case "half":
      return { d: `M${p(11, 5)}L${p(0, 0)}`, fill: "none" };
    case "triangle":
      return { d: `M${p(13, 6)}L${p(0, 0)}L${p(13, -6)}Z`, fill: "bg" };
    case "diamond":
      return { d: `M${p(0, 0)}L${p(8, 4.5)}L${p(16, 0)}L${p(8, -4.5)}Z`, fill: "bg" };
    case "filledDiamond":
      return { d: `M${p(0, 0)}L${p(8, 4.5)}L${p(16, 0)}L${p(8, -4.5)}Z`, fill: "stroke" };
    case "circle":
    case "filledCircle": {
      const cx = tip.x - Math.cos(a) * 4;
      const cy = tip.y - Math.sin(a) * 4;
      return { d: `M${(cx - 4).toFixed(1)} ${cy.toFixed(1)}a4 4 0 1 0 8 0a4 4 0 1 0 -8 0Z`, fill: kind === "circle" ? "bg" : "stroke" };
    }
  }
}

export const dashArray = (line?: "solid" | "dashed" | "dotted") => (line === "dashed" ? "6 4" : line === "dotted" ? "2 4" : undefined);

/** Greedy word wrap using an average glyph width; good enough for labels in exported SVG. */
export function wrapText(text: string, width: number, fontSize = 12): string[] {
  const max = Math.max(4, Math.floor(width / (fontSize * 0.55)));
  const lines: string[] = [];
  let cur = "";
  for (const word of text.split(/\s+/)) {
    if (cur && (cur + " " + word).length > max) {
      lines.push(cur);
      cur = word;
    } else cur = cur ? cur + " " + word : word;
  }
  if (cur) lines.push(cur);
  return lines;
}
