import { makeElement, makeRelationship, makeView, type Element, type Id, type ModelPatch, type Relationship, type Workspace } from "@vastitecture/plugin-sdk";

/** Mermaid node brackets → generic shapes. Longest openers first. */
const SHAPES: [string, string, string][] = [
  ["([", "])", "generic:StartEnd"],
  ["[[", "]]", "generic:Process"],
  ["[(", ")]", "generic:Database"],
  ["((", "))", "generic:RoundedBox"],
  ["{{", "}}", "generic:Decision"],
  ["[/", "/]", "generic:Data"],
  ["[\\", "\\]", "generic:Data"],
  ["(", ")", "generic:RoundedBox"],
  ["[", "]", "generic:Box"],
  ["{", "}", "generic:Decision"],
  [">", "]", "generic:Box"],
];
const SIZE: Record<string, [number, number]> = { "generic:Decision": [130, 90], "generic:Database": [110, 90], "generic:Group": [320, 220] };

/** Parse a node token like  id["Label"]  or  id((Label)). */
function nodeToken(s: string): { id: string; label?: string; type?: string } | undefined {
  const m = /^([\w.-]+)(.*)$/.exec(s.trim());
  if (!m) return undefined;
  const rest = m[2].trim();
  if (!rest) return { id: m[1] };
  for (const [open, close, type] of SHAPES)
    if (rest.startsWith(open) && rest.endsWith(close)) return { id: m[1], label: rest.slice(open.length, rest.length - close.length).replace(/^"|"$/g, "").trim(), type };
  return { id: m[1] };
}

/** Link syntax: a --> b, a -->|text| b, a -- text --> b, a -. text .-> b, a == text ==> b. */
const ARROW = /\s*(<?(?:-->|---|-\.->|-\.-|==>|===|--[ox>]|<-->)(?:\|([^|]*)\|)?|--\s*([^-]+?)\s*-->|-\.\s*([^.]+?)\s*\.->|==\s*([^=]+?)\s*==>)\s*/;

/** Import a Mermaid flowchart (`graph` / `flowchart`) as generic whiteboard shapes; subgraphs become groups. */
export function parseMermaidFlowchart(text: string): ModelPatch {
  const report: string[] = [];
  const elements: Element[] = [];
  const relationships: Relationship[] = [];
  const nodes = new Map<string, Element>();
  const groups: Element[] = [];
  let direction: "DOWN" | "RIGHT" = "DOWN";
  const node = (tok: { id: string; label?: string; type?: string }) => {
    let e = nodes.get(tok.id);
    if (!e) {
      e = makeElement(tok.type ?? "generic:Box", tok.label ?? tok.id, groups.length ? { parent: groups[groups.length - 1].id } : {});
      nodes.set(tok.id, e);
      elements.push(e);
    } else if (tok.label) {
      e.name = tok.label;
      if (tok.type) e.type = tok.type;
    }
    return e;
  };
  for (const [n, raw] of text.replace(/\r/g, "").split("\n").entries()) {
    const line = raw.replace(/%%.*$/, "").trim().replace(/;$/, "");
    if (!line || line.startsWith("```") || /^(classDef|class|style|linkStyle|click)\b/.test(line)) continue;
    const head = /^(graph|flowchart)\s*(TD|TB|BT|LR|RL)?/i.exec(line);
    if (head) {
      direction = /LR|RL/i.test(head[2] ?? "") ? "RIGHT" : "DOWN";
      continue;
    }
    const sg = /^subgraph\s+([\w.-]+)?\s*(?:\[(.*)\])?\s*(.*)$/.exec(line);
    if (sg) {
      const g = makeElement("generic:Group", (sg[2] ?? sg[3] ?? sg[1] ?? "Group").replace(/^"|"$/g, "").trim() || sg[1] || "Group", groups.length ? { parent: groups[groups.length - 1].id } : {});
      elements.push(g);
      if (sg[1]) nodes.set(sg[1], g);
      groups.push(g);
      continue;
    }
    if (line === "end") {
      groups.pop();
      continue;
    }
    // A chain: a --> b -- text --> c, with "&" fan-out.
    const parts: string[] = [];
    const labels: (string | undefined)[] = [];
    const dashed: boolean[] = [];
    let rest = line;
    for (let m; (m = ARROW.exec(rest)); ) {
      parts.push(rest.slice(0, m.index));
      labels.push((m[2] ?? m[3] ?? m[4] ?? m[5])?.trim().replace(/^"|"$/g, ""));
      dashed.push(/\.|---/.test(m[1]) && !m[1].includes(">") ? true : /\./.test(m[1]));
      rest = rest.slice(m.index + m[0].length);
    }
    parts.push(rest);
    const groupsOf = parts.map((p) => p.split("&").map((x) => nodeToken(x)).filter(Boolean) as { id: string }[]);
    if (groupsOf.some((g) => !g.length)) {
      report.push(`Line ${n + 1}: "${line.slice(0, 60)}" was not understood`);
      continue;
    }
    const els = groupsOf.map((g) => g.map((t) => node(t)));
    for (let i = 1; i < els.length; i++)
      for (const a of els[i - 1])
        for (const b of els[i]) relationships.push(makeRelationship(dashed[i - 1] ? "generic:Dashed" : "generic:Arrow", a.id, b.id, labels[i - 1] ? { label: labels[i - 1] } : {}));
  }
  const ids = new Set(elements.map((e) => e.id));
  const view = makeView("generic", "Mermaid flowchart", { viewpoint: "generic:flowchart" });
  view.nodes = elements.map((e) => ({ element: e.id, x: 0, y: 0, w: (SIZE[e.type] ?? [140, 70])[0], h: (SIZE[e.type] ?? [140, 70])[1], ...(e.parent && ids.has(e.parent) ? { parent: e.parent } : {}) }));
  view.edges = relationships.map((r) => ({ relationship: r.id }));
  if (direction === "RIGHT") view.properties.direction = "RIGHT";
  report.unshift(`Mermaid flowchart: ${elements.length} nodes, ${relationships.length} links`);
  return { elements, relationships, views: [view], layout: [view.id], report };
}

