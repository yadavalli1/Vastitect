import { emptyWorkspace, makeElement, makeRelationship, makeView, type Workspace } from "./model";

/** A workspace at the size in the performance budget: 5,000 elements and 200 views. */
export function bigWorkspace(elements = 5000, views = 200): Workspace {
  const ws = emptyWorkspace("Big");
  const ids: string[] = [];
  for (let i = 0; i < elements; i++) {
    const e = makeElement(i % 10 === 0 ? "c4:SoftwareSystem" : "c4:Container", `Element ${i}`, { description: `Description of element ${i}`, owner: `Team ${i % 37}`, tags: ["t" + (i % 5)], properties: { technology: "Java", annualCost: i } });
    if (i % 10) e.parent = ids[i - (i % 10)];
    ws.elements[e.id] = e;
    ids.push(e.id);
  }
  for (let i = 1; i < elements; i++) {
    const r = makeRelationship("c4:Uses", ids[i], ids[(i * 7) % elements], { label: "uses" });
    ws.relationships[r.id] = r;
  }
  const rels = Object.values(ws.relationships);
  for (let v = 0; v < views; v++) {
    const nodes = Array.from({ length: 25 }, (_, k) => ({ element: ids[(v * 25 + k) % elements], x: (k % 5) * 200, y: Math.floor(k / 5) * 120, w: 180, h: 90 }));
    const present = new Set(nodes.map((n) => n.element));
    const view = makeView("c4", `View ${v}`, { nodes, edges: rels.filter((r) => present.has(r.source) && present.has(r.target)).map((r) => ({ relationship: r.id })) });
    ws.views[view.id] = view;
  }
  return ws;
}

