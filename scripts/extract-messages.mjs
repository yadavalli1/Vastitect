#!/usr/bin/env node
// Collect every t("…") source string in the app into apps/desktop/src/messages/en.json.
// `--check` fails (for CI) when the file is out of date, so no user-facing string goes untranslated.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../apps/desktop/src/", import.meta.url).pathname;
const out = join(root, "messages/en.json");
const files = [];
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(n)) files.push(p);
  }
};
walk(root);
const messages = new Set();
const re = /\bt\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\$]|\\.)*`)/g;
for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(re)) messages.add(JSON.parse(m[1].startsWith('"') ? m[1] : `"${m[1].slice(1, -1).replace(/"/g, '\\"')}"`));
const sorted = Object.fromEntries([...messages].sort().map((m) => [m, m]));
const text = JSON.stringify(sorted, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (readFileSync(out, "utf8") !== text) {
    console.error("apps/desktop/src/messages/en.json is out of date. Run `pnpm i18n` and commit the result.");
    process.exit(1);
  }
  console.log(`${messages.size} messages, up to date`);
} else {
  writeFileSync(out, text);
  console.log(`Wrote ${messages.size} messages to ${out}`);
}
