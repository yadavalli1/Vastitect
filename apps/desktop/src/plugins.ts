import { Registry } from "@vastitecture/core";
import { PluginHost, parseManifest, rewriteSdkImport, workerBootstrapSource, SDK_SHIM_SOURCE, type HostedPlugin, type PluginManifest, type Port } from "@vastitecture/plugin-sdk";
import BuiltinWorker from "./builtin.worker?worker";
import { httpFetch, isTauri, secrets } from "./platform";

export const registry = new Registry();
export const hostServices = { fetch: httpFetch, getSecret: secrets.get };

export interface LoadedPlugin {
  manifest: PluginManifest;
  origin: "builtin" | "user" | "workspace" | "browser";
  host: PluginHost;
  worker: Worker;
  code?: string;
  dir?: string;
}
export const loaded = new Map<string, LoadedPlugin>();
const listeners = new Set<() => void>();
let version = 0;
export const pluginsVersion = () => version;
export const subscribePlugins = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
const changed = () => {
  version++;
  for (const l of listeners) l();
};

/** Built-ins run in one worker and register through the same plugin API as third-party plugins. */
export function activateBuiltins(): Promise<void> {
  const worker = new BuiltinWorker();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The built-in plugins did not start within 20 seconds (worker did not respond)")), 20000);
    worker.onerror = (e) => (clearTimeout(timer), reject(new Error(`Built-in plugin worker failed: ${e.message || "could not load"}`)));
    worker.onmessage = (event: MessageEvent<{ t: string; manifests: PluginManifest[] }>) => {
      if (event.data.t !== "hello") return;
      const host = new PluginHost(worker as unknown as Port, registry, event.data.manifests, hostServices);
      host.onChange = changed;
      for (const m of event.data.manifests) loaded.set(m.id, { manifest: m, origin: "builtin", host, worker });
      Promise.all(event.data.manifests.map((m) => host.ready(m.id))).then(() => (clearTimeout(timer), resolve()), (e) => (clearTimeout(timer), reject(e)));
      worker.postMessage({ t: "go" });
    };
  });
}

export interface PluginSource {
  manifestJson: string;
  code: string;
  origin: "user" | "workspace" | "browser";
  dir?: string;
}

const APPROVED = "vastitecture/plugins/approved";
const INSTALLED = "vastitecture/plugins/installed";
/** Approval covers one exact set of capabilities and permissions: a plugin asking for more must be approved again. */
export const approvalKey = (m: PluginManifest) => `${m.id}|${[...m.capabilities].sort().join(",")}|${JSON.stringify(m.permissions ?? {})}`;
const approved = (): string[] => JSON.parse(localStorage.getItem(APPROVED) ?? "[]");
export const isApproved = (m: PluginManifest) => approved().includes(approvalKey(m));
export const approve = (m: PluginManifest) => localStorage.setItem(APPROVED, JSON.stringify([...new Set([...approved(), approvalKey(m)])]));

export type Approver = (manifest: PluginManifest, origin: string) => Promise<boolean>;
let approver: Approver = async () => false;
export const setApprover = (a: Approver) => void (approver = a);

export function unloadPlugin(id: string) {
  const p = loaded.get(id);
  if (!p || p.origin === "builtin") return;
  p.host.dispose();
  p.worker.terminate();
  loaded.delete(id);
  changed();
}

/** Load one third-party plugin into its own locked-down worker, after the user has approved its permissions. */
export async function loadPlugin(src: PluginSource): Promise<HostedPlugin> {
  const manifest = parseManifest(src.manifestJson);
  if (loaded.get(manifest.id)?.origin === "builtin") throw new Error(`"${manifest.id}" is the id of a built-in plugin`);
  if (!isApproved(manifest)) {
    if (!(await approver(manifest, src.origin))) throw new Error(`Plugin ${manifest.id} was not approved`);
    approve(manifest);
  }
  unloadPlugin(manifest.id);
  const blob = (text: string) => URL.createObjectURL(new Blob([text], { type: "text/javascript" }));
  const shimUrl = blob(SDK_SHIM_SOURCE);
  const pluginUrl = blob(rewriteSdkImport(src.code, shimUrl));
  const worker = new Worker(blob(workerBootstrapSource(manifest, pluginUrl)), { type: "module", name: `plugin:${manifest.id}` });
  const host = new PluginHost(worker as unknown as Port, registry, [manifest], hostServices);
  host.onChange = changed;
  worker.onerror = (e) => {
    const p = host.plugins.get(manifest.id)!;
    p.status = "failed";
    p.error = e.message || "The plugin's code could not be loaded";
    changed();
  };
  loaded.set(manifest.id, { manifest, origin: src.origin, host, worker, code: src.code, dir: src.dir });
  changed();
  try {
    await host.ready(manifest.id);
  } catch {
    /* status and error are recorded on the hosted plugin */
  }
  changed();
  return host.plugins.get(manifest.id)!;
}

const browserInstalled = (): PluginSource[] => JSON.parse(localStorage.getItem(INSTALLED) ?? "[]");

/** Web build: remember a plugin in browser storage (the desktop app reads plugin folders instead). */
export async function installInBrowser(manifestJson: string, code: string) {
  const manifest = parseManifest(manifestJson);
  const list = browserInstalled().filter((p) => parseManifest(p.manifestJson).id !== manifest.id);
  localStorage.setItem(INSTALLED, JSON.stringify([...list, { manifestJson, code, origin: "browser" }]));
  return loadPlugin({ manifestJson, code, origin: "browser" });
}

export function uninstall(id: string) {
  unloadPlugin(id);
  localStorage.setItem(INSTALLED, JSON.stringify(browserInstalled().filter((p) => parseManifest(p.manifestJson).id !== id)));
}

async function tauriSources(workspace?: string): Promise<PluginSource[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  const folders = await invoke<{ dir: string; manifest: string; source: "user" | "workspace" }[]>("plugins_list", { workspace });
  const out: PluginSource[] = [];
  for (const f of folders) {
    try {
      const entry = (JSON.parse(f.manifest).entry as string | undefined) ?? "index.js";
      out.push({ manifestJson: f.manifest, code: await invoke<string>("plugin_read", { dir: f.dir, file: entry }), origin: f.source, dir: f.dir });
    } catch (e) {
      console.error(`Could not read plugin in ${f.dir}`, e);
    }
  }
  return out;
}

/** Find and load installed plugins: ~/.vastitecture/plugins and <workspace>/.vastitecture/plugins on desktop. */
export async function loadInstalledPlugins(workspaceRoot?: string, onlyChanged = false) {
  const sources = isTauri ? await tauriSources(workspaceRoot) : browserInstalled();
  for (const src of sources) {
    try {
      const id = parseManifest(src.manifestJson).id;
      const cur = loaded.get(id);
      if (onlyChanged && cur && cur.code === src.code && JSON.stringify(cur.manifest) === JSON.stringify(parseManifest(src.manifestJson))) continue;
      await loadPlugin(src);
    } catch (e) {
      console.error(e);
    }
  }
  if (isTauri) {
    const present = new Set(sources.map((s) => JSON.parse(s.manifestJson).id));
    for (const [id, p] of loaded) if (p.origin !== "builtin" && p.origin !== "browser" && !present.has(id)) unloadPlugin(id);
  }
}
