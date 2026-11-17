import { useSyncExternalStore } from "react";
import { create } from "zustand";
import {
  DEFAULT_MAPPINGS,
  ModelStore,
  Persister,
  emptyWorkspace,
  type Command,
  type DispatchOptions,
  type ExternalChange,
  type Id,
  type ModelPatch,
  type Workspace,
  type WorkspaceFS,
} from "@vastitecture/core";
import { LocalStorageFS, lastWorkspace } from "./platform";
import { activateBuiltins, installInBrowser, loadInstalledPlugins, registry } from "./plugins";
import { t } from "./i18n";
import { buildSample } from "./sample";

export { registry };
export const model = new ModelStore(emptyWorkspace());

export type Page = "diagram" | "inventory" | "capabilities" | "roadmap" | "impact" | "reports" | "adrs" | "repository" | "mappings" | "discover" | "plugins" | "settings";

export interface Review {
  title: string;
  patch: ModelPatch;
  /** Open this view after applying. */
  openView?: Id;
  layoutViews?: Id[];
}

interface AppState {
  phase: "loading" | "ready";
  fsLabel: string;
  page: Page;
  activeView?: Id;
  selection: { elements: Id[]; relationships: Id[] };
  theme: "light" | "dark";
  codeOpen: boolean;
  problemsOpen: boolean;
  impact: null | "dependsOn" | "usedBy";
  focus: boolean;
  presenting: boolean;
  commandOpen: boolean;
  newOpen: boolean;
  renaming?: Id;
  saveState: "saved" | "dirty" | "saving" | "error";
  review?: Review;
  conflicts: ExternalChange["conflicts"];
  loadIssues: { path: string; message: string }[];
  toast?: string;
  devMode: boolean;
  /** Which view each drilled-into view was opened from, for breadcrumbs. */
  cameFrom: Record<Id, Id>;
  /** Bumped when post-import layout finishes (lets tests and UI wait for it). */
  layoutDone?: number;
}

export const useApp = create<AppState>(() => ({
  phase: "loading",
  fsLabel: "",
  page: "diagram",
  selection: { elements: [], relationships: [] },
  theme: (localStorage.getItem("vastitecture/theme") as "light" | "dark") ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
  codeOpen: false,
  problemsOpen: false,
  impact: null,
  focus: false,
  presenting: false,
  commandOpen: false,
  newOpen: false,
  saveState: "saved",
  conflicts: [],
  loadIssues: [],
  devMode: localStorage.getItem("vastitecture/dev") === "1",
  cameFrom: {},
}));
export const app = useApp;
export const set = (p: Partial<AppState>) => useApp.setState(p);

/** Subscribe a component to a slice of the model. The selector must return a stable reference. */
export function useModel<T>(selector: (ws: Workspace) => T): T {
  return useSyncExternalStore(model.subscribe, () => selector(model.state));
}
export function useRegistryVersion() {
  return useSyncExternalStore(registry.subscribe, () => registry.version);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(message: string) {
  set({ toast: message });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => set({ toast: undefined }), 4000);
}

/** All model edits go through here so undo can restore which view was showing. */
export function dispatch(commands: Command | Command[], label?: string, opts: DispatchOptions = {}) {
  const s = app.getState();
  model.dispatch(commands, { label, context: { view: s.activeView, page: s.page }, ...opts });
}

function restore(ctx: unknown) {
  const c = ctx as { view?: Id; page?: Page } | undefined;
  if (c?.view && model.state.views[c.view]) set({ activeView: c.view, page: c.page ?? "diagram" });
  else if (app.getState().activeView && !model.state.views[app.getState().activeView!]) set({ activeView: Object.keys(model.state.views)[0] });
}
export const undo = () => restore(model.undo());
export const redo = () => restore(model.redo());

let persister: Persister | undefined;
let unwatch: (() => void) | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saving = Promise.resolve();

export function saveNow(): Promise<void> {
  clearTimeout(saveTimer);
  const p = persister;
  if (!p) return Promise.resolve();
  set({ saveState: "saving" });
  saving = saving
    .then(() => p.save(model.state))
    .then(() => set({ saveState: "saved" }))
    .catch((e) => {
      console.error(e);
      set({ saveState: "error" });
      toast(t("Could not save: {error}", { error: String(e) }));
    });
  return saving;
}

model.subscribe((_, change) => {
  if (change.origin === "external" || !persister) return;
  set({ saveState: "dirty" });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 500);
});

async function onExternalChange() {
  if (!persister) return;
  await saving;
  const change = await persister.checkExternal(model.state);
  if (!change) return;
  model.dispatch({ type: "replace", workspace: change.workspace }, { silent: true });
  set({ conflicts: change.conflicts, loadIssues: change.issues });
  if (!change.conflicts.length) toast(t("Reloaded changes from disk"));
  const v = app.getState().activeView;
  if (v && !model.state.views[v]) set({ activeView: Object.keys(model.state.views)[0] });
}

/** Resolve a conflict by keeping our version (re-save) or taking theirs. */
export async function resolveConflict(path: string, take: "ours" | "theirs") {
  const c = app.getState().conflicts.find((x) => x.path === path);
  if (!c || !persister) return;
  set({ conflicts: app.getState().conflicts.filter((x) => x.path !== path) });
  if (take === "theirs") model.dispatch({ type: "replace", workspace: persister.withFile(model.state, path, c.theirs) }, { silent: true });
  await saveNow();
}

export async function openWorkspace(fs: WorkspaceFS, initial?: Workspace) {
  await saving;
  unwatch?.();
  persister = new Persister(fs);
  const { workspace, issues } = await persister.load();
  const ws = initial ?? workspace;
  model.reset(ws);
  if (initial) await persister.save(ws);
  unwatch = fs.watch?.(() => void onExternalChange());
  if (fs instanceof LocalStorageFS) lastWorkspace.set(fs.name);
  set({
    phase: "ready",
    fsLabel: fs.label,
    activeView: Object.values(ws.views).sort((a, b) => a.name.localeCompare(b.name))[0]?.id,
    selection: { elements: [], relationships: [] },
    page: "diagram",
    saveState: "saved",
    loadIssues: issues,
    conflicts: [],
  });
}

export function blankWorkspace(name: string): Workspace {
  return { ...emptyWorkspace(name, [...registry.packs.keys()]), mappings: DEFAULT_MAPPINGS };
}

export async function boot() {
  await activateBuiltins();
  document.documentElement.dataset.theme = app.getState().theme;
  const name = lastWorkspace.get();
  const fs = new LocalStorageFS(name ?? "sample");
  const existing = Object.keys(await fs.readAll()).length > 0;
  // Zero-config start: first launch opens the sample workspace.
  await openWorkspace(fs, existing ? undefined : buildSample());
  void loadInstalledPlugins();
}

export function setTheme(theme: "light" | "dark") {
  localStorage.setItem("vastitecture/theme", theme);
  document.documentElement.dataset.theme = theme;
  set({ theme });
}

export function select(elements: Id[] = [], relationships: Id[] = []) {
  const cur = app.getState().selection;
  if (cur.elements.join() === elements.join() && cur.relationships.join() === relationships.join()) return;
  set({ selection: { elements, relationships } });
}

/** Test hook: lets Playwright inspect the model without scraping the DOM. */
(window as unknown as Record<string, unknown>).__vastitecture = { model, app, registry, installPlugin: installInBrowser };
