import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe as suite, expect, it } from "vitest";
import { DEFAULT_MAPPINGS, emptyWorkspace, validate, type Registry, type Workspace } from "@vastitecture/core";
import { buildBanking } from "@vastitecture/samples";
import { createRegistry, loadWorkspace, run } from "./cli";
import { handle, inside } from "./mcp";
import { skillTarget } from "./skill";
import { SKILL_FILES } from "./skill-files.generated";
import { applySpec, describe, parseSpec, specToYaml, vocabularyMarkdown } from "./spec";

const SKILL = new URL("../../../skills/vastitecture-modeling/", import.meta.url).pathname;
const blank = (): Workspace => ({ ...emptyWorkspace("Test", ["archimate", "c4", "ddd", "togaf", "generic"]), mappings: DEFAULT_MAPPINGS });
const io = () => {
  const out: string[] = [], err: string[] = [];
  return { out, err, io: { cwd: process.cwd(), out: (s: string) => out.push(s), err: (s: string) => err.push(s) } };
};
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
let reg: Registry;
const get = async () => (reg ??= await createRegistry());

suite("model specs", () => {
  it("the skill's examples apply in order to a blank workspace with no errors and tidy views", async () => {
    let ws = blank();
    for (const f of ["c4-system.yaml", "archimate-capabilities.yaml", "ddd-context-map.yaml"]) {
      const r = applySpec(ws, parseSpec(readFileSync(join(SKILL, "examples", f), "utf8")), await get());
      expect(r.errors, f).toEqual([]);
      ws = r.workspace;
    }
    expect(validate(ws, await get()).filter((p) => p.severity !== "info").map((p) => p.message)).toEqual([]);
    expect(Object.keys(ws.views)).toHaveLength(8);
    const shop = Object.values(ws.elements).find((e) => e.name === "Online Shop")!;
    expect(shop.properties.purpose).toBe("Take an order from basket to confirmed payment.");
    expect(Object.values(ws.adrs)[0]).toMatchObject({ id: "0001", status: "accepted" });
    for (const v of Object.values(ws.views)) {
      const top = v.nodes.filter((n) => !n.parent);
      for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) expect(overlaps(top[i], top[j]), v.name).toBe(false);
      for (const n of v.nodes.filter((x) => x.parent)) {
        const p = v.nodes.find((x) => x.element === n.parent)!;
        expect(n.x + n.w <= p.w && n.y + n.h <= p.h, `${v.name}: child inside parent`).toBe(true);
      }
    }
    const containers = Object.values(ws.views).find((v) => v.name === "Online Shop – containers")!;
    expect(containers.nodes.filter((n) => n.parent === shop.id)).toHaveLength(3);
    expect(containers.edges).toHaveLength(4);
  });

  it("reports every problem with the valid choices, and changes nothing", async () => {
    const ws = blank();
    const r = applySpec(ws, parseSpec(`
elements:
  - { name: A, type: c4:SoftwareSytem }
  - { name: B }
  - { name: C, type: c4:Container, parent: Nope }
relationships:
  - { from: A, to: C, type: c4:Use }
views:
  - { name: V, viewpoint: c4:containers, elements: [A] }
colours: red
`), await get());
    expect(r.workspace).toBe(ws);
    expect(r.errors.join("\n")).toMatch(/Unknown top-level key "colours"/);
    const r2 = applySpec(ws, parseSpec(`
elements:
  - { name: A, type: c4:SoftwareSytem }
  - { name: B }
  - { name: C, type: c4:Container, parent: Nope }
relationships:
  - { from: C, to: C, type: c4:Use }
views:
  - { name: V, notation: c4, viewpoint: c4:containers, elements: [C] }
`), await get());
    const text = r2.errors.join("\n");
    expect(text).toMatch(/unknown type "c4:SoftwareSytem". Did you mean: c4:SoftwareSystem/);
    expect(text).toMatch(/"type" is required for a new element/);
    expect(text).toMatch(/no element named "Nope"/);
    expect(text).toMatch(/unknown relationship type "c4:Use". Did you mean: c4:Uses/);
    expect(text).toMatch(/unknown viewpoint "c4:containers" for c4. Choose one of: .*c4:container/);
    expect(r2.workspace).toBe(ws);
  });

  it("updates by name, merges properties, removes with cascade, and is idempotent", async () => {
    let ws = applySpec(blank(), parseSpec(`
elements:
  - { name: Shop, type: c4:SoftwareSystem, properties: { criticality: Mission critical, annualCost: 10 } }
  - { name: CRM, type: c4:SoftwareSystem }
relationships:
  - { from: CRM, to: Shop, type: c4:Uses, label: reads }
views:
  - { name: L, viewpoint: c4:landscape, elements: [Shop, CRM] }
`), await get()).workspace;
    const view = Object.values(ws.views)[0];
    view.nodes[0].x = 999; // a manual move in the app
    const again = applySpec(ws, parseSpec(`
elements:
  - { name: Shop, properties: { annualCost: null, owner2: x }, owner: Team }
relationships:
  - { from: CRM, to: Shop, type: c4:Uses, label: reads orders }
views:
  - { name: L, elements: [Shop, CRM] }
`), await get());
    expect(again.errors).toEqual([]);
    ws = again.workspace;
    const shop = Object.values(ws.elements).find((e) => e.name === "Shop")!;
    expect(shop).toMatchObject({ owner: "Team", properties: { criticality: "Mission critical", owner2: "x" } });
    expect(shop.properties.annualCost).toBeUndefined();
    expect(Object.values(ws.relationships)).toHaveLength(1);
    expect(Object.values(ws.relationships)[0].label).toBe("reads orders");
    expect(Object.values(ws.views)[0].nodes[0].x).toBe(999); // same elements: layout kept
    expect(again.summary).toMatchObject({ elements: { added: [], updated: ["Shop"] }, relationships: { added: 0, updated: 1 } });

    const renamed = applySpec(ws, parseSpec(`elements: [{ id: ${shop.id}, name: Web Shop }]`), await get());
    expect(renamed.errors).toEqual([]);
    expect(renamed.workspace.elements[shop.id].name).toBe("Web Shop");
    expect(renamed.summary.elements.updated).toEqual(["Shop → Web Shop"]);

    const removed = applySpec(ws, parseSpec(`remove: { elements: [CRM] }`), await get());
    expect(removed.errors).toEqual([]);
    expect(Object.values(removed.workspace.relationships)).toHaveLength(0);
    expect(Object.values(removed.workspace.views)[0].nodes).toHaveLength(1);
  });

  it("show and apply use the same format: a whole sample survives a round trip", async () => {
    const bank = buildBanking();
    const spec = parseSpec(specToYaml(describe(bank)));
    const r = applySpec(blank(), spec, await get());
    expect(r.errors).toEqual([]);
    const count = (w: Workspace) => [Object.keys(w.elements).length, Object.keys(w.relationships).length, Object.keys(w.views).length, Object.keys(w.adrs).length, w.rules.length];
    expect(count(r.workspace)).toEqual(count(bank));
    expect(validate(r.workspace, await get()).filter((p) => p.severity === "error")).toEqual([]);
  });

  it("vastitecture apply writes files, refuses bad specs, and a second run changes nothing", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "vast-apply-")), "ws");
    const c = io();
    expect(await run(["new", dir], c.io)).toBe(0);
    const spec = join(dir, "..", "spec.yaml");
    writeFileSync(spec, readFileSync(join(SKILL, "examples", "c4-system.yaml")));
    expect(await run(["apply", dir, spec, "--dry-run"], c.io)).toBe(0);
    expect((await loadWorkspace(dir)).ws.elements).toEqual({});
    expect(await run(["apply", dir, spec], c.io)).toBe(0);
    expect(Object.keys((await loadWorkspace(dir)).ws.elements)).toHaveLength(6);
    c.err.length = 0;
    expect(await run(["apply", dir, spec], c.io)).toBe(0);
    expect(c.err.join("\n")).toMatch(/Wrote 0 file\(s\)/);
    writeFileSync(spec, "elements:\n  - { name: X, type: c4:Nope }\n");
    expect(await run(["apply", dir, spec], c.io)).toBe(1);
    expect(c.err.join("\n")).toMatch(/not applied[\s\S]*unknown type "c4:Nope"/);
    c.out.length = 0;
    expect(await run(["show", dir, "--view", "Online Shop – containers"], c.io)).toBe(0);
    expect(c.out.join("\n")).toMatch(/name: Orders DB[\s\S]*viewpoint: c4:container/);
    expect(await run(["check", dir], c.io)).toBe(0);
  });
});

