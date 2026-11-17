import { Suspense, lazy, useEffect, useState } from "react";
import type { Id } from "@vastitecture/core";
import { model, redo, registry, select, set, setTheme, undo, useApp, useModel, useRegistryVersion } from "./state";
import { exportPng, exportSvg, registerLayouts, runLayout, alignSelection } from "./ops";
import { handleShortcut } from "./commands";
import { Canvas } from "./canvas/Canvas";
import { Sidebar } from "./panels/Sidebar";
import { Properties } from "./panels/Properties";
import { Problems, useProblems } from "./panels/Problems";
import { CommandPalette } from "./panels/CommandPalette";
import { SearchDialog } from "./panels/Search";
import { AboutDialog, ConflictDialog, ReviewDialog, WorkspaceDialog } from "./panels/Dialogs";
import { pages } from "./pages/registry";
import "./pages";
import { PluginApproval } from "./pages/Plugins";
import { extensions } from "./extensions";
import { t } from "./i18n";
import { importFiles, importInputs, runExporter } from "./io";
import { Modal } from "./panels/Dialogs";

const LazyCode = lazy(() => import("./panels/CodePane"));
extensions.codePane = ({ viewId }) => (
  <Suspense fallback={<div className="panel border-l" style={{ width: "40%", padding: 12 }}>{t("Loading editor…")}</div>}>
    <LazyCode key={viewId} viewId={viewId} />
  </Suspense>
);

/** Paste a Mermaid block, DSL or any other supported text to import it. */
function PasteImport({ onClose }: { onClose(): void }) {
  const [text, setText] = useState("");
  return (
    <Modal title={t("Import from pasted text")} onClose={onClose}>
      <p className="muted">{t("Paste Structurizr DSL, Mermaid, PlantUML, CML, YAML or JSON. The format is detected automatically.")}</p>
      <textarea className="input" aria-label={t("Text to import")} style={{ minHeight: 260, fontFamily: "monospace" }} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      <div className="flex gap-2 mt-3">
        <button className="btn primary" disabled={!text.trim()} onClick={() => (onClose(), void importInputs([{ name: "pasted.txt", text }]))}>{t("Import")}</button>
        <button className="btn" onClick={onClose}>{t("Cancel")}</button>
      </div>
    </Modal>
  );
}


registerLayouts();

/** Breadcrumbs: follow the view's subject up the containment chain to views that drill into its ancestors. */
function Breadcrumbs({ viewId }: { viewId: Id }) {
  const views = useModel((ws) => ws.views);
  const cameFrom = useApp((st) => st.cameFrom);
  const view = views[viewId];
  if (!view) return null;
  // Walk up: the view we drilled in from, else a view that shows this view's subject as a plain (unexpanded) node.
  const crumbs: { id: Id; name: string }[] = [];
  const seen = new Set<Id>([viewId]);
  for (let cur = view; cur.subject && crumbs.length < 8; ) {
    const from = cameFrom[cur.id] && views[cameFrom[cur.id]] ? views[cameFrom[cur.id]] : undefined;
    const subject = cur.subject;
    const up =
      from ??
      Object.values(views)
        .filter((v) => v.notation === cur.notation && !seen.has(v.id) && v.nodes.some((n) => n.element === subject) && !v.nodes.some((n) => n.parent === subject))
        .sort((a, b) => Number(!!a.subject) - Number(!!b.subject) || a.name.localeCompare(b.name))[0];
    if (!up || seen.has(up.id)) break;
    seen.add(up.id);
    crumbs.unshift({ id: up.id, name: up.name });
    cur = up;
  }
  return (
    <nav className="chrome flex items-center gap-1" aria-label={t("Breadcrumbs")} data-testid="breadcrumbs" style={{ padding: "4px 10px", borderBottom: "1px solid var(--border)", background: "var(--panel)" }}>
      {crumbs.map((c) => (
        <span key={c.id} className="flex items-center gap-1">
          <button className="btn ghost" onClick={() => (set({ activeView: c.id }), select())}>{c.name}</button>
          <span className="muted">›</span>
        </span>
      ))}
      <strong>{view.name}</strong>
      <span className="chip muted" style={{ marginLeft: 6 }}>{registry.viewpoint(view.notation, view.viewpoint)?.name ?? registry.packs.get(view.notation)?.name ?? view.notation}</span>
    </nav>
  );
}

