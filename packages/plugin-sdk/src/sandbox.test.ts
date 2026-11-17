import { MessageChannel } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import { Registry, emptyWorkspace, type NotationPack } from "@vastitecture/core";
import { PluginHost, guestMain, parseManifest, type Port, type PluginManifest } from "./index";

/** Wire a host and a guest together over a real MessageChannel, so everything is structured-cloned. */
function sandbox(manifest: PluginManifest, plugin: { activate(ctx: any): unknown }, services = {}) {
  const { port1, port2 } = new MessageChannel();
  const wrap = (p: typeof port1): Port => {
    const port: Port = { postMessage: (m) => p.postMessage(m), onmessage: null };
    p.on("message", (data) => port.onmessage?.({ data }));
    return port;
  };
  const registry = new Registry();
  const host = new PluginHost(wrap(port1), registry, [manifest], services);
  // The guest runtime is rebuilt from its own source text, exactly as a blob worker bootstrap does.
  const fromSource = new Function(`return (${guestMain.toString()})`)() as typeof guestMain;
  void fromSource(wrap(port2), [{ manifest, plugin }]);
  return { host, registry, close: () => (port1.close(), port2.close()) };
}

const manifest = (over: Partial<PluginManifest> = {}): PluginManifest => ({ id: "test.plugin", name: "Test", version: "1.0.0", apiVersion: "1.0.0", capabilities: ["notation", "importer", "exporter", "connector", "validator"], ...over });
const pack: NotationPack = { id: "x", name: "X", elementTypes: [{ id: "x:Thing", name: "Thing", shape: "rect" }], relationshipTypes: [], viewpoints: [{ id: "x:main", name: "Main" }] };

describe("plugin sandbox", () => {
  it("registers data and proxies functions across the boundary", async () => {
    const s = sandbox(manifest(), {
      activate(ctx) {
        ctx.notations.register(pack);
        ctx.importers.register({ id: "thing", label: "Things", extensions: ["thing"], detect: (i: { text: string }) => i.text.startsWith("THING"), import: (i: { text: string }) => ({ elements: [{ id: "1", type: "x:Thing", name: i.text.slice(6), tags: [], properties: {}, links: [] }] }) });
        ctx.exporters.register({ id: "count", label: "Count", extension: "txt", scope: "workspace", export: (ws: { elements: object }) => String(Object.keys(ws.elements).length) });
        ctx.validators.register({ id: "v", run: () => [{ code: "x", severity: "info", message: "hello", target: { kind: "workspace" } }] });
      },
    });
    await s.host.ready("test.plugin");
    expect(s.registry.packs.get("x")!.elementTypes[0].name).toBe("Thing");
    const imp = s.registry.importers.get("thing")!;
    expect(imp.extensions).toEqual(["thing"]);
    expect(await imp.detect!({ name: "a.thing", text: "THING Widget" })).toBe(true);
    expect(await imp.import({ name: "a.thing", text: "THING Widget" }, emptyWorkspace())).toMatchObject({ elements: [{ name: "Widget" }] });
    expect(await s.registry.exporters.get("count")!.export(emptyWorkspace(), {})).toBe("0");
    expect(await s.registry.validators.get("v")!.run(emptyWorkspace())).toHaveLength(1);
    expect(s.host.plugins.get("test.plugin")).toMatchObject({ status: "active", registered: [{ kind: "notation", id: "x" }, { kind: "importer", id: "thing" }, { kind: "exporter", id: "count" }, { kind: "validator", id: "v" }] });
    s.host.dispose();
    expect(s.registry.packs.size).toBe(0);
    expect(s.registry.importers.size).toBe(0);
    s.close();
  });

  it("rejects registrations for capabilities the manifest did not declare", async () => {
    const s = sandbox(manifest({ capabilities: ["importer"] }), { activate: (ctx) => ctx.notations.register(pack) });
    await expect(s.host.ready("test.plugin")).rejects.toThrow(/without declaring that capability/);
    expect(s.registry.packs.size).toBe(0);
    s.close();
  });

  it("allows network and secrets only as declared, through the host", async () => {
    const calls: string[] = [];
    const services = { fetch: async (url: string) => (calls.push(url), { status: 200, headers: {}, text: "ok" }), getSecret: async (n: string) => "s3cret-" + n };
    const s = sandbox(manifest({ capabilities: ["connector"], permissions: { network: ["api.example.com", "*.internal.test"], secrets: ["token"] } }), {
      activate(ctx) {
        ctx.connectors.register({
          id: "c",
          label: "C",
          fields: [],
          async discover(input: { config: Record<string, string> }) {
            const r = await ctx.net.fetch(input.config.url);
            return { report: [r.text, await ctx.secrets.get(input.config.secret ?? "token")] };
          },
        });
      },
    }, services);
    await s.host.ready("test.plugin");
    const c = s.registry.connectors.get("c")!;
    expect(await c.discover({ files: [], config: { url: "https://api.example.com/x" } }, emptyWorkspace())).toEqual({ report: ["ok", "s3cret-token"] });
    expect(await c.discover({ files: [], config: { url: "https://a.internal.test/x" } }, emptyWorkspace())).toMatchObject({ report: ["ok", "s3cret-token"] });
    await expect(c.discover({ files: [], config: { url: "https://evil.example.org/x" } }, emptyWorkspace())).rejects.toThrow(/not allowed to contact evil.example.org/);
    await expect(c.discover({ files: [], config: { url: "https://api.example.com/x", secret: "other" } }, emptyWorkspace())).rejects.toThrow(/not allowed to read secret other/);
    expect(calls).toEqual(["https://api.example.com/x", "https://a.internal.test/x", "https://api.example.com/x"]);
    s.close();
  });

  it("reports a plugin that throws during activation and propagates errors from calls", async () => {
    const bad = sandbox(manifest(), { activate: () => { throw new Error("boom"); } });
    await expect(bad.host.ready("test.plugin")).rejects.toThrow("boom");
    bad.close();
    const s = sandbox(manifest(), { activate: (ctx) => ctx.exporters.register({ id: "e", label: "E", extension: "x", scope: "workspace", export: () => { throw new Error("cannot export"); } }) });
    await s.host.ready("test.plugin");
    await expect(Promise.resolve(s.registry.exporters.get("e")!.export(emptyWorkspace(), {}))).rejects.toThrow("cannot export");
    s.close();
  });

  it("validates manifests with actionable messages", () => {
    expect(parseManifest(JSON.stringify(manifest())).id).toBe("test.plugin");
    expect(() => parseManifest("{")).toThrow(/not valid JSON/);
    expect(() => parseManifest(JSON.stringify({ ...manifest(), id: "Bad Id" }))).toThrow(/"id" must be/);
    expect(() => parseManifest(JSON.stringify({ ...manifest(), capabilities: ["telepathy"] }))).toThrow(/capabilities/);
    expect(() => parseManifest(JSON.stringify({ ...manifest(), apiVersion: "2.0.0" }))).toThrow(/targets API 2.0.0/);
    expect(() => parseManifest(JSON.stringify({ ...manifest(), permissions: { network: "everything" } }))).toThrow(/permissions.network/);
    const { name: _n, ...noName } = manifest();
    expect(() => parseManifest(JSON.stringify(noName))).toThrow(/missing "name"/);
  });
});
