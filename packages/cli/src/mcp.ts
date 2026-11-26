/**
 * A Model Context Protocol server (JSON-RPC 2.0 over stdio, one message per line), so AI tools that
 * speak MCP (Claude Desktop, Claude Code, Codex, Cursor and others) can read and change workspaces with
 * the same commands as the CLI. Every path is confined to the folder the server was started in.
 */
import { isAbsolute, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { applyToFolder, run } from "./cli";

const VERSION = "0.3.0";
const PROTOCOL = "2025-06-18";

const workspaceArg = { type: "string", description: "Workspace folder, relative to the folder the server runs in. Default: that folder." };
export const TOOLS = [
  {
    name: "list_types",
    description: "List the element types, relationship types and viewpoints of each notation (ArchiMate, C4, DDD, TOGAF, generic, inventory). Call this before writing a spec, and use only these ids.",
    inputSchema: { type: "object", properties: { notation: { type: "string", description: "Only this notation, e.g. c4 or archimate." } } },
  },
  {
    name: "show_model",
    description: "Show a workspace (or one view) as a model spec in YAML: elements, relationships, views and decisions, referred to by name.",
    inputSchema: { type: "object", properties: { workspace: workspaceArg, view: { type: "string", description: "Only the elements and relationships of this view." } } },
  },
  {
    name: "apply_model_spec",
    description:
      "Create or change elements, relationships, views and decisions from a model spec (YAML or JSON). Elements are matched by name, views are laid out automatically. Nothing is written if the spec or the resulting model has errors; the errors list the valid choices. Use dry_run to check first.",
    inputSchema: {
      type: "object",
      properties: { workspace: workspaceArg, spec: { type: "string", description: "The model spec as YAML or JSON text." }, dry_run: { type: "boolean", description: "Validate and report without writing." } },
      required: ["spec"],
    },
  },
  {
    name: "check_model",
    description: "Validate a workspace and run its architecture rules. Returns every problem with its severity.",
    inputSchema: { type: "object", properties: { workspace: workspaceArg } },
  },
  {
    name: "create_workspace",
    description: "Create a new workspace in an empty folder: blank, or from an industry sample (retail, banking, insurance, healthcare, manufacturing, telecom).",
    inputSchema: { type: "object", properties: { workspace: { type: "string", description: "New folder, relative to the server's folder." }, sample: { type: "string" } }, required: ["workspace"] },
  },
  {
    name: "export_view",
    description: "Export a workspace or one view as text: structurizr-dsl, c4-plantuml, mermaid-c4, mermaid-flowchart, archimate-exchange, svg-view, drawio and others (list_formats).",
    inputSchema: { type: "object", properties: { workspace: workspaceArg, format: { type: "string" }, view: { type: "string", description: "View name, for view exporters." } }, required: ["format"] },
  },
  { name: "list_formats", description: "List the export formats.", inputSchema: { type: "object", properties: {} } },
];

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method?: string; params?: Record<string, unknown> };

export async function serveMcp(root: string, io: { stdin: Readable; stdout: Writable; log: (s: string) => void }) {
  const send = (msg: unknown) => io.stdout.write(JSON.stringify(msg) + "\n");
  const lines = createInterface({ input: io.stdin, crlfDelay: Infinity });
  io.log(`Vastitecture MCP server on ${root}`);
  for await (const line of lines) {
    if (!line.trim()) continue;
    let msg: Rpc;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      continue;
    }
    const reply = await handle(root, msg).catch((e) => ({ error: { code: -32603, message: e instanceof Error ? e.message : String(e) } }));
    if (msg.id !== undefined && reply) send({ jsonrpc: "2.0", id: msg.id, ...reply });
  }
}

export async function handle(root: string, msg: Rpc): Promise<{ result?: unknown; error?: { code: number; message: string } } | undefined> {
  switch (msg.method) {
    case "initialize":
      return {
        result: {
          protocolVersion: (msg.params?.protocolVersion as string) ?? PROTOCOL,
          capabilities: { tools: {} },
          serverInfo: { name: "vastitecture", version: VERSION },
          instructions: "Vastitecture models architecture once and shows it in C4, ArchiMate, DDD and TOGAF. To change a model: list_types, show_model, then apply_model_spec (dry_run first), then check_model.",
        },
      };
    case "notifications/initialized":
    case "notifications/cancelled":
      return undefined;
    case "ping":
      return { result: {} };
    case "tools/list":
      return { result: { tools: TOOLS } };
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const text = await callTool(root, name, args);
        return { result: { content: [{ type: "text", text: text.text }], isError: !text.ok } };
      } catch (e) {
        return { result: { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true } };
      }
    }
    default:
      return msg.id === undefined ? undefined : { error: { code: -32601, message: `Method not found: ${msg.method}` } };
  }
}

/** A folder inside the server's root. Anything that would leave it is refused. */
export function inside(root: string, p: unknown): string {
  const target = resolve(root, typeof p === "string" && p ? p : ".");
  const rel = relative(root, target);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`Refusing a workspace outside ${root}: ${String(p)}`);
  return target;
}

async function cli(argv: string[]) {
  const out: string[] = [], err: string[] = [];
  const code = await run(argv, { cwd: process.cwd(), out: (s) => out.push(s), err: (s) => err.push(s) });
  return { ok: code === 0, text: [...out, ...err].join("\n") };
}

async function callTool(root: string, name: string, a: Record<string, unknown>): Promise<{ ok: boolean; text: string }> {
  const str = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : undefined);
  switch (name) {
    case "list_types":
      return cli(["types", "--format", "json", ...(str("notation") ? ["--notation", str("notation")!] : [])]);
    case "show_model":
      return cli(["show", inside(root, a.workspace), ...(str("view") ? ["--view", str("view")!] : [])]);
    case "apply_model_spec": {
      const spec = typeof a.spec === "string" ? a.spec : JSON.stringify(a.spec ?? {});
      const r = await applyToFolder(inside(root, a.workspace), spec, a.dry_run === true);
      if (r.errors.length) return { ok: false, text: `Not applied. Fix these and try again:\n${r.errors.map((e) => `- ${e}`).join("\n")}${r.report ? `\n\n${r.report}` : ""}` };
      return { ok: true, text: `${r.report}\n${a.dry_run === true ? "Dry run: nothing written." : `Wrote ${r.changed.length} file(s).`}` };
    }
    case "check_model":
      return cli(["check", inside(root, a.workspace), "--fail-on", "never"]);
    case "create_workspace":
      return cli(["new", inside(root, a.workspace), ...(str("sample") ? ["--sample", str("sample")!] : [])]);
    case "export_view":
      return cli(["export", inside(root, a.workspace), "--format", String(a.format ?? ""), ...(str("view") ? ["--view", str("view")!] : [])]);
    case "list_formats":
      return cli(["formats"]);
    default:
      return { ok: false, text: `Unknown tool "${name}". Tools: ${TOOLS.map((t) => t.name).join(", ")}` };
  }
}
