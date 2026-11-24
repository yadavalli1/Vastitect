import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Registry } from "@vastitecture/core";
import { viewToSvg } from "../../../render/src/index";
import { pack as c4 } from "../../../notations/c4/src/index";
import { pack as archimate } from "../../../notations/archimate/src/index";
import { pack as ddd } from "../../../notations/ddd/src/index";
import { pack as generic } from "../../../notations/generic/src/index";
import { buildSample } from "../../../../apps/desktop/src/sample";
import { parseXml, pathToPdf, svgToPdfPage, textWidth, writeVectorPdf } from "./vectorpdf";

const reg = new Registry();
for (const p of [c4, archimate, ddd, generic]) reg.registerPack(p);
const poppler = existsSync("/usr/bin/pdftotext");

describe("vector PDF", () => {
  it("converts path commands, including arcs and relative moves", () => {
    expect(pathToPdf("M0 0 L10 0 H20 V5 Z")).toBe("0 0 m 10 0 l 20 0 l 20 5 l h");
    expect(pathToPdf("m5 5 l5 0 10 10")).toBe("5 5 m 10 5 l 20 15 l");
    const arc = pathToPdf("M0 10 A10 10 0 0 1 20 10");
    expect(arc.match(/ c/g)).toHaveLength(2); // a half circle becomes two quarter Béziers
    expect(arc.endsWith("20 10 c")).toBe(true);
    expect(pathToPdf("M0 0 Q10 10 20 0").split(" ").slice(-1)[0]).toBe("c");
  });

  it("parses the renderer's SVG and measures Helvetica", () => {
    const x = parseXml('<svg viewBox="0 0 10 10"><title>A &amp; B</title><text x="1">Hi &lt;3</text></svg>');
    expect(x.children[0].children.map((c) => c.text)).toEqual(["A & B", "Hi <3"]);
    expect(textWidth("Hello", 10)).toBeCloseTo(22.78, 1);
    expect(textWidth("Hello", 10, true)).toBeGreaterThan(textWidth("Hello", 10));
  });

  it("writes every view of the sample as a valid vector PDF with real text", () => {
    const ws = buildSample();
    const views = Object.values(ws.views);
    const pages = views.map((v) => svgToPdfPage(viewToSvg(ws, v, reg)));
    for (const p of pages) expect(p.content).not.toMatch(/NaN|undefined|Infinity/);
    const pdf = writeVectorPdf(pages, { title: "Online shop – all views" });
    const text = new TextDecoder("latin1").decode(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    // Every cross-reference offset points at the start of its object.
    const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
    const entries = text.slice(xref).split("\n").slice(3).filter((l) => / 00000 n $/.test(l));
    entries.forEach((l, i) => expect(text.slice(Number(l.slice(0, 10)), Number(l.slice(0, 10)) + 12)).toMatch(new RegExp(`^${i + 1} 0 obj`)));
    expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBe(views.length);
    expect(text).toContain("(Order API) Tj");
    if (poppler) {
      const dir = mkdtempSync(join(tmpdir(), "vpdf-"));
      writeFileSync(join(dir, "a.pdf"), pdf);
      const extracted = execFileSync("pdftotext", ["-layout", join(dir, "a.pdf"), "-"], { encoding: "utf8" });
      expect(extracted).toContain("Order API");
      expect(extracted).toContain("Online Shop");
      const info = execFileSync("pdfinfo", [join(dir, "a.pdf")], { encoding: "utf8" });
      expect(info).toMatch(new RegExp(`Pages:\\s+${views.length}`));
    }
  });
});
