import { ChatPanel } from "./panels/Chat";
import { Fragment, Suspense, lazy, useEffect, useState } from "react";
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalSpaceAround, AlignStartHorizontal, AlignStartVertical,
  AlignVerticalSpaceAround, ArrowDownRight, ArrowUpRight, Boxes, ChevronDown, ChevronRight, CircleAlert, CircleHelp, ClipboardPaste, CodeXml, Command, Download,
  FileUp, Focus, ImageDown, Info, Maximize, Moon, Network, Presentation, Redo2, Search, Shapes, Sparkles, Sun, TriangleAlert, Undo2, Upload, X, type LucideIcon,
} from "lucide-react";
import { Button, EmptyState, IconButton, MOD, Menu, PageHeader, Tooltip, TooltipProvider } from "./ui";
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
    <nav className="flex items-center gap-1" aria-label={t("Breadcrumbs")} data-testid="breadcrumbs" style={{ minWidth: 0, overflow: "hidden" }}>
      {crumbs.map((c) => (
        <span key={c.id} className="flex items-center gap-1">
          <button className="btn ghost sm" onClick={() => (set({ activeView: c.id }), select())}>{c.name}</button>
          <ChevronRight size={14} className="faint" aria-hidden />
        </span>
      ))}
      <strong style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingLeft: crumbs.length ? 2 : 0 }}>{view.name}</strong>
      <span className="badge" style={{ marginLeft: 6 }}>{registry.viewpoint(view.notation, view.viewpoint)?.name ?? registry.packs.get(view.notation)?.name ?? view.notation}</span>
    </nav>
  );
}


const ALIGN: [string, string, LucideIcon][] = [
  ["left", "Align left", AlignStartVertical],
  ["hcenter", "Align centres horizontally", AlignCenterVertical],
  ["right", "Align right", AlignEndVertical],
  ["top", "Align top", AlignStartHorizontal],
  ["vcenter", "Align centres vertically", AlignCenterHorizontal],
  ["bottom", "Align bottom", AlignEndHorizontal],
  ["hspace", "Distribute horizontally", AlignHorizontalSpaceAround],
  ["vspace", "Distribute vertically", AlignVerticalSpaceAround],
];

function ImportMenu() {
  return (
    <Menu
      label={t("Import")}
      trigger={<Button variant="ghost" icon={Upload}>{t("Import")}</Button>}
      items={[
        { label: t("Import files…"), icon: FileUp, onSelect: () => void importFiles() },
        { label: t("Paste text…"), icon: ClipboardPaste, onSelect: () => window.dispatchEvent(new CustomEvent("vastitecture:paste-import")) },
      ]}
    />
  );
}

function ExportMenu() {
  useRegistryVersion();
  const v = useApp((s) => s.activeView);
  const onDiagram = useApp((s) => s.page === "diagram");
  const exporters = [...registry.exporters.values()];
  const item = (x: (typeof exporters)[number]) => ({ label: x.label, disabled: x.scope === "view" && !(onDiagram && v), onSelect: () => void runExporter(x) });
  return (
    <Menu
      label={t("Export")}
      align="end"
      trigger={<Button variant="ghost" icon={Download} aria-label={t("Export")}>{t("Export")}</Button>}
      items={[
        { heading: t("This view") },
        { label: t("SVG image"), icon: ImageDown, disabled: !(onDiagram && v), onSelect: () => v && void exportSvg(v) },
        { label: t("PNG image"), icon: ImageDown, disabled: !(onDiagram && v), onSelect: () => v && void exportPng(v) },
        ...exporters.filter((x) => x.scope === "view").map(item),
        "separator",
        { heading: t("Whole workspace") },
        ...exporters.filter((x) => x.scope === "workspace").map(item),
      ]}
    />
  );
}

