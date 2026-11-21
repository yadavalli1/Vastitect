/**
 * Vector PDF from the SVG that Vastitecture's own renderer produces. The renderer writes a small, known
 * subset of SVG (rect, path, text and translated groups, with fill, stroke, dash and opacity), so this
 * converts that subset directly into PDF drawing operators: text stays selectable and searchable, and
 * lines stay sharp at any zoom. Text uses the standard Helvetica fonts (no embedding), so characters
 * outside Windows-1252 are replaced with "?".
 */

interface Node {
  tag: string;
  attrs: Record<string, string>;
  children: Node[];
  text: string;
}

/** A tolerant parser for well-formed XML without DTDs: enough for SVG the app itself wrote. */
export function parseXml(src: string): Node {
  const root: Node = { tag: "#root", attrs: {}, children: [], text: "" };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (let m; (m = re.exec(src)); ) {
    const [, close, tag, attrs, selfClose, text] = m;
    const top = stack[stack.length - 1];
    if (text !== undefined) top.text += decode(text);
    else if (!tag) continue;
    else if (close) stack.length > 1 && stack.pop();
    else {
      const n: Node = { tag, attrs: {}, children: [], text: "" };
      for (const a of (attrs ?? "").matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) n.attrs[a[1]] = decode(a[2] ?? a[3] ?? "");
      top.children.push(n);
      if (!selfClose) stack.push(n);
    }
  }
  return root;
}
const decode = (s: string) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) => ({ lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" })[e.toLowerCase()] ?? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));

/* ---------------------------------------------------------------- colours */

const NAMED: Record<string, string> = { black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", gray: "#808080", grey: "#808080", transparent: "none" };
function rgb(c: string | undefined): [number, number, number] | undefined {
  if (!c || c === "none") return undefined;
  const v = NAMED[c.toLowerCase()] ?? c;
  if (v === "none") return undefined;
  let m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m) return [...m[1]].map((h) => parseInt(h + h, 16) / 255) as [number, number, number];
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(v);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16) / 255) as [number, number, number];
  m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(v);
  if (m) return [m[1], m[2], m[3]].map((x) => Number(x) / 255) as [number, number, number];
  return [0, 0, 0];
}
const n = (x: number) => (Math.abs(x) < 1e-6 ? "0" : String(Math.round(x * 1000) / 1000));

/* ---------------------------------------------------------------- paths */

/** SVG path data to PDF operators. Quadratic curves and arcs become cubic Béziers. */
export function pathToPdf(d: string): string {
  const toks = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const out: string[] = [];
  let i = 0, cmd = "", x = 0, y = 0, sx = 0, sy = 0, cx = 0, cy = 0, qx = 0, qy = 0, prev = "";
  const num = () => Number(toks[i++]);
  const more = () => i < toks.length && !/[a-zA-Z]/.test(toks[i]);
  const C = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => out.push(`${n(x1)} ${n(y1)} ${n(x2)} ${n(y2)} ${n(x3)} ${n(y3)} c`);
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case "M":
        (x = ox + num()), (y = oy + num()), (sx = x), (sy = y);
        out.push(`${n(x)} ${n(y)} m`);
        cmd = rel ? "l" : "L"; // further pairs are line-tos
        break;
      case "L":
        (x = ox + num()), (y = oy + num());
        out.push(`${n(x)} ${n(y)} l`);
        break;
      case "H":
        x = ox + num();
        out.push(`${n(x)} ${n(y)} l`);
        break;
      case "V":
        y = oy + num();
        out.push(`${n(x)} ${n(y)} l`);
        break;
      case "C": {
        const [x1, y1, x2, y2, x3, y3] = [ox + num(), oy + num(), ox + num(), oy + num(), ox + num(), oy + num()];
        C(x1, y1, x2, y2, x3, y3);
        (cx = x2), (cy = y2), (x = x3), (y = y3);
        break;
      }
      case "S": {
        const [x1, y1] = /[CS]/i.test(prev) ? [2 * x - cx, 2 * y - cy] : [x, y];
        const [x2, y2, x3, y3] = [ox + num(), oy + num(), ox + num(), oy + num()];
        C(x1, y1, x2, y2, x3, y3);
        (cx = x2), (cy = y2), (x = x3), (y = y3);
        break;
      }
      case "Q":
      case "T": {
        const [px, py] = cmd.toUpperCase() === "Q" ? [ox + num(), oy + num()] : /[QT]/i.test(prev) ? [2 * x - qx, 2 * y - qy] : [x, y];
        const [x3, y3] = [ox + num(), oy + num()];
        C(x + (2 / 3) * (px - x), y + (2 / 3) * (py - y), x3 + (2 / 3) * (px - x3), y3 + (2 / 3) * (py - y3), x3, y3);
        (qx = px), (qy = py), (x = x3), (y = y3);
        break;
      }
      case "A": {
        const [rx, ry, rot, large, sweep, x3, y3] = [num(), num(), num(), num(), num(), ox + num(), oy + num()];
        for (const seg of arcToBeziers(x, y, rx, ry, rot, !!large, !!sweep, x3, y3)) C(...seg);
        (x = x3), (y = y3);
        break;
      }
      case "Z":
        out.push("h");
        (x = sx), (y = sy);
        break;
      default:
        i++; // unknown command: skip a token rather than loop forever
    }
    prev = cmd;
    if (cmd.toUpperCase() === "Z" && more()) cmd = "L";
  }
  return out.join(" ");
}

