import type { ExportResult, Exporter, ImportInput, Importer, ModelPatch } from "@vastitecture/core";
import { app, model, registry, set, toast } from "./state";
import { pickFiles, saveFile } from "./platform";
import { contributeCommands } from "./commands";
import { t } from "./i18n";

const ext = (name: string) => name.slice(name.lastIndexOf(".") + 1).toLowerCase();

/** Pick the importer for a file: extension first, then each candidate's content sniff. */
export async function importerFor(input: ImportInput): Promise<Importer | undefined> {
  const all = [...registry.importers.values()];
  const byExt = all.filter((i) => i.extensions.includes(ext(input.name)));
  // Importers may live in a sandbox, so their content sniff is asynchronous.
  for (const i of byExt.length ? byExt : all) if (i.detect && (await i.detect(input))) return i;
  return byExt.length === 1 ? byExt[0] : byExt.find((i) => !i.detect);
}

function merge(patches: ModelPatch[]): ModelPatch {
  const out: ModelPatch = { elements: [], relationships: [], views: [], adrs: [], layout: [], report: [] };
  for (const p of patches) {
    out.elements!.push(...(p.elements ?? []));
    out.relationships!.push(...(p.relationships ?? []));
    out.views!.push(...(p.views ?? []));
    out.adrs!.push(...(p.adrs ?? []));
    out.layout!.push(...(p.layout ?? []));
    out.report!.push(...(p.report ?? []));
  }
  return out;
}

/** Run importers and open the result as a reviewable diff. Nothing touches the model until the user applies it. */
export async function importInputs(inputs: ImportInput[], importerId?: string) {
  const patches: ModelPatch[] = [];
  const used = new Set<string>();
  for (const input of inputs) {
    const imp = importerId ? registry.importers.get(importerId) : await importerFor(input);
    if (!imp) {
      toast(t("No importer recognises {name}", { name: input.name }));
      continue;
    }
    try {
      patches.push(await imp.import(input, model.state));
      used.add(imp.label);
    } catch (e) {
      console.error(e);
      toast(t("Could not import {name}: {error}", { name: input.name, error: e instanceof Error ? e.message : String(e) }));
    }
  }
  if (!patches.length) return;
  const patch = merge(patches);
  set({ review: { title: t("Import: {formats}", { formats: [...used].join(", ") }), patch, layoutViews: patch.layout } });
}

export async function importFiles() {
  const accept = [...new Set([...registry.importers.values()].flatMap((i) => i.extensions.map((e) => "." + e)))].join(",");
  const files = await pickFiles(accept);
  if (files.length) await importInputs(files);
}

const MIME: Record<string, string> = { svg: "image/svg+xml", png: "image/png", pdf: "application/pdf", json: "application/json", csv: "text/csv", xml: "application/xml", html: "text/html", md: "text/markdown", zip: "application/zip" };

export async function saveExport(result: ExportResult, base: string, extension: string) {
  if (typeof result === "string" || result instanceof Uint8Array) return saveFile(`${base}.${extension}`, result, MIME[extension]);
  // Several files (e.g. a static site): delivered as one zip archive.
  const { zip } = await import("@vastitecture/io-formats");
  await saveFile(`${base}.zip`, zip(result), MIME.zip);
}

export async function runExporter(exp: Exporter) {
  const s = app.getState();
  if (exp.scope === "view" && !s.activeView) return toast(t("Open a view first"));
  const view = exp.scope === "view" ? model.state.views[s.activeView!] : undefined;
  if (view && exp.notations && !exp.notations.includes(view.notation)) return toast(t("{format} cannot export a {notation} view", { format: exp.label, notation: registry.packs.get(view.notation)?.name ?? view.notation }));
  try {
    const result = await exp.export(model.state, { view: view?.id });
    const base = (view?.name ?? model.state.name).replace(/[^\w.-]+/g, "-").toLowerCase() || "export";
    await saveExport(result, base, exp.extension);
  } catch (e) {
    console.error(e);
    toast(t("Export failed: {error}", { error: e instanceof Error ? e.message : String(e) }));
  }
}

contributeCommands(() => [
  { id: "import", label: t("Import file…"), run: importFiles },
  { id: "import-paste", label: t("Import from pasted text…"), run: () => void window.dispatchEvent(new CustomEvent("vastitecture:paste-import")) },
  ...[...registry.exporters.values()].map((e) => ({ id: "export-" + e.id, label: t("Export: {format}", { format: e.label }), run: () => runExporter(e) })),
]);
