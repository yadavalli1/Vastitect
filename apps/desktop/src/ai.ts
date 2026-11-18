import { useSyncExternalStore } from "react";
import type { AiConfig, Fetcher } from "@vastitecture/ai";
import { httpFetch, secrets } from "./platform";

/** Assistant settings. Off by default; the key lives in the OS keychain, never in the workspace or localStorage. */
export interface AiSettings {
  enabled: boolean;
  baseUrl: string;
  model: string;
}
const KEY = "vastitecture/ai";
const SECRET = "ai-api-key";
const DEFAULTS: AiSettings = { enabled: false, baseUrl: "http://localhost:11434/v1", model: "llama3.1" };

let current: AiSettings = (() => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
})();
const listeners = new Set<() => void>();
export const aiSettings = {
  get: () => current,
  set(next: Partial<AiSettings>) {
    current = { ...current, ...next };
    localStorage.setItem(KEY, JSON.stringify(current));
    for (const l of listeners) l();
  },
  subscribe: (l: () => void) => (listeners.add(l), () => void listeners.delete(l)),
  setKey: (key: string) => secrets.set(SECRET, key),
  hasKey: async () => !!(await secrets.get(SECRET)),
};
export const useAiSettings = () => useSyncExternalStore(aiSettings.subscribe, aiSettings.get);

export async function aiConfig(): Promise<AiConfig> {
  if (!current.enabled) throw new Error("The assistant is switched off. Turn it on in Settings.");
  return { baseUrl: current.baseUrl, model: current.model, apiKey: (await secrets.get(SECRET)) || undefined };
}

/** The assistant only reaches the network through the app's HTTP bridge, and only when the user asks it something. */
export const aiFetch: Fetcher = (url, init) => httpFetch(url, init);
