import { useMemo, useState } from "react";
import { diffPatch } from "@vastitecture/core";
import { app, blankWorkspace, model, openWorkspace, resolveConflict, set, toast, useApp } from "../state";
import { LocalStorageFS, TauriFS, canPickFolder, explainFsError, isTauri, lastWorkspace, pickFolder, revealFolder } from "../platform";
import type { WorkspaceFS } from "@vastitecture/core";
import { buildSample } from "../sample";
import { runLayout } from "../ops";
import { t } from "../i18n";

export function Modal({ title, onClose, children, wide }: { title: string; onClose(): void; children: React.ReactNode; wide?: boolean }) {
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="dialog" role="dialog" aria-label={title} style={wide ? { width: "min(1000px, 94vw)" } : undefined} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="flex items-center" style={{ borderBottom: "1px solid var(--border)", padding: "8px 12px" }}>
          <strong style={{ flex: 1 }}>{title}</strong>
          <button className="btn ghost" aria-label={t("Close")} onClick={onClose}>×</button>
        </div>
        <div className="scroll" style={{ padding: 12 }}>{children}</div>
      </div>
    </>
  );
}

/** New / open workspace. No account, no server: a workspace is just a folder (or browser storage in the web build). */
export function WorkspaceDialog() {
  const [name, setName] = useState("my-architecture");
  const [template, setTemplate] = useState<"blank" | "sample">("blank");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const fsLabel = useApp((s) => s.fsLabel);
  const close = () => set({ newOpen: false });
  const make = () => (template === "sample" ? { ...buildSample(), name } : blankWorkspace(name));
  const existing = useMemo(() => {
    const names = new Set<string>();
    for (let i = 0; i < localStorage.length; i++) {
      const m = /^vastitecture\/ws\/([^/]+)\//.exec(localStorage.key(i)!);
      if (m) names.add(m[1]);
    }
    return [...names];
  }, []);
  const recentFolders = isTauri ? lastWorkspace.recent().filter((r) => r.startsWith("folder:")).map((r) => r.slice(7)) : [];
  const inFolder = isTauri && !fsLabel.startsWith("browser:");
  // Every action reports its failure here instead of failing silently.
  const run = (fn: () => Promise<void>) => async () => {
    setError(undefined);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      console.error(e);
      setError(explainFsError(e));
    } finally {
      setBusy(false);
    }
  };
  const openOrCreate = async (fs: WorkspaceFS, create: boolean) => {
    const has = Object.keys(await fs.readAll()).length > 0;
    if (create && has) toast(t("That folder already holds a workspace, so it was opened instead"));
    await openWorkspace(fs, create && !has ? make() : undefined);
    if (create && !has && fs instanceof TauriFS) toast(t("Workspace created in {path}", { path: fs.root }));
    close();
  };
  return (
    <Modal title={t("Workspace")} onClose={close}>
      <div className="panel" style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 8, marginBottom: 8 }} data-testid="workspace-location">
        <div className="label" style={{ marginTop: 0 }}>{t("Current workspace")}</div>
        {inFolder ? (
          <div className="flex items-center gap-2">
            <code style={{ overflowWrap: "anywhere" }}>{fsLabel}</code>
            <button className="btn" onClick={run(() => revealFolder(fsLabel))}>{navigator.platform.includes("Mac") ? t("Show in Finder") : t("Show folder")}</button>
          </div>
        ) : (
          <div className="muted">{t("Kept inside the app, not in a folder on disk. Use “Create in a folder…” to get files you can open and commit to Git.")}</div>
        )}
      </div>
      <div className="h" style={{ paddingLeft: 0 }}>{t("New workspace")}</div>
      <label className="label" htmlFor="ws-name">{t("Name")}</label>
      <input id="ws-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
      <label className="label" htmlFor="ws-template">{t("Template")}</label>
      <select id="ws-template" className="input" value={template} onChange={(e) => setTemplate(e.target.value as never)}>
        <option value="blank">{t("Blank")}</option>
        <option value="sample">{t("Sample: online shop in every notation")}</option>
      </select>
      <div className="flex gap-2 mt-3">
        {canPickFolder() && (
          <button className="btn primary" disabled={busy} onClick={run(async () => {
            const fs = await pickFolder();
            if (fs) await openOrCreate(fs, true);
          })}>{t("Create in a folder…")}</button>
        )}
        <button className="btn" disabled={busy} onClick={run(async () => openOrCreate(new LocalStorageFS(name.trim().replace(/[^\w.-]+/g, "-") || "workspace"), true))}>
          {isTauri ? t("Keep inside the app (no folder)") : t("Create in browser storage")}
        </button>
      </div>
      <div className="h" style={{ paddingLeft: 0, marginTop: 14 }}>{t("Open workspace")}</div>
      <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
        {canPickFolder() && (
          <button className="btn" disabled={busy} onClick={run(async () => {
            const fs = await pickFolder();
            if (fs) await openOrCreate(fs, false);
          })}>{t("Open folder…")}</button>
        )}
        {recentFolders.map((p) => (
          <button key={p} className="btn" title={p} disabled={busy} onClick={run(async () => openOrCreate(new TauriFS(p), false))}>📁 {p.split(/[\\/]/).pop()}</button>
        ))}
        {existing.map((n) => (
          <button key={n} className="btn" disabled={busy} onClick={run(async () => openOrCreate(new LocalStorageFS(n), false))}>{n}</button>
        ))}
      </div>
      {error && <p role="alert" className="sev-error" data-testid="workspace-error" style={{ whiteSpace: "pre-wrap" }}>{error}</p>}
      {!canPickFolder() && <p className="muted">{t("This browser cannot open folders. Use the desktop app or a Chromium browser to work with a Git folder.")}</p>}
    </Modal>
  );
}

