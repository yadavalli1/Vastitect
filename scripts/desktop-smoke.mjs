#!/usr/bin/env node
// End-to-end smoke test of the packaged desktop app through tauri-driver (WebDriver).
// Usage: node scripts/desktop-smoke.mjs <path to app binary> <empty folder>
// Needs tauri-driver running on 127.0.0.1:4444 (and a display, e.g. Xvfb, on Linux).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const [app, dir] = process.argv.slice(2);
const base = "http://127.0.0.1:4444";
const call = async (method, path, body) => (await (await fetch(base + path, { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) })).json()).value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => {
  console.error("FAIL:", msg);
  process.exitCode = 1;
};

async function launch() {
  const s = await call("POST", "/session", { capabilities: { alwaysMatch: { "tauri:options": { application: app } } } });
  if (!s?.sessionId) throw new Error("Could not start the app: " + JSON.stringify(s));
  const id = s.sessionId;
  const js = (script, ...args) => call("POST", `/session/${id}/execute/sync`, { script, args });
  for (let i = 0; i < 60; i++) {
    const phase = await js("return window.__vastitecture && window.__vastitecture.app.getState().phase");
    if (phase === "ready") break;
    if (phase === "error") throw new Error("App failed to start: " + (await js("return window.__vastitecture.app.getState().bootError")));
    await sleep(500);
  }
  return { id, js, quit: () => call("DELETE", `/session/${id}`) };
}

const walk = (d, p = "") => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name), p + e.name + "/") : [p + e.name]));

// 1. Create a folder workspace from the sample: files must appear on disk.
let a = await launch();
await a.js("window.__vastitecture.openFolder(arguments[0], true)", dir);
await sleep(1500);
const files = walk(dir);
console.log(`created ${files.length} files in ${dir}`);
if (!files.includes("vastitecture.yaml")) fail("vastitecture.yaml was not written");
if (!files.some((f) => f.startsWith("model/elements/"))) fail("no element files were written");
if (!files.some((f) => f.startsWith("views/"))) fail("no view files were written");
if (!files.some((f) => f.startsWith("adrs/"))) fail("no decision files were written");

// 2. An edit in the app autosaves to the element's file.
await a.js(`const s = window.__vastitecture; const e = Object.values(s.model.state.elements).find((x) => x.name === "Online Shop");
  s.model.dispatch({ type: "updateElement", id: e.id, patch: { name: "Web Store" } });`);
await sleep(1500);
const shopFile = join(dir, "model/elements/c4/software-system/online-shop.yaml");
if (!existsSync(shopFile) || !readFileSync(shopFile, "utf8").includes("name: Web Store")) fail("the rename was not saved to " + shopFile);
else console.log("rename saved to disk");
const label = await a.js("return window.__vastitecture.app.getState().fsLabel");
if (label !== dir) fail(`the app reports its workspace as ${label}, expected ${dir}`);
await a.quit();

// 3. Restarting the app reopens the same folder.
a = await launch();
const reopened = await a.js("return [window.__vastitecture.app.getState().fsLabel, Object.values(window.__vastitecture.model.state.elements).some((e) => e.name === 'Web Store')]");
if (reopened[0] !== dir || !reopened[1]) fail(`after a restart the app opened ${reopened[0]} (renamed element present: ${reopened[1]})`);
else console.log("restart reopened the folder workspace");
await a.quit();
if (!process.exitCode) console.log("desktop smoke test passed");
