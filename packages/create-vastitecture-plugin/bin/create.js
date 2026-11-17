#!/usr/bin/env node
// Scaffold a Vastitecture plugin folder. No dependencies, no build step: the result is plain ES modules
// you can drop into ~/.vastitecture/plugins or <workspace>/.vastitecture/plugins.
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATES = ["notation", "importer", "exporter", "validator", "connector"];
const here = dirname(fileURLToPath(import.meta.url));

function usage(code = 0) {
  console.log(`Usage: create-vastitecture-plugin <folder> [--template ${TEMPLATES.join("|")}] [--id my.plugin] [--name "My plugin"]

Creates a plugin folder with plugin.json, index.js and a README.
Templates:
  notation   a new notation pack: element types, relationships, viewpoints, validity rules (default)
  importer   reads a file format into a reviewable model patch
  exporter   writes the model or one view to a file format
  validator  adds checks to the problems panel
  connector  discovers a draft model from files or an API (declares network permission)`);
  process.exit(code);
}

export function scaffold(dir, opts = {}) {
  const template = opts.template ?? "notation";
  if (!TEMPLATES.includes(template)) throw new Error(`Unknown template "${template}". Choose one of: ${TEMPLATES.join(", ")}`);
  const slug = basename(resolve(dir)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "my-plugin";
  const id = opts.id ?? `local.${slug}`;
  const name = opts.name ?? slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const ns = slug.replace(/-/g, "").slice(0, 16) || "custom";
  if (existsSync(dir) && readdirSync(dir).length) throw new Error(`${dir} already exists and is not empty`);
  mkdirSync(dir, { recursive: true });
  const fill = (text) => text.replaceAll("__ID__", id).replaceAll("__NAME__", name).replaceAll("__NS__", ns).replaceAll("__SLUG__", slug);
  for (const file of ["plugin.json", "index.js"]) writeFileSync(join(dir, file), fill(readFileSync(join(here, "..", "templates", template, file), "utf8")));
  writeFileSync(join(dir, "README.md"), fill(readFileSync(join(here, "..", "templates", "README.md"), "utf8")));
  return { dir, id, name, template };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("-h") || args.includes("--help")) usage(args.length ? 0 : 1);
  const opt = (k) => {
    const i = args.indexOf(k);
    return i >= 0 ? args.splice(i, 2)[1] : undefined;
  };
  const template = opt("--template"), id = opt("--id"), name = opt("--name");
  try {
    const r = scaffold(args[0], { template, id, name });
    console.log(`Created ${r.template} plugin "${r.name}" (${r.id}) in ${r.dir}

Next:
  1. Edit ${join(r.dir, "index.js")}
  2. Copy the folder to ~/.vastitecture/plugins/ (or your workspace's .vastitecture/plugins/)
  3. In Vastitecture open Plugins and press "Rescan plugin folders" (or turn on developer mode to hot-reload)`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
