import { useEffect, useState } from "react";
import { aiSettings, useAiSettings } from "../ai";
import { isTauri } from "../platform";
import { setDevMode } from "./Plugins";
import { setTheme, useApp } from "../state";
import { t } from "../i18n";
import { KeyRound, Moon, Sun } from "lucide-react";
import { PageHeader } from "../ui";

export function SettingsPage() {
  const ai = useAiSettings();
  const theme = useApp((s) => s.theme);
  const devMode = useApp((s) => s.devMode);
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  useEffect(() => void aiSettings.hasKey().then(setHasKey), []);
  return (
    <div className="page" style={{ maxWidth: 760 }} data-testid="settings-page">
      <PageHeader title={t("Settings")} description={t("Preferences for this computer. Workspace settings live in vastitecture.yaml.")} />
      <section className="card card-pad stack">
        <h3 style={{ marginTop: 0 }}>{t("Appearance")}</h3>
        <div className="flex items-center gap-3">
          <span className="muted" style={{ width: 120 }}>{t("Theme")}</span>
          <div className="tabs" role="radiogroup" aria-label={t("Theme")}>
            {(["light", "dark"] as const).map((x) => (
              <button key={x} type="button" role="radio" aria-checked={theme === x} className={theme === x ? "seg on" : "seg"} onClick={() => setTheme(x)}>
                {x === "light" ? <Sun size={14} aria-hidden /> : <Moon size={14} aria-hidden />} {x === "light" ? t("Light") : t("Dark")}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={devMode} onChange={(e) => setDevMode(e.target.checked)} /> {t("Plugin developer mode")}</label>
        <p className="hint" style={{ marginTop: -6, marginLeft: 22 }}>{t("Reload plugins from their folders when their files change, and show plugin errors in full.")}</p>
      </section>
      <section className="card card-pad" style={{ marginTop: 16 }}>
        <div className="flex items-center gap-2">
          <h3 style={{ margin: 0, flex: 1 }}>{t("AI assistant")}</h3>
          <span className={`badge${ai.enabled ? " ok" : ""}`}>{ai.enabled ? t("On") : t("Off")}</span>
        </div>
        <p className="muted" style={{ marginTop: 6 }}>
          {t("Optional and off by default. Vastitecture is fully usable without it. When on, it sends the parts of the model you ask about to the endpoint below, only when you run an assistant action. Every change it proposes is shown as a diff before anything is applied.")}
        </p>
        <label className="flex items-center gap-2"><input type="checkbox" checked={ai.enabled} onChange={(e) => aiSettings.set({ enabled: e.target.checked })} /> {t("Enable the assistant")}</label>
        <label className="label" htmlFor="ai-url">{t("OpenAI-compatible base URL")}</label>
        <input id="ai-url" className="input" value={ai.baseUrl} onChange={(e) => aiSettings.set({ baseUrl: e.target.value })} placeholder={t("https://api.openai.com/v1")} />
        <p className="hint">{t("Examples: http://localhost:11434/v1 (Ollama), http://localhost:4000/v1 (LiteLLM), https://api.openai.com/v1")}</p>
        <label className="label" htmlFor="ai-model">{t("Model")}</label>
        <input id="ai-model" className="input" value={ai.model} onChange={(e) => aiSettings.set({ model: e.target.value })} />
        <label className="label" htmlFor="ai-key">{t("API key")}</label>
        <div className="flex gap-2">
          <input id="ai-key" className="input" type="password" autoComplete="off" value={key} placeholder={hasKey ? t("A key is stored") : t("Not needed for local models")} onChange={(e) => setKey(e.target.value)} />
          <button className="btn" disabled={!key} onClick={async () => (await aiSettings.setKey(key), setKey(""), setHasKey(true))}>{t("Save key")}</button>
          {hasKey && <button className="btn danger" onClick={async () => (await aiSettings.setKey(""), setHasKey(false))}>{t("Remove key")}</button>}
        </div>
        <p className="hint flex items-center gap-1"><KeyRound size={12} aria-hidden /> {isTauri ? t("The key is stored in your operating system's keychain.") : t("In the browser build the key is kept in memory for this session only. Use the desktop app to store it in the OS keychain.")}</p>
      </section>
    </div>
  );
}
