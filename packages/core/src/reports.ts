import type { Element, Id, Workspace } from "./model";
import { ancestors } from "./queries";
import type { Registry, ReportDef } from "./registry";

export interface Table {
  title: string;
  columns: string[];
  rows: (string | number)[][];
  /** Element id behind each row, when rows are elements. */
  rowIds?: Id[];
}

/** Expand "concept:<name>" entries through the workspace mapping table. */
export function expandTypes(ws: Workspace, specs: string[]): Set<string> {
  const out = new Set<string>();
  for (const s of specs) {
    if (s.startsWith("concept:")) {
      const rule = ws.mappings.find((m) => m.concept === s.slice(8));
      for (const t of Object.values(rule?.members ?? {}).flat()) out.add(t);
    } else out.add(s);
  }
  return out;
}

const byName = (a: Element, b: Element) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

export function elementsOfTypes(ws: Workspace, specs: string[]): Element[] {
  const types = expandTypes(ws, specs);
  return Object.values(ws.elements).filter((e) => types.has(e.type) || Object.values(e.facets ?? {}).some((f) => f.type && types.has(f.type))).sort(byName);
}

const BUILTIN: Record<string, (e: Element, ws: Workspace, reg?: Registry) => string | number> = {
  name: (e) => e.name,
  type: (e, _ws, reg) => reg?.elementType(e.type)?.name ?? e.type,
  description: (e) => e.description ?? "",
  owner: (e) => e.owner ?? "",
  lifecycle: (e) => e.lifecycle?.phase ?? "",
  tags: (e) => e.tags.join(", "),
  parent: (e, ws) => (e.parent ? ws.elements[e.parent]?.name ?? "" : ""),
};

export const fieldValue = (e: Element, field: string, ws: Workspace, reg?: Registry): string | number => {
  if (BUILTIN[field]) return BUILTIN[field](e, ws, reg);
  const v = e.properties[field];
  return v === undefined || v === null ? "" : Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? String(v) : v;
};

const title = (f: string) => f.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

/** Generate a catalog or matrix from the model. Relationships of descendants count for their ancestors. */
export function runReport(ws: Workspace, def: ReportDef, reg?: Registry): Table {
  const rows = elementsOfTypes(ws, def.rows);
  if (def.kind === "catalog") {
    const fields = def.fields ?? ["name", "type", "description", "owner", "lifecycle"];
    return { title: def.name, columns: fields.map(title), rows: rows.map((e) => fields.map((f) => fieldValue(e, f, ws, reg))), rowIds: rows.map((e) => e.id) };
  }
  const cols = elementsOfTypes(ws, def.columns ?? def.rows);
  const rowSet = new Set(rows.map((e) => e.id));
  const colSet = new Set(cols.map((e) => e.id));
  const lift = (id: Id, set: Set<Id>) => (set.has(id) ? id : ancestors(ws, id).find((a) => set.has(a)));
  const cells = new Map<string, number>();
  const hit = (r: Id | undefined, c: Id | undefined) => {
    if (r && c && r !== c) cells.set(`${r}|${c}`, (cells.get(`${r}|${c}`) ?? 0) + 1);
  };
  for (const rel of Object.values(ws.relationships)) {
    hit(lift(rel.source, rowSet), lift(rel.target, colSet));
    // Undirected reading when rows and columns are different kinds of thing (application x function).
    if (def.columns) hit(lift(rel.target, rowSet), lift(rel.source, colSet));
  }
  return {
    title: def.name,
    columns: ["", ...cols.map((c) => c.name)],
    rows: rows.map((r) => [r.name, ...cols.map((c) => (r.id === c.id ? "—" : cells.get(`${r.id}|${c.id}`) ? "×" : ""))]),
    rowIds: rows.map((e) => e.id),
  };
}

const csvCell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
export const tableToCsv = (t: Table) => [t.columns, ...t.rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
export const tableToMarkdown = (t: Table) => {
  const cell = (v: string | number) => String(v).replace(/\|/g, "\\|").replace(/\n/g, " ");
  return [`## ${t.title}`, "", `| ${t.columns.map(cell).join(" | ")} |`, `| ${t.columns.map(() => "---").join(" | ")} |`, ...t.rows.map((r) => `| ${r.map(cell).join(" | ")} |`), ""].join("\n");
};
