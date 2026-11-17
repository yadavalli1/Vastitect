import { useEffect, useState } from "react";
import { aiSettings, useAiSettings } from "../ai";
import { isTauri } from "../platform";
import { setDevMode } from "./Plugins";
import { setTheme, useApp } from "../state";
import { t } from "../i18n";

export function SettingsPage() {
  const ai = useAiSettings();
  const theme = useApp((s) => s.theme);
  const devMode = useApp((s) => s.devMode);
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  useEffect(() => void aiSettings.hasKey().then(setHasKey), []);
  return (
    <div style={{ padding: 16, maxWidth: 720 }} data-testid="settings-page">
      <h2 style={{ marginTop: 0 }}>{t("Settings")}</h2>
      <section>
        <h3>{t("Appearance")}</h3>
        <label className="flex items-center gap-2"><input type="radio" name="theme" checked={theme === "light"} onChange={() => setTheme("light")} /> {t("Light")}</label>
        <label className="flex items-center gap-2"><input type="radio" name="theme" checked={theme === "dark"} onChange={() => setTheme("dark")} /> {t("Dark")}</label>
        <label className="flex items-center gap-2 mt-2"><input type="checkbox" checked={devMode} onChange={(e) => setDevMode(e.target.checked)} /> {t("Plugin developer mode")}</label>
      </section>
      <section>
        <h3>{t("AI assistant")}</h3>
        <p className="muted">
          {t("Optional and off by default. Vastitecture is fully usable without it. When on, it sends the parts of the model you ask about to the endpoint below, only when you run an assistant action. Every change it proposes is shown as a diff before anything is applied.")}
        </p>
        <label className="flex items-center gap-2"><input type="checkbox" checked={ai.enabled} onChange={(e) => aiSettings.set({ enabled: e.target.checked })} /> {t("Enable the assistant")}</label>
        <label className="label" htmlFor="ai-url">{t("OpenAI-compatible base URL")}</label>
        <input id="ai-url" className="input" value={ai.baseUrl} onChange={(e) => aiSettings.set({ baseUrl: e.target.value })} placeholder={t("https://api.openai.com/v1")} />
        <p className="muted" style={{ fontSize: 12, margin: "4px 0" }}>{t("Examples: http://localhost:11434/v1 (Ollama), http://localhost:4000/v1 (LiteLLM), https://api.openai.com/v1")}</p>
        <label className="label" htmlFor="ai-model">{t("Model")}</label>
        <input id="ai-model" className="input" value={ai.model} onChange={(e) => aiSettings.set({ model: e.target.value })} />
        <label className="label" htmlFor="ai-key">{t("API key")}</label>
        <div className="flex gap-2">
          <input id="ai-key" className="input" type="password" autoComplete="off" value={key} placeholder={hasKey ? t("A key is stored") : t("Not needed for local models")} onChange={(e) => setKey(e.target.value)} />
          <button className="btn" disabled={!key} onClick={async () => (await aiSettings.setKey(key), setKey(""), setHasKey(true))}>{t("Save key")}</button>
          {hasKey && <button className="btn" onClick={async () => (await aiSettings.setKey(""), setHasKey(false))}>{t("Remove key")}</button>}
        </div>
        <p className="muted" style={{ fontSize: 12 }}>{isTauri ? t("The key is stored in your operating system's keychain.") : t("In the browser build the key is kept in memory for this session only. Use the desktop app to store it in the OS keychain.")}</p>
      </section>
    </div>
  );
}