suite("agent skill", () => {
  it("SKILL.md has valid frontmatter", () => {
    const text = readFileSync(join(SKILL, "SKILL.md"), "utf8");
    const fm = /^---\nname: ([^\n]+)\ndescription: ([^\n]+)\n---\n/.exec(text);
    expect(fm).not.toBeNull();
    expect(fm![1]).toBe("vastitecture-modeling");
    expect(fm![1]).toMatch(/^[a-z0-9-]{1,64}$/);
    expect(fm![2].length).toBeLessThanOrEqual(1024);
    for (const link of text.matchAll(/\]\(((?:reference|examples)\/[^)]*)\)/g)) expect(statSync(join(SKILL, link[1])).isFile() || statSync(join(SKILL, link[1])).isDirectory()).toBe(true);
  });

  it("the notation reference matches the app's notation packs", async () => {
    expect(readFileSync(join(SKILL, "reference/notations.md"), "utf8"), "run `pnpm skill`").toBe(vocabularyMarkdown(await get()) + "\n");
  });

  it("the CLI embeds the current skill files", () => {
    const files: Record<string, string> = {};
    const walk = (d: string) => {
      for (const n of readdirSync(d).sort()) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else files[relative(SKILL, p)] = readFileSync(p, "utf8");
      }
    };
    walk(SKILL);
    expect(SKILL_FILES, "run `pnpm skill`").toEqual(files);
  });

  it("installs for Claude Code, Codex or any folder, and does not overwrite edits without --force", async () => {
    expect(skillTarget("claude", false, "/w", {}, "/h")).toBe("/h/.claude/skills/vastitecture-modeling");
    expect(skillTarget("claude", true, "/w", {}, "/h")).toBe("/w/.claude/skills/vastitecture-modeling");
    expect(skillTarget("codex", false, "/w", { CODEX_HOME: "/c" }, "/h")).toBe("/c/skills/vastitecture-modeling");
    expect(skillTarget("codex", false, "/w", {}, "/h")).toBe("/h/.codex/skills/vastitecture-modeling");
    const dir = mkdtempSync(join(tmpdir(), "vast-skill-"));
    const c = io();
    c.io.cwd = dir;
    expect(await run(["skill", "install", "--target", "agents"], c.io)).toBe(0);
    const skillMd = join(dir, "agents/vastitecture-modeling/SKILL.md");
    expect(readFileSync(skillMd, "utf8")).toBe(SKILL_FILES["SKILL.md"]);
    expect(await run(["skill", "install", "--target", "agents"], c.io)).toBe(0);
    writeFileSync(skillMd, "edited");
    expect(await run(["skill", "install", "--target", "agents"], c.io)).toBe(1);
    expect(await run(["skill", "install", "--target", "agents", "--force"], c.io)).toBe(0);
    expect(readFileSync(skillMd, "utf8")).toBe(SKILL_FILES["SKILL.md"]);
  });
});

