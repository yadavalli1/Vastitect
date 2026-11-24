import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkRules, comparePlateaus, dataExposure, fromFiles, toFiles, validate, type Registry, type Workspace } from "@vastitecture/core";
import { SAMPLES } from "@vastitecture/samples";
import { createRegistry, run } from "./cli";

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("industry samples", () => {
  let reg: Registry;
  const get = async () => (reg ??= await createRegistry());

  it("offers one sample per industry, each with a unique id", () => {
    expect(SAMPLES.map((s) => s.id)).toEqual(["retail", "banking", "insurance", "healthcare", "manufacturing", "telecom"]);
  });

  for (const sample of SAMPLES)
    describe(sample.industry, () => {
      const ws: Workspace = sample.build();

      it("uses only element, relationship and viewpoint types the app knows", async () => {
        const r = await get();
        for (const e of Object.values(ws.elements)) expect(r.elementType(e.type), `${e.name}: ${e.type}`).toBeDefined();
        for (const rel of Object.values(ws.relationships)) expect(r.relationshipType(rel.type), rel.type).toBeDefined();
        for (const v of Object.values(ws.views)) expect(r.viewpoint(v.notation, v.viewpoint), `${v.name}: ${v.viewpoint}`).toBeDefined();
      });

      it("is shown in every notation, with decisions, rules and portfolio data", () => {
        const notations = new Set(Object.values(ws.views).map((v) => v.notation));
        for (const n of ["c4", "archimate", "ddd", "togaf"]) expect(notations, n).toContain(n);
        expect(Object.keys(ws.adrs).length).toBeGreaterThanOrEqual(2);
        const systems = Object.values(ws.elements).filter((e) => e.type === "c4:SoftwareSystem");
        expect(systems.length).toBeGreaterThanOrEqual(6);
        // a migration in flight: something phasing out and its successor coming in
        expect(systems.some((e) => e.lifecycle?.phase === "phaseOut")).toBe(true);
        expect(systems.some((e) => e.lifecycle?.dates?.plan || e.lifecycle?.dates?.phaseIn)).toBe(true);
        if (sample.id !== "retail") {
          expect(ws.rules.length).toBeGreaterThanOrEqual(2);
          expect(systems.some((e) => e.properties.dataClassification === "restricted" || e.properties.dataClassification === "confidential")).toBe(true);
          expect(Object.values(ws.elements).some((e) => e.type === "archimate:Driver")).toBe(true);
        }
      });

      it("has consistent views: every node, parent and edge exists, and siblings do not overlap", () => {
        for (const v of Object.values(ws.views)) {
          const ids = new Set(v.nodes.map((n) => n.element));
          for (const n of v.nodes) {
            expect(ws.elements[n.element], `${v.name}`).toBeDefined();
            if (n.parent) expect(ids.has(n.parent), `${v.name}: parent of ${ws.elements[n.element].name}`).toBe(true);
          }
          for (const e of v.edges) {
            const r = ws.relationships[e.relationship];
            expect(r && ids.has(r.source) && ids.has(r.target), v.name).toBe(true);
          }
          const byParent = new Map<string | undefined, typeof v.nodes>();
          for (const n of v.nodes) byParent.set(n.parent, [...(byParent.get(n.parent) ?? []), n]);
          for (const [parent, kids] of byParent) {
            for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) expect(overlaps(kids[i], kids[j]), `${v.name}: ${ws.elements[kids[i].element].name} / ${ws.elements[kids[j].element].name}`).toBe(false);
            if (parent) {
              const box = v.nodes.find((n) => n.element === parent)!;
              for (const k of kids) expect(k.x >= 0 && k.y >= 0 && k.x + k.w <= box.w && k.y + k.h <= box.h, `${v.name}: ${ws.elements[k.element].name} inside ${ws.elements[parent].name}`).toBe(true);
            }
          }
          if (v.viewpoint !== "ddd:canvas") expect(v.nodes.length, v.name).toBeGreaterThan(0);
        }
      });

      it("saves to files and loads back unchanged, with no validation errors or rule errors", async () => {
        const { files } = toFiles(ws);
        const back = fromFiles(files);
        expect(back.issues).toEqual([]);
        expect(Object.keys(back.workspace.elements).length).toBe(Object.keys(ws.elements).length);
        expect(Object.keys(back.workspace.relationships).length).toBe(Object.keys(ws.relationships).length);
        expect(Object.keys(back.workspace.views).length).toBe(Object.keys(ws.views).length);
        expect(back.workspace.rules).toEqual(ws.rules);
        const errors = validate(back.workspace, await get()).filter((p) => p.severity === "error");
        expect(errors.map((p) => p.message)).toEqual([]);
        for (const r of checkRules(back.workspace)) {
          expect(r.problems.filter((p) => p.code === "rule-invalid")).toEqual([]);
          expect(r.problems.filter((p) => p.severity === "error").map((p) => p.message)).toEqual([]);
        }
      });

      it("gives the Insights page something to show: a migration and classified data", () => {
        const plateau = comparePlateaus(ws, "2025-01-01", "2028-06-30");
        expect(plateau.introduced.length + plateau.retired.length + plateau.changed.length).toBeGreaterThan(0);
        if (sample.id !== "retail") expect(dataExposure(ws).handles.size).toBeGreaterThan(0);
      });
    });

  it("vastitecture new --sample writes a workspace that vastitecture check accepts", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "vast-new-")), "bank");
    const out: string[] = [], err: string[] = [];
    const io = { cwd: process.cwd(), out: (s: string) => out.push(s), err: (s: string) => err.push(s) };
    expect(await run(["new", dir, "--sample", "banking"], io)).toBe(0);
    expect(readdirSync(dir)).toEqual(expect.arrayContaining(["vastitecture.yaml", "model", "views", "adrs"]));
    expect(readFileSync(join(dir, "vastitecture.yaml"), "utf8")).toContain("Northbridge Bank");
    expect(await run(["check", dir], io)).toBe(0);
    // a second run into the same folder is refused, and unknown samples are explained
    expect(await run(["new", dir, "--sample", "banking"], io)).toBe(2);
    expect(await run(["new", join(dir, "..", "x"), "--sample", "nope"], io)).toBe(2);
    expect(err.join("\n")).toMatch(/not empty[\s\S]*Unknown sample "nope". Available: retail, banking/);
    out.length = 0;
    expect(await run(["samples"], io)).toBe(0);
    expect(out).toHaveLength(SAMPLES.length);
  });
});
