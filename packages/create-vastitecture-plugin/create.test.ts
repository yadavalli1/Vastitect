import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MessageChannel } from "node:worker_threads";
import { afterAll, describe, expect, it } from "vitest";
import { Registry, emptyWorkspace } from "@vastitecture/core";
import { PluginHost, SDK_SHIM_SOURCE, guestMain, parseManifest, rewriteSdkImport, type Port } from "@vastitecture/plugin-sdk";
// @ts-expect-error plain JS module
import { scaffold } from "./bin/create.js";

const tmp = mkdtempSync(join(tmpdir(), "vplugin-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Load a plugin folder exactly as the app does: manifest check, SDK import rewritten to the shim, run in a sandbox. */
async function load(dir: string, services = {}) {
  const manifest = parseManifest(readFileSync(join(dir, "plugin.json"), "utf8"));
  const data = (s: string) => "data:text/javascript;base64," + Buffer.from(s).toString("base64");
  const code = rewriteSdkImport(readFileSync(join(dir, manifest.entry ?? "index.js"), "utf8"), data(SDK_SHIM_SOURCE));
  const plugin = (await import(/* @vite-ignore */ data(code))).default;
  const { port1, port2 } = new MessageChannel();
  const wrap = (p: typeof port1): Port => {
    const port: Port = { postMessage: (m) => p.postMessage(m), onmessage: null };
    p.on("message", (d) => port.onmessage?.({ data: d }));
    return port;
  };
  const registry = new Registry();
  const host = new PluginHost(wrap(port1), registry, [manifest], services);
  void guestMain(wrap(port2), [{ manifest, plugin }]);
  await host.ready(manifest.id);
  return { registry, host, close: () => (port1.close(), port2.close()) };
}

describe("create-vastitecture-plugin", () => {
  it.each(["notation", "importer", "exporter", "validator", "connector"])("scaffolds a %s plugin that loads in the sandbox", async (template) => {
    const dir = join(tmp, `p-${template}`);
    const r = scaffold(dir, { template });
    expect(r.id).toBe(`local.p-${template}`);
    const s = await load(dir);
    const kind = { notation: "packs", importer: "importers", exporter: "exporters", validator: "validators", connector: "connectors" }[template] as "packs";
    expect(s.registry[kind].size).toBe(1);
    s.close();
  });

  it("a scaffolded notation adds element types, viewpoints and validity rules without any core change", async () => {
    const dir = join(tmp, "my-notation");
    scaffold(dir, { template: "notation", id: "acme.my-notation", name: "My Notation" });
    const s = await load(dir);
    const ns = "mynotation";
    expect(s.registry.paletteFor(ns, `${ns}:main`).map((t) => t.name)).toEqual(["Thing", "Store", "Area"]);
    expect(s.registry.validRelationships(ns, `${ns}:Store`, `${ns}:Thing`)).toEqual({ types: [`${ns}:Feeds`], strict: true });
    expect(s.registry.validRelationships(ns, `${ns}:Store`, `${ns}:Store`).types).toEqual([]);
    s.close();
  });

  it("the scaffolded importer and connector work through the sandbox", async () => {
    const imp = await load(join(tmp, "p-importer"));
    const patch = await imp.registry.importers.get("p-importer")!.import({ name: "a.arrows", text: "Web -> API: calls\nAPI -> DB" }, emptyWorkspace());
    expect(patch.elements!.map((e) => e.name)).toEqual(["Web", "API", "DB"]);
    expect(patch.relationships![0].label).toBe("calls");
    imp.close();
    const fetched: string[] = [];
    const con = await load(join(tmp, "p-connector"), {
      fetch: async (url: string) => (fetched.push(url), { status: 200, headers: {}, text: JSON.stringify([{ id: 7, name: "Billing", team: "Finance" }]) }),
      getSecret: async () => "t0ken",
    });
    const out = await con.registry.connectors.get("p-connector")!.discover({ files: [], config: { team: "Finance" } }, emptyWorkspace());
    expect(out.elements![0]).toMatchObject({ name: "Billing", owner: "Finance", properties: { externalId: "p-connector:7" } });
    expect(fetched).toEqual(["https://catalog.example.com/api/services?team=Finance"]);
    con.close();
  });

  it("refuses unknown templates and non-empty folders", () => {
    expect(() => scaffold(join(tmp, "x"), { template: "nope" })).toThrow(/Unknown template/);
    expect(() => scaffold(join(tmp, "my-notation"))).toThrow(/not empty/);
  });

  it("the example Wardley plugin loads, validates and renders its panel", async () => {
    const s = await load(new URL("../../examples/plugins/wardley", import.meta.url).pathname);
    expect(s.registry.packs.get("wardley")!.elementTypes).toHaveLength(3);
    const ws = emptyWorkspace();
    ws.elements.a = { id: "a", type: "wardley:Component", name: "Compute", tags: [], links: [], properties: { evolution: "Commodity" } };
    ws.elements.b = { id: "b", type: "wardley:Component", name: "Custom VM", tags: [], links: [], properties: { evolution: "Custom built" } };
    ws.relationships.r = { id: "r", type: "wardley:Evolves", source: "a", target: "b", properties: {} };
    expect((await s.registry.validators.get("wardley-evolution")!.run(ws))[0].code).toBe("wardley/evolves-backwards");
    expect(await s.registry.panels.get("wardley-summary")!.render!(ws)).toContain("<b>1</b>");
    s.close();
  });
});
