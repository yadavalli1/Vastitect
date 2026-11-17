import { XMLParser } from "fast-xml-parser";
import { makeElement, makeRelationship, makeView, type Annotation, type Element, type Id, type ModelPatch, type Relationship, type Workspace } from "@vastitecture/plugin-sdk";
import { inflateRaw } from "./zip";

 
const arr = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
const styleOf = (s: string) => Object.fromEntries(String(s ?? "").split(";").filter(Boolean).map((kv) => (kv.includes("=") ? [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)] : [kv, "1"])));
const plain = (html: unknown) =>
  String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{2,}/g, "\n")
    .trim();

function typeFor(st: Record<string, string>): string {
  const shape = st.shape ?? "";
  if (st.swimlane || st.group || shape === "swimlane" || st.container === "1") return "generic:Group";
  if (/umlActor|actor/.test(shape)) return "generic:Actor";
  if (/cylinder|datastore/.test(shape)) return "generic:Database";
  if (st.rhombus || shape === "rhombus") return "generic:Decision";
  if (/document/.test(shape)) return "generic:Document";
  if (/parallelogram/.test(shape)) return "generic:Data";
  if (/note/.test(shape) || st.sticky) return "generic:Note";
  if (st.image || shape === "image") return "generic:Image";
  if (st.ellipse || shape === "ellipse") return st.rounded === "1" ? "generic:StartEnd" : "generic:RoundedBox";
  if (st.rounded === "1" && Number(st.arcSize ?? 0) >= 40) return "generic:StartEnd";
  if (st.rounded === "1") return "generic:RoundedBox";
  return "generic:Box";
}

/** Decode a diagram's content: a plain mxGraphModel, or draw.io's compressed form (base64 → raw deflate → URI-encoded XML). */
async function graphModel(diagram: any, parser: XMLParser): Promise<any> {
  if (diagram.mxGraphModel) return diagram.mxGraphModel;
  const text = String(diagram["#text"] ?? "").trim();
  if (!text) return undefined;
  const bin = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  const xml = decodeURIComponent(new TextDecoder().decode(await inflateRaw(bin)));
  return parser.parse(xml).mxGraphModel;
}