const show = (v: unknown) => (v === undefined ? "∅" : typeof v === "string" ? v : JSON.stringify(v));

/** Every imported, discovered or AI-generated change arrives here as a diff. Nothing is applied silently. */
export function ReviewDialog() {
  const review = useApp((s) => s.review)!;
  const diff = useMemo(() => diffPatch(model.state, review.patch), [review]);
  const close = () => set({ review: undefined });
  const empty = !diff.added.length && !diff.changed.length && !diff.removed.length;
  return (
    <Modal title={review.title} onClose={close} wide>
      <div data-testid="review">
        {!!review.patch.report?.length && (
          <details open style={{ marginBottom: 10 }}>
            <summary><strong>{t("Report ({count})", { count: review.patch.report.length })}</strong></summary>
            <ul style={{ margin: "4px 0", paddingLeft: 18, maxHeight: 180, overflow: "auto" }}>{review.patch.report.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </details>
        )}
        <p>
          <span style={{ color: "var(--ok)" }}>+{diff.added.length} {t("added")}</span> · <span style={{ color: "var(--warn)" }}>~{diff.changed.length} {t("changed")}</span> ·{" "}
          <span style={{ color: "var(--danger)" }}>−{diff.removed.length} {t("removed")}</span>
        </p>
        {empty && <p className="muted">{t("Nothing would change.")}</p>}
        <div className="scroll" style={{ maxHeight: 330 }}>
          {diff.added.map((a) => <div key={a.kind + a.id} style={{ color: "var(--ok)" }}>+ {a.kind}: {a.label}</div>)}
          {diff.changed.map((c) => (
            <div key={c.kind + c.id} style={{ color: "var(--warn)" }}>
              ~ {c.kind}: {c.label}
              {c.fields.map((f) => <div key={f.field} className="muted" style={{ paddingLeft: 16, fontSize: 11 }}>{f.field}: {show(f.before)} → {show(f.after)}</div>)}
            </div>
          ))}
          {diff.removed.map((a) => <div key={a.kind + a.id} style={{ color: "var(--danger)" }}>− {a.kind}: {a.label}</div>)}
        </div>
      </div>
      <div className="flex gap-2 mt-3">
        <button className="btn primary" disabled={empty} onClick={async () => {
          model.dispatch({ type: "applyPatch", patch: review.patch }, { label: review.title, context: { view: app.getState().activeView } });
          close();
          const open = review.openView ?? review.patch.views?.[0]?.id;
          if (open && model.state.views[open]) set({ activeView: open, page: "diagram" });
          for (const v of review.layoutViews ?? []) await runLayout(v, undefined, true);
          set({ layoutDone: (app.getState().layoutDone ?? 0) + 1 });
          toast(t("Applied. Undo reverts the whole change."));
        }}>{t("Apply")}</button>
        <button className="btn" onClick={close}>{t("Discard")}</button>
      </div>
    </Modal>
  );
}

/** Merge view for files edited both here and on disk. */
export function ConflictDialog() {
  const conflicts = useApp((s) => s.conflicts);
  const c = conflicts[0];
  if (!c) return null;
  const pane = (title: string, text: string | undefined) => (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="label">{title}</div>
      <pre className="scroll" style={{ margin: 0, padding: 8, border: "1px solid var(--border)", borderRadius: 4, maxHeight: 300, fontSize: 11 }}>{text ?? t("(deleted)")}</pre>
    </div>
  );
  return (
    <Modal title={t("Conflicting edit: {path}", { path: c.path })} onClose={() => void resolveConflict(c.path, "ours")} wide>
      <p>{t("This file changed on disk while you had unsaved edits to it. Choose which version to keep.")}</p>
      <div className="flex gap-2">
        {pane(t("Base (last loaded)"), c.base)}
        {pane(t("Yours (in the app)"), c.ours)}
        {pane(t("Theirs (on disk)"), c.theirs)}
      </div>
      <div className="flex gap-2 mt-3">
        <button className="btn primary" onClick={() => void resolveConflict(c.path, "ours")}>{t("Keep mine")}</button>
        <button className="btn" onClick={() => void resolveConflict(c.path, "theirs")}>{t("Take theirs")}</button>
        <span className="muted" style={{ marginLeft: "auto" }}>{t("{count} conflict(s) left", { count: conflicts.length })}</span>
      </div>
    </Modal>
  );
}

export const TRADEMARKS = "ArchiMate® and TOGAF® are registered trademarks of The Open Group.";

export function AboutDialog({ onClose }: { onClose(): void }) {
  return (
    <Modal title={t("About Vastitecture")} onClose={onClose}>
      <p><strong>{t("Vastitecture")}</strong> {__APP_VERSION__}</p>
      <p>{t("An open-source, local-first workspace for modelling architecture in ArchiMate, C4, DDD and TOGAF. Model once, view many.")}</p>
      <p>{t("No account, no server, no telemetry. The app makes no network calls unless you run a discovery connector or enable the AI assistant.")}</p>
      <p data-testid="trademarks">{t("ArchiMate® and TOGAF® are registered trademarks of The Open Group.")}</p>
      <p className="muted">{t("C4 model by Simon Brown. Structurizr, Archi, Context Mapper, Mermaid, PlantUML and draw.io are the property of their respective owners; Vastitecture reads and writes their file formats and is not affiliated with them.")}</p>
    </Modal>
  );
}
