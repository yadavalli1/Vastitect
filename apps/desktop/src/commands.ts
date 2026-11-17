import { app, model, redo, registry, saveNow, set, setTheme, undo } from "./state";
import { alignSelection, addAnnotation, deleteSelection, exportPng, exportSvg, runLayout } from "./ops";
import { t } from "./i18n";
import { pages } from "./pages/registry";

export interface AppCommand {
  id: string;
  label: string;
  keys?: string;
  run(): void | Promise<void>;
}

const extra: (() => AppCommand[])[] = [];
/** Feature modules contribute their own commands (importers, exporters, pages). */
export const contributeCommands = (fn: () => AppCommand[]) => void extra.push(fn);

/** Every action in the app, for the command palette and keyboard shortcuts. */
export function commands(): AppCommand[] {
  const s = app.getState();
  const v = s.activeView;
  const list: AppCommand[] = [
    { id: "undo", label: t("Undo"), keys: "Mod+Z", run: undo },
    { id: "redo", label: t("Redo"), keys: "Mod+Shift+Z", run: redo },
    { id: "save", label: t("Save now"), keys: "Mod+S", run: saveNow },
    { id: "about", label: t("About Vastitecture"), run: () => void window.dispatchEvent(new CustomEvent("vastitecture:about")) },
    { id: "new-workspace", label: t("New or open workspace…"), run: () => set({ newOpen: true }) },
    { id: "theme", label: s.theme === "dark" ? t("Switch to light theme") : t("Switch to dark theme"), run: () => setTheme(s.theme === "dark" ? "light" : "dark") },
    { id: "code", label: t("Toggle diagram as code"), keys: "Mod+E", run: () => set({ codeOpen: !s.codeOpen }) },
    { id: "problems", label: t("Toggle problems panel"), keys: "Mod+J", run: () => set({ problemsOpen: !s.problemsOpen }) },
    { id: "present", label: t("Toggle presentation mode"), keys: "Mod+Shift+P", run: () => set({ presenting: !s.presenting }) },
    { id: "focus", label: t("Toggle focus mode"), run: () => set({ focus: !s.focus }) },
    { id: "impact-used", label: t("Impact highlight: what depends on the selection"), run: () => set({ impact: s.impact === "usedBy" ? null : "usedBy" }) },
    { id: "impact-deps", label: t("Impact highlight: what the selection depends on"), run: () => set({ impact: s.impact === "dependsOn" ? null : "dependsOn" }) },
    { id: "fit", label: t("Zoom to fit"), keys: "Mod+0", run: () => void window.dispatchEvent(new CustomEvent("vastitecture:fit")) },
    { id: "delete", label: t("Delete selection"), run: () => deleteSelection() },
    { id: "delete-model", label: t("Delete selection from the model"), run: () => deleteSelection(true) },
    ...(["left", "right", "top", "bottom", "hcenter", "vcenter", "hspace", "vspace"] as const).map((m) => ({
      id: "align-" + m,
      label: { left: t("Align left"), right: t("Align right"), top: t("Align top"), bottom: t("Align bottom"), hcenter: t("Align centres horizontally"), vcenter: t("Align centres vertically"), hspace: t("Distribute horizontally"), vspace: t("Distribute vertically") }[m],
      run: () => alignSelection(m),
    })),
    { id: "go-diagram", label: t("Go to diagrams"), run: () => set({ page: "diagram" }) },
    ...pages.map((p) => ({ id: "go-" + p.id, label: t("Go to {page}", { page: p.label() }), run: () => set({ page: p.id }) })),
    ...Object.values(model.state.views).map((view) => ({ id: "view-" + view.id, label: t("Open view: {name}", { name: view.name }), run: () => set({ activeView: view.id, page: "diagram" as const }) })),
  ];
  if (v) {
    list.push(
      ...[...registry.layouts.values()].map((l) => ({ id: "layout-" + l.id, label: t("Auto-layout: {name}", { name: l.label }), run: () => runLayout(v, l.id) })),
      { id: "export-svg", label: t("Export view as SVG"), run: () => exportSvg(v) },
      { id: "export-png", label: t("Export view as PNG"), run: () => exportPng(v) },
      { id: "note", label: t("Add note"), run: () => addAnnotation(v, "note", { x: 40, y: 40 }) },
      { id: "group-ann", label: t("Add annotation group"), run: () => addAnnotation(v, "group", { x: 40, y: 40 }) },
    );
  }
  for (const fn of extra) list.push(...fn());
  return list;
}

/** Global keyboard shortcuts. Returns true when handled. */
export function handleShortcut(e: KeyboardEvent): boolean {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) {
    if (e.key === "Escape" && app.getState().presenting) return (set({ presenting: false }), true);
    return false;
  }
  const inField = (e.target as HTMLElement)?.closest?.("input, textarea, select, .monaco-editor");
  const k = e.key.toLowerCase();
  if (k === "k") return (set({ commandOpen: !app.getState().commandOpen }), true);
  if (k === "s") return (void saveNow(), true);
  if (inField) return false;
  const combo = `Mod+${e.shiftKey ? "Shift+" : ""}${k.toUpperCase()}`;
  if (k === "y") return (redo(), true);
  const cmd = commands().find((c) => c.keys === combo);
  if (!cmd) return false;
  void cmd.run();
  return true;
}
