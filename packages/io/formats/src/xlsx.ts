import { XMLParser } from "fast-xml-parser";
import type { Table } from "@vastitecture/plugin-sdk";
import { unzip, zip } from "./zip";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const col = (i: number) => {
  let s = "";
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
};

/** A minimal, dependency-free .xlsx writer: one sheet, inline strings, numbers as numbers, bold header. */
export function tableToXlsx(table: Table): Uint8Array {
  const rows = [table.columns, ...table.rows];
  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><sheetData>` +
    rows
      .map(
        (r, i) =>
          `<row r="${i + 1}">` +
          r
            .map((v, j) => {
              const ref = `${col(j)}${i + 1}`;
              const style = i === 0 ? ' s="1"' : "";
              return typeof v === "number" && Number.isFinite(v) ? `<c r="${ref}"${style}><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${esc(String(v ?? ""))}</t></is></c>`;
            })
            .join("") +
          "</row>",
      )
      .join("") +
    "</sheetData></worksheet>";
  return zip({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(table.title.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet1")}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`,
    "xl/worksheets/sheet1.xml": sheet,
  });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const arr = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
const colIndex = (ref: string) => {
  let n = 0;
  for (const c of ref.replace(/\d+$/, "")) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
};

/** Read the first sheet of an .xlsx file into rows of cells (shared strings, inline strings, numbers, booleans). */
export async function readXlsx(bytes: Uint8Array): Promise<(string | number)[][]> {
  const files = await unzip(bytes);
  const dec = new TextDecoder();
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", textNodeName: "#text", parseTagValue: false, trimValues: false });
  const text = (x: any): string => (x === undefined ? "" : typeof x === "object" ? (x["#text"] ?? "") : String(x));
  const shared = files["xl/sharedStrings.xml"] ? arr(parser.parse(dec.decode(files["xl/sharedStrings.xml"])).sst?.si).map((si: any) => (si.t !== undefined ? text(si.t) : arr(si.r).map((r: any) => text(r.t)).join(""))) : [];
  const rels = files["xl/_rels/workbook.xml.rels"] ? arr(parser.parse(dec.decode(files["xl/_rels/workbook.xml.rels"])).Relationships?.Relationship) : [];
  const wb = files["xl/workbook.xml"] ? parser.parse(dec.decode(files["xl/workbook.xml"])) : undefined;
  const firstRel = arr(wb?.workbook?.sheets?.sheet)[0]?.["@r:id"];
  const target = rels.find((r: any) => r["@Id"] === firstRel)?.["@Target"];
  const sheetPath = target ? "xl/" + String(target).replace(/^\/?xl\//, "").replace(/^\//, "") : Object.keys(files).find((f) => /^xl\/worksheets\/sheet\d*\.xml$/.test(f));
  if (!sheetPath || !files[sheetPath]) throw new Error("No worksheet found in the workbook");
  const sheet = parser.parse(dec.decode(files[sheetPath]));
  const rows: (string | number)[][] = [];
  for (const r of arr(sheet.worksheet?.sheetData?.row)) {
    const row: (string | number)[] = [];
    arr(r.c).forEach((c: any, i: number) => {
      const idx = c["@r"] ? colIndex(c["@r"]) : i;
      const t = c["@t"];
      const v = text(c.v);
      row[idx] = t === "s" ? shared[Number(v)] ?? "" : t === "inlineStr" ? text(c.is?.t) || arr(c.is?.r).map((x: any) => text(x.t)).join("") : t === "b" ? (v === "1" ? "TRUE" : "FALSE") : t === "str" || t === "e" ? v : v === "" ? "" : Number(v);
    });
    rows[Number(r["@r"] ?? rows.length + 1) - 1] = Array.from(row, (x) => x ?? "");
  }
  return Array.from(rows, (x) => x ?? []);
}
