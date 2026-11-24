import { useEffect, useState, useSyncExternalStore } from "react";
import type { PluginManifest } from "@vastitecture/plugin-sdk";
import { installInBrowser, loadInstalledPlugins, loadPlugin, loaded, pluginsVersion, setApprover, subscribePlugins, uninstall } from "../plugins";
import { app, set, toast, useApp } from "../state";
import { isTauri, pickFiles } from "../platform";
import { Modal } from "../panels/Dialogs";
import { t } from "../i18n";
import { Puzzle } from "lucide-react";
import { PageHeader } from "../ui";

let pending: { manifest: PluginManifest; origin: string; resolve(ok: boolean): void } | undefined;
const approvalListeners = new Set<() => void>();
setApprover(
  (manifest, origin) =>
    new Promise((resolve) => {
      pending = { manifest, origin, resolve };
      for (const l of approvalListeners) l();
    }),
);

/** Shown before a plugin's code is ever run: what it wants to do, in plain words. */
export function PluginApproval() {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    approvalListeners.add(l);
    return () => void approvalListeners.delete(l);
  }, []);
  if (!pending) return null;
  const { manifest: m, origin } = pending;
  const done = (ok: boolean) => {
    pending!.resolve(ok);
    pending = undefined;
    tick((n) => n + 1);
  };
  const perms = m.permissions ?? {};
  return (
    <Modal title={t("Allow plugin “{name}”?", { name: m.name })} onClose={() => done(false)}>
      <div data-testid="plugin-approval">
        <p>
          <strong>{m.name}</strong> {m.version} <span className="muted">({m.id}, {origin})</span>
        </p>
        {m.description && <p>{m.description}</p>}
        <p>{t("It runs in a sandbox and can only do what is listed here:")}</p>
        <ul>
          <li>{t("Adds: {capabilities}", { capabilities: m.capabilities.join(", ") })}</li>
          <li>{perms.network?.length ? t("Contacts these hosts when you run it: {hosts}", { hosts: perms.network.join(", ") }) : t("No network access")}</li>
          <li>{perms.fs?.length ? t("Reads files: {scopes}", { scopes: perms.fs.join(", ") }) : t("No file access beyond what you hand it")}</li>
          <li>{perms.secrets?.length ? t("Reads these secrets from the keychain: {names}", { names: perms.secrets.join(", ") }) : t("No access to stored secrets")}</li>
        </ul>
        <div className="flex gap-2 mt-3">
          <button className="btn primary" onClick={() => done(true)}>{t("Allow")}</button>
          <button className="btn" onClick={() => done(false)}>{t("Don’t allow")}</button>
        </div>
      </div>
    </Modal>
  );
}

const workspaceRoot = () => {
  const label = app.getState().fsLabel;
  return isTauri && !label.startsWith("browser:") ? label : undefined;
};

/** Developer mode: reload plugins whose files changed on disk. */
let devTimer: ReturnType<typeof setInterval> | undefined;
export function setDevMode(on: boolean) {
  localStorage.setItem("vastitecture/dev", on ? "1" : "0");
  set({ devMode: on });
  clearInterval(devTimer);
  if (on && isTauri) devTimer = setInterval(() => void loadInstalledPlugins(workspaceRoot(), true), 2000);
}

export function PluginsPage() {
  useSyncExternalStore(subscribePlugins, pluginsVersion);
  const devMode = useApp((s) => s.devMode);
  const list = [...loaded.values()];
  const row = (p: (typeof list)[number]) => {
    const h = p.host.plugins.get(p.manifest.id)!;
    const perms = p.manifest.permissions ?? {};
    return (
      <tr key={p.manifest.id} data-plugin={p.manifest.id}>
        <td style={{ minWidth: 200, padding: "8px 10px" }}><strong>{p.manifest.name}</strong><div className="faint mono" style={{ fontSize: 11 }}>{p.manifest.id} · {p.manifest.version}</div></td>
        <td style={{ whiteSpace: "nowrap" }}>{p.origin === "builtin" ? t("Built-in") : p.origin === "user" ? t("User folder") : p.origin === "workspace" ? t("Workspace folder") : t("Browser storage")}</td>
        <td><span className={`badge ${h.status === "active" ? "ok" : h.status === "failed" ? "danger" : ""}`}>{h.status === "active" ? t("Active") : h.status === "loading" ? t("Loading…") : t("Failed: {error}", { error: h.error ?? "" })}</span></td>
        <td style={{ fontSize: 12, padding: "8px 10px" }}>{h.registered.map((r) => `${r.kind}: ${r.id}`).join(", ")}</td>
        <td style={{ fontSize: 12, padding: "8px 10px" }} className="muted">{[perms.network?.length ? `network: ${perms.network.join(", ")}` : "", perms.fs?.length ? `files: ${perms.fs.join(", ")}` : "", perms.secrets?.length ? `secrets: ${perms.secrets.join(", ")}` : ""].filter(Boolean).join(" · ") || <span className="muted">{t("none")}</span>}</td>
        <td>
          {p.origin !== "builtin" && (
            <span className="flex gap-1">
              <button className="btn" onClick={() => void loadPlugin({ manifestJson: JSON.stringify(p.manifest), code: p.code!, origin: p.origin as never, dir: p.dir })}>{t("Reload")}</button>
              <button className="btn" onClick={() => uninstall(p.manifest.id)}>{p.origin === "browser" ? t("Remove") : t("Unload")}</button>
            </span>
          )}
        </td>
      </tr>
    );
  };
  return (
    <div className="page" data-testid="plugins-page">
      <PageHeader icon={Puzzle} title={t("Plugins")} description={t("Every notation, importer, exporter and connector is a plugin. Built-ins and third-party plugins use the same API and run in sandboxed workers. To install one, drop its folder into ~/.vastitecture/plugins or the workspace's .vastitecture/plugins, then press Rescan.")} />
      <div className="flex gap-2 items-center" style={{ marginBottom: 10 }}>
        <button className="btn" onClick={() => void loadInstalledPlugins(workspaceRoot()).then(() => toast(t("Plugin folders rescanned")))}>{t("Rescan plugin folders")}</button>
        <button className="btn" onClick={async () => {
          const files = await pickFiles(".json,.js,.mjs", true);
          const manifest = files.find((f) => f.name === "plugin.json");
          const entryName = manifest ? (JSON.parse(manifest.text).entry ?? "index.js") : "index.js";
          const code = files.find((f) => f.name === entryName.replace(/^.*\//, ""));
          if (!manifest || !code) return toast(t("Select the plugin's plugin.json and its entry file together"));
          try {
            await installInBrowser(manifest.text, code.text);
          } catch (e) {
            toast(e instanceof Error ? e.message : String(e));
          }
        }}>{t("Install from files…")}</button>
        <label className="flex items-center gap-2" style={{ marginLeft: 12 }}>
          <input type="checkbox" checked={devMode} onChange={(e) => setDevMode(e.target.checked)} /> {t("Developer mode (hot-reload plugin folders)")}
        </label>
      </div>
      <table className="data-table">
        <thead><tr><th>{t("Plugin")}</th><th>{t("From")}</th><th>{t("Status")}</th><th>{t("Provides")}</th><th>{t("Permissions")}</th><th /></tr></thead>
        <tbody>{list.filter((p) => p.origin !== "builtin").map(row)}{list.filter((p) => p.origin === "builtin").map(row)}</tbody>
      </table>
    </div>
  );
}
