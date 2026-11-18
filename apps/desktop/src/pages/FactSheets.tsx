import { useMemo, useState } from "react";
import { LIFECYCLE_PHASES, searchElements, type Element, type Id, type PropertyDef, type Table } from "@vastitecture/core";
import { dispatch, model, registry, select, set, useApp, useModel, useRegistryVersion } from "../state";
import { phaseLabel } from "../panels/Properties";
import { TableExport } from "./Reports";
import { t } from "../i18n";

const BUILTIN = ["name", "type", "owner", "lifecycle", "tags"] as const;

function Cell({ value, onCommit, def, label }: { value: string; onCommit(v: string): void; def?: PropertyDef; label: string }) {
  const [v, setV] = useState(value);
  const [cur, setCur] = useState(value);
  if (cur !== value) (setCur(value), setV(value));
  if (def?.type === "enum")
    return (
      <select aria-label={label} value={value} onChange={(e) => onCommit(e.target.value)}>
        <option value="">—</option>
        {def.options?.map((o) => <option key={o}>{o}</option>)}
      </select>
    );
  return <input aria-label={label} value={v} type={def?.type === "number" ? "number" : "text"} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onCommit(v)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />;
}

/** The inventory: every element as a fact sheet row, editable in place, filterable and bulk-editable. */
export function FactSheetsPage() {
  useRegistryVersion();
  const elements = useModel((ws) => ws.elements);
  const savedFilters = useModel((ws) => ws.savedFilters);
  const selection = useApp((s) => s.selection.elements);
  const [q, setQ] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [checked, setChecked] = useState<Set<Id>>(new Set());
  const [bulk, setBulk] = useState<{ field: string; value: string }>({ field: "owner", value: "" });

  const portfolio = useMemo(() => [...registry.packs.values()].flatMap((p) => p.globalProperties ?? []).filter((d) => d.group === "Portfolio"), [registry.version]);
  const usedTypes = useMemo(() => [...new Set(Object.values(elements).map((e) => e.type))].sort((a, b) => (registry.elementType(a)?.name ?? a).localeCompare(registry.elementType(b)?.name ?? b)), [elements]);
  const rows = useMemo(
    () => searchElements(model.state, q).filter((e) => !types.length || types.includes(e.type)).sort((a, b) => a.name.localeCompare(b.name)),
    [elements, q, types],
  );
  const up = (e: Element, patch: Partial<Element>) => dispatch({ type: "updateElement", id: e.id, patch }, t("Edit fact sheet"));
  const setProp = (e: Element, key: string, raw: string, def?: PropertyDef) => {
    const properties = { ...e.properties };
    if (raw === "") delete properties[key];
    else properties[key] = def?.type === "number" ? Number(raw) : raw;
    up(e, { properties });
  };
  const table: Table = {
    title: t("Fact sheets"),
    columns: [t("Name"), t("Type"), t("Owner"), t("Lifecycle"), ...portfolio.map((d) => d.label), t("Tags")],
    rows: rows.map((e) => [e.name, registry.elementType(e.type)?.name ?? e.type, e.owner ?? "", e.lifecycle?.phase ?? "", ...portfolio.map((d) => (e.properties[d.key] as string | number) ?? ""), e.tags.join(", ")]),
    rowIds: rows.map((e) => e.id),
  };
  const all = rows.length > 0 && rows.every((e) => checked.has(e.id));
  const applyBulk = () => {
    const targets = rows.filter((e) => checked.has(e.id));
    const cmds = targets.map((e) => {
      const f = bulk.field;
      if (f === "owner") return { type: "updateElement" as const, id: e.id, patch: { owner: bulk.value || undefined } };
      if (f === "lifecycle") return { type: "updateElement" as const, id: e.id, patch: { lifecycle: { ...e.lifecycle, phase: (bulk.value || undefined) as never } } };
      if (f === "addTag") return { type: "updateElement" as const, id: e.id, patch: { tags: [...new Set([...e.tags, bulk.value.trim()])].filter(Boolean) } };
      const def = portfolio.find((d) => d.key === f);
      const properties = { ...e.properties };
      if (!bulk.value) delete properties[f];
      else properties[f] = def?.type === "number" ? Number(bulk.value) : bulk.value;
      return { type: "updateElement" as const, id: e.id, patch: { properties } };
    });
    dispatch(cmds, t("Bulk edit {count} elements", { count: cmds.length }));
  };
  const bulkDef = portfolio.find((d) => d.key === bulk.field);
  return (
    <div style={{ padding: 16 }} data-testid="factsheets-page">
      <div className="flex items-center gap-2" style={{ flexWrap: "wrap", marginBottom: 8 }}>
        <h2 style={{ margin: "0 12px 0 0" }}>{t("Fact sheets")}</h2>
        <input className="input" style={{ width: 280 }} aria-label={t("Filter fact sheets")} placeholder={t("Filter… (type:, tag:, owner:, phase:, no:owner)")} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="btn" aria-label={t("Element type")} value={types[0] ?? ""} onChange={(e) => setTypes(e.target.value ? [e.target.value] : [])}>
          <option value="">{t("All types")}</option>
          {usedTypes.map((ty) => <option key={ty} value={ty}>{registry.elementType(ty)?.name ?? ty}</option>)}
        </select>
        <select className="btn" aria-label={t("Saved filters")} value="" onChange={(e) => {
          const f = savedFilters.find((x) => x.name === e.target.value);
          if (f) (setQ(f.query), setTypes(f.types));
        }}>
          <option value="">{t("Saved filters…")}</option>
          {savedFilters.map((f) => <option key={f.name}>{f.name}</option>)}
        </select>
        <button className="btn" disabled={!q && !types.length} onClick={() => {
          const name = prompt(t("Name this filter"), q || types.join(", "));
          if (name) dispatch({ type: "setSettings", patch: { savedFilters: [...savedFilters.filter((f) => f.name !== name), { name, query: q, types }] } }, t("Save filter"));
        }}>{t("Save filter")}</button>
        <span className="muted">{t("{count} elements", { count: rows.length })}</span>
        <span style={{ marginLeft: "auto" }}><TableExport table={table} base="fact-sheets" /></span>
      </div>
      {checked.size > 0 && (
        <div className="panel flex items-center gap-2" style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 6, marginBottom: 8 }} role="group" aria-label={t("Bulk edit")}>
          <strong>{t("{count} selected", { count: checked.size })}</strong>
          <span>{t("Set")}</span>
          <select aria-label={t("Bulk field")} value={bulk.field} onChange={(e) => setBulk({ field: e.target.value, value: "" })}>
            <option value="owner">{t("Owner")}</option>
            <option value="lifecycle">{t("Lifecycle")}</option>
            <option value="addTag">{t("Add tag")}</option>
            {portfolio.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
          {bulk.field === "lifecycle" ? (
            <select aria-label={t("Bulk value")} value={bulk.value} onChange={(e) => setBulk({ ...bulk, value: e.target.value })}>
              <option value="">—</option>
              {LIFECYCLE_PHASES.map((p) => <option key={p} value={p}>{phaseLabel(p)}</option>)}
            </select>
          ) : bulkDef?.type === "enum" ? (
            <select aria-label={t("Bulk value")} value={bulk.value} onChange={(e) => setBulk({ ...bulk, value: e.target.value })}>
              <option value="">—</option>
              {bulkDef.options?.map((o) => <option key={o}>{o}</option>)}
            </select>
          ) : (
            <input aria-label={t("Bulk value")} className="input" style={{ width: 200 }} value={bulk.value} onChange={(e) => setBulk({ ...bulk, value: e.target.value })} />
          )}
          <button className="btn primary" onClick={applyBulk}>{t("Apply to selected")}</button>
          <button className="btn" onClick={() => setChecked(new Set())}>{t("Clear selection")}</button>
        </div>
      )}
      <div className="scroll" style={{ maxHeight: "calc(100vh - 210px)" }}>
        <table className="grid" data-testid="factsheets">
          <thead>
            <tr>
              <th><input type="checkbox" aria-label={t("Select all")} checked={all} onChange={() => setChecked(all ? new Set() : new Set(rows.map((e) => e.id)))} /></th>
              {table.columns.map((c) => <th key={c}>{c}</th>)}
              <th>{t("Links")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} data-element={e.id} style={selection.includes(e.id) ? { outline: "2px solid var(--accent)" } : undefined}>
                <td><input type="checkbox" aria-label={t("Select {name}", { name: e.name })} checked={checked.has(e.id)} onChange={() => setChecked((s) => { const n = new Set(s); n.has(e.id) ? n.delete(e.id) : n.add(e.id); return n; })} /></td>
                <td style={{ minWidth: 180 }}><Cell label={t("Name of {name}", { name: e.name })} value={e.name} onCommit={(v) => v.trim() && up(e, { name: v.trim() })} /></td>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>
                  <button className="btn ghost" style={{ padding: 0 }} title={t("Show in diagrams")} onClick={() => (select([e.id]), set({ page: "diagram" }))}>{registry.elementType(e.type)?.name ?? e.type}</button>
                </td>
                <td><Cell label={t("Owner of {name}", { name: e.name })} value={e.owner ?? ""} onCommit={(v) => up(e, { owner: v || undefined })} /></td>
                <td>
                  <select aria-label={t("Lifecycle of {name}", { name: e.name })} value={e.lifecycle?.phase ?? ""} onChange={(ev) => up(e, { lifecycle: { ...e.lifecycle, phase: (ev.target.value || undefined) as never } })}>
                    <option value="">—</option>
                    {LIFECYCLE_PHASES.map((p) => <option key={p} value={p}>{phaseLabel(p)}</option>)}
                  </select>
                </td>
                {portfolio.map((d) => (
                  <td key={d.key}><Cell label={t("{field} of {name}", { field: d.label, name: e.name })} def={d} value={String(e.properties[d.key] ?? "")} onCommit={(v) => setProp(e, d.key, v, d)} /></td>
                ))}
                <td><Cell label={t("Tags of {name}", { name: e.name })} value={e.tags.join(", ")} onCommit={(v) => up(e, { tags: v.split(",").map((x) => x.trim()).filter(Boolean) })} /></td>
                <td>{e.links.map((l, i) => <a key={i} href={l.href} target="_blank" rel="noreferrer" style={{ marginRight: 6, color: "var(--accent)" }}>{l.kind}</a>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
void BUILTIN;