/** Endpoint-parameterised elliptical arc to cubic Béziers (SVG implementation notes, F.6). */
function arcToBeziers(x1: number, y1: number, rx: number, ry: number, phiDeg: number, large: boolean, sweep: boolean, x2: number, y2: number): [number, number, number, number, number, number][] {
  if ((x1 === x2 && y1 === y2) || !rx || !ry) return [[x1, y1, x2, y2, x2, y2]];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (phiDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) (rx *= Math.sqrt(lambda)), (ry *= Math.sqrt(lambda));
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const segs = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2)));
  const step = dt / segs, k = (4 / 3) * Math.tan(step / 4);
  const pt = (t: number) => [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  const der = (t: number) => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos];
  const out: [number, number, number, number, number, number][] = [];
  for (let s = 0, t = t1; s < segs; s++, t += step) {
    const [ax, ay] = pt(t), [bx, by] = pt(t + step), [dax, day] = der(t), [dbx, dby] = der(t + step);
    out.push([ax + k * dax, ay + k * day, bx - k * dbx, by - k * dby, bx, by]);
  }
  return out;
}

/* ---------------------------------------------------------------- text */

/** Helvetica and Helvetica-Bold advance widths (1/1000 em) for ASCII 32–126, from the standard AFM files. */
const HELV = "278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584".split(",").map(Number);
const HELVB = "278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584".split(",").map(Number);
export function textWidth(s: string, size: number, bold = false) {
  const w = bold ? HELVB : HELV;
  let total = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    total += c >= 32 && c <= 126 ? w[c - 32] : 556;
  }
  return (total * size) / 1000;
}
/** Windows-1252 bytes as a PDF literal string; anything else becomes "?". */
const CP1252: Record<number, number> = { 0x20ac: 0x80, 0x201a: 0x82, 0x192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x2c6: 0x88, 0x2030: 0x89, 0x160: 0x8a, 0x2039: 0x8b, 0x152: 0x8c, 0x17d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2dc: 0x98, 0x2122: 0x99, 0x161: 0x9a, 0x203a: 0x9b, 0x153: 0x9c, 0x17e: 0x9e, 0x178: 0x9f };
function pdfText(s: string): string {
  let out = "(";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    const b = c < 0x80 || (c >= 0xa0 && c <= 0xff) ? c : CP1252[c] ?? 0x3f;
    out += b === 0x28 || b === 0x29 || b === 0x5c ? "\\" + String.fromCharCode(b) : b < 0x20 || b > 0x7e ? "\\" + b.toString(8).padStart(3, "0") : String.fromCharCode(b);
  }
  return out + ")";
}

/* ---------------------------------------------------------------- page */

export interface VectorPage {
  width: number;
  height: number;
  /** PDF content stream operators. */
  content: string;
  /** Opacity values that need an ExtGState, named /GA0, /GA1, … in order. */
  alphas: number[];
}