suite("MCP server", () => {
  it("speaks MCP: initialize, list tools, apply a spec and check, confined to its folder", async () => {
    const root = mkdtempSync(join(tmpdir(), "vast-mcp-"));
    const init = await handle(root, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    expect(init?.result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "vastitecture" } });
    expect(await handle(root, { jsonrpc: "2.0", method: "notifications/initialized" })).toBeUndefined();
    const tools = (await handle(root, { jsonrpc: "2.0", id: 2, method: "tools/list" }))?.result as { tools: { name: string }[] };
    expect(tools.tools.map((t) => t.name)).toEqual(["list_types", "show_model", "apply_model_spec", "check_model", "create_workspace", "export_view", "list_formats"]);
    const call = async (name: string, args: Record<string, unknown>) => (await handle(root, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name, arguments: args } }))?.result as { content: { text: string }[]; isError: boolean };
    expect((await call("create_workspace", { workspace: "shop" })).isError).toBe(false);
    const bad = await call("apply_model_spec", { workspace: "shop", spec: "elements: [{ name: X, type: c4:Systm }]" });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toMatch(/Not applied[\s\S]*Did you mean: c4:SoftwareSystem/);
    const ok = await call("apply_model_spec", { workspace: "shop", spec: readFileSync(join(SKILL, "examples", "c4-system.yaml"), "utf8") });
    expect(ok.isError).toBe(false);
    expect(ok.content[0].text).toMatch(/\+6 element\(s\)/);
    expect((await call("check_model", { workspace: "shop" })).content[0].text).toMatch(/0 error\(s\)/);
    expect((await call("export_view", { workspace: "shop", format: "mermaid-c4", view: "Online Shop – containers" })).content[0].text).toMatch(/C4Container/);
    const escape = await call("show_model", { workspace: "../.." });
    expect(escape.isError).toBe(true);
    expect(escape.content[0].text).toMatch(/Refusing a workspace outside/);
    expect(() => inside(root, "/etc")).toThrow(/outside/);
    expect((await handle(root, { jsonrpc: "2.0", id: 9, method: "nope" }))?.error?.code).toBe(-32601);
  });
});
