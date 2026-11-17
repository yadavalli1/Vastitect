import { useState } from "react";
import { reconcilePatch, type ImportInput } from "@vastitecture/core";
import { model, registry, set, toast, useRegistryVersion } from "../state";
import { pickFiles } from "../platform";
import { t } from "../i18n";

const FOLDER_FILES = /\.(ya?ml|json|tfstate)$/i;

/** Read every YAML/JSON file under a folder the user picks (Chromium and the desktop app). */
async function pickFolderFiles(): Promise<ImportInput[]> {
  const picker = (window as unknown as { showDirectoryPicker?: (o?: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  if (!picker) return [];
  const root = await picker({ mode: "read" }).catch(() => undefined);
  if (!root) return [];
  const out: ImportInput[] = [];
  const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
    for await (const [name, h] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (name.startsWith(".") || name === "node_modules") continue;
      if (h.kind === "directory") await walk(h as FileSystemDirectoryHandle, `${prefix}${name}/`);
      else if (FOLDER_FILES.test(name) && out.length < 2000) out.push({ name: prefix + name, text: await (await (h as FileSystemFileHandle).getFile()).text() });
    }
  };
  await walk(root, "");
  return out;
}

/**
 * Discovery connectors build a draft model from real systems. They are read-only, run only when the
 * user presses Discover, and their result is shown as a diff before anything is applied.
 */
export function DiscoverPage() {
  useRegistryVersion();
  const connectors = [...registry.connectors.values()];
  const [id, setId] = useState(connectors[0]?.id);
  const c = registry.connectors.get(id ?? "") ?? connectors[0];
  const [files, setFiles] = useState<ImportInput[]>([]);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  if (!c) return <div style={{ padding: 16 }}>{t("No discovery connectors are installed.")}</div>;
  const needsFiles = c.fields.some((f) => f.type === "files");
  const run = async () => {
    setBusy(true);
    try {
      const draft = await c.discover({ files, config }, model.state);
      // Re-running updates the same elements (matched by external id) and the same draft views.
      const patch = reconcilePatch(model.state, draft);
      set({ review: { title: t("Discover: {name}", { name: c.label }), patch, layoutViews: patch.layout } });
    } catch (e) {
      toast(t("Discovery failed: {error}", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex h-full" data-testid="discover-page">
      <nav className="panel border-r scroll" style={{ width: 260 }} aria-label={t("Connectors")}>
        <div className="h">{t("Discovery connectors")}</div>
        {connectors.map((x) => (
          <div key={x.id} role="button" tabIndex={0} className={`row${x.id === c.id ? " active" : ""}`} onClick={() => (setId(x.id), setFiles([]), setConfig({}))} onKeyDown={(e) => e.key === "Enter" && setId(x.id)}>
            {x.label}
          </div>
        ))}
      </nav>
      <div style={{ padding: 16, maxWidth: 760 }}>
        <h2 style={{ marginTop: 0 }}>{c.label}</h2>
        {c.description && <p className="muted">{c.description}</p>}
        <p className="muted" style={{ fontSize: 12 }}>{t("Read-only: nothing is changed until you review the result and press Apply. Running it again later updates the same elements.")}</p>
        {c.fields.map((f) =>
          f.type === "files" ? (
            <div key={f.key}>
              <div className="label">{f.label}</div>
              <div className="flex gap-2 items-center">
                <button className="btn" onClick={async () => setFiles([...files, ...(await pickFiles(".yaml,.yml,.json,.tfstate", true))])}>{t("Add files…")}</button>
                {"showDirectoryPicker" in window && <button className="btn" onClick={async () => setFiles([...files, ...(await pickFolderFiles())])}>{t("Add a folder…")}</button>}
                {!!files.length && <button className="btn ghost" onClick={() => setFiles([])}>{t("Clear")}</button>}
              </div>
              <ul data-testid="discover-files" style={{ margin: "6px 0", paddingLeft: 18, maxHeight: 160, overflow: "auto" }}>
                {files.map((x, i) => <li key={i}>{x.name}</li>)}
              </ul>
            </div>
          ) : (
            <div key={f.key}>
              <label className="label" htmlFor={`cf-${f.key}`}>{f.label}</label>
              <input id={`cf-${f.key}`} className="input" placeholder={f.placeholder} value={config[f.key] ?? ""} onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })} />
            </div>
          ),
        )}
        <button className="btn primary mt-3" disabled={busy || (needsFiles && !files.length)} onClick={() => void run()}>{busy ? t("Discovering…") : t("Discover")}</button>
      </div>
    </div>
  );
}