/** Convert one SVG (as written by the renderer) into a PDF page of the same size in points. */
export function svgToPdfPage(svg: string): VectorPage {
  const root = parseXml(svg).children.find((c) => c.tag === "svg");
  if (!root) throw new Error("Not an SVG document");
  const [vx, vy, vw, vh] = (root.attrs.viewBox ?? `0 0 ${root.attrs.width ?? 800} ${root.attrs.height ?? 600}`).split(/[\s,]+/).map(Number);
  const width = Number(root.attrs.width) || vw, height = Number(root.attrs.height) || vh;
  const alphas: number[] = [];
  const gs = (a: number) => {
    const k = Math.round(a * 100) / 100;
    let idx = alphas.indexOf(k);
    if (idx < 0) idx = alphas.push(k) - 1;
    return `/GA${idx} gs`;
  };
  const ops: string[] = [`1 0 0 -1 0 ${n(height)} cm`, `${n(width / vw)} 0 0 ${n(height / vh)} ${n(-vx * (width / vw))} ${n(-vy * (height / vh))} cm`];
  const paint = (a: Record<string, string>, inherited: Record<string, string>, geometry: string) => {
    const get = (k: string) => a[k] ?? inherited[k];
    const fill = rgb(get("fill") ?? "#000000");
    const stroke = rgb(get("stroke"));
    if (!fill && !stroke) return;
    const parts = ["q"];
    const fo = Number(get("fill-opacity") ?? get("opacity") ?? 1), so = Number(get("stroke-opacity") ?? get("opacity") ?? 1);
    if (fill && fo < 1) parts.push(gs(fo));
    if (fill) parts.push(`${fill.map(n).join(" ")} rg`);
    if (stroke) parts.push(`${stroke.map(n).join(" ")} RG`, `${n(Number(get("stroke-width") ?? 1))} w`, "1 j");
    const dash = get("stroke-dasharray");
    if (stroke && dash && dash !== "none") parts.push(`[${dash.split(/[\s,]+/).map(Number).map(n).join(" ")}] 0 d`);
    parts.push(geometry, fill && stroke ? "B" : fill ? "f" : "S", "Q");
    // Stroke opacity below one gets its own pass so it does not change the fill.
    if (stroke && so < 1 && !fill) parts.splice(1, 0, gs(so));
    ops.push(parts.join(" "));
  };
  const walk = (node: Node, inherited: Record<string, string>) => {
    const a = node.attrs;
    const style: Record<string, string> = Object.fromEntries((a.style ?? "").split(";").map((p) => p.split(":").map((x) => x.trim())).filter((p) => p.length === 2 && p[0]));
    const own: Record<string, string> = { ...a, ...style };
    const inh: Record<string, string> = { ...inherited, ...Object.fromEntries(Object.entries(own).filter(([k]) => /^(fill|stroke|stroke-width|stroke-dasharray|fill-opacity|font-size|font-weight|text-anchor|opacity)$/.test(k))) };
    switch (node.tag) {
      case "g": {
        const m = /translate\(\s*(-?[\d.e-]+)[\s,]+(-?[\d.e-]+)\s*\)/.exec(a.transform ?? "");
        ops.push("q" + (m ? ` 1 0 0 1 ${n(Number(m[1]))} ${n(Number(m[2]))} cm` : ""));
        for (const c of node.children) walk(c, inh);
        ops.push("Q");
        break;
      }
      case "rect": {
        const [x, y, w, h] = ["x", "y", "width", "height"].map((k) => Number(a[k] ?? 0));
        const r = Math.min(Number(a.rx ?? a.ry ?? 0), w / 2, h / 2);
        const geo = r > 0 ? pathToPdf(`M${x + r} ${y} H${x + w - r} A${r} ${r} 0 0 1 ${x + w} ${y + r} V${y + h - r} A${r} ${r} 0 0 1 ${x + w - r} ${y + h} H${x + r} A${r} ${r} 0 0 1 ${x} ${y + h - r} V${y + r} A${r} ${r} 0 0 1 ${x + r} ${y} Z`) : `${n(x)} ${n(y)} ${n(w)} ${n(h)} re`;
        paint(own, inherited, geo);
        break;
      }
      case "path":
        if (a.d) paint(own, inherited, pathToPdf(a.d));
        break;
      case "line":
        paint({ ...own, fill: "none" }, inherited, `${n(Number(a.x1))} ${n(Number(a.y1))} m ${n(Number(a.x2))} ${n(Number(a.y2))} l`);
        break;
      case "circle":
      case "ellipse": {
        const [cx, cy] = [Number(a.cx ?? 0), Number(a.cy ?? 0)];
        const [rx, ry] = node.tag === "circle" ? [Number(a.r), Number(a.r)] : [Number(a.rx), Number(a.ry)];
        paint(own, inherited, pathToPdf(`M${cx - rx} ${cy} A${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`));
        break;
      }
      case "text": {
        const text = (node.text + node.children.map((c) => c.text).join("")).replace(/\s+/g, " ").trim();
        if (!text) break;
        const size = Number(inh["font-size"] ?? 12);
        const bold = /^(bold|[6-9]00)$/.test(String(inh["font-weight"] ?? ""));
        const anchor = inh["text-anchor"] ?? "start";
        const w = textWidth(text, size, bold);
        const x = Number(a.x ?? 0) - (anchor === "middle" ? w / 2 : anchor === "end" ? w : 0);
        const fill = rgb(inh.fill ?? "#000000") ?? [0, 0, 0];
        const fo = Number(inh["fill-opacity"] ?? inh.opacity ?? 1);
        ops.push(`q${fo < 1 ? ` ${gs(fo)}` : ""} ${fill.map(n).join(" ")} rg BT /${bold ? "F2" : "F1"} ${n(size)} Tf 1 0 0 -1 ${n(x)} ${n(Number(a.y ?? 0))} Tm ${pdfText(text)} Tj ET Q`);
        break;
      }
      case "svg":
      case "#root":
        for (const c of node.children) walk(c, inh);
        break;
      default:
        break; // title, desc, defs: nothing to draw
    }
  };
  for (const c of root.children) walk(c, { fill: "#000000" });
  return { width, height, content: ops.join("\n"), alphas };
}

