import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { STARTER_RULES, toFiles, type Workspace } from "@vastitecture/core";
import { buildSample } from "../../../apps/desktop/src/sample";
import { run } from "./cli";

async function write(ws: Workspace) {
  const dir = await mkdtemp(join(tmpdir(), "vast-cli-"));
  for (const [p, text] of Object.entries(toFiles(ws).files)) {
    await mkdir(dirname(join(dir, p)), { recursive: true });
    await writeFile(join(dir, p), text);
  }
  return dir;
}
async function cli(...argv: string[]) {
  const out: string[] = [], err: string[] = [];
  const code = await run(argv, { out: (s) => out.push(s), err: (s) => err.push(s), cwd: "/" });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("vastitecture CLI", () => {
  it("checks the sample workspace and fails only at the chosen severity", async () => {
    const dir = await write(buildSample());
    const ok = await cli("check", dir);
    expect(ok.out).toMatch(/\d+ elements, \d+ relationships, \d+ views · 0 error\(s\)/);
    expect(ok.code).toBe(0);
    expect((await cli("check", dir, "--fail-on", "info")).code).toBe(1);
  });

  it("adds starter rules, then reports violations as GitHub annotations and JSON", async () => {
    const ws = buildSample();
    const dir = await write(ws);
    expect((await cli("rules", "init", dir)).code).toBe(0);
    expect(await readFile(join(dir, "vastitecture.yaml"), "utf8")).toContain("id: systems-have-owners");
    const gh = await cli("check", dir, "--rules-only", "--format", "github", "--fail-on", "warning");
    expect(gh.out.split("\n").every((l) => l.startsWith("::") || /elements/.test(l))).toBe(true);
    const json = JSON.parse((await cli("check", dir, "--format", "json")).out);
    expect(json.rules.map((r: { id: string }) => r.id)).toEqual(STARTER_RULES.map((r) => r.id));
  });

  it("summarises a change between two workspace copies, including problems it introduces", async () => {
    const base = buildSample();
    base.rules = [{ id: "owned", description: "Systems have owners", severity: "error", match: { type: "c4:SoftwareSystem" }, require: ["owner"] }];
    for (const e of Object.values(base.elements)) if (e.type === "c4:SoftwareSystem") e.owner = "Team";
    const head: Workspace = structuredClone(base);
    const sys = Object.values(head.elements).find((e) => e.type === "c4:SoftwareSystem")!;
    sys.name = "Renamed system";
    delete sys.owner;
    const r = await cli("diff", await write(base), await write(head), "--fail-on", "error");
    expect(r.out).toContain("**+0 added · ~1 changed · −0 removed**");
    expect(r.out).toMatch(/name `.+` → `Renamed system`/);
    expect(r.out).toContain('🔴 Systems have owners: "Renamed system" has no owner');
    expect(r.code).toBe(1);
  });

  it("exports a workspace and a single view", async () => {
    const ws = buildSample();
    const dir = await write(ws);
    expect((await cli("export", dir, "--format", "structurizr-dsl")).out).toMatch(/^workspace /m);
    const view = Object.values(ws.views).find((v) => v.notation === "c4")!;
    const mmd = await cli("export", dir, "--format", "mermaid-flowchart", "--view", view.name);
    expect(mmd.code).toBe(0);
    expect(mmd.out).toMatch(/^flowchart/m);
    expect((await cli("export", dir, "--format", "mermaid-flowchart")).err).toContain("Pass --view");
    expect((await cli("check", "/nonexistent")).code).toBe(2);
  });
});
