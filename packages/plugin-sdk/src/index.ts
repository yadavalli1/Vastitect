import type {
  Connector,
  Exporter,
  Importer,
  LayoutEngine,
  NotationPack,
  Registry,
  SidePanel,
  Theme,
  Validator,
} from "@vastitecture/core";

export type * from "@vastitecture/core";
export { makeElement, makeRelationship, makeView, newId, slugify, packOf, localName } from "@vastitecture/core";

/** Version of the plugin API. Hosts accept plugins with the same major version. */
export const API_VERSION = "1.0.0";

export type Capability = "notation" | "importer" | "exporter" | "validator" | "connector" | "layout" | "theme" | "panel";

export interface PluginPermissions {
  /** "read:workspace" lets the plugin read workspace files; "read:pick" lets it read files the user picks. */
  fs?: ("read:workspace" | "read:pick")[];
  /** Host names the plugin may contact through ctx.net.fetch. */
  network?: string[];
  /** Names of secrets stored in the OS keychain the plugin may read. */
  secrets?: string[];
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: string;
  description?: string;
  /** ES module entry point, relative to the plugin folder. */
  entry?: string;
  capabilities: Capability[];
  permissions?: PluginPermissions;
}

export interface NetResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
}

/** The only surface a plugin sees. Everything is mediated by the host and checked against the manifest. */
export interface PluginContext {
  manifest: PluginManifest;
  notations: { register(pack: NotationPack): void };
  importers: { register(importer: Importer): void };
  exporters: { register(exporter: Exporter): void };
  validators: { register(validator: Validator): void };
  connectors: { register(connector: Connector): void };
  layouts: { register(layout: LayoutEngine): void };
  themes: { register(theme: Theme): void };
  panels: { register(panel: SidePanel): void };
  net: { fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<NetResponse> };
  secrets: { get(name: string): Promise<string | undefined> };
  log(...args: unknown[]): void;
}

export interface Plugin {
  manifest?: PluginManifest;
  activate(ctx: PluginContext): void | Promise<void>;
}

export const definePlugin = <P extends Plugin>(plugin: P): P => plugin;

export interface HostServices {
  fetch?: PluginContext["net"]["fetch"];
  getSecret?: PluginContext["secrets"]["get"];
  log?: (...args: unknown[]) => void;
}

export class PermissionError extends Error {}

export function checkApiVersion(manifest: PluginManifest) {
  const major = (v: string) => v.split(".")[0];
  if (major(manifest.apiVersion) !== major(API_VERSION))
    throw new Error(`Plugin ${manifest.id} targets API ${manifest.apiVersion}; this app supports ${API_VERSION}`);
}

/** Build a context that registers into `registry`, enforcing declared capabilities and permissions. Returns a disposer. */
export function createContext(manifest: PluginManifest, registry: Registry, services: HostServices = {}): { ctx: PluginContext; dispose(): void } {
  checkApiVersion(manifest);
  const disposers: (() => void)[] = [];
  const need = (cap: Capability) => {
    if (!manifest.capabilities.includes(cap)) throw new PermissionError(`Plugin ${manifest.id} did not declare the "${cap}" capability`);
  };
  const reg = <T>(cap: Capability, fn: (item: T) => () => void) => ({
    register(item: T) {
      need(cap);
      disposers.push(fn(item));
    },
  });
  const ctx: PluginContext = {
    manifest,
    notations: reg("notation", registry.registerPack),
    importers: reg("importer", registry.registerImporter),
    exporters: reg("exporter", registry.registerExporter),
    validators: reg("validator", registry.registerValidator),
    connectors: reg("connector", registry.registerConnector),
    layouts: reg("layout", registry.registerLayout),
    themes: reg("theme", registry.registerTheme),
    panels: reg("panel", registry.registerPanel),
    net: {
      async fetch(url, init) {
        const host = new URL(url).hostname;
        const allowed = manifest.permissions?.network ?? [];
        if (!allowed.some((h) => h === "*" || h === host || (h.startsWith("*.") && host.endsWith(h.slice(1)))))
          throw new PermissionError(`Plugin ${manifest.id} is not allowed to contact ${host}`);
        if (!services.fetch) throw new Error("Network access is not available");
        return services.fetch(url, init);
      },
    },
    secrets: {
      async get(name) {
        if (!(manifest.permissions?.secrets ?? []).includes(name)) throw new PermissionError(`Plugin ${manifest.id} is not allowed to read secret ${name}`);
        return services.getSecret?.(name);
      },
    },
    log: (...args) => (services.log ?? console.log)(`[${manifest.id}]`, ...args),
  };
  return { ctx, dispose: () => disposers.splice(0).forEach((d) => d()) };
}

/** Activate a plugin in the current thread (tests, built-ins before sandboxing). */
export async function activate(plugin: Plugin, registry: Registry, services?: HostServices, manifest = plugin.manifest) {
  if (!manifest) throw new Error("Plugin has no manifest");
  const { ctx, dispose } = createContext(manifest, registry, services);
  await plugin.activate(ctx);
  return dispose;
}

export * from "./rpc";