function Toolbar({ problemCount }: { problemCount: number }) {
  const s = useApp();
  const name = useModel((ws) => ws.name);
  useModel((ws) => ws); // refresh undo/redo availability
  const v = s.activeView;
  const saveLabel = { saved: t("Saved"), dirty: t("Unsaved changes"), saving: t("Saving…"), error: t("Save failed") }[s.saveState];
  return (
    <header className="panel chrome flex items-center gap-1 border-b" style={{ padding: "5px 8px", flexWrap: "wrap" }} role="toolbar" aria-label={t("Main toolbar")}>
      <button className="btn ghost" onClick={() => set({ newOpen: true })} title={s.fsLabel}><strong>{t("Vastitecture")}</strong> · {name}</button>
      <span className="muted" data-testid="save-state" style={{ fontSize: 11, minWidth: 70 }}>{saveLabel}</span>
      <button className="btn" onClick={undo} disabled={!model.canUndo} aria-label={t("Undo")} title={t("Undo")}>↶</button>
      <button className="btn" onClick={redo} disabled={!model.canRedo} aria-label={t("Redo")} title={t("Redo")}>↷</button>
      {s.page === "diagram" && v && (
        <>
          <select className="btn" aria-label={t("Auto-layout")} value="" onChange={(e) => e.target.value && void runLayout(v, e.target.value)}>
            <option value="">{t("Layout…")}</option>
            {[...registry.layouts.values()].map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
          <select className="btn" aria-label={t("Align")} value="" onChange={(e) => e.target.value && alignSelection(e.target.value as never)}>
            <option value="">{t("Align…")}</option>
            <option value="left">{t("Align left")}</option>
            <option value="hcenter">{t("Align centres horizontally")}</option>
            <option value="right">{t("Align right")}</option>
            <option value="top">{t("Align top")}</option>
            <option value="vcenter">{t("Align centres vertically")}</option>
            <option value="bottom">{t("Align bottom")}</option>
            <option value="hspace">{t("Distribute horizontally")}</option>
            <option value="vspace">{t("Distribute vertically")}</option>
          </select>
          <button className="btn" onClick={() => window.dispatchEvent(new CustomEvent("vastitecture:fit"))}>{t("Fit")}</button>
          <button className={`btn${s.impact === "usedBy" ? " on" : ""}`} aria-pressed={s.impact === "usedBy"} title={t("Light up everything that depends on the selection")} onClick={() => set({ impact: s.impact === "usedBy" ? null : "usedBy" })}>{t("Used by")}</button>
          <button className={`btn${s.impact === "dependsOn" ? " on" : ""}`} aria-pressed={s.impact === "dependsOn"} title={t("Light up everything the selection depends on")} onClick={() => set({ impact: s.impact === "dependsOn" ? null : "dependsOn" })}>{t("Depends on")}</button>
          <button className={`btn${s.focus ? " on" : ""}`} aria-pressed={s.focus} onClick={() => set({ focus: !s.focus })}>{t("Focus")}</button>
          <button className={`btn${s.codeOpen ? " on" : ""}`} aria-pressed={s.codeOpen} onClick={() => set({ codeOpen: !s.codeOpen })}>{t("Code")}</button>
          <button className="btn" onClick={() => void exportSvg(v)}>{t("SVG")}</button>
          <button className="btn" onClick={() => void exportPng(v)}>{t("PNG")}</button>
          <select className="btn" aria-label={t("Export")} value="" onChange={(e) => { const x = registry.exporters.get(e.target.value); if (x) void runExporter(x); }}>
            <option value="">{t("Export…")}</option>
            {[...registry.exporters.values()].map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
          {extensions.toolbar.map((T, i) => <T key={i} />)}
        </>
      )}
      <button className="btn" onClick={() => void importFiles()}>{t("Import")}</button>
      <button className="btn" onClick={() => window.dispatchEvent(new CustomEvent("vastitecture:paste-import"))}>{t("Paste")}</button>
      <span style={{ flex: 1 }} />
      <button className={`btn${s.problemsOpen ? " on" : ""}`} aria-pressed={s.problemsOpen} onClick={() => set({ problemsOpen: !s.problemsOpen })}>{t("Problems")} ({problemCount})</button>
      <button className="btn" onClick={() => set({ presenting: true })}>{t("Present")}</button>
      <button className="btn" onClick={() => setTheme(s.theme === "dark" ? "light" : "dark")} aria-label={t("Toggle theme")}>{s.theme === "dark" ? "☀" : "☾"}</button>
      <button className="btn" onClick={() => set({ searchOpen: true })} aria-label={t("Search")} title={t("Search (Ctrl+P)")}>🔎</button>
      <button className="btn" onClick={() => set({ commandOpen: true })}>⌘K</button>
      <button className="btn" aria-label={t("About")} title={t("About")} onClick={() => window.dispatchEvent(new CustomEvent("vastitecture:about"))}>?</button>
    </header>
  );
}

function Rail() {
  const page = useApp((s) => s.page);
  const item = (id: string, icon: string, label: string) => (
    <button key={id} className={`btn ghost${page === id ? " on" : ""}`} style={{ width: 44, height: 40, justifyContent: "center", fontSize: 17 }} aria-label={label} title={label} aria-current={page === id} onClick={() => set({ page: id as never })}>{icon}</button>
  );
  return (
    <nav className="panel chrome flex flex-col items-center gap-1 border-r" style={{ padding: "6px 3px" }} aria-label={t("Sections")}>
      {item("diagram", "◫", t("Diagrams"))}
      {pages.map((p) => item(p.id, p.icon, p.label()))}
    </nav>
  );
}

export function App() {
  const s = useApp();
  useRegistryVersion();
  const problems = useProblems();
  const [pasting, setPasting] = useState(false);
  const [about, setAbout] = useState(false);
  useEffect(() => {
    const open = () => setPasting(true);
    const openAbout = () => setAbout(true);
    window.addEventListener("vastitecture:paste-import", open);
    window.addEventListener("vastitecture:about", openAbout);
    return () => (window.removeEventListener("vastitecture:paste-import", open), window.removeEventListener("vastitecture:about", openAbout));
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => handleShortcut(e) && e.preventDefault();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  if (s.phase === "loading") return <div style={{ padding: 40 }}>{t("Loading…")}</div>;
  const page = pages.find((p) => p.id === s.page);
  const real = problems.filter((p) => p.severity !== "info").length;
  const CodePane = extensions.codePane;
  return (
    <div className={`flex flex-col h-full${s.presenting ? " present" : ""}`}>
      <Toolbar problemCount={real} />
      <div className="flex flex-1" style={{ minHeight: 0 }}>
        <Rail />
        {page ? (
          <main className="flex-1 scroll" style={{ minWidth: 0 }}>{page.render()}</main>
        ) : (
          <>
            <Sidebar />
            <main className="flex flex-col flex-1" style={{ minWidth: 0 }}>
              {s.activeView && <Breadcrumbs viewId={s.activeView} />}
              <div className="flex flex-1" style={{ minHeight: 0 }}>
                <div className="flex-1" style={{ minWidth: 0, position: "relative" }}>
                  {s.activeView ? (
                    extensions.viewRenderer(s.activeView) ?? <Canvas viewId={s.activeView} />
                  ) : (
                    <div style={{ padding: 40 }} className="muted">{t("Create a view to start drawing.")}</div>
                  )}
                </div>
                {s.codeOpen && s.activeView && CodePane && !s.presenting && <CodePane viewId={s.activeView} />}
              </div>
              {s.problemsOpen && !s.presenting && <Problems problems={problems} />}
            </main>
            {!s.presenting && <Properties />}
          </>
        )}
      </div>
      {s.presenting && <button className="btn" style={{ position: "fixed", top: 8, right: 8, zIndex: 30 }} onClick={() => set({ presenting: false })}>{t("Exit presentation")}</button>}
      {s.commandOpen && <CommandPalette />}
      {s.searchOpen && <SearchDialog />}
      {s.newOpen && <WorkspaceDialog />}
      {s.review && <ReviewDialog />}
      {pasting && <PasteImport onClose={() => setPasting(false)} />}
      {about && <AboutDialog onClose={() => setAbout(false)} />}
      <ConflictDialog />
      <PluginApproval />
      {!!s.loadIssues.length && (
        <div className="panel" role="alert" style={{ position: "fixed", left: 12, bottom: 12, zIndex: 30, border: "1px solid var(--danger)", borderRadius: 6, padding: 10, maxWidth: 520 }}>
          <strong className="sev-error">{t("{count} file(s) could not be read", { count: s.loadIssues.length })}</strong>
          {s.loadIssues.slice(0, 4).map((i) => <div key={i.path} style={{ fontSize: 11 }}>{i.path}: {i.message.slice(0, 160)}</div>)}
          <button className="btn mt-2" onClick={() => set({ loadIssues: [] })}>{t("Dismiss")}</button>
        </div>
      )}
      {s.toast && <div role="status" className="panel" style={{ position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", zIndex: 60, border: "1px solid var(--border)", borderRadius: 6, padding: "8px 14px", boxShadow: "0 6px 20px rgba(0,0,0,.25)" }}>{s.toast}</div>}
    </div>
  );
}
