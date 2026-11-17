import { describe, expect, it } from "vitest";
import ELK from "elkjs/lib/elk.bundled.js";
import { createElkEngines } from "./index";

const engines = createElkEngines(new ELK());
const overlap = (a: { x: number; y: number; w?: number; h?: number }, b: typeof a) =>
  a.x < b.x + b.w! && b.x < a.x + a.w! && a.y < b.y + b.h! && b.y < a.y + a.h!;

describe("layout", () => {
  it.each(["layered", "force", "radial"])("%s places nodes without overlap", async (id) => {
    const nodes = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, w: 120, h: 60 }));
    const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: `n${Math.floor(i / 2)}`, target: n.id }));
    const r = await engines.find((e) => e.id === id)!.layout({ nodes, edges });
    const placed = Object.values(r);
    expect(placed).toHaveLength(12);
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) expect(overlap(placed[i], placed[j])).toBe(false);
  });

  it("nests children inside their container and sizes the container", async () => {
    const r = await engines[0].layout({
      nodes: [
        { id: "sys", w: 100, h: 100 },
        { id: "a", w: 120, h: 60, parent: "sys" },
        { id: "b", w: 120, h: 60, parent: "sys" },
        { id: "ext", w: 120, h: 60 },
      ],
      edges: [
        { id: "1", source: "a", target: "b" },
        { id: "2", source: "b", target: "ext" },
      ],
    });
    expect(r.sys.w!).toBeGreaterThan(120);
    expect(r.a.x).toBeGreaterThanOrEqual(0);
    expect(r.a.y + 60).toBeLessThanOrEqual(r.sys.h!);
  });

  it("lays out 300 nodes in under a second", async () => {
    const nodes = Array.from({ length: 300 }, (_, i) => ({ id: `n${i}`, w: 140, h: 70 }));
    const edges = Array.from({ length: 400 }, (_, i) => ({ id: `e${i}`, source: `n${(i * 7) % 300}`, target: `n${(i * 13 + 5) % 300}` }));
    await engines[0].layout({ nodes: nodes.slice(0, 5), edges: [] }); // warm up
    const t0 = performance.now();
    const r = await engines[0].layout({ nodes, edges });
    const ms = performance.now() - t0;
    expect(Object.keys(r)).toHaveLength(300);
    console.log(`300 nodes: ${ms.toFixed(0)}ms`);
    expect(ms).toBeLessThan(1000);
  });
});