const OUT: Record<string, [string, string]> = {
  "generic:StartEnd": ["([", "])"],
  "generic:Decision": ["{", "}"],
  "generic:Database": ["[(", ")]"],
  "generic:Data": ["[/", "/]"],
  "generic:RoundedBox": ["(", ")"],
};

/** Write any view as a Mermaid flowchart. Containers become subgraphs. */
export function writeMermaidFlowchart(ws: Workspace, viewId: Id): string {
  const view = ws.views[viewId];
  const id = new Map<Id, string>(view.nodes.map((n, i) => [n.element, `n${i + 1}`]));
  const kids = new Map<Id | undefined, typeof view.nodes>();
  for (const n of view.nodes) if (ws.elements[n.element]) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n]);
  const q = (s: string) => `"${s.replace(/"/g, "#quot;")}"`;
  const out = [`flowchart ${view.properties.direction === "RIGHT" ? "LR" : "TD"}`];
  const write = (parent: Id | undefined, ind: string) => {
    for (const n of (kids.get(parent) ?? []).sort((a, b) => a.y - b.y || a.x - b.x)) {
      const e = ws.elements[n.element];
      if (kids.has(n.element)) {
        out.push(`${ind}subgraph ${id.get(n.element)} [${q(e.name)}]`);
        write(n.element, ind + "  ");
        out.push(`${ind}end`);
      } else {
        const [o, c] = OUT[e.type] ?? (e.type === "c4:Person" ? ["((", "))"] : e.properties.kind === "Database" ? ["[(", ")]"] : ["[", "]"]);
        out.push(`${ind}${id.get(n.element)}${o}${q(e.name)}${c}`);
      }
    }
  };
  write(undefined, "  ");
  for (const ed of view.edges) {
    const r = ws.relationships[ed.relationship];
    if (!r || !id.has(r.source) || !id.has(r.target)) continue;
    const label = [r.label, r.technology && `[${r.technology}]`].filter(Boolean).join(" ");
    const arrow = r.type === "generic:Dashed" ? "-.->" : r.type === "generic:Line" ? "---" : "-->";
    out.push(`  ${id.get(r.source)} ${arrow}${label ? `|${q(label)}|` : ""} ${id.get(r.target)}`);
  }
  return out.join("\n") + "\n";
}
