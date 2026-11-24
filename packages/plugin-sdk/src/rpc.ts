/**
 * Sandbox RPC. A plugin runs in a Web Worker ("guest") and talks to the app ("host") only through
 * structured-clone messages. Definitions cross the boundary as plain data; their functions stay in
 * the guest and are invoked by handle. The host checks every registration against the manifest's
 * declared capabilities and every network or secret request against its declared permissions.
 */
import type { Registry } from "@vastitecture/core";
import { PermissionError, checkApiVersion, fetchInit, hostAllowed, type Capability, type HostServices, type PluginManifest } from "./index";

export interface Port {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

type GuestMessage =
  | { t: "register"; plugin: string; kind: string; handle: number; data: Record<string, unknown>; methods: string[] }
  | { t: "result"; id: number; ok: boolean; value?: unknown; error?: string }
  | { t: "host-call"; id: number; plugin: string; method: string; args: unknown[] }
  | { t: "ready"; plugin: string }
  | { t: "failed"; plugin: string; error: string };

type HostMessage = { t: "call"; id: number; handle: number; method: string; args: unknown[] } | { t: "host-result"; id: number; ok: boolean; value?: unknown; error?: string };

const KIND_TO_CAPABILITY: Record<string, Capability> = {
  notations: "notation",
  importers: "importer",
  exporters: "exporter",
  validators: "validator",
  connectors: "connector",
  layouts: "layout",
  themes: "theme",
  panels: "panel",
};

/**
 * Guest side. Deliberately self-contained (no imports, no outer references): the app serialises this
 * function with toString() to build the bootstrap of a third-party plugin's worker.
 */
export function guestMain(port: Port, plugins: { manifest: { id: string }; plugin: { activate(ctx: unknown): unknown } }[]): Promise<void> {
  const handles = new Map<number, Record<string, unknown>>();
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  let nextHandle = 1;
  let nextCall = 1;
  const hostCall = (plugin: string, method: string, args: unknown[]) =>
    new Promise((resolve, reject) => {
      const id = nextCall++;
      pending.set(id, { resolve, reject });
      port.postMessage({ t: "host-call", id, plugin, method, args });
    });
  port.onmessage = (event) => {
    const m = event.data as { t: string; id: number; handle: number; method: string; args: unknown[]; ok: boolean; value: unknown; error: string };
    if (m.t === "host-result") {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (p) m.ok ? p.resolve(m.value) : p.reject(new Error(m.error));
    } else if (m.t === "call") {
      Promise.resolve()
        .then(() => (handles.get(m.handle)![m.method] as (...a: unknown[]) => unknown)(...m.args))
        .then(
          (value) => port.postMessage({ t: "result", id: m.id, ok: true, value }),
          (err) => port.postMessage({ t: "result", id: m.id, ok: false, error: String(err && (err as Error).message ? (err as Error).message : err) }),
        );
    }
  };
  const run = async (entry: { manifest: { id: string }; plugin: { activate(ctx: unknown): unknown } }) => {
    const id = entry.manifest.id;
    const registrar = (kind: string) => ({
      register(def: Record<string, unknown>) {
        const handle = nextHandle++;
        const data: Record<string, unknown> = {};
        const methods: string[] = [];
        for (const key of Object.keys(def)) {
          if (typeof def[key] === "function") methods.push(key);
          else data[key] = def[key];
        }
        handles.set(handle, def);
        port.postMessage({ t: "register", plugin: id, kind, handle, data, methods });
      },
    });
    const ctx = {
      manifest: entry.manifest,
      notations: registrar("notations"),
      importers: registrar("importers"),
      exporters: registrar("exporters"),
      validators: registrar("validators"),
      connectors: registrar("connectors"),
      layouts: registrar("layouts"),
      themes: registrar("themes"),
      panels: registrar("panels"),
      net: { fetch: (url: string, init?: unknown) => hostCall(id, "net.fetch", [url, init]) },
      secrets: { get: (name: string) => hostCall(id, "secrets.get", [name]) },
      log: (...args: unknown[]) => void hostCall(id, "log", args.map((a) => (typeof a === "string" ? a : JSON.stringify(a)))).catch(() => undefined),
    };
    try {
      await entry.plugin.activate(ctx);
      port.postMessage({ t: "ready", plugin: id });
    } catch (err) {
      port.postMessage({ t: "failed", plugin: id, error: String(err && (err as Error).message ? (err as Error).message : err) });
    }
  };
  return plugins.reduce((p, entry) => p.then(() => run(entry)), Promise.resolve());
}

export interface HostedPlugin {
  manifest: PluginManifest;
  status: "loading" | "active" | "failed";
  error?: string;
  /** What the plugin registered, for the plugins page. */
  registered: { kind: string; id: string }[];
}

/** Host side of one sandbox (one worker, one or more plugins). */
export class PluginHost {
  plugins = new Map<string, HostedPlugin>();
  private disposers: (() => void)[] = [];
  private pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  private nextCall = 1;
  private waiters = new Map<string, { resolve(): void; reject(e: Error): void }>();
  onChange?: () => void;

