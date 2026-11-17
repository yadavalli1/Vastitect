import { impliedRelationships, presentationType, resolveLook, type Registry, type View, type ViewNode, type Workspace } from "@vastitecture/core";
import { dashArray, edgePoints, markerGeom, midPoint, pointsToPath, shapeGeom, wrapText, type Rect } from "./shapes";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface SvgTheme {
  background: string;
  stroke: string;
  text: string;
  fill: string;
  muted: string;
}
export const LIGHT: SvgTheme = { background: "#ffffff", stroke: "#334155", text: "#0f172a", fill: "#f8fafc", muted: "#64748b" };
export const DARK: SvgTheme = { background: "#0f172a", stroke: "#cbd5e1", text: "#f1f5f9", fill: "#1e293b", muted: "#94a3b8" };

/** Absolute rectangles for every node (stored positions are relative to the visual parent). */
export function absoluteRects(view: View): Map<string, Rect> {
  const byId = new Map(view.nodes.map((n) => [n.element, n]));
  const out = new Map<string, Rect>();
  const abs = (n: ViewNode, depth = 0): Rect => {
    const done = out.get(n.element);
    if (done) return done;
    const p = n.parent && depth < 50 ? byId.get(n.parent) : undefined;
    const base = p ? abs(p, depth + 1) : { x: 0, y: 0 };
    const r = { x: base.x + n.x, y: base.y + n.y, w: n.w, h: n.h };
    out.set(n.element, r);
    return r;
  };
  for (const n of view.nodes) abs(n);
  return out;
}

/** Elements hidden because an ancestor node is collapsed. */
export function hiddenNodes(view: View): Set<string> {
  const byId = new Map(view.nodes.map((n) => [n.element, n]));
  const hidden = new Set<string>();
  for (const n of view.nodes) {
    for (let p = n.parent && byId.get(n.parent), i = 0; p && i < 50; p = p.parent && byId.get(p.parent), i++) {
      if (p.collapsed) {
        hidden.add(n.element);
        break;
      }
    }
  }
  return hidden;
}

