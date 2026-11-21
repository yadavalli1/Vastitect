import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  Registry,
  STARTER_RULES,
  checkRules,
  diffWorkspaces,
  fromFiles,
  isWorkspacePath,
  toFiles,
  validate,
  SETTINGS_FILE,
  type FileMap,
  type Problem,
  type Workspace,
} from "@vastitecture/core";
import { activate, type Plugin } from "@vastitecture/plugin-sdk";
import generic from "@vastitecture/notation-generic";
import c4 from "@vastitecture/notation-c4";
import archimate from "@vastitecture/notation-archimate";
import ddd from "@vastitecture/notation-ddd";
import togaf from "@vastitecture/notation-togaf";
import inventory from "@vastitecture/notation-inventory";
import structurizr from "@vastitecture/io-structurizr";
import archimateIo from "@vastitecture/io-archimate";
import cml from "@vastitecture/io-cml";
import formats, { svgToPdfPage, writeVectorPdf } from "@vastitecture/io-formats";
import { viewToSvg } from "@vastitecture/render";
import { definePlugin } from "@vastitecture/plugin-sdk";

/** The same built-in notations and formats as the app, activated in-process. Connectors are left out: the CLI never reaches the network. */
/** Rendered outputs (the app has these too, plus image-based variants that need a browser). */
const rendered = (reg: Registry) =>
  definePlugin({
    manifest: { id: "vastitecture.cli-render", name: "SVG and PDF", version: "0.1.0", apiVersion: "1.0.0", capabilities: ["exporter"] },
    activate(ctx) {
      const svg = (ws: Workspace, id: string) => viewToSvg(ws, ws.views[id], reg);
      ctx.exporters.register({ id: "svg-view", label: "SVG (this view)", extension: "svg", scope: "view", export: (ws, o) => svg(ws, o.view!) });
      ctx.exporters.register({ id: "pdf-view", label: "PDF (this view)", extension: "pdf", scope: "view", export: (ws, o) => writeVectorPdf([svgToPdfPage(svg(ws, o.view!))], { title: ws.views[o.view!].name }) });
      ctx.exporters.register({
        id: "pdf",
        label: "PDF (all views)",
        extension: "pdf",
        scope: "workspace",
        export: (ws) => writeVectorPdf(Object.values(ws.views).sort((a, b) => a.notation.localeCompare(b.notation) || a.name.localeCompare(b.name)).map((v) => svgToPdfPage(svg(ws, v.id))), { title: ws.name }),
      });
    },
  });
const PLUGINS: Plugin[] = [archimate, c4, ddd, togaf, generic, inventory, structurizr, archimateIo, cml, formats];

export async function createRegistry(): Promise<Registry> {
  const reg = new Registry();
  for (const p of PLUGINS) await activate(p, reg, { log: () => {} });
  await activate(rendered(reg), reg);
  return reg;
}

export async function readWorkspaceFiles(dir: string): Promise<FileMap> {
  const files: FileMap = {};
  const walk = async (d: string) => {
    for (const ent of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      if (ent.name.startsWith(".") || ent.name === "node_modules") continue;
      const full = join(d, ent.name);
      if (ent.isDirectory()) await walk(full);
      else {
        const rel = relative(dir, full).split(sep).join("/");
        if (isWorkspacePath(rel)) files[rel] = await readFile(full, "utf8");
      }
    }
  };
  await walk(dir);
  if (files[SETTINGS_FILE] === undefined) throw new UsageError(`${dir} is not a Vastitecture workspace (no ${SETTINGS_FILE})`);
  return files;
}

export async function loadWorkspace(dir: string): Promise<{ ws: Workspace; issues: string[] }> {
  const { workspace, issues } = fromFiles(await readWorkspaceFiles(dir));
  return { ws: workspace, issues: issues.map((i) => `${i.path}: ${i.message}`) };
}

class UsageError extends Error {}
export interface Io {
  out(s: string): void;
  err(s: string): void;
  cwd: string;
}

const SEVERITY = { error: 0, warning: 1, info: 2 } as const;
type Sev = keyof typeof SEVERITY;

function flags(args: string[]) {
  const pos: string[] = [];
  const opt: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2);
      if (v !== undefined) opt[k] = v;
      else if (args[i + 1] !== undefined && !args[i + 1].startsWith("--")) opt[k] = args[++i];
      else opt[k] = true;
    } else pos.push(a);
  }
  return { pos, opt };
}

function where(ws: Workspace, p: Problem) {
  if (p.target.kind === "element" && p.target.id) return ws.elements[p.target.id]?.name;
  if (p.target.kind === "view" && p.target.id) return ws.views[p.target.id]?.name;
  return undefined;
}

