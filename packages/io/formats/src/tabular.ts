import { makeElement, type Element, type ModelPatch, type PropertyValue, type Table, type Workspace } from "@vastitecture/plugin-sdk";
import { readXlsx, tableToXlsx } from "./xlsx";

const FIXED = ["id", "name", "type", "description", "parent", "owner", "lifecycle", "tags"];
const LIFECYCLE = ["plan", "phaseIn", "active", "phaseOut", "endOfLife"];

/** Every element as one row: fixed columns, then one column per property key in use. */
export function inventoryTable(ws: Workspace): Table {
  const els = Object.values(ws.elements).sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const keys = [...new Set(els.flatMap((e) => Object.keys(e.properties)))].filter((k) => !["cml", "drawioStyle"].includes(k)).sort();
  const cell = (v: PropertyValue | undefined): string | number => (v === undefined || v === null ? "" : Array.isArray(v) ? v.join("; ") : typeof v === "boolean" ? String(v) : v);
  return {
    title: "Elements",
    columns: [...FIXED, ...keys],
    rows: els.map((e) => [e.id, e.name, e.type, e.description ?? "", e.parent ? ws.elements[e.parent]?.name ?? "" : "", e.owner ?? "", e.lifecycle?.phase ?? "", e.tags.join("; "), ...keys.map((k) => cell(e.properties[k]))]),
  };
}

export { parseCsv } from "@vastitecture/core";
import { parseCsv } from "@vastitecture/core";

const csvCell = (v: string | number) => (/[",\n\r;]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
export const tableToCsv = (t: Table) => [t.columns, ...t.rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";

/**
 * Bulk inventory edit: rows are matched to elements by id, else by type + name; unmatched rows with a
 * name and type create elements. Empty cells leave a field as it is. Columns not in the fixed set are properties.
 */
export function rowsToPatch(rows: (string | number)[][], ws: Workspace): ModelPatch {
  if (rows.length < 1) return { report: ["The sheet is empty"] };
  const head = rows[0].map((h) => String(h).trim());
  const col = (name: string) => head.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const at = (r: (string | number)[], name: string) => (col(name) >= 0 ? r[col(name)] : undefined);
  if (col("name") < 0 && col("id") < 0) throw new Error('The first row must be a header with at least a "name" or an "id" column');
  const report: string[] = [];
  const elements: Element[] = [];
  const byName = new Map(Object.values(ws.elements).map((e) => [`${e.type}|${e.name.toLowerCase()}`, e]));
  const anyName = new Map(Object.values(ws.elements).map((e) => [e.name.toLowerCase(), e]));
  const created = new Map<string, Element>();
  let updated = 0;
  rows.slice(1).forEach((r, i) => {
    const s = (name: string) => {
      const v = at(r, name);
      return v === undefined || v === "" ? undefined : String(v).trim();
    };
    const id = s("id");
    const name = s("name");
    const type = s("type");
    let cur = (id && ws.elements[id]) || (type && name && byName.get(`${type}|${name.toLowerCase()}`)) || undefined;
    if (!cur) {
      if (!name || !type) {
        report.push(`Row ${i + 2}: skipped, a new element needs both a name and a type`);
        return;
      }
      cur = makeElement(type, name, id ? { id } : {});
      created.set(name.toLowerCase(), cur);
    } else updated++;
    const next: Element = { ...cur, properties: { ...cur.properties }, tags: [...cur.tags] };
    if (name) next.name = name;
    if (type) next.type = type;
    const desc = s("description");
    if (desc !== undefined) next.description = desc;
    const owner = s("owner");
    if (owner !== undefined) next.owner = owner;
    const phase = s("lifecycle");
    if (phase !== undefined) {
      const p = LIFECYCLE.find((x) => x.toLowerCase() === phase.replace(/[\s_-]/g, "").toLowerCase());
      if (p) next.lifecycle = { ...next.lifecycle, phase: p as never };
      else report.push(`Row ${i + 2}: unknown lifecycle "${phase}" (use ${LIFECYCLE.join(", ")})`);
    }
    const tags = s("tags");
    if (tags !== undefined) next.tags = tags.split(/[;,]/).map((x) => x.trim()).filter(Boolean);
    const parent = s("parent");
    if (parent !== undefined) {
      const p = anyName.get(parent.toLowerCase()) ?? created.get(parent.toLowerCase()) ?? ws.elements[parent];
      if (p) next.parent = p.id;
      else report.push(`Row ${i + 2}: parent "${parent}" not found`);
    }
    head.forEach((h, c) => {
      if (!h || FIXED.includes(h.toLowerCase())) return;
      const raw = r[c];
      if (raw === undefined || raw === "") return;
      const before = cur!.properties[h];
      next.properties[h] = typeof raw === "number" ? raw : typeof before === "number" && /^-?\d+(\.\d+)?$/.test(String(raw).trim()) ? Number(raw) : String(raw);
    });
    elements.push(next);
  });
  return { elements, report: [`${updated} element(s) updated, ${created.size} created`, ...report] };
}

export const parseInventoryCsv = (text: string, ws: Workspace) => rowsToPatch(parseCsv(text), ws);
export async function parseInventoryXlsx(bytes: Uint8Array, ws: Workspace) {
  return rowsToPatch(await readXlsx(bytes), ws);
}
export { tableToXlsx };
