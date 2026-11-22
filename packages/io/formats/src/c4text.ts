import { makeElement, makeRelationship, makeView, type Element, type Id, type ModelPatch, type Relationship, type Workspace } from "@vastitecture/plugin-sdk";

/**
 * Mermaid C4 diagrams and C4-PlantUML share one macro language:
 *   Person(alias, "Label", "Description")  System_Ext(...)  Container(alias, "Label", "Tech", "Descr")
 *   System_Boundary(alias, "Label") { ... }  Rel(from, to, "Label", "Tech")
 */
const MACROS: Record<string, { type: string; external?: boolean; db?: boolean; queue?: boolean; tech: boolean }> = {
  person: { type: "c4:Person", tech: false },
  person_ext: { type: "c4:Person", external: true, tech: false },
  system: { type: "c4:SoftwareSystem", tech: false },
  system_ext: { type: "c4:SoftwareSystem", external: true, tech: false },
  systemdb: { type: "c4:SoftwareSystem", tech: false },
  systemdb_ext: { type: "c4:SoftwareSystem", external: true, tech: false },
  systemqueue: { type: "c4:SoftwareSystem", tech: false },
  systemqueue_ext: { type: "c4:SoftwareSystem", external: true, tech: false },
  container: { type: "c4:Container", tech: true },
  container_ext: { type: "c4:Container", external: true, tech: true },
  containerdb: { type: "c4:Container", db: true, tech: true },
  containerdb_ext: { type: "c4:Container", db: true, external: true, tech: true },
  containerqueue: { type: "c4:Container", queue: true, tech: true },
  containerqueue_ext: { type: "c4:Container", queue: true, external: true, tech: true },
  component: { type: "c4:Component", tech: true },
  component_ext: { type: "c4:Component", external: true, tech: true },
  componentdb: { type: "c4:Component", db: true, tech: true },
  componentqueue: { type: "c4:Component", queue: true, tech: true },
  deployment_node: { type: "c4:DeploymentNode", tech: true },
  node: { type: "c4:DeploymentNode", tech: true },
  node_l: { type: "c4:DeploymentNode", tech: true },
  node_r: { type: "c4:DeploymentNode", tech: true },
};
const BOUNDARY = /^(system_boundary|container_boundary|enterprise_boundary|boundary)$/;
const REL = /^(rel|birel|rel_u|rel_up|rel_d|rel_down|rel_l|rel_left|rel_r|rel_right|rel_back|rel_neighbor|birel_u|birel_d|birel_l|birel_r)$/;
const VIEWPOINT: Record<string, string> = { c4context: "c4:context", c4container: "c4:container", c4component: "c4:component", c4dynamic: "c4:dynamic", c4deployment: "c4:deployment" };

/** Split macro arguments, honouring quotes and $named="args". */
function args(s: string): { pos: string[]; named: Record<string, string> } {
  const pos: string[] = [];
  const named: Record<string, string> = {};
  const re = /\s*(?:\$(\w+)\s*=\s*)?(?:"((?:[^"\\]|\\.)*)"|([^,]*))\s*(?:,|$)/g;
  for (let m; (m = re.exec(s)) && m[0]; ) {
    const v = (m[2] ?? m[3] ?? "").trim().replace(/\\"/g, '"').replace(/\\n|<br\s*\/?>/g, " ").replace(/\s+/g, " ").trim();
    if (m[1]) named[m[1].toLowerCase()] = v;
    else pos.push(v);
  }
  return { pos, named };
}