/** Write vector pages into one PDF. Each page keeps the drawing's size, scaled down to fit A3 if larger. */
export function writeVectorPdf(pages: VectorPage[], info: { title?: string } = {}): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (s: string) => {
    const b = enc.encode(s);
    chunks.push(b);
    size += b.length;
  };
  const obj = (id: number, body: string) => {
    offsets[id] = size;
    push(`${id} 0 obj\n${body}\nendobj\n`);
  };
  const latin = (s: string) => pdfText(s);
  // Built at run time: see pdf.ts on why the signature must not appear literally in the bundle.
  push(["%", "PDF-1.4"].join("") + "\n%âã\n");
  const pageIds = pages.map((_, i) => 6 + i * 2);
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  obj(3, `<< /Producer (Vastitecture)${info.title ? ` /Title ${latin(info.title)}` : ""} >>`);
  obj(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  obj(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  pages.forEach((p, i) => {
    const id = pageIds[i];
    // Fit within A3 landscape (1191 x 842 pt) with a margin, never enlarging.
    const scale = Math.min(1, 1151 / p.width, 802 / p.height);
    const w = p.width * scale + 40, h = p.height * scale + 40;
    const content = `q 1 0 0 1 20 20 cm ${n(scale)} 0 0 ${n(scale)} 0 0 cm\n${p.content}\nQ`;
    const ext = p.alphas.length ? ` /ExtGState << ${p.alphas.map((a, k) => `/GA${k} << /ca ${n(a)} /CA ${n(a)} >>`).join(" ")} >>` : "";
    obj(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(w)} ${n(h)}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >>${ext} >> /Contents ${id + 1} 0 R >>`);
    obj(id + 1, `<< /Length ${enc.encode(content).length} >>\nstream\n${content}\nendstream`);
  });
  const total = 6 + pages.length * 2;
  const xref = size;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let k = 1; k < total; k++) push(`${String(offsets[k] ?? 0).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n${["%%", "EOF"].join("")}\n`);
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) out.set(c, at), (at += c.length);
  return out;
}