export const HELP = `vastitecture — check, diff and export architecture workspaces

Usage:
  vastitecture check [dir] [--fail-on error|warning|info|never] [--format text|json|github|markdown] [--rules-only]
  vastitecture diff <base-dir> <head-dir> [--format markdown|json] [--fail-on …]
  vastitecture export [dir] --format <exporter> [--view <name or id>] [--out <file or folder>]
  vastitecture formats [dir]
  vastitecture rules init [dir]

check   validates the model and runs the architecture rules in vastitecture.yaml. Exit code 1 when a
        problem at or above --fail-on (default: error) is found.
diff    summarises what changed between two copies of a workspace (for example the base and head of
        a pull request) and which problems the change introduces or fixes.
export  writes a workspace or view export (Structurizr DSL, ArchiMate exchange, Mermaid, PlantUML, …).
rules init adds a starter set of rules to vastitecture.yaml.`;

export async function run(argv: string[], io: Io): Promise<number> {
  const [cmd, ...rest] = argv;
  const { pos, opt } = flags(rest);
  const dirArg = (i = 0) => resolve(io.cwd, pos[i] ?? ".");
  try {
    switch (cmd) {
      case "check":
        return await check(dirArg(), opt, io);
      case "diff":
        if (pos.length < 2) throw new UsageError("diff needs two workspace folders: <base> <head>");
        return await diff(dirArg(0), dirArg(1), opt, io);
      case "export":
        return await exportCmd(dirArg(), opt, io);
      case "formats": {
        const reg = await createRegistry();
        for (const e of [...reg.exporters.values()].sort((a, b) => a.id.localeCompare(b.id))) io.out(`${e.id.padEnd(28)} ${e.scope.padEnd(10)} .${e.extension.padEnd(6)} ${e.label}`);
        return 0;
      }
      case "rules":
        if (pos[0] !== "init") throw new UsageError("Try: vastitecture rules init [dir]");
        return await rulesInit(resolve(io.cwd, pos[1] ?? "."), io);
      case undefined:
      case "help":
      case "--help":
      case "-h":
        io.out(HELP);
        return 0;
      case "--version":
        io.out("0.1.0");
        return 0;
      default:
        throw new UsageError(`Unknown command "${cmd}"\n\n${HELP}`);
    }
  } catch (e) {
    io.err(e instanceof Error ? e.message : String(e));
    return 2;
  }
}

function failOn(opt: Record<string, string | true>): Sev | "never" {
  const v = typeof opt["fail-on"] === "string" ? opt["fail-on"] : "error";
  if (v !== "never" && !(v in SEVERITY)) throw new UsageError(`--fail-on must be error, warning, info or never (got ${v})`);
  return v as Sev | "never";
}
const fails = (ps: Problem[], level: Sev | "never") => level !== "never" && ps.some((p) => SEVERITY[p.severity] <= SEVERITY[level]);

async function problemsOf(ws: Workspace, rulesOnly: boolean) {
  const all = rulesOnly ? checkRules(ws).flatMap((r) => r.problems) : validate(ws, await createRegistry());
  return all.sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity] || a.message.localeCompare(b.message));
}

async function check(dir: string, opt: Record<string, string | true>, io: Io) {
  const level = failOn(opt);
  const { ws, issues } = await loadWorkspace(dir);
  const problems = await problemsOf(ws, opt["rules-only"] === true);
  const format = opt.format ?? "text";
  const count = (s: Sev) => problems.filter((p) => p.severity === s).length;
  const summary = `${Object.keys(ws.elements).length} elements, ${Object.keys(ws.relationships).length} relationships, ${Object.keys(ws.views).length} views · ${count("error")} error(s), ${count("warning")} warning(s), ${count("info")} info`;
  if (format === "json") io.out(JSON.stringify({ workspace: ws.name, issues, problems: problems.map((p) => ({ ...p, fixes: undefined, element: where(ws, p) })), rules: checkRules(ws).map((r) => ({ id: r.rule.id, checked: r.checked, violations: r.problems.length })) }, null, 2));
  else if (format === "github") {
    // GitHub Actions workflow commands: shown as annotations on the run and the pull request.
    for (const i of issues) io.out(`::error file=${SETTINGS_FILE}::${i}`);
    for (const p of problems) io.out(`::${p.severity === "info" ? "notice" : p.severity} title=${p.code}::${p.message.replace(/\r?\n/g, " ")}`);
    io.out(summary);
  } else if (format === "markdown") io.out(markdownProblems(ws.name, problems, summary));
  else {
    for (const i of issues) io.out(`error   load  ${i}`);
    for (const p of problems) io.out(`${p.severity.padEnd(7)} ${p.code.padEnd(28)} ${p.message}`);
    io.out(summary);
  }
  return issues.length || fails(problems, level) ? 1 : 0;
}

function markdownProblems(name: string, problems: Problem[], summary: string) {
  const icon = { error: "🔴", warning: "🟡", info: "🔵" };
  return [`### ${name}: architecture check`, "", summary, "", ...(problems.length ? ["| | Check | Problem |", "| --- | --- | --- |", ...problems.slice(0, 200).map((p) => `| ${icon[p.severity]} | \`${p.code}\` | ${p.message.replace(/\|/g, "\\|")} |`)] : ["No problems found."])].join("\n");
}

