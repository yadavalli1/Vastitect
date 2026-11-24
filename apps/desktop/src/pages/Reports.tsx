import { useMemo, useState } from "react";
import { runReport, tableToCsv, tableToMarkdown, type ReportDef, type Table } from "@vastitecture/core";
import { model, registry, select, set, useModel, useRegistryVersion } from "../state";
import { saveFile } from "../platform";
import { tableToXlsx } from "@vastitecture/io-formats";
import { t } from "../i18n";
import { PageHeader } from "../ui";
import { Download } from "lucide-react";

export function TableExport({ table, base }: { table: Table; base: string }) {
  return (
    <span className="btn-group" role="group" aria-label={t("Download table")}>
      <Download size={14} className="faint" style={{ marginRight: 4 }} aria-hidden />
      <button className="btn sm" onClick={() => void saveFile(`${base}.csv`, tableToCsv(table), "text/csv")}>{t("CSV")}</button>
      <button className="btn sm" onClick={() => void saveFile(`${base}.xlsx`, tableToXlsx(table), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}>{t("Excel")}</button>
      <button className="btn sm" onClick={() => void saveFile(`${base}.md`, tableToMarkdown(table), "text/markdown")}>{t("Markdown")}</button>
    </span>
  );
}

export function TableView({ table }: { table: Table }) {
  return (
    <div className="card scroll" style={{ maxHeight: "calc(100vh - 200px)" }}>
      <table className="data-table" data-testid="report-table">
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
      <nav className="side border-r scroll" style={{ width: 280, paddingBottom: 12 }} aria-label={t("Reports")}>
        <div className="h">{t("Catalogs and matrices")}</div>
        {reports.map((r) => (
          <div key={r.id} role="button" tabIndex={0} className={`row${r.id === def?.id ? " active" : ""}`} onClick={() => setId(r.id)} onKeyDown={(e) => e.key === "Enter" && setId(r.id)}>
            <span>{r.name}</span>
            <span className="badge" style={{ marginLeft: "auto" }}>{r.kind}</span>
          </div>
        ))}
      </nav>
      <div className="page wide" style={{ flex: 1, minWidth: 0 }}>
        {table && def && (
          <>
            <PageHeader title={def.name} description={`${def.pack} · ${t("{count} rows", { count: table.rows.length })}`} actions={<TableExport table={table} base={def.name.replace(/\W+/g, "-").toLowerCase()} />} />
            <TableView table={table} />
          </>
        )}
      </div>
    </div>
  );
}
