import { useMemo, useState } from "react";
import { diffPatch } from "@vastitecture/core";
import { app, blankWorkspace, model, openWorkspace, resolveConflict, set, toast, useApp } from "../state";
import { LocalStorageFS, TauriFS, canPickFolder, explainFsError, isTauri, lastWorkspace, pickFolder, revealFolder } from "../platform";
import type { WorkspaceFS } from "@vastitecture/core";
import { buildSample } from "../sample";
import { runLayout } from "../ops";
import { t } from "../i18n";
import * as Dialog from "@radix-ui/react-dialog";
import { Boxes, Check, Folder, FolderOpen, FolderPlus, HardDrive, X } from "lucide-react";
import { Button, IconButton } from "../ui";

/** A modal dialog: focus is trapped inside, Escape and the close button dismiss it. */
export function Modal({ title, onClose, children, wide, footer, description }: { title: string; onClose(): void; children: React.ReactNode; wide?: boolean; footer?: React.ReactNode; description?: React.ReactNode }) {
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content
          className={`dialog${wide ? " wide" : ""}`}
          aria-describedby={undefined}
          // Start in the first field (or the dialog itself), not on the close button, so its tooltip does not pop up.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            const root = e.currentTarget as HTMLElement;
            (root.querySelector<HTMLElement>(".dialog-body [autofocus], .dialog-body input, .dialog-body textarea, .dialog-body select") ?? root).focus();
          }}
          tabIndex={-1}
        >
          <div className="dialog-head">
            <Dialog.Title asChild><h2>{title}</h2></Dialog.Title>
            <Dialog.Close asChild><IconButton size="sm" icon={X} label={t("Close")} /></Dialog.Close>
          </div>
          <div className="dialog-body">
            {description && <p className="muted" style={{ marginTop: 0 }}>{description}</p>}
            {children}
          </div>
          {footer && <div className="dialog-foot">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
    <Modal title={t("Workspace")} onClose={close} wide>
      <div className="callout" data-testid="workspace-location" style={{ marginBottom: 16 }}>
        {inFolder ? <FolderOpen size={16} className="muted" style={{ flex: "none", marginTop: 1 }} aria-hidden /> : <HardDrive size={16} className="muted" style={{ flex: "none", marginTop: 1 }} aria-hidden />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500 }}>{t("Current workspace")}</div>
          {inFolder ? <code style={{ overflowWrap: "anywhere" }}>{fsLabel}</code> : <span className="muted">{t("Kept inside the app, not in a folder on disk. Use “Create in a folder…” to get files you can open and commit to Git.")}</span>}
        </div>
        {inFolder && <Button size="sm" icon={FolderOpen} onClick={run(() => revealFolder(fsLabel))}>{navigator.platform.includes("Mac") ? t("Show in Finder") : t("Show folder")}</Button>}
      </div>
      <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr", alignItems: "start" }}>
        <section className="card card-pad">
          <h3 style={{ marginTop: 0 }}>{t("New workspace")}</h3>
          <label className="label" htmlFor="ws-name">{t("Name")}</label>
          <input id="ws-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="label" htmlFor="ws-template">{t("Template")}</label>
          <select id="ws-template" className="input" value={template} onChange={(e) => setTemplate(e.target.value as never)}>
            <option value="blank">{t("Blank")}</option>
            <option value="sample">{t("Sample: online shop in every notation")}</option>
          </select>
          <div className="flex gap-2 mt-4" style={{ flexWrap: "wrap" }}>
            {canPickFolder() && (
              <Button variant="primary" icon={FolderPlus} disabled={busy} onClick={run(async () => {
                const fs = await pickFolder();
                if (fs) await openOrCreate(fs, true);
              })}>{t("Create in a folder…")}</Button>
            )}
            <Button disabled={busy} onClick={run(async () => openOrCreate(new LocalStorageFS(name.trim().replace(/[^\w.-]+/g, "-") || "workspace"), true))}>
              {isTauri ? t("Keep inside the app (no folder)") : t("Create in browser storage")}
            </Button>
          </div>
          {!canPickFolder() && <p className="hint">{t("This browser cannot open folders. Use the desktop app or a Chromium browser to work with a Git folder.")}</p>}
        </section>
        <section className="card card-pad">
          <h3 style={{ marginTop: 0 }}>{t("Open workspace")}</h3>
          {canPickFolder() && (
            <Button icon={FolderOpen} disabled={busy} onClick={run(async () => {
              const fs = await pickFolder();
              if (fs) await openOrCreate(fs, false);
            })}>{t("Open folder…")}</Button>
          )}
          {!!(recentFolders.length + existing.length) && <div className="label">{t("Recent")}</div>}
          <div style={{ margin: "0 -6px" }}>
            {recentFolders.map((p) => (
              <button key={p} type="button" className="row" style={{ width: "100%", border: 0, background: "transparent" }} title={p} disabled={busy} onClick={run(async () => openOrCreate(new TauriFS(p), false))}>
                <Folder size={14} className="faint" aria-hidden /> <span>{p.split(/[\\/]/).pop()}</span>
                <span className="faint" style={{ marginLeft: "auto", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>{p}</span>
              </button>
            ))}
            {existing.map((n) => (
              <button key={n} type="button" className="row" style={{ width: "100%", border: 0, background: "transparent" }} disabled={busy} onClick={run(async () => openOrCreate(new LocalStorageFS(n), false))}>
                <HardDrive size={14} className="faint" aria-hidden /> <span>{n}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
      {error && <p role="alert" className="callout danger" data-testid="workspace-error" style={{ whiteSpace: "pre-wrap", marginTop: 12 }}>{error}</p>}
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
    <Modal
      title={review.title}
      onClose={close}
      wide
      footer={
        <>
          <span className="faint" style={{ marginRight: "auto", fontSize: 12 }}>{t("Nothing changes until you apply. Undo reverts the whole change.")}</span>
          <Button onClick={close}>{t("Discard")}</Button>
          <Button variant="primary" icon={Check} disabled={empty} onClick={async () => {
            model.dispatch({ type: "applyPatch", patch: review.patch }, { label: review.title, context: { view: app.getState().activeView } });
            close();
            const open = review.openView ?? review.patch.views?.[0]?.id;
            if (open && model.state.views[open]) set({ activeView: open, page: "diagram" });
            for (const v of review.layoutViews ?? []) await runLayout(v, undefined, true);
            set({ layoutDone: (app.getState().layoutDone ?? 0) + 1 });
            toast(t("Applied. Undo reverts the whole change."));
          }}>{t("Apply")}</Button>
        </>
      }
    >
      <div data-testid="review">
        <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
          <span className="badge ok">+{diff.added.length} {t("added")}</span>
          <span className="badge warn">~{diff.changed.length} {t("changed")}</span>
          <span className="badge danger">−{diff.removed.length} {t("removed")}</span>
        </div>
        {!!review.patch.report?.length && (
          <details open className="callout" style={{ display: "block", marginBottom: 12 }}>
            <summary style={{ cursor: "pointer", fontWeight: 500 }}>{t("Report ({count})", { count: review.patch.report.length })}</summary>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, maxHeight: 180, overflow: "auto" }}>{review.patch.report.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </details>
        )}
        {empty && <p className="muted">{t("Nothing would change.")}</p>}
        {review.patch.adrs?.map((a) => (
          <details key={a.id} open className="card card-pad" style={{ marginBottom: 12 }} data-testid="review-adr">
            <summary style={{ cursor: "pointer" }}><strong>{a.id} {a.title}</strong> <span className="badge">{a.status}</span></summary>
            <pre style={{ whiteSpace: "pre-wrap", maxHeight: 240, overflow: "auto" }}>{a.body}</pre>
          </details>
        ))}
        <div className="card scroll diff-list" style={{ maxHeight: 360 }}>
          {diff.added.map((a) => <div key={a.kind + a.id} className="diff-row add"><span className="diff-sign">+</span> {a.kind}: {a.label}</div>)}
          {diff.changed.map((c) => (
            <div key={c.kind + c.id} className="diff-row change">
              <span className="diff-sign">~</span> {c.kind}: {c.label}
              {c.fields.map((f) => <div key={f.field} className="muted" style={{ paddingLeft: 22, fontSize: 11.5 }}>{f.field}: {show(f.before)} → {show(f.after)}</div>)}
            </div>
          ))}
          {diff.removed.map((a) => <div key={a.kind + a.id} className="diff-row remove"><span className="diff-sign">−</span> {a.kind}: {a.label}</div>)}
        </div>
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
      <pre className="scroll card" style={{ margin: 0, padding: 10, maxHeight: 300, fontSize: 11 }}>{text ?? t("(deleted)")}</pre>
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
      <div className="flex gap-2 mt-4">
        <span className="muted" style={{ marginRight: "auto" }}>{t("{count} conflict(s) left", { count: conflicts.length })}</span>
        <Button onClick={() => void resolveConflict(c.path, "theirs")}>{t("Take theirs")}</Button>
        <Button variant="primary" onClick={() => void resolveConflict(c.path, "ours")}>{t("Keep mine")}</Button>
      </div>
    </Modal>
  );
}

export function AboutDialog({ onClose }: { onClose(): void }) {
  return (
    <Modal title={t("About Vastitecture")} onClose={onClose}>
      <div className="flex items-center gap-3" style={{ marginBottom: 8 }}>
        <span className="brand-mark" style={{ width: 40, height: 40, borderRadius: 10 }} aria-hidden><Boxes size={22} strokeWidth={2} /></span>
        <div><strong style={{ fontSize: 15 }}>{t("Vastitecture")}</strong><div className="faint">{t("Version {version}", { version: __APP_VERSION__ })}</div></div>
      </div>
      <p>{t("An open-source, local-first workspace for modelling architecture in ArchiMate, C4, DDD and TOGAF. Model once, view many.")}</p>
      <p>{t("No account, no server, no telemetry. The app makes no network calls unless you run a discovery connector or enable the AI assistant.")}</p>
      <p data-testid="trademarks">{t("ArchiMate® and TOGAF® are registered trademarks of The Open Group.")}</p>
      <p className="muted">{t("C4 model by Simon Brown. Structurizr, Archi, Context Mapper, Mermaid, PlantUML and draw.io are the property of their respective owners; Vastitecture reads and writes their file formats and is not affiliated with them.")}</p>
    </Modal>
  );
}