  constructor(private port: Port, private registry: Registry, manifests: PluginManifest[], private services: HostServices = {}) {
    for (const m of manifests) {
      checkApiVersion(m);
      this.plugins.set(m.id, { manifest: m, status: "loading", registered: [] });
    }
    port.onmessage = (event) => this.receive(event.data as GuestMessage);
  }

  /** Resolves when the plugin has finished activating; rejects if activation threw. */
  ready(id: string, timeoutMs = 15000): Promise<void> {
    const p = this.plugins.get(id);
    if (!p) return Promise.reject(new Error(`Unknown plugin ${id}`));
    if (p.status === "active") return Promise.resolve();
    if (p.status === "failed") return Promise.reject(new Error(p.error));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Plugin ${id} did not start within ${timeoutMs} ms`)), timeoutMs);
      this.waiters.set(id, { resolve: () => (clearTimeout(timer), resolve()), reject: (e) => (clearTimeout(timer), reject(e)) });
    });
  }

  private call(handle: number, method: string, args: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextCall++;
      this.pending.set(id, { resolve, reject });
      this.port.postMessage({ t: "call", id, handle, method, args } satisfies HostMessage);
    });
  }

  private fail(p: HostedPlugin, error: string) {
    p.status = "failed";
    p.error = error;
    this.waiters.get(p.manifest.id)?.reject(new Error(error));
    this.waiters.delete(p.manifest.id);
    this.onChange?.();
  }

  private receive(m: GuestMessage) {
    if (m.t === "result") {
      const p = this.pending.get(m.id);
      this.pending.delete(m.id);
      if (p) m.ok ? p.resolve(m.value) : p.reject(new Error(m.error));
      return;
    }
    const plugin = this.plugins.get(m.plugin);
    if (!plugin) return;
    if (m.t === "ready") {
      if (plugin.status === "loading") plugin.status = "active";
      this.waiters.get(m.plugin)?.resolve();
      this.waiters.delete(m.plugin);
      this.onChange?.();
    } else if (m.t === "failed") this.fail(plugin, m.error);
    else if (m.t === "register") {
      const cap = KIND_TO_CAPABILITY[m.kind];
      if (!cap || !plugin.manifest.capabilities.includes(cap)) return this.fail(plugin, `Plugin ${m.plugin} registered a ${cap ?? m.kind} without declaring that capability`);
      const def: Record<string, unknown> = { ...m.data };
      for (const method of m.methods) def[method] = (...args: unknown[]) => this.call(m.handle, method, args);
      const reg = this.registry;
      // A plugin may not take over an id that a built-in or another plugin already registered.
      const existing = { notations: reg.packs, importers: reg.importers, exporters: reg.exporters, validators: reg.validators, connectors: reg.connectors, layouts: reg.layouts, themes: reg.themes, panels: reg.panels }[m.kind] as Map<string, unknown> | undefined;
      if (typeof def.id !== "string" || !def.id) return this.fail(plugin, `Plugin ${m.plugin} registered a ${cap} without an id`);
      if (existing?.has(def.id)) return this.fail(plugin, `Plugin ${m.plugin} tried to replace the ${cap} "${def.id}", which is already registered`);
      const add = { notations: reg.registerPack, importers: reg.registerImporter, exporters: reg.registerExporter, validators: reg.registerValidator, connectors: reg.registerConnector, layouts: reg.registerLayout, themes: reg.registerTheme, panels: reg.registerPanel }[m.kind] as (d: never) => () => void;
      this.disposers.push(add(def as never));
      plugin.registered.push({ kind: cap, id: String(def.id) });
    } else if (m.t === "host-call") {
      this.hostCall(plugin.manifest, m.method, m.args).then(
        (value) => this.port.postMessage({ t: "host-result", id: m.id, ok: true, value } satisfies HostMessage),
        (err) => this.port.postMessage({ t: "host-result", id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies HostMessage),
      );
    }
  }

  private async hostCall(manifest: PluginManifest, method: string, args: unknown[]): Promise<unknown> {
    if (method === "log") return void (this.services.log ?? console.log)(`[${manifest.id}]`, ...args);
    if (method === "net.fetch") {
      const [url, rawInit] = args as [unknown, unknown];
      if (typeof url !== "string") throw new TypeError("net.fetch expects a URL string");
      const host = new URL(url).hostname;
      const allowed = manifest.permissions?.network ?? [];
      if (!hostAllowed(allowed, host)) throw new PermissionError(`Plugin ${manifest.id} is not allowed to contact ${host}`);
      if (!this.services.fetch) throw new Error("Network access is not available");
      // Rebuild the request options from known fields only, so nothing in them can change where the
      // request goes, and pass the allow-list down so redirects are held to it as well.
      return this.services.fetch(url, { ...fetchInit(rawInit), allowHosts: [...allowed] });
    }
    if (method === "secrets.get") {
      const [name] = args as [string];
      if (!(manifest.permissions?.secrets ?? []).includes(name)) throw new PermissionError(`Plugin ${manifest.id} is not allowed to read secret ${name}`);
      return this.services.getSecret?.(name);
    }
    throw new Error(`Unknown host method ${method}`);
  }

  /** Remove everything the sandbox registered. The caller terminates the worker. */
  dispose() {
    for (const d of this.disposers.splice(0)) d();
    for (const p of this.pending.values()) p.reject(new Error("Plugin was unloaded"));
    this.pending.clear();
  }
}

/** Globals removed from a third-party plugin's worker before its code runs, so it can only reach the outside through ctx. */
export const BLOCKED_GLOBALS = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "indexedDB", "caches", "BroadcastChannel", "Worker", "SharedWorker", "WebTransport", "RTCPeerConnection", "Notification"];

const MANIFEST_KEYS = ["id", "name", "version", "apiVersion", "capabilities"];
const CAPABILITIES: Capability[] = ["notation", "importer", "exporter", "validator", "connector", "layout", "theme", "panel"];

/** Validate a plugin.json. Throws with a message a plugin author can act on. */
export function parseManifest(json: string): PluginManifest {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(json);
  } catch (e) {
    throw new Error(`plugin.json is not valid JSON: ${e instanceof Error ? e.message : e}`);
  }
  for (const k of MANIFEST_KEYS) if (m[k] === undefined) throw new Error(`plugin.json is missing "${k}"`);
  if (typeof m.id !== "string" || !/^[a-z0-9][a-z0-9._-]*$/.test(m.id)) throw new Error(`plugin.json "id" must be lowercase letters, digits, dots, dashes or underscores`);
  if (!Array.isArray(m.capabilities) || m.capabilities.some((c) => !CAPABILITIES.includes(c as Capability))) throw new Error(`plugin.json "capabilities" must be a list of: ${CAPABILITIES.join(", ")}`);
  const perms = (m.permissions ?? {}) as Record<string, unknown>;
  for (const k of ["fs", "network", "secrets"]) if (perms[k] !== undefined && (!Array.isArray(perms[k]) || (perms[k] as unknown[]).some((x) => typeof x !== "string"))) throw new Error(`plugin.json "permissions.${k}" must be a list of strings`);
  const manifest = m as unknown as PluginManifest;
  checkApiVersion(manifest);
  return manifest;
}

/**
 * What `import … from "@vastitecture/plugin-sdk"` resolves to inside a third-party plugin's sandbox:
 * the small runtime half of the SDK, as source text. The host rewrites the import to a blob of this.
 */
export const SDK_SHIM_SOURCE = `export const API_VERSION = "1.0.0";
export const definePlugin = (plugin) => plugin;
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
export function newId() {
  let t = Date.now(), out = "";
  for (let i = 0; i < 10; i++) { out = ALPHABET[t % 32] + out; t = Math.floor(t / 32); }
  const r = new Uint8Array(16);
  crypto.getRandomValues(r);
  for (const b of r) out += ALPHABET[b % 32];
  return out;
}
export const slugify = (s) => s.normalize("NFKD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "unnamed";
export const packOf = (type) => type.slice(0, type.indexOf(":"));
export const localName = (type) => type.slice(type.indexOf(":") + 1);
export const makeElement = (type, name, extra = {}) => ({ id: newId(), type, name, tags: [], properties: {}, links: [], ...extra });
export const makeRelationship = (type, source, target, extra = {}) => ({ id: newId(), type, source, target, properties: {}, ...extra });
export const makeView = (notation, name, extra = {}) => ({ id: newId(), notation, name, properties: {}, nodes: [], edges: [], annotations: [], ...extra });
`;

/** Source of the worker bootstrap for one third-party plugin. `pluginUrl` is a blob URL of its entry module. */
export function workerBootstrapSource(manifest: PluginManifest, pluginUrl: string): string {
  return `const guestMain = ${guestMain.toString()};
// Lock the sandbox down before any plugin code runs: the only way out is through ctx.
for (const name of ${JSON.stringify(BLOCKED_GLOBALS)}) {
  for (let o = self; o; o = Object.getPrototypeOf(o)) {
    try { Object.defineProperty(o, name, { value: undefined, writable: false, configurable: false }); } catch {}
  }
}
const manifest = ${JSON.stringify(manifest)};
import(${JSON.stringify(pluginUrl)})
  .then((m) => {
    if (!m.default || typeof m.default.activate !== "function") throw new Error("The plugin's entry module must default-export an object with an activate(ctx) function");
    return guestMain(self, [{ manifest, plugin: m.default }]);
  })
  .catch((e) => self.postMessage({ t: "failed", plugin: manifest.id, error: String((e && e.message) || e) }));
`;
}

/** Point a plugin's SDK import at the shim module. */
export const rewriteSdkImport = (code: string, shimUrl: string) => code.replace(/(from\s*|import\s*\(\s*)(["'])@vastitecture\/plugin-sdk\2/g, (_m, lead, quote) => `${lead}${quote}${shimUrl}${quote}`);
