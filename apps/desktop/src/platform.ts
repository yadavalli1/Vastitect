import { isWorkspacePath, type FileMap, type ImportInput, type WorkspaceFS } from "@vastitecture/core";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Browser-only storage so the web build is usable with no folder access (and for UI tests). */
export class LocalStorageFS implements WorkspaceFS {
  label: string;
  private prefix: string;
  constructor(public name: string) {
    this.label = `browser:${name}`;
    this.prefix = `vastitecture/ws/${name}/`;
  }
  async readAll() {
    const out: FileMap = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith(this.prefix)) out[k.slice(this.prefix.length)] = localStorage.getItem(k)!;
    }
    return out;
  }
  async write(path: string, content: string) {
    localStorage.setItem(this.prefix + path, content);
  }
  async remove(path: string) {
    localStorage.removeItem(this.prefix + path);
  }
  watch(cb: () => void) {
    const h = (e: StorageEvent) => e.key?.startsWith(this.prefix) && cb();
    window.addEventListener("storage", h);
    return () => window.removeEventListener("storage", h);
  }
}

type DirHandle = FileSystemDirectoryHandle & { entries(): AsyncIterable<[string, FileSystemHandle]> };

/** A real folder in Chromium browsers through the File System Access API. */
export class DirectoryFS implements WorkspaceFS {
  label: string;
  constructor(private root: FileSystemDirectoryHandle) {
    this.label = root.name;
  }
  async readAll() {
    const out: FileMap = {};
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
      for await (const [name, h] of (dir as DirHandle).entries()) {
        if (name.startsWith(".") || name === "node_modules") continue;
        const path = prefix + name;
        if (h.kind === "directory") {
          if (prefix || ["model", "views", "adrs"].includes(name)) await walk(h as FileSystemDirectoryHandle, path + "/");
        } else if (isWorkspacePath(path)) out[path] = await (await (h as FileSystemFileHandle).getFile()).text();
      }
    };
    await walk(this.root, "");
    return out;
  }
  private async dir(parts: string[], create: boolean) {
    let d = this.root;
    for (const p of parts) d = await d.getDirectoryHandle(p, { create });
    return d;
  }
  async write(path: string, content: string) {
    const parts = path.split("/");
    const file = await (await this.dir(parts.slice(0, -1), true)).getFileHandle(parts[parts.length - 1], { create: true });
    const w = await file.createWritable();
    await w.write(content);
    await w.close();
  }
  async remove(path: string) {
    const parts = path.split("/");
    try {
      await (await this.dir(parts.slice(0, -1), false)).removeEntry(parts[parts.length - 1]);
    } catch {
      /* already gone */
    }
  }
  watch(cb: () => void) {
    const h = () => document.visibilityState === "visible" && cb();
    window.addEventListener("focus", h);
    return () => window.removeEventListener("focus", h);
  }
}

/** Desktop: thin Rust commands do batched reads, atomic writes and native file watching. */
export class TauriFS implements WorkspaceFS {
  label: string;
  constructor(public root: string) {
    this.label = root;
  }
  readAll() {
    return invoke<FileMap>("ws_read_all", { root: this.root });
  }
  write(path: string, content: string) {
    return invoke<void>("ws_write", { root: this.root, path, content });
  }
  remove(path: string) {
    return invoke<void>("ws_remove", { root: this.root, path });
  }
  watch(cb: () => void) {
    let un: (() => void) | undefined;
    let stopped = false;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      await invoke("ws_watch", { root: this.root });
      const u = await listen("ws-changed", () => cb());
      if (stopped) u();
      else un = u;
    })();
    return () => {
      stopped = true;
      un?.();
      void invoke("ws_unwatch").catch(() => {});
    };
  }
}

/** Ask the user for a workspace folder. Undefined when cancelled or unsupported. */
export async function pickFolder(): Promise<WorkspaceFS | undefined> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({ directory: true, multiple: false });
    return typeof dir === "string" ? new TauriFS(dir) : undefined;
  }
  const picker = (window as unknown as { showDirectoryPicker?: (o: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  if (!picker) return undefined;
  try {
    return new DirectoryFS(await picker({ mode: "readwrite" }));
  } catch {
    return undefined;
  }
}
export const canPickFolder = () => isTauri || "showDirectoryPicker" in window;

export function pickFiles(accept = "", multiple = true): Promise<ImportInput[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = async () => {
      const out: ImportInput[] = [];
      for (const f of Array.from(input.files ?? [])) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        out.push({ name: f.name, bytes, text: new TextDecoder().decode(bytes) });
      }
      resolve(out);
    };
    input.oncancel = () => resolve([]);
    input.click();
  });
}

export async function saveFile(name: string, data: string | Uint8Array | Blob, mime = "application/octet-stream") {
  if (isTauri) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: name });
    if (!path) return;
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
    await invoke("write_binary", { path, bytes: Array.from(bytes) });
    return;
  }
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Secrets live in the OS keychain on desktop. The web build keeps them for the session only. */
const sessionSecrets = new Map<string, string>();
export const secrets = {
  async get(name: string): Promise<string | undefined> {
    if (isTauri) return (await invoke<string | null>("secret_get", { name })) ?? undefined;
    return sessionSecrets.get(name);
  },
  async set(name: string, value: string) {
    if (isTauri) return invoke<void>("secret_set", { name, value });
    if (value) sessionSecrets.set(name, value);
    else sessionSecrets.delete(name);
  },
};

/** Network access for connectors, plugins and the AI assistant. Never called unless the user runs one. */
export async function httpFetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) {
  if (isTauri) return invoke<{ status: number; headers: Record<string, string>; text: string }>("http_fetch", { url, ...init });
  const r = await fetch(url, init);
  return { status: r.status, headers: Object.fromEntries(r.headers.entries()), text: await r.text() };
}

/**
 * The workspace to reopen at start-up, and recently used ones. Folder workspaces (desktop) are stored as
 * "folder:<absolute path>"; workspaces kept in the app's own storage by name.
 */
export const lastWorkspace = {
  get: () => localStorage.getItem("vastitecture/last") ?? undefined,
  set: (v: string) => {
    localStorage.setItem("vastitecture/last", v);
    const recent = [v, ...lastWorkspace.recent().filter((x) => x !== v)].slice(0, 8);
    localStorage.setItem("vastitecture/recent", JSON.stringify(recent));
  },
  recent: (): string[] => {
    try {
      return JSON.parse(localStorage.getItem("vastitecture/recent") ?? "[]");
    } catch {
      return [];
    }
  },
  forget: (v: string) => localStorage.setItem("vastitecture/recent", JSON.stringify(lastWorkspace.recent().filter((x) => x !== v))),
};

/** Show a workspace folder in Finder, Explorer or the file manager (desktop only). */
export async function revealFolder(path: string) {
  await invoke("reveal_folder", { path });
}

/** Explain file-system errors in terms a person can act on. */
export function explainFsError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
  if (/not permitted|permission denied|access is denied|EACCES|EPERM/i.test(msg))
    return `${msg}. The app is not allowed to write there. On macOS, allow Vastitecture under System Settings → Privacy & Security → Files and Folders (or Full Disk Access), or choose a folder outside Documents, Desktop and Downloads.`;
  return msg;
}
