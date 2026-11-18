import en from "./messages/en.json";

/**
 * gettext-style messages: the English source string is the key. `pnpm i18n:extract` regenerates
 * messages/en.json from the source, and other locales are files with the same keys.
 */
let messages: Record<string, string> = en;

export function setMessages(m: Record<string, string>) {
  messages = { ...en, ...m };
}

export function t(source: string, params?: Record<string, string | number>): string {
  const m = messages[source] ?? source;
  return params ? m.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? "")) : m;
}