function TitleBar({ problemCount }: { problemCount: number }) {
  const s = useApp();
  const name = useModel((ws) => ws.name);
  useModel((ws) => ws); // refresh undo/redo availability
  const saveLabel = { saved: t("Saved"), dirty: t("Unsaved changes"), saving: t("Saving…"), error: t("Save failed") }[s.saveState];
  const where = s.fsLabel.startsWith("browser:") ? t("Kept inside the app") : s.fsLabel;
  return (
    <header className="titlebar chrome" role="toolbar" aria-label={t("Main toolbar")}>
      <span className="brand" aria-hidden><span className="brand-mark"><Boxes size={14} strokeWidth={2.2} /></span></span>
      <Tooltip label={where}>
        <button type="button" className="btn ghost ws-switch" onClick={() => set({ newOpen: true })} aria-label={t("Workspace: {name}", { name })}>
          <span className="name"><strong>{name}</strong></span>
          <ChevronDown size={14} className="faint" aria-hidden />
        </button>
      </Tooltip>
      <span className="flex items-center gap-1 faint" style={{ fontSize: 12, minWidth: 92 }}>
        <span className={`save-dot ${s.saveState}`} aria-hidden />
        <span data-testid="save-state">{saveLabel}</span>
      </span>
      <div className="btn-group">
        <IconButton icon={Undo2} label={t("Undo")} shortcut={`${MOD}Z`} onClick={undo} disabled={!model.canUndo} />
        <IconButton icon={Redo2} label={t("Redo")} shortcut={`${MOD}⇧Z`} onClick={redo} disabled={!model.canRedo} />
      </div>
      <span style={{ flex: 1 }} />
      <button type="button" className="searchbar" onClick={() => set({ searchOpen: true })} aria-label={t("Search")}>
        <Search size={14} aria-hidden />
        <span>{t("Search the model…")}</span>
        <span className="kbd">{MOD}K</span>
      </button>
      <span style={{ flex: 1 }} />
      <ImportMenu />
      <ExportMenu />
      <span className="toolbar-sep" />
      <IconButton
        icon={CircleAlert}
        label={t("Problems ({count})", { count: problemCount })}
        pressed={s.problemsOpen}
        onClick={() => set({ problemsOpen: !s.problemsOpen, page: "diagram" })}
        badge={problemCount ? <span className="count danger" style={{ position: "absolute", top: -3, right: -5, transform: "scale(.85)" }}>{problemCount}</span> : undefined}
      />
      <IconButton icon={Sparkles} label={t("Assistant chat")} pressed={s.chatOpen} onClick={() => set({ chatOpen: !s.chatOpen })} />
      <IconButton icon={s.theme === "dark" ? Sun : Moon} label={t("Toggle theme")} onClick={() => setTheme(s.theme === "dark" ? "light" : "dark")} />
      <Menu
        label={t("Help")}
        align="end"
        trigger={<IconButton icon={CircleHelp} label={t("Help")} />}
        items={[
          { label: t("Command palette"), icon: Command, shortcut: `${MOD}⇧P`, onSelect: () => set({ commandOpen: true }) },
          { label: t("Search"), icon: Search, shortcut: `${MOD}K`, onSelect: () => set({ searchOpen: true }) },
          "separator",
          { label: t("About Vastitecture"), icon: Info, onSelect: () => window.dispatchEvent(new CustomEvent("vastitecture:about")) },
        ]}
      />
    </header>
  );
}

/** Tools for the open diagram: layout, alignment, impact highlighting, code and presentation. */
function DiagramBar({ viewId }: { viewId: Id }) {
  const s = useApp();
  useRegistryVersion();
  return (
    <div className="subbar chrome" role="toolbar" aria-label={t("Diagram tools")}>
      <Breadcrumbs viewId={viewId} />
      <Menu
        label={t("Auto-layout")}
        align="end"
        trigger={<Button variant="ghost" size="sm" icon={Network} aria-label={t("Auto-layout")}>{t("Layout")}</Button>}
        items={[...registry.layouts.values()].map((l) => ({ label: l.label, onSelect: () => void runLayout(viewId, l.id) }))}
      />
      <Menu
        label={t("Align")}
        align="end"
        trigger={<Button variant="ghost" size="sm" icon={AlignStartVertical} aria-label={t("Align")}>{t("Align")}</Button>}
        items={ALIGN.flatMap(([id, label, icon], i) => [...(i === 6 ? ["separator" as const] : []), { label: t(label), icon, onSelect: () => alignSelection(id as never) }])}
      />
      <IconButton size="sm" icon={Maximize} label={t("Fit")} shortcut="1" onClick={() => window.dispatchEvent(new CustomEvent("vastitecture:fit"))} />
      <span className="toolbar-sep" />
      <IconButton size="sm" icon={ArrowUpRight} label={t("Used by")} pressed={s.impact === "usedBy"} onClick={() => set({ impact: s.impact === "usedBy" ? null : "usedBy" })} />
      <IconButton size="sm" icon={ArrowDownRight} label={t("Depends on")} pressed={s.impact === "dependsOn"} onClick={() => set({ impact: s.impact === "dependsOn" ? null : "dependsOn" })} />
      <IconButton size="sm" icon={Focus} label={t("Focus")} pressed={s.focus} onClick={() => set({ focus: !s.focus })} />
      <span className="toolbar-sep" />
      <IconButton size="sm" icon={CodeXml} label={t("Code")} pressed={s.codeOpen} onClick={() => set({ codeOpen: !s.codeOpen })} />
      <IconButton size="sm" icon={Presentation} label={t("Present")} onClick={() => set({ presenting: true })} />
      {extensions.toolbar.map((T, i) => <T key={i} />)}
    </div>
  );
}

