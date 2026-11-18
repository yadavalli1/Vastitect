import { describe, expect, it } from "vitest";
import { DEFAULT_MAPPINGS, ModelStore, Registry, emptyWorkspace, makeElement, makeRelationship, makeView, type Workspace } from "@vastitecture/core";
import { pack as c4 } from "../../notations/c4/src/index";
import { pack as archimate } from "../../notations/archimate/src/index";
import { AiError, chat, draftModel, explainView, extractJson, suggestRelationships, translateView, type Fetcher } from "./index";

const reg = new Registry();
reg.registerPack(c4);
reg.registerPack(archimate);
const cfg = { baseUrl: "http://llm.test/v1/", model: "m", apiKey: "k" };

/** A fake endpoint that records requests and answers with a fixed message. */
function endpoint(answer: string, status = 200) {
  const calls: { url: string; body: any; headers: Record<string, string> }[] = [];
  const f: Fetcher = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return { status, text: status === 200 ? JSON.stringify({ choices: [{ message: { content: answer } }] }) : "nope" };
  };
  return { f, calls };
}

function shop(): Workspace {
  const ws: Workspace = { ...emptyWorkspace("S", ["c4", "archimate"]), mappings: DEFAULT_MAPPINGS };
  const user = makeElement("c4:Person", "Customer");
  const sys = makeElement("c4:SoftwareSystem", "Shop");
  const pay = makeElement("c4:SoftwareSystem", "Payments");
  for (const e of [user, sys, pay]) ws.elements[e.id] = e;
  const r1 = makeRelationship("c4:Uses", user.id, sys.id, { label: "buys from" });
  const r2 = makeRelationship("c4:Uses", sys.id, pay.id, { label: "charges", technology: "HTTPS" });
  ws.relationships[r1.id] = r1;
  ws.relationships[r2.id] = r2;
  const v = makeView("c4", "Context", { viewpoint: "c4:context", nodes: [user, sys, pay].map((e, i) => ({ element: e.id, x: i * 200, y: 0, w: 150, h: 90 })), edges: [{ relationship: r1.id }, { relationship: r2.id }] });
  ws.views[v.id] = v;
  return ws;
}

describe("chat", () => {
  it("calls an OpenAI-compatible endpoint with the key and model", async () => {
    const { f, calls } = endpoint("hello");
    expect(await chat(cfg, [{ role: "user", content: "hi" }], f)).toBe("hello");
    expect(calls[0].url).toBe("http://llm.test/v1/chat/completions");
    expect(calls[0].headers.Authorization).toBe("Bearer k");
    expect(calls[0].body.model).toBe("m");
  });
  it("explains failures", async () => {
    await expect(chat(cfg, [], endpoint("", 401).f)).rejects.toThrow(/rejected the API key/);
    await expect(chat(cfg, [], async () => ({ status: 200, text: "<html>" }))).rejects.toThrow(/did not return JSON/);
  });
  it("extracts JSON from fenced or chatty replies", () => {
    expect(extractJson('Sure!\n```json\n{"a": "x}"}\n```')).toEqual({ a: "x}" });
    expect(extractJson('Here: {"a": {"b": 1}} done')).toEqual({ a: { b: 1 } });
    expect(() => extractJson("no json")).toThrow(AiError);
  });
});

describe("draft a model", () => {
  it("turns the reply into a reviewable patch, reusing existing elements and dropping unknown types", async () => {
    const ws = shop();
    const reply = JSON.stringify({
      elements: [
        { name: "Shop", type: "c4:SoftwareSystem" },
        { name: "Web App", type: "c4:Container", parent: "Shop", description: "Storefront" },
        { name: "Orders DB", type: "c4:Container", parent: "Shop" },
        { name: "Mystery", type: "c4:Spaceship" },
      ],
      relationships: [
        { source: "Web App", target: "Orders DB", type: "c4:Uses", label: "reads and writes", technology: "SQL" },
        { source: "Web App", target: "Nowhere", type: "c4:Uses" },
        { source: "Web App", target: "Payments", type: "c4:Teleports" },
      ],
    });
    const { f, calls } = endpoint(reply);
    const patch = await draftModel(cfg, f, ws, reg, { text: "A shop with a web app and a database.", notation: "c4" });
    expect(calls[0].body.messages[1].content).toContain("c4:Container (Container)");
    expect(calls[0].body.messages[1].content).toContain("Shop [c4:SoftwareSystem]");
    expect(patch.elements!.map((e) => e.name)).toEqual(["Web App", "Orders DB"]);
    const shopId = Object.values(ws.elements).find((e) => e.name === "Shop")!.id;
    expect(patch.elements!.every((e) => e.parent === shopId)).toBe(true);
    expect(patch.relationships).toHaveLength(1);
    expect(patch.report!.join("\n")).toMatch(/Skipped "Mystery": unknown type c4:Spaceship/);
    expect(patch.report!.join("\n")).toMatch(/unknown relationship type c4:Teleports/);
    // nothing has been applied: the caller shows the patch as a diff
    expect(Object.keys(ws.elements)).toHaveLength(3);
    expect(patch.views![0].nodes.find((n) => n.element === patch.elements![0].id)!.parent).toBeUndefined();
  });
});

describe("suggest, explain", () => {
  it("suggests relationships only between elements of the view", async () => {
    const ws = shop();
    const { f } = endpoint(JSON.stringify({ relationships: [{ source: "Customer", target: "Payments", type: "c4:Uses", label: "enters card details", reason: "Hosted payment page" }, { source: "Shop", target: "Warehouse", type: "c4:Uses" }] }));
    const patch = await suggestRelationships(cfg, f, ws, reg, Object.keys(ws.views)[0]);
    expect(patch.elements).toEqual([]);
    expect(patch.relationships!.map((r) => r.label)).toEqual(["enters card details"]);
    expect(patch.views![0].edges).toHaveLength(3);
    expect(patch.report!.join("\n")).toMatch(/Hosted payment page/);
  });
  it("sends the view's content to explain it", async () => {
    const ws = shop();
    const { f, calls } = endpoint("It shows a shop.");
    expect(await explainView(cfg, f, ws, reg, Object.keys(ws.views)[0])).toBe("It shows a shop.");
    expect(calls[0].body.messages[1].content).toContain('- Shop -> Payments: Uses "charges" [HTTPS]');
  });
});

describe("translate a view", () => {
  it("turns a C4 context view into an ArchiMate view through the mapping table", () => {
    const ws = shop();
    const patch = translateView(ws, reg, Object.keys(ws.views)[0], "archimate", "archimate:application");
    const store = new ModelStore(ws);
    store.dispatch({ type: "applyPatch", patch });
    const v = Object.values(store.state.views).find((x) => x.notation === "archimate")!;
    expect(v.nodes).toHaveLength(3);
    const rels = v.edges.map((e) => store.state.relationships[e.relationship]);
    // "Customer uses Shop" becomes "Shop serves Customer"
    expect(rels.map((r) => `${store.state.elements[r.source].name} ${r.type} ${store.state.elements[r.target].name}`).sort()).toEqual(["Payments archimate:Serving Shop", "Shop archimate:Serving Customer"]);
    expect(rels.find((r) => r.technology === "HTTPS")).toBeTruthy();
    // translating again reuses the relationships it created
    const again = translateView(store.state, reg, Object.keys(ws.views)[0], "archimate", "archimate:application");
    expect(again.relationships).toEqual([]);
  });
});