async function diff(baseDir: string, headDir: string, opt: Record<string, string | true>, io: Io) {
  const level = failOn({ "fail-on": "never", ...opt });
  const [{ ws: base }, { ws: head }] = await Promise.all([loadWorkspace(baseDir), loadWorkspace(headDir)]);
  const d = diffWorkspaces(base, head);
  const [pb, ph] = await Promise.all([problemsOf(base, false), problemsOf(head, false)]);
  const key = (p: Problem) => `${p.code}|${p.message}`;
  const before = new Set(pb.map(key));
  const after = new Set(ph.map(key));
  const introduced = ph.filter((p) => !before.has(key(p)) && p.severity !== "info");
  const fixed = pb.filter((p) => !after.has(key(p)) && p.severity !== "info");
  if (opt.format === "json") io.out(JSON.stringify({ ...d, introduced, fixed }, null, 2));
  else {
    const sym = { element: "◻", relationship: "→", view: "▦", decision: "✎" };
    const lines = [`### Architecture changes in ${head.name}`, "", `**+${d.added.length} added · ~${d.changed.length} changed · −${d.removed.length} removed**`, ""];
    const section = (title: string, items: string[]) => items.length && lines.push(`<details${items.length <= 15 ? " open" : ""}><summary>${title} (${items.length})</summary>`, "", ...items.slice(0, 300).map((s) => `- ${s}`), "", "</details>", "");
    section("Added", d.added.map((x) => `${sym[x.kind]} ${x.label}`));
    section("Changed", d.changed.map((x) => `${sym[x.kind]} ${x.label}: ${x.fields.filter((f) => !["nodes", "edges"].includes(f.field)).map((f) => `${f.field} ${short(f.before)} → ${short(f.after)}`).join(", ") || "layout"}`));
    section("Removed", d.removed.map((x) => `${sym[x.kind]} ${x.label}`));
    section("New problems", introduced.map((p) => `${p.severity === "error" ? "🔴" : "🟡"} ${p.message}`));
    section("Fixed problems", fixed.map((p) => `✅ ${p.message}`));
    if (!d.added.length && !d.changed.length && !d.removed.length) lines.push("No model changes.");
    io.out(lines.join("\n"));
  }
  return fails(introduced, level) ? 1 : 0;
}

const short = (v: unknown) => {
  if (v === undefined || v === null || v === "") return "∅";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return `\`${s.length > 40 ? s.slice(0, 39) + "…" : s}\``;
};

async function exportCmd(dir: string, opt: Record<string, string | true>, io: Io) {
  const reg = await createRegistry();
  const id = typeof opt.format === "string" ? opt.format : undefined;
  const exporter = id && reg.exporters.get(id);
  if (!exporter) throw new UsageError(`Choose an exporter with --format. Available: ${[...reg.exporters.keys()].sort().join(", ")}`);
  const { ws } = await loadWorkspace(dir);
  let view: string | undefined;
  if (exporter.scope === "view") {
    const want = typeof opt.view === "string" ? opt.view : undefined;
    const v = Object.values(ws.views).find((x) => x.id === want || x.name === want);
    if (!v) throw new UsageError(`${exporter.label} exports one view. Pass --view with one of: ${Object.values(ws.views).map((x) => JSON.stringify(x.name)).join(", ")}`);
    view = v.id;
  }
  const result = await exporter.export(ws, { view });
  const out = typeof opt.out === "string" ? resolve(io.cwd, opt.out) : undefined;
  if (typeof result === "string" && !out) {
    io.out(result);
    return 0;
  }
  if (!out) throw new UsageError(`${exporter.label} produces binary or several files; pass --out`);
  if (typeof result === "string" || result instanceof Uint8Array) {
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, result);
    io.err(`Wrote ${out}`);
  } else {
    for (const [name, data] of Object.entries(result)) {
      const p = join(out, name);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, data);
    }
    io.err(`Wrote ${Object.keys(result).length} file(s) to ${out}`);
  }
  return 0;
}

async function rulesInit(dir: string, io: Io) {
  const files = await readWorkspaceFiles(dir);
  const { workspace } = fromFiles(files);
  if (workspace.rules.length) {
    io.err(`${SETTINGS_FILE} already has ${workspace.rules.length} rule(s); nothing changed.`);
    return 0;
  }
  const settings = toFiles({ ...workspace, rules: STARTER_RULES }).files[SETTINGS_FILE];
  await writeFile(join(dir, SETTINGS_FILE), settings);
  io.err(`Added ${STARTER_RULES.length} starter rules to ${join(dir, SETTINGS_FILE)}. Edit them to suit your architecture.`);
  return 0;
}