/** Import draw.io diagrams as generic shapes (ready to Formalise into any notation). One view per page. */
export async function parseDrawio(text: string, fileName = "diagram.drawio"): Promise<ModelPatch> {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", textNodeName: "#text", parseTagValue: false, isArray: (n) => ["diagram", "mxCell", "UserObject", "object"].includes(n) });
  const doc = parser.parse(text);
  const diagrams = doc.mxfile ? arr(doc.mxfile.diagram) : doc.mxGraphModel ? [{ mxGraphModel: doc.mxGraphModel, "@name": fileName.replace(/\.\w+$/, "") }] : [];
  if (!diagrams.length) throw new Error("Not a draw.io file: no <mxfile> or <mxGraphModel>");
  const elements: Element[] = [];
  const relationships: Relationship[] = [];
  const views = [];
  const report: string[] = [];
  for (const [i, d] of diagrams.entries()) {
    const model = await graphModel(d, parser);
    if (!model) continue;
    // Cells may be wrapped in <UserObject label=".."> / <object label="..">.
    const cells: any[] = [];
    const root = model.root ?? {};
    for (const c of arr(root.mxCell)) cells.push(c);
    for (const w of [...arr(root.UserObject), ...arr(root.object)]) for (const c of arr(w.mxCell)) cells.push({ ...c, "@id": w["@id"], "@value": w["@label"] ?? c["@value"], tooltip: w["@tooltip"] });
    const view = makeView("generic", String(d["@name"] ?? `Page ${i + 1}`), { viewpoint: "generic:whiteboard" });
    const byCell = new Map<string, Element>();
    const layers = new Set(cells.filter((c) => !c["@parent"] || (c["@parent"] === "0" && !c["@vertex"] && !c["@edge"])).map((c) => String(c["@id"])));
    const geo = (c: any) => {
      const g = c.mxGeometry ?? {};
      return { x: Number(g["@x"] ?? 0), y: Number(g["@y"] ?? 0), w: Number(g["@width"] ?? 120), h: Number(g["@height"] ?? 60) };
    };
    const vertexIds = new Set(cells.filter((c) => c["@vertex"] === "1").map((c) => String(c["@id"])));
    const edgeLabels = new Map<string, string>();
    for (const c of cells) {
      if (c["@vertex"] !== "1") continue;
      const st = styleOf(c["@style"]);
      const label = plain(c["@value"]);
      const parent = String(c["@parent"] ?? "1");
      if (st.edgeLabel || (!vertexIds.has(parent) && !layers.has(parent))) {
        edgeLabels.set(parent, label);
        continue;
      }
      const g = geo(c);
      if (st.text === "1" || (st.text !== undefined && !label.length) || (st.strokeColor === "none" && st.fillColor === "none")) {
        if (label) view.annotations.push({ id: `a${view.annotations.length}-${String(c["@id"]).replace(/\W/g, "")}`, kind: "text", ...g, text: label } satisfies Annotation);
        continue;
      }
      const e = makeElement(typeFor(st), label || (st.image ? "Image" : "Shape"));
      if (st.image) e.properties.href = st.image;
      if (c.tooltip) e.description = String(c.tooltip);
      e.properties.drawioStyle = String(c["@style"] ?? "");
      byCell.set(String(c["@id"]), e);
      elements.push(e);
      view.nodes.push({ element: e.id, ...g, ...(st.fillColor && /^#/.test(st.fillColor) ? { style: { fill: st.fillColor } } : {}) });
    }
    // Nesting: a vertex whose parent is another vertex sits inside it (draw.io geometry is already parent-relative).
    for (const c of cells) {
      const child = byCell.get(String(c["@id"]));
      const parent = byCell.get(String(c["@parent"]));
      if (child && parent) {
        view.nodes.find((n) => n.element === child.id)!.parent = parent.id;
        child.parent = parent.id;
      }
    }
    let dangling = 0;
    for (const c of cells) {
      if (c["@edge"] !== "1") continue;
      const s = byCell.get(String(c["@source"])), t = byCell.get(String(c["@target"]));
      if (!s || !t) {
        dangling++;
        continue;
      }
      const st = styleOf(c["@style"]);
      const label = plain(c["@value"]) || edgeLabels.get(String(c["@id"]));
      const type = st.endArrow === "none" && !st.startArrow ? "generic:Line" : st.dashed === "1" ? "generic:Dashed" : "generic:Arrow";
      const r = makeRelationship(type, s.id, t.id, label ? { label } : {});
      relationships.push(r);
      const pts = arr(c.mxGeometry?.Array?.mxPoint).map((p: any) => ({ x: Number(p["@x"] ?? 0), y: Number(p["@y"] ?? 0) }));
      view.edges.push({ relationship: r.id, ...(pts.length ? { waypoints: pts } : {}) });
    }
    if (dangling) report.push(`${view.name}: ${dangling} connector(s) not attached to two shapes were skipped`);
    views.push(view);
  }
  report.unshift(`draw.io: ${elements.length} shapes, ${relationships.length} connectors on ${views.length} page(s). Use the Type field (Formalise) to turn shapes into typed elements.`);
  return { elements, relationships, views, report };
}

const STYLE: Record<string, string> = {
  "generic:RoundedBox": "rounded=1;whiteSpace=wrap;html=1;",
  "generic:StartEnd": "rounded=1;arcSize=50;whiteSpace=wrap;html=1;",
  "generic:Decision": "rhombus;whiteSpace=wrap;html=1;",
  "generic:Database": "shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;size=12;",
  "generic:Data": "shape=parallelogram;perimeter=parallelogramPerimeter;whiteSpace=wrap;html=1;",
  "generic:Document": "shape=document;whiteSpace=wrap;html=1;boundedLbl=1;",
  "generic:Note": "shape=note;whiteSpace=wrap;html=1;size=14;",
  "generic:Actor": "shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;",
  "generic:Group": "rounded=0;whiteSpace=wrap;html=1;dashed=1;verticalAlign=top;align=left;spacingLeft=6;container=1;",
  "c4:Person": "shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;",
};
const xesc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\n/g, "&#10;");

/** Export views as an uncompressed draw.io file (one page per view). */
export function writeDrawio(ws: Workspace, viewIds: Id[]): string {
  const pages = viewIds.map((vid) => {
    const v = ws.views[vid];
    const cells: string[] = ['<mxCell id="0" />', '<mxCell id="1" parent="0" />'];
    const cid = (id: Id) => `e-${id}`;
    const containers = new Set(v.nodes.map((n) => n.parent).filter(Boolean));
    const depth = (n: (typeof v.nodes)[number]): number => (n.parent ? 1 + depth(v.nodes.find((x) => x.element === n.parent) ?? { ...n, parent: undefined }) : 0);
    for (const n of [...v.nodes].sort((a, b) => depth(a) - depth(b))) {
      const e = ws.elements[n.element];
      if (!e) continue;
      const kind = typeof e.properties.kind === "string" ? e.properties.kind : "";
      let style = typeof e.properties.drawioStyle === "string" && e.properties.drawioStyle ? e.properties.drawioStyle : STYLE[e.type] ?? (kind === "Database" ? STYLE["generic:Database"] : containers.has(n.element) ? STYLE["generic:Group"] : "rounded=1;whiteSpace=wrap;html=1;");
      if (n.style?.fill) style += `fillColor=${n.style.fill};`;
      const tech = typeof e.properties.technology === "string" ? `\n[${e.properties.technology}]` : "";
      const parentRef = n.parent && v.nodes.some((x) => x.element === n.parent) ? xesc(cid(n.parent)) : "1";
      const geometry = `<mxGeometry x="${Math.round(n.x)}" y="${Math.round(n.y)}" width="${Math.round(n.w)}" height="${Math.round(n.h)}" as="geometry" />`;
      // Descriptions travel as draw.io tooltips, which needs the UserObject wrapper.
      if (e.description) cells.push(`<UserObject label="${xesc(e.name + tech)}" tooltip="${xesc(e.description)}" id="${xesc(cid(n.element))}"><mxCell style="${xesc(style)}" vertex="1" parent="${parentRef}">${geometry}</mxCell></UserObject>`);
      else cells.push(`<mxCell id="${xesc(cid(n.element))}" value="${xesc(e.name + tech)}" style="${xesc(style)}" vertex="1" parent="${parentRef}">${geometry}</mxCell>`);
    }
    for (const a of v.annotations)
      cells.push(`<mxCell id="${xesc("a-" + a.id)}" value="${xesc(a.text ?? "")}" style="${a.kind === "note" ? "shape=note;whiteSpace=wrap;html=1;fillColor=#fff2cc;" : a.kind === "group" ? "rounded=0;whiteSpace=wrap;html=1;dashed=1;fillColor=none;verticalAlign=top;" : "text;html=1;"}" vertex="1" parent="1"><mxGeometry x="${Math.round(a.x)}" y="${Math.round(a.y)}" width="${Math.round(a.w)}" height="${Math.round(a.h)}" as="geometry" /></mxCell>`);
    for (const ed of v.edges) {
      const r = ws.relationships[ed.relationship];
      if (!r || !v.nodes.some((n) => n.element === r.source) || !v.nodes.some((n) => n.element === r.target)) continue;
      const label = [ed.order !== undefined ? `${ed.order}.` : "", r.label ?? "", r.technology ? `[${r.technology}]` : ""].filter(Boolean).join(" ");
      const style = `edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;${r.type === "generic:Dashed" || r.type === "c4:Uses" ? "dashed=1;" : ""}${r.type === "generic:Line" ? "endArrow=none;" : ""}`;
      const pts = ed.waypoints?.length ? `<Array as="points">${ed.waypoints.map((p) => `<mxPoint x="${Math.round(p.x)}" y="${Math.round(p.y)}" />`).join("")}</Array>` : "";
      cells.push(`<mxCell id="${xesc("r-" + r.id)}" value="${xesc(label)}" style="${style}" edge="1" parent="1" source="${xesc(cid(r.source))}" target="${xesc(cid(r.target))}"><mxGeometry relative="1" as="geometry">${pts}</mxGeometry></mxCell>`);
    }
    return `  <diagram id="${xesc(v.id)}" name="${xesc(v.name)}">\n    <mxGraphModel dx="1000" dy="800" grid="1" gridSize="10" guides="1" page="0" math="0" shadow="0">\n      <root>\n        ${cells.join("\n        ")}\n      </root>\n    </mxGraphModel>\n  </diagram>`;
  });
  return `<mxfile host="Vastitecture" type="device">\n${pages.join("\n")}\n</mxfile>\n`;
}
