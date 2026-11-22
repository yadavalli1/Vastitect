/**
 * RFC 4180 CSV: quoted cells, doubled quotes, CRLF or LF, and a byte-order mark. The separator is a
 * semicolon when the header row has semicolons and no commas (spreadsheets in many European locales).
 * Blank rows are dropped.
 */
/**
 * One CSV cell. Text that a spreadsheet would read as a formula (starting with = + - @, a tab or a carriage
 * return) gets a leading apostrophe, so model text exported to CSV opens as text, never as a formula.
 */
export function csvCell(v: string | number): string {
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r;]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows of cells as CSV text. */
export const toCsv = (rows: (string | number)[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";

/** Undo csvCell's formula guard on a cell read back from CSV. */
export const unguardCell = (s: string) => (/^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s);

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const sep = /^[^\n]*;/.test(src) && !/^[^\n]*,/.test(src) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) row.push(cell), (cell = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell), rows.push(row), (row = []), (cell = "");
    } else cell += c;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows.filter((r) => r.some((x) => x.trim())).map((r) => r.map(unguardCell));
}