export function parseC4Text(text: string, source: "mermaid" | "plantuml"): ModelPatch {
  const report: string[] = [];
  const elements: Element[] = [];
  const relationships: Relationship[] = [];
  const byAlias = new Map<string, Element>();
  const stack: (Element | undefined)[] = [];
  let viewpoint = "c4:context";
  let title: string | undefined;
  const lines = text.replace(/\r/g, "").replace(/<U\+0025>/gi, "%").split("\n");
  // A Mermaid code fence or a PlantUML wrapper is fine.
  for (const [n, raw] of lines.entries()) {
    const line = raw.replace(/'.*$|%%.*$/, (m) => (m.startsWith("'") && source === "plantuml") || m.startsWith("%%") ? "" : m).trim();
    if (!line || /^(```|@startuml|@enduml|!include|!define|LAYOUT_|SHOW_|HIDE_|UpdateElementStyle|UpdateRelStyle|UpdateLayoutConfig|AddElementTag|AddRelTag|skinparam)/i.test(line)) continue;
    if (VIEWPOINT[line.toLowerCase()]) {
      viewpoint = VIEWPOINT[line.toLowerCase()];
      continue;
    }
    const t = /^title\s+(.+)$/i.exec(line);
    if (t) {
      title = t[1].trim();
      continue;
    }
    if (line === "}") {
      stack.pop();
      continue;
    }
    const m = /^([A-Za-z_]+)\s*\((.*)\)\s*(\{)?\s*$/.exec(line);
    if (!m) {
      if (line !== "{") report.push(`Line ${n + 1}: "${line.slice(0, 60)}" was not understood`);
      continue;
    }
    const kw = m[1].toLowerCase();
    const a = args(m[2]);
    const parent = stack[stack.length - 1];
    if (BOUNDARY.test(kw)) {
      const [alias, label] = a.pos;
      // A boundary around containers stands for the system that contains them.
      const existing = byAlias.get(alias);
      const el = existing ?? makeElement(kw === "container_boundary" ? "c4:Container" : kw === "enterprise_boundary" ? "generic:Group" : "c4:SoftwareSystem", label || alias, parent ? { parent: parent.id } : {});
      if (!existing) {
        elements.push(el);
        byAlias.set(alias, el);
      }
      if (m[3]) stack.push(el);
      continue;
    }
    if (REL.test(kw)) {
      const [from, to, label, tech] = a.pos;
      const s = byAlias.get(from), d = byAlias.get(to);
      if (!s || !d) {
        report.push(`Line ${n + 1}: relationship skipped, unknown alias "${!s ? from : to}"`);
        continue;
      }
      const [src, dst] = kw === "rel_back" ? [d, s] : [s, d];
      const r = makeRelationship("c4:Uses", src.id, dst.id, { ...(label ? { label } : {}), ...((tech || a.named.techn) ? { technology: tech || a.named.techn } : {}) });
      relationships.push(r);
      if (kw.startsWith("birel")) relationships.push(makeRelationship("c4:Uses", dst.id, src.id, label ? { label } : {}));
      continue;
    }
    const def = MACROS[kw];
    if (!def) {
      report.push(`Line ${n + 1}: ${m[1]} is not supported`);
      continue;
    }
    const [alias, label, third, fourth] = a.pos;
    const el = makeElement(def.type, label || alias, parent ? { parent: parent.id } : {});
    const descr = def.tech ? fourth ?? a.named.descr : third ?? a.named.descr;
    const tech = def.tech ? third ?? a.named.techn : undefined;
    if (descr) el.description = descr;
    if (tech) el.properties.technology = tech;
    if (def.external) el.properties.location = "External";
    if (def.db && def.type === "c4:Container") el.properties.kind = "Database";
    if (def.queue && def.type === "c4:Container") el.properties.kind = "Queue";
    if (a.named.tags) el.tags = a.named.tags.split(/[+,]/).map((x) => x.trim()).filter(Boolean);
    elements.push(el);
    byAlias.set(alias, el);
    if (m[3]) stack.push(el);
  }
  const ids = new Set(elements.map((e) => e.id));
  const view = makeView("c4", title ?? (source === "mermaid" ? "Mermaid diagram" : "PlantUML diagram"), { viewpoint });
  const size: Record<string, [number, number]> = { "c4:Person": [150, 150], "c4:SoftwareSystem": [200, 110], "c4:Container": [190, 110], "c4:Component": [180, 100], "c4:DeploymentNode": [340, 220] };
  view.nodes = elements.map((e) => ({ element: e.id, x: 0, y: 0, w: (size[e.type] ?? [160, 80])[0], h: (size[e.type] ?? [160, 80])[1], ...(e.parent && ids.has(e.parent) ? { parent: e.parent } : {}) }));
  view.edges = relationships.map((r, i) => ({ relationship: r.id, ...(viewpoint === "c4:dynamic" ? { order: i + 1 } : {}) }));
  const boundary = elements.find((e) => view.nodes.some((n) => n.parent === e.id) && e.type !== "generic:Group");
  if (boundary && (viewpoint === "c4:container" || viewpoint === "c4:component")) view.subject = boundary.id;
  report.unshift(`${source === "mermaid" ? "Mermaid C4" : "C4-PlantUML"}: ${elements.length} elements, ${relationships.length} relationships`);
  return { elements, relationships, views: [view], layout: [view.id], report };
}

const MACRO_OUT: Record<string, string> = { "c4:Person": "Person", "c4:SoftwareSystem": "System", "c4:Container": "Container", "c4:Component": "Component", "c4:DeploymentNode": "Deployment_Node", "c4:InfrastructureNode": "Deployment_Node" };
const HEADER: Record<string, string> = { "c4:landscape": "C4Context", "c4:context": "C4Context", "c4:container": "C4Container", "c4:component": "C4Component", "c4:dynamic": "C4Dynamic", "c4:deployment": "C4Deployment" };
const INCLUDE: Record<string, string> = { C4Context: "C4_Context", C4Container: "C4_Container", C4Component: "C4_Component", C4Dynamic: "C4_Dynamic", C4Deployment: "C4_Deployment" };

/** Write one view as a Mermaid C4 diagram or a C4-PlantUML file. */
export function writeC4Text(ws: Workspace, viewId: Id, target: "mermaid" | "plantuml", typeOf: (e: Element) => string | undefined): string {
  const view = ws.views[viewId];
  // Model text never starts a new line (so it cannot add `!include ...`), and for PlantUML a `%` cannot
  // call a preprocessor function such as `%getenv(...)`: it is written as a Unicode escape that renders the same.
  const text = (s: string | undefined) => {
    const t = (s ?? "").replace(/[\r\n\u000b\u000c\u0085\u2028\u2029]+/g, " ");
    return target === "plantuml" ? t.replace(/%/g, "<U+0025>") : t;
  };
  const q = (s: string | undefined) => `"${text(s).replace(/"/g, "'")}"`;
  const alias = new Map<Id, string>();
  const used = new Set<string>();
  for (const n of view.nodes) {
    const base = (ws.elements[n.element]?.name ?? "e").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").toLowerCase() || "e";
    let a = /^\d/.test(base) ? "e_" + base : base;
    for (let i = 2; used.has(a); i++) a = `${base}_${i}`;
    used.add(a);
    alias.set(n.element, a);
  }
  const kids = new Map<Id | undefined, typeof view.nodes>();
  for (const n of view.nodes) if (ws.elements[n.element]) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n]);
  const header = HEADER[view.viewpoint ?? ""] ?? "C4Context";
  const out: string[] = target === "mermaid" ? [header, `    title ${text(view.name)}`, ""] : ["@startuml", `!include <C4/${INCLUDE[header]}>`, "", `title ${text(view.name)}`, ""];
  const write = (parent: Id | undefined, depth: number) => {
    for (const n of (kids.get(parent) ?? []).sort((a, b) => a.y - b.y || a.x - b.x)) {
      const e = ws.elements[n.element];
      const t = typeOf(e) ?? "c4:SoftwareSystem";
      const ind = "    ".repeat(depth);
      const inner = kids.has(n.element);
      if (inner) {
        const kw = t === "c4:DeploymentNode" ? "Deployment_Node" : t === "c4:Container" ? "Container_Boundary" : t === "generic:Group" ? "Enterprise_Boundary" : "System_Boundary";
        const extra = kw === "Deployment_Node" && e.properties.technology ? `, ${q(String(e.properties.technology))}` : "";
        out.push(`${ind}${kw}(${alias.get(n.element)}, ${q(e.name)}${extra}) {`);
        write(n.element, depth + 1);
        out.push(`${ind}}`);
        continue;
      }
      let macro = MACRO_OUT[t] ?? "System";
      if (e.properties.kind === "Database" && (macro === "Container" || macro === "System" || macro === "Component")) macro += "Db";
      else if (e.properties.kind === "Queue" && (macro === "Container" || macro === "System" || macro === "Component")) macro += "Queue";
      if (e.properties.location === "External" && macro !== "Deployment_Node") macro += "_Ext";
      const tech = typeof e.properties.technology === "string" ? e.properties.technology : "";
      const withTech = ["Container", "Component", "Deployment_Node"].some((p) => macro.startsWith(p));
      out.push(`${ind}${macro}(${alias.get(n.element)}, ${q(e.name)}${withTech ? `, ${q(tech)}` : ""}${e.description ? `, ${q(e.description)}` : ""})`);
    }
  };
  write(undefined, target === "mermaid" ? 1 : 0);
  out.push("");
  const ordered = [...view.edges].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const ed of ordered) {
    const r = ws.relationships[ed.relationship];
    if (!r || !alias.has(r.source) || !alias.has(r.target)) continue;
    out.push(`${target === "mermaid" ? "    " : ""}Rel(${alias.get(r.source)}, ${alias.get(r.target)}, ${q(r.label ?? "")}${r.technology ? `, ${q(r.technology)}` : ""})`);
  }
  if (target === "plantuml") out.push("", "@enduml");
  return out.join("\n") + "\n";
}