/** Render a view to a standalone SVG document straight from the model. */
export function viewToSvg(ws: Workspace, view: View, reg: Registry, theme: SvgTheme = LIGHT): string {
  const rects = absoluteRects(view);
  const hidden = hiddenNodes(view);
  const depth = (n: ViewNode): number => (n.parent && rects.has(n.parent) ? 1 + depth(view.nodes.find((x) => x.element === n.parent)!) : 0);
  const nodes = view.nodes.filter((n) => !hidden.has(n.element) && ws.elements[n.element]).sort((a, b) => depth(a) - depth(b));
  const body: string[] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (r: Rect) => {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  };

  for (const a of view.annotations) {
    grow(a);
    const fill = a.kind === "note" ? "#fde68a" : "none";
    if (a.kind !== "text") body.push(`<rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" rx="4" fill="${fill}" stroke="${theme.muted}"${a.kind === "group" ? ' stroke-dasharray="6 4"' : ""}/>`);
    wrapText(a.text ?? "", a.w - 12).forEach((line, i) =>
      body.push(`<text x="${a.x + 8}" y="${a.y + 18 + i * 15}" font-size="12" fill="${a.kind === "note" ? "#1f2937" : theme.text}">${esc(line)}</text>`),
    );
  }

  for (const n of nodes) {
    const el = ws.elements[n.element];
    const def = reg.elementType(presentationType(ws, el, view.notation, reg) ?? el.type) ?? reg.elementType(el.type);
    const r = rects.get(n.element)!;
    grow(r);
    const look = resolveLook(def, el.properties);
    const g = shapeGeom(look.shape, r.w, r.h);
    const fill = String(n.style?.fill ?? look.fill ?? theme.fill);
    const dark = look.fill || n.style?.fill ? "#0f172a" : theme.text;
    body.push(`<g transform="translate(${r.x} ${r.y})" role="img" aria-label="${esc(`${def?.name ?? el.type}: ${el.name}`)}">`);
    for (const p of g.parts) {
      if (p.role === "body") body.push(`<path d="${p.d}" fill="${g.dashed ? "none" : fill}" stroke="${theme.stroke}" stroke-width="1.5"${g.dashed ? ' stroke-dasharray="6 4"' : ""}/>`);
      else if (p.role === "detail") body.push(`<path d="${p.d}" fill="none" stroke="${theme.stroke}" stroke-width="1.5"/>`);
      else body.push(`<path d="${p.d}" fill="#000" fill-opacity="0.15"/>`);
    }
    const isContainer = g.top || def?.container === true || view.nodes.some((k) => k.parent === n.element && !hidden.has(k.element));
    const lines = wrapText(el.name, g.label.w, 13);
    const badge = look.badge ? `[${look.badge}${typeof el.properties.technology === "string" && el.properties.technology ? ": " + el.properties.technology : ""}]` : "";
    const total = lines.length * 16 + (badge ? 13 : 0);
    const y0 = isContainer ? g.label.y + 14 : g.label.y + g.label.h / 2 - total / 2 + 12;
    const anchor = isContainer ? "start" : "middle";
    const x = isContainer ? g.label.x : g.label.x + g.label.w / 2;
    const textFill = g.dashed ? theme.text : dark;
    lines.forEach((line, i) => body.push(`<text x="${x}" y="${y0 + i * 16}" text-anchor="${anchor}" font-size="13" font-weight="600" fill="${textFill}">${esc(line)}</text>`));
    if (badge) body.push(`<text x="${x}" y="${y0 + lines.length * 16}" text-anchor="${anchor}" font-size="10" fill="${textFill}" fill-opacity="0.75">${esc(badge)}</text>`);
    body.push("</g>");
  }

  const visible = new Set(nodes.map((n) => n.element));
  const drawEdge = (s: string, t: string, label: string | undefined, typeId: string | undefined, waypoints?: { x: number; y: number }[], implied = false) => {
    const sr = rects.get(s);
    const tr = rects.get(t);
    if (!sr || !tr || !visible.has(s) || !visible.has(t)) return;
    const def = typeId ? reg.relationshipType(typeId) : undefined;
    const pts = edgePoints(sr, tr, waypoints);
    const dash = implied ? "2 4" : dashArray(def?.line);
    body.push(`<path d="${pointsToPath(pts)}" fill="none" stroke="${theme.stroke}" stroke-width="1.3"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`);
    for (const [kind, tip, from] of [
      [def?.targetMarker ?? "arrow", pts[pts.length - 1], pts[pts.length - 2]],
      [def?.sourceMarker, pts[0], pts[1]],
    ] as const) {
      const m = markerGeom(kind, tip, from);
      if (m) body.push(`<path d="${m.d}" fill="${m.fill === "stroke" ? theme.stroke : m.fill === "bg" ? theme.background : "none"}" stroke="${theme.stroke}" stroke-width="1.3"/>`);
    }
    if (label) {
      const m = midPoint(pts);
      const w = label.length * 6 + 8;
      body.push(`<rect x="${m.x - w / 2}" y="${m.y - 9}" width="${w}" height="16" fill="${theme.background}" fill-opacity="0.85"/>`);
      body.push(`<text x="${m.x}" y="${m.y + 3}" text-anchor="middle" font-size="11" fill="${theme.text}">${esc(label)}</text>`);
    }
  };
  for (const e of view.edges) {
    const r = ws.relationships[e.relationship];
    if (!r || e.hidden) continue;
    const inside = (c: string, a: string) => {
      for (let p = view.nodes.find((n) => n.element === c)?.parent, i = 0; p && i < 50; p = view.nodes.find((n) => n.element === p)?.parent, i++) if (p === a) return true;
      return false;
    };
    if (inside(r.source, r.target) || inside(r.target, r.source)) continue;
    const text = [e.order !== undefined ? `${e.order}.` : "", r.label ?? "", r.technology ? `[${r.technology}]` : ""].filter(Boolean).join(" ");
    drawEdge(r.source, r.target, text || undefined, r.type, e.waypoints);
  }
  if (view.properties.showImplied !== false)
    for (const i of impliedRelationships(ws, view, reg, visible)) drawEdge(i.source, i.target, undefined, undefined, undefined, true);

  if (minX === Infinity) [minX, minY, maxX, maxY] = [0, 0, 200, 100];
  const pad = 24;
  const w = maxX - minX + pad * 2;
  const h = maxY - minY + pad * 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${minX - pad} ${minY - pad} ${w} ${h}" font-family="Inter, system-ui, sans-serif">` +
    `<title>${esc(view.name)}</title><rect x="${minX - pad}" y="${minY - pad}" width="${w}" height="${h}" fill="${theme.background}"/>` +
    body.join("") +
    "</svg>\n"
  );
}
