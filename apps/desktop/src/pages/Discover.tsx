import { useEffect, useState } from "react";
import { reconcilePatch, type ConnectorCli, type ImportInput, type WriteBackItem } from "@vastitecture/core";
import { model, registry, set, toast, useRegistryVersion } from "../state";
import { isTauri, pickFiles, secrets } from "../platform";
import { MANIFESTS } from "@vastitecture/connectors-discovery";
import { t } from "../i18n";

const FOLDER_FILES = /\.(ya?ml|json|tfstate)$/i;
const SKIP = new Set(["node_modules", "vendor", "dist", "build", "target", "__pycache__", ".venv", "venv"]);

/**
 * Read a folder the user picks (Chromium and the desktop app). Specs, manifests and state files are read;
 * other files are listed by name only (enough to detect languages), so large repositories stay cheap.
 */
async function pickFolderFiles(namesToo: boolean): Promise<ImportInput[]> {
  const picker = (window as unknown as { showDirectoryPicker?: (o?: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  if (!picker) return [];
  const root = await picker({ mode: "read" }).catch(() => undefined);
  if (!root) return [];
  const out: ImportInput[] = [];
  const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
    for await (const [name, h] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (SKIP.has(name) || out.length >= 20000) continue;
      const path = `${prefix}${name}`;
      if (h.kind === "directory") {
        if (!name.startsWith(".") || name === ".git") await walk(h as FileSystemDirectoryHandle, `${path}/`);
        continue;
      }
      if (prefix.endsWith(".git/") && name !== "config") continue;
      const wanted = FOLDER_FILES.test(name) || MANIFESTS.test(path);
      if (wanted) out.push({ name: path, text: await (await (h as FileSystemFileHandle).getFile()).text() });
      else if (namesToo) out.push({ name: path, text: "" });
    }
  };
  await walk(root, root.name + "/");
  return out;
}

const CLI_NAME = { aws: "AWS CLI", gcloud: "gcloud", az: "Azure CLI", kubectl: "kubectl" } as const;
const CLI_JSON = { aws: "--output json", gcloud: "--format=json", az: "-o json", kubectl: "--all-namespaces -o json" } as const;

/** Desktop: run a connector's read-only cloud CLI commands with the user's own login. */
async function readFromCli(cli: ConnectorCli, config: Record<string, string>): Promise<{ files: ImportInput[]; errors: string[] }> {
  const { invoke } = await import("@tauri-apps/api/core");
  const flags = Object.entries(cli.flags ?? {}).filter(([k]) => config[k]).map(([k, flag]) => [flag, config[k]] as [string, string]);
  const files: ImportInput[] = [];
  const errors: string[] = [];
  for (const args of cli.commands) {
    try {
      files.push({ name: `${cli.tool}-${args.join("-")}.json`, text: await invoke<string>("cloud_cli", { tool: cli.tool, args, flags }) });
    } catch (e) {
      errors.push(`${cli.tool} ${args.join(" ")}: ${String(e).split("\n")[0]}`);
    }
  }
  return { files, errors };
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
  const [cliErrors, setCliErrors] = useState<string[]>([]);
  const [stored, setStored] = useState<Record<string, boolean>>({});
  const [plan, setPlan] = useState<{ items: WriteBackItem[]; report: string[]; picked: Set<string>; confirming?: boolean; results?: string[] }>();
  useEffect(() => {
    // Show which secrets are already in the keychain, without ever reading them into the page.
    let live = true;
    void Promise.all((c?.fields ?? []).filter((f) => f.type === "secret" && f.secret).map(async (f) => [f.key, !!(await secrets.get(f.secret!))] as const)).then(
      (pairs) => live && setStored(Object.fromEntries(pairs)),
    );
    return () => void (live = false);
  }, [c?.id]);
  if (!c) return <div style={{ padding: 16 }}>{t("No discovery connectors are installed.")}</div>;
  const needsFiles = c.fields.some((f) => f.type === "files" && !f.optional);
  /** Secrets go to the OS keychain; the connector reads them from there, never from the config. */
  const storeSecrets = async () => {
    for (const f of c.fields.filter((x) => x.type === "secret" && x.secret && config[x.key])) {
      await secrets.set(f.secret!, config[f.key]);
      setStored((s) => ({ ...s, [f.key]: true }));
    }
    const cleanConfig = Object.fromEntries(Object.entries(config).filter(([k]) => c.fields.find((f) => f.key === k)?.type !== "secret"));
    setConfig(cleanConfig);
    return cleanConfig;
  };
  const run = async () => {
    setBusy(true);
    try {
      const cleanConfig = await storeSecrets();
      const draft = await c.discover({ files, config: cleanConfig }, model.state);
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
          <div key={x.id} role="button" tabIndex={0} className={`row${x.id === c.id ? " active" : ""}`} onClick={() => (setId(x.id), setFiles([]), setConfig({}), setCliErrors([]), setPlan(undefined))} onKeyDown={(e) => e.key === "Enter" && setId(x.id)}>
            {x.label}
          </div>
        ))}
      </nav>
      <div style={{ padding: 16, maxWidth: 760 }}>
        <h2 style={{ marginTop: 0 }}>{c.label}</h2>
        {c.description && <p className="muted">{c.description}</p>}
        <p className="muted" style={{ fontSize: 12 }}>{t("Read-only: nothing is changed until you review the result and press Apply. Running it again later updates the same elements.")}</p>
        {c.cli && (
          <div className="panel" style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 8, margin: "8px 0" }}>
            {isTauri ? (
              <>
                <button className="btn" disabled={busy} onClick={async () => {
                  setBusy(true);
                  const r = await readFromCli(c.cli!, config).finally(() => setBusy(false));
                  setFiles([...files.filter((x) => !r.files.some((y) => y.name === x.name)), ...r.files]);
                  setCliErrors(r.errors);
                }}>{t("Read from my {cli} login", { cli: CLI_NAME[c.cli.tool] })}</button>
                <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>{t("Runs {count} read-only list/describe commands with your installed {cli} and its current sign-in. Nothing in your account is changed.", { count: c.cli.commands.length, cli: CLI_NAME[c.cli.tool] })}</p>
              </>
            ) : (
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                {t("In the browser, run these read-only commands and pick their output files below (the desktop app can run them for you):")}
                <code style={{ display: "block", whiteSpace: "pre-wrap", marginTop: 4 }}>{c.cli.commands.map((x) => `${c.cli!.tool} ${x.join(" ")} ${CLI_JSON[c.cli!.tool]} > ${c.cli!.tool}-${x.join("-")}.json`).join("\n")}</code>
              </p>
            )}
            {!!cliErrors.length && (
              <details style={{ marginTop: 4 }} open={cliErrors.length === c.cli.commands.length}>
                <summary className="sev-warning">{t("{count} command(s) failed", { count: cliErrors.length })}</summary>
                <ul style={{ fontSize: 12 }}>{cliErrors.map((e) => <li key={e}>{e}</li>)}</ul>
              </details>
            )}
          </div>
        )}
        {c.fields.map((f) =>
          f.type === "files" ? (
            <div key={f.key}>
              <div className="label">{f.label}</div>
              <div className="flex gap-2 items-center">
                <button className="btn" onClick={async () => setFiles([...files, ...(await pickFiles(c.id === "github" ? "" : ".yaml,.yml,.json,.tfstate,.csv,.xmi,.xml", true))])}>{t("Add files…")}</button>
                {"showDirectoryPicker" in window && <button className="btn" onClick={async () => setFiles([...files, ...(await pickFolderFiles(c.id === "git"))])}>{t("Add a folder…")}</button>}
                {!!files.length && <button className="btn ghost" onClick={() => setFiles([])}>{t("Clear")}</button>}
              </div>
              <ul data-testid="discover-files" style={{ margin: "6px 0", paddingLeft: 18, maxHeight: 160, overflow: "auto" }}>
                {files.filter((x) => x.text).slice(0, 200).map((x, i) => <li key={i}>{x.name}</li>)}
                {files.some((x) => !x.text) && <li className="muted">{t("+ {count} other files (names only)", { count: files.filter((x) => !x.text).length })}</li>}
              </ul>
            </div>
          ) : (
            <div key={f.key}>
              <label className="label" htmlFor={`cf-${f.key}`}>{f.label}</label>
              <input
                id={`cf-${f.key}`}
                className="input"
                type={f.type === "secret" ? "password" : "text"}
                autoComplete={f.type === "secret" ? "off" : undefined}
                placeholder={f.type === "secret" && stored[f.key] ? t("Stored in the keychain (type to replace)") : f.placeholder}
                value={config[f.key] ?? ""}
                onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}
              />
              {f.type === "secret" && stored[f.key] && (
                <button className="btn ghost" style={{ fontSize: 12 }} onClick={async () => (await secrets.set(f.secret!, ""), setStored((s) => ({ ...s, [f.key]: false })))}>{t("Forget stored value")}</button>
              )}
            </div>
          ),
        )}
        <button className="btn primary mt-3" disabled={busy || (needsFiles && !files.length)} onClick={() => void run()}>{busy ? t("Discovering…") : t("Discover")}</button>
        {c.planWriteBack && (
          <section className="panel" style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 10, marginTop: 16 }} data-testid="write-back">
            <h3 style={{ marginTop: 0 }}>{t("Write back to {name}", { name: c.label })}</h3>
            <p className="muted" style={{ fontSize: 12 }}>{t("Compares the model with the live system and lists names, descriptions and dependencies changed in the model. Nothing is sent until you pick changes and confirm. Nothing is ever deleted.")}</p>
            <button className="btn" disabled={busy} onClick={async () => {
              setBusy(true);
              try {
                const r = await c.planWriteBack!({ config: await storeSecrets() }, model.state);
                setPlan({ ...r, picked: new Set(r.items.map((x) => x.id)) });
              } catch (e) {
                toast(t("Comparison failed: {error}", { error: e instanceof Error ? e.message : String(e) }));
              } finally {
                setBusy(false);
              }
            }}>{t("Compare with the live system")}</button>
            {plan && (
              <div style={{ marginTop: 8 }}>
                <ul className="muted" style={{ fontSize: 12, paddingLeft: 18 }}>{plan.report.map((r) => <li key={r}>{r}</li>)}</ul>
                {plan.items.map((it) => (
                  <label key={it.id} className="flex gap-2" style={{ alignItems: "flex-start", fontSize: 13, margin: "4px 0" }}>
                    <input type="checkbox" checked={plan.picked.has(it.id)} onChange={(e) => { const picked = new Set(plan.picked); if (e.target.checked) picked.add(it.id); else picked.delete(it.id); setPlan({ ...plan, picked, confirming: false }); }} />
                    <span>
                      {it.label}
                      {(it.before !== undefined || it.after !== undefined) && <span className="muted" style={{ display: "block", fontSize: 11 }}>{it.before !== undefined ? `“${it.before || "∅"}” → ` : ""}“{it.after}”</span>}
                    </span>
                  </label>
                ))}
                {!!plan.items.length && !plan.results && (plan.confirming ? (
                  <p role="alert">
                    {t("This changes {count} record(s) in the live system. Continue?", { count: plan.picked.size })}{" "}
                    <button className="btn primary" disabled={busy} onClick={async () => {
                      setBusy(true);
                      try {
                        const results = await c.applyWriteBack!({ config: await storeSecrets() }, plan.items.filter((x) => plan.picked.has(x.id)));
                        setPlan({ ...plan, confirming: false, results });
                      } catch (e) {
                        toast(t("Write-back failed: {error}", { error: e instanceof Error ? e.message : String(e) }));
                      } finally {
                        setBusy(false);
                      }
                    }}>{t("Yes, write the changes")}</button>{" "}
                    <button className="btn" onClick={() => setPlan({ ...plan, confirming: false })}>{t("Cancel")}</button>
                  </p>
                ) : (
                  <button className="btn primary" disabled={!plan.picked.size} onClick={() => setPlan({ ...plan, confirming: true })}>{t("Write {count} selected change(s)…", { count: plan.picked.size })}</button>
                ))}
                {plan.results && <ul data-testid="write-back-results" style={{ fontSize: 13 }}>{plan.results.map((r, i) => <li key={i}>{r}</li>)}</ul>}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
