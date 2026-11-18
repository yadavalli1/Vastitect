import type { LayoutEngine, LayoutGraph, LayoutResult } from "@vastitecture/core";

interface ElkNode {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  children?: ElkNode[];
  edges?: { id: string; sources: string[]; targets: string[] }[];
  layoutOptions?: Record<string, string>;
}
export interface ElkLike {
  layout(graph: ElkNode): Promise<ElkNode>;
}

const ALGORITHMS: Record<string, { label: string; options: Record<string, string>; hierarchical: boolean }> = {
  layered: {
    label: "Layered",
    hierarchical: true,
    options: {
      "elk.algorithm": "layered",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.layered.spacing.nodeNodeBetweenLayers": "70",
      "elk.spacing.nodeNode": "45",
      "elk.layered.thoroughness": "3",
    },
  },
  force: { label: "Force", hierarchical: false, options: { "elk.algorithm": "force", "elk.spacing.nodeNode": "70", "elk.force.iterations": "200" } },
  radial: { label: "Radial", hierarchical: false, options: { "elk.algorithm": "radial", "elk.spacing.nodeNode": "50" } },
};

const PADDING = "[top=46,left=24,bottom=24,right=24]";

async function run(elk: ElkLike, graph: LayoutGraph, algorithm: string): Promise<LayoutResult> {
  const alg = ALGORITHMS[algorithm];
  const ids = new Set(graph.nodes.map((n) => n.id));
  const kids = new Map<string, ElkNode[]>();
  const parentOf = new Map<string, string>();
  const nodes = new Map<string, ElkNode>();
  for (const n of graph.nodes) nodes.set(n.id, { id: n.id, width: n.w, height: n.h });
  for (const n of graph.nodes) {
    const p = n.parent && ids.has(n.parent) ? n.parent : "root";
    parentOf.set(n.id, p);
    kids.set(p, [...(kids.get(p) ?? []), nodes.get(n.id)!]);
  }
  for (const [p, children] of kids) {
    const node = nodes.get(p);
    if (!node) continue;
    node.children = children;
    node.layoutOptions = { "elk.padding": PADDING, ...(alg.hierarchical ? {} : alg.options) };
    delete node.width;
    delete node.height;
  }
  const edges = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target);
  const root: ElkNode = {
    id: "root",
    layoutOptions: { ...alg.options, "elk.direction": graph.direction ?? "DOWN", "elk.padding": "[top=20,left=20,bottom=20,right=20]" },
    children: kids.get("root") ?? [],
    edges: [],
  };
  if (alg.hierarchical) root.edges = edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] }));
  else {
    // Non-hierarchical algorithms lay out each container separately; edges are kept only within one container.
    for (const e of edges) {
      const p = parentOf.get(e.source)!;
      if (p !== parentOf.get(e.target)) continue;
      const owner = p === "root" ? root : nodes.get(p)!;
      (owner.edges ??= []).push({ id: e.id, sources: [e.source], targets: [e.target] });
    }
  }
  const out: LayoutResult = {};
  const collect = (n: ElkNode) => {
    for (const c of n.children ?? []) {
      out[c.id] = { x: Math.round(c.x ?? 0), y: Math.round(c.y ?? 0), w: Math.round(c.width ?? 0), h: Math.round(c.height ?? 0) };
      collect(c);
    }
  };
  collect(await elk.layout(root));
  return out;
}

/** ELK-backed layout engines. The caller supplies the ELK instance (worker-backed in the app, bundled in tests). */
export function createElkEngines(elk: ElkLike): LayoutEngine[] {
  return Object.entries(ALGORITHMS).map(([id, a]) => ({
    id,
    label: a.label,
    async layout(graph) {
      if (!graph.nodes.length) return {};
      try {
        return await run(elk, graph, id);
      } catch (err) {
        if (id === "layered") throw err;
        return run(elk, graph, "layered");
      }
    },
  }));
}
