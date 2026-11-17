#!/usr/bin/env node
// The desktop webview sniffs file content to choose a MIME type. A JavaScript chunk containing a file
// signature (e.g. "%PDF-") can be served as that type and fail to load, so the app hangs at start-up.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = new URL("../apps/desktop/dist/assets/", import.meta.url).pathname;
const SIGNATURES = ["%PDF-", "%!PS-Adobe", "GIF87a", "GIF89a", "\x89PNG", "PK\x03\x04", "\x1f\x8b\x08", "{\\rtf1", "OggS", "fLaC", "ID3"];
let bad = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
  const text = readFileSync(join(dir, f), "latin1");
  for (const sig of SIGNATURES)
    if (text.includes(sig)) {
      console.error(`${f} contains the file signature ${JSON.stringify(sig)}; build that string at run time instead.`);
      bad++;
    }
}
if (bad) process.exit(1);
console.log("No file signatures in the JavaScript bundle");
