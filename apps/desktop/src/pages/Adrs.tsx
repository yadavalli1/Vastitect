import { useMemo, useState } from "react";
import type { Adr } from "@vastitecture/core";
import { markdownToHtml } from "@vastitecture/render";
import { dispatch, model, select, set, useApp, useModel, today } from "../state";
import { Field } from "../panels/Properties";
import { t } from "../i18n";
import { NotebookPen, Plus, X } from "lucide-react";
import { Button, EmptyState } from "../ui";

const STATUS_TONE: Record<string, string> = { accepted: "ok", proposed: "accent", deprecated: "warn", superseded: "warn", rejected: "danger" };

const STATUSES = ["proposed", "accepted", "rejected", "deprecated", "superseded"];
const TEMPLATE = "## Context\n\nWhat is the issue that motivates this decision?\n\n## Decision\n\nWhat are we going to do?\n\n## Consequences\n\nWhat becomes easier or harder?\n";

/** Architecture Decision Records: Markdown files in adrs/, linked to the elements they affect. */
export function AdrsPage() {
  const adrs = useModel((ws) => ws.adrs);
  const elements = useModel((ws) => ws.elements);
  const openId = useApp((s) => s.openAdr);
  const list = useMemo(() => Object.values(adrs).sort((a, b) => a.id.localeCompare(b.id)), [adrs]);
  const cur = (openId && adrs[openId]) || list[0];
  const [preview, setPreview] = useState(true);
  const put = (a: Adr, label = t("Edit decision")) => dispatch({ type: "putAdr", adr: a }, label);
  const create = () => {
    const next = String(Math.max(0, ...list.map((a) => Number(a.id) || 0)) + 1).padStart(4, "0");
    const linked = model.state.elements ? (useApp.getState().selection.elements ?? []) : [];
    put({ id: next, title: t("New decision"), status: "proposed", date: today(), elements: linked, body: TEMPLATE }, t("New decision"));
    set({ openAdr: next });
    setPreview(false);
  };
  return (
    <div className="flex h-full" data-testid="adrs-page">
      <nav className="side border-r scroll" style={{ width: 300, paddingBottom: 12 }} aria-label={t("Decisions")}>
        <div className="flex items-center" style={{ padding: "6px 8px 0 0" }}>
          <div className="h" style={{ flex: 1 }}>{t("Decisions")}</div>
          <Button size="sm" variant="ghost" icon={Plus} onClick={create}>{t("New")}</Button>
        </div>
        {list.map((a) => (
          <div key={a.id} role="button" tabIndex={0} className={`row${a.id === cur?.id ? " active" : ""}`} onClick={() => set({ openAdr: a.id })} onKeyDown={(e) => e.key === "Enter" && set({ openAdr: a.id })}>
            <span className="faint mono" style={{ fontSize: 11 }}>{a.id}</span> <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</span>
            <span className={`badge ${STATUS_TONE[a.status] ?? ""}`} style={{ marginLeft: "auto" }}>{a.status}</span>
          </div>
        ))}
        {!list.length && <div className="row muted">{t("No decisions yet")}</div>}
      </nav>
      {!cur && <div className="page" style={{ flex: 1 }}><EmptyState icon={NotebookPen} title={t("No decisions yet")} action={<Button variant="primary" icon={Plus} onClick={create}>{t("New decision")}</Button>}>{t("Record why the architecture is the way it is. Decisions are Markdown files in adrs/, linked to the elements they affect.")}</EmptyState></div>}
      {cur && (
        <div className="scroll page" style={{ flex: 1, maxWidth: 940 }}>
          <div className="flex gap-2 items-end">
            <div style={{ flex: 1 }}><Field id="adr-title" label={t("Title")} value={cur.title} onCommit={(title) => put({ ...cur, title })} /></div>
            <div>
              <label className="label" htmlFor="adr-status">{t("Status")}</label>
              <select id="adr-status" className="input" value={cur.status} onChange={(e) => put({ ...cur, status: e.target.value })}>
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div><Field id="adr-date" label={t("Date")} type="date" value={cur.date ?? ""} onCommit={(date) => put({ ...cur, date: date || undefined })} /></div>
          </div>
          <div className="label">{t("Affects")}</div>
          <div className="flex gap-1" style={{ flexWrap: "wrap" }}>
            {cur.elements.filter((id) => elements[id]).map((id) => (
              <span key={id} className="badge accent" style={{ paddingRight: 2 }}>
                <button className="btn ghost sm" style={{ padding: "0 2px", height: 18, color: "inherit" }} onClick={() => (select([id]), set({ page: "diagram" }))}>{elements[id].name}</button>
                <button className="btn ghost icon sm" style={{ width: 18, height: 18, color: "inherit" }} aria-label={t("Unlink {name}", { name: elements[id].name })} onClick={() => put({ ...cur, elements: cur.elements.filter((x) => x !== id) })}><X size={12} aria-hidden /></button>
              </span>
            ))}
            <select className="input" style={{ width: "auto", minHeight: 22, height: 22, fontSize: 12, padding: "0 24px 0 8px" }} aria-label={t("Link an element")} value="" onChange={(e) => e.target.value && put({ ...cur, elements: [...cur.elements, e.target.value] })}>
              <option value="">{t("+ link element")}</option>
              {Object.values(elements).filter((e) => !cur.elements.includes(e.id)).sort((a, b) => a.name.localeCompare(b.name)).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <div className="label" style={{ margin: 0 }}>{t("Record")}</div>
            <div className="tabs" role="group" aria-label={t("Record")}>
              <button type="button" className={`seg${preview ? " on" : ""}`} aria-pressed={preview} onClick={() => setPreview(true)}>{t("Preview")}</button>
              <button type="button" className={`seg${!preview ? " on" : ""}`} aria-pressed={!preview} onClick={() => setPreview(false)}>{t("Edit")}</button>
            </div>
            <span className="faint mono" style={{ fontSize: 11, marginLeft: "auto" }}>{t("Stored as adrs/{file}.md", { file: `${cur.id}-${cur.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` })}</span>
          </div>
          {preview ? (
            <article className="adr-body card card-pad" data-testid="adr-preview" style={{ marginTop: 10 }} dangerouslySetInnerHTML={{ __html: markdownToHtml(cur.body) }} />
          ) : (
            <Field id="adr-body" label={t("Markdown")} multiline value={cur.body} onCommit={(body) => put({ ...cur, body })} />
          )}
          <button className="btn mt-3" style={{ color: "var(--danger)" }} onClick={() => (dispatch({ type: "removeAdr", id: cur.id }, t("Delete decision")), set({ openAdr: undefined }))}>{t("Delete decision")}</button>
        </div>
      )}
    </div>
  );
}