function Rail() {
  const page = useApp((s) => s.page);
  const item = (id: string, Icon: LucideIcon, label: string) => (
    <Tooltip key={id} label={label} side="right">
      <button type="button" className={`btn ghost${page === id ? " on" : ""}`} aria-label={label} aria-current={page === id} onClick={() => set({ page: id as never })}>
        <Icon size={18} strokeWidth={1.7} aria-hidden />
      </button>
    </Tooltip>
  );
  const groups = ["model", "analyse", "connect"] as const;
  return (
    <nav className="rail chrome" aria-label={t("Sections")}>
      {item("diagram", Shapes, t("Diagrams"))}
      {groups.map((g, i) => (
        <Fragment key={g}>
          {pages.filter((p) => p.group === g).map((p) => item(p.id, p.icon, p.label()))}
          {i < groups.length - 1 && <span className="rail-sep" />}
        </Fragment>
      ))}
      <span style={{ flex: 1 }} />
      {pages.filter((p) => p.group === "app").map((p) => item(p.id, p.icon, p.label()))}
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
  if (s.phase === "error")
    return (
      <div className="page" role="alert">
        <PageHeader icon={TriangleAlert} title={t("Vastitecture could not start")} description={t("Nothing was changed. The details below help when reporting the problem.")} />
        <pre className="card card-pad" style={{ whiteSpace: "pre-wrap" }}>{s.bootError}</pre>
      </div>
    );
  if (s.phase === "loading")
    return (
      <div className="h-full" style={{ display: "grid", placeItems: "center" }}>
        <span className="brand-mark" style={{ width: 40, height: 40, borderRadius: 10 }} aria-label={t("Loading…")}><Boxes size={22} strokeWidth={2} /></span>
      </div>
    );
  const page = pages.find((p) => p.id === s.page);
  const real = problems.filter((p) => p.severity !== "info").length;
  const CodePane = extensions.codePane;
  return (
    <TooltipProvider>
    <div className={`flex flex-col h-full${s.presenting ? " present" : ""}`}>
      <TitleBar problemCount={real} />
      <div className="flex flex-1" style={{ minHeight: 0 }}>
        <Rail />
        {page ? (
          <main className="flex-1 scroll" style={{ minWidth: 0 }} key={page.id}>{page.render()}</main>
        ) : (
          <>
            <Sidebar />
            <main className="flex flex-col flex-1" style={{ minWidth: 0 }}>
              {s.activeView && !s.presenting && <DiagramBar viewId={s.activeView} />}
              <div className="flex flex-1" style={{ minHeight: 0 }}>
                <div className="flex-1" style={{ minWidth: 0, position: "relative" }}>
                  {s.activeView ? (
                    extensions.viewRenderer(s.activeView) ?? <Canvas viewId={s.activeView} />
                  ) : (
                    <div className="page"><EmptyState icon={Shapes} title={t("No views yet")}>{t("Create a view from the panel on the left to start drawing.")}</EmptyState></div>
                  )}
                </div>
                {s.codeOpen && s.activeView && CodePane && !s.presenting && <CodePane viewId={s.activeView} />}
              </div>
              {s.problemsOpen && !s.presenting && <Problems problems={problems} />}
            </main>
            {!s.presenting && (s.chatOpen ? <ChatPanel /> : <Properties />)}
          </>
        )}
      </div>
      {s.presenting && <Button icon={X} style={{ position: "fixed", top: 12, right: 12, zIndex: 30 }} onClick={() => set({ presenting: false })}>{t("Exit presentation")}</Button>}
      {s.commandOpen && <CommandPalette />}
      {s.searchOpen && <SearchDialog />}
      {s.newOpen && <WorkspaceDialog />}
      {s.review && <ReviewDialog />}
      {pasting && <PasteImport onClose={() => setPasting(false)} />}
      {about && <AboutDialog onClose={() => setAbout(false)} />}
      <ConflictDialog />
      <PluginApproval />
      {!!s.loadIssues.length && (
        <div className="callout danger" role="alert" style={{ position: "fixed", left: 64, bottom: 16, zIndex: 30, maxWidth: 520, boxShadow: "var(--shadow-md)" }}>
          <TriangleAlert size={16} className="sev-error" style={{ flex: "none", marginTop: 1 }} aria-hidden />
          <div>
            <strong>{t("{count} file(s) could not be read", { count: s.loadIssues.length })}</strong>
            <div className="muted" style={{ margin: "2px 0 8px" }}>{t("They are left untouched on disk until they can be read again.")}</div>
            {s.loadIssues.slice(0, 4).map((i) => <div key={i.path} className="mono" style={{ fontSize: 11 }}>{i.path}: {i.message.slice(0, 160)}</div>)}
            <Button size="sm" style={{ marginTop: 8 }} onClick={() => set({ loadIssues: [] })}>{t("Dismiss")}</Button>
          </div>
        </div>
      )}
      {s.toast && <div role="status" className="toast">{s.toast}</div>}
    </div>
    </TooltipProvider>
  );
}
