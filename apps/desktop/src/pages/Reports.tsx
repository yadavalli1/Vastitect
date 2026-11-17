import { useMemo, useState } from "react";
import { runReport, tableToCsv, tableToMarkdown, type ReportDef, type Table } from "@vastitecture/core";
import { model, registry, select, set, useModel, useRegistryVersion } from "../state";
import { saveFile } from "../platform";
import { tableToXlsx } from "../xlsx";
import { t } from "../i18n";

export function TableExport({ table, base }: { table: Table; base: string }) {
  return (
    <span className="flex gap-1">
      <button className="btn" onClick={() => void saveFile(`${base}.csv`, tableToCsv(table), "text/csv")}>CSV</button>
      <button className="btn" onClick={() => void saveFile(`${base}.xlsx`, tableToXlsx(table), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}>Excel</button>
      <button className="btn" onClick={() => void saveFile(`${base}.md`, tableToMarkdown(table), "text/markdown")}>Markdown</button>
    </span>
  );
}

export function TableView({ table }: { table: Table }) {
  return (
    <div className="scroll" style={{ maxHeight: "calc(100vh - 190px)" }}>
      <table className="grid" data-testid="report-table">
        <thead>
          <tr>{table.columns.map((c, i) => <th key={i}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i} style={{ cursor: table.rowIds ? "pointer" : undefined }} onClick={() => table.rowIds && (select([table.rowIds[i]]), set({ page: "inventory" }))}>
              {r.map((c, j) => (j === 0 ? <th key={j} scope="row" style={{ position: "static" }}>{c}</th> : <td key={j} style={{ textAlign: c === "×" || c === "—" ? "center" : undefined }}>{c}</td>))}
            </tr>
          ))}
          {!table.rows.length && <tr><td colSpan={table.columns.length} className="muted">{t("Nothing in the model matches this report yet")}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/** Catalogs and matrices generated from the model, whatever notation the elements were drawn in. */
export function ReportsPage() {
  useRegistryVersion();
  const elements = useModel((ws) => ws.elements);
  const relationships = useModel((ws) => ws.relationships);
  const mappings = useModel((ws) => ws.mappings);
  const reports: (ReportDef & { pack: string })[] = [...registry.packs.values()].flatMap((p) => (p.reports ?? []).map((r) => ({ ...r, pack: p.name })));
  const [id, setId] = useState(reports[0]?.id);
  const def = reports.find((r) => r.id === id) ?? reports[0];
  const table = useMemo(() => (def ? runReport(model.state, def, registry) : undefined), [def, elements, relationships, mappings]);
  return (
    <div className="flex h-full" data-testid="reports-page">
      <nav className="panel border-r scroll" style={{ width: 260 }} aria-label={t("Reports")}>
        <div className="h">{t("Catalogs and matrices")}</div>
        {reports.map((r) => (
          <div key={r.id} role="button" tabIndex={0} className={`row${r.id === def?.id ? " active" : ""}`} onClick={() => setId(r.id)} onKeyDown={(e) => e.key === "Enter" && setId(r.id)}>
            <span>{r.name}</span>
            <span className="chip muted" style={{ marginLeft: "auto" }}>{r.kind}</span>
          </div>
        ))}
      </nav>
      <div style={{ flex: 1, padding: 16, minWidth: 0 }}>
        {table && def && (
          <>
            <div className="flex items-center gap-3" style={{ marginBottom: 10 }}>
              <h2 style={{ margin: 0 }}>{def.name}</h2>
              <span className="muted">{def.pack} · {t("{count} rows", { count: table.rows.length })}</span>
              <span style={{ marginLeft: "auto" }}><TableExport table={table} base={def.name.replace(/\W+/g, "-").toLowerCase()} /></span>
            </div>
            <TableView table={table} />
          </>
        )}
      </div>
    </div>
  );
}
