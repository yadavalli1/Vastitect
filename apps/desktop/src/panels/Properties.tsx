import { safeHref } from "../ui";
import { useEffect, useState } from "react";
import { LIFECYCLE_PHASES, presentationType, viewsContaining, type Element, type Id, type PropertyDef, type PropertyValue, type SidePanel } from "@vastitecture/core";
import { dispatch, model, registry, select, set, useApp, useModel, useRegistryVersion } from "../state";
import { createView, retype } from "../ops";
import { t } from "../i18n";
import { Comments } from "./Comments";

/** Text input that commits on blur/Enter so every keystroke is not an undo step. */
export function Field({ label, value, onCommit, multiline, type = "text", id }: { label: string; value: string; onCommit(v: string): void; multiline?: boolean; type?: string; id?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const fid = id ?? "f-" + label.replace(/\W+/g, "-").toLowerCase();
  const commit = () => v !== value && onCommit(v);
  return (
    <>
      <label className="label" htmlFor={fid}>{label}</label>
      {multiline ? (
        <textarea id={fid} className="input" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} />
      ) : (
        <input id={fid} className="input" type={type} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
      )}
    </>
  );
}

export function PropertyField({ def, value, onChange }: { def: PropertyDef; value: PropertyValue | undefined; onChange(v: PropertyValue | undefined): void }) {
  const id = "p-" + def.key;
  if (def.type === "enum")
    return (
      <>
        <label className="label" htmlFor={id}>{def.label}</label>
        <select id={id} className="input" value={String(value ?? "")} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">—</option>
          {def.options?.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </>
    );
  if (def.type === "boolean")
    return (
      <label className="flex items-center gap-2 mt-2">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked || undefined)} /> {def.label}
      </label>
    );
  return (
    <Field
      id={id}
      label={def.label}
      multiline={def.type === "text"}
      type={def.type === "number" ? "number" : def.type === "date" ? "date" : "text"}
      value={Array.isArray(value) ? value.join(", ") : String(value ?? "")}
      onCommit={(v) => onChange(v === "" ? undefined : def.type === "number" ? Number(v) : def.type === "tags" ? v.split(",").map((x) => x.trim()).filter(Boolean) : v)}
    />
  );
}

function ElementProps({ el }: { el: Element }) {
  const activeView = useApp((s) => s.activeView);
  const adrs = useModel((ws) => ws.adrs);
  useModel((ws) => ws.views);
  useModel((ws) => ws.relationships);
  useModel((ws) => ws.mappings);
  const ws = model.state;
  const up = (patch: Partial<Element>, label = t("Edit element")) => dispatch({ type: "updateElement", id: el.id, patch }, label);
  const setProp = (key: string, v: PropertyValue | undefined) => {
    const properties = { ...el.properties };
    if (v === undefined) delete properties[key];
    else properties[key] = v;
    up({ properties });
  };
  const def = registry.elementType(el.type);
  const pack = registry.packs.get(el.type.slice(0, el.type.indexOf(":")));
  const others = viewsContaining(ws, el.id);
  const view = activeView ? ws.views[activeView] : undefined;
  const shownAs = view ? presentationType(ws, el, view.notation, registry) : undefined;
  const groups = new Map<string, PropertyDef[]>();
  for (const d of registry.propertiesFor(el.type)) groups.set(d.group ?? "", [...(groups.get(d.group ?? "") ?? []), d]);
  const linked = Object.values(adrs).filter((a) => a.elements.includes(el.id));
  const node = view?.nodes.find((n) => n.element === el.id);
  return (
    <div style={{ padding: "0 10px 14px" }}>
      <Field label={t("Name")} value={el.name} onCommit={(name) => up({ name }, t("Rename"))} />
      <label className="label" htmlFor="f-type">{t("Type")}</label>
      <select id="f-type" className="input" value={el.type} onChange={(e) => retype(el.id, e.target.value)}>
        {!def && <option value={el.type}>{el.type}</option>}
        {[...registry.packs.values()].map((p) => (
          <optgroup key={p.id} label={p === pack ? p.name : t("Formalise as {pack}", { pack: p.name })}>
            {p.elementTypes.map((ty) => <option key={ty.id} value={ty.id}>{ty.name}</option>)}
          </optgroup>
        ))}
      </select>
      {shownAs && shownAs !== el.type && (
        <div className="muted" style={{ marginTop: 4 }}>{t("Shown here as {type}", { type: registry.elementType(shownAs)?.name ?? shownAs })}</div>
      )}
      <Field label={t("Description")} value={el.description ?? ""} multiline onCommit={(v) => up({ description: v || undefined })} />
      <Field label={t("Owner")} value={el.owner ?? ""} onCommit={(v) => up({ owner: v || undefined })} />
      <Field label={t("Tags (comma-separated)")} value={el.tags.join(", ")} onCommit={(v) => up({ tags: v.split(",").map((x) => x.trim()).filter(Boolean) })} />
      <label className="label" htmlFor="f-phase">{t("Lifecycle phase")}</label>
      <select id="f-phase" className="input" value={el.lifecycle?.phase ?? ""} onChange={(e) => up({ lifecycle: { ...el.lifecycle, phase: (e.target.value || undefined) as never } })}>
        <option value="">—</option>
        {LIFECYCLE_PHASES.map((p) => <option key={p} value={p}>{phaseLabel(p)}</option>)}
      </select>
      <details>
        <summary className="label" style={{ cursor: "pointer" }}>{t("Lifecycle dates")}</summary>
        {LIFECYCLE_PHASES.map((p) => (
          <Field key={p} id={"f-date-" + p} label={phaseLabel(p)} type="date" value={el.lifecycle?.dates?.[p] ?? ""} onCommit={(v) => {
            const dates = { ...el.lifecycle?.dates };
            if (v) dates[p] = v;
            else delete dates[p];
            up({ lifecycle: { ...el.lifecycle, dates } });
          }} />
        ))}
      </details>
      {[...groups.entries()].map(([g, defs]) => (
        <div key={g}>
          {g && <div className="h" style={{ paddingLeft: 0 }}>{g}</div>}
          {defs.map((d) => <PropertyField key={d.key} def={d} value={el.properties[d.key]} onChange={(v) => setProp(d.key, v)} />)}
        </div>
      ))}
      <label className="label" htmlFor="f-parent">{t("Part of")}</label>
      <select id="f-parent" className="input" value={el.parent ?? ""} onChange={(e) => up({ parent: e.target.value || undefined })}>
        <option value="">—</option>
        {Object.values(ws.elements).filter((e) => e.id !== el.id).sort((a, b) => a.name.localeCompare(b.name)).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select>
      <div className="label">{t("Links")}</div>
      {el.links.map((l, i) => (
        <div key={i} className="flex gap-1 items-center" style={{ marginBottom: 2 }}>
          <span className="chip">{l.kind}</span>
          <a href={safeHref(l.href)} target="_blank" rel="noreferrer" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--accent)" }}>{l.label ?? l.href}</a>
          <button className="btn ghost" aria-label={t("Remove link")} onClick={() => up({ links: el.links.filter((_, j) => j !== i) })}>×</button>
        </div>
      ))}
      <form className="flex gap-1" onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const href = String(f.get("href") ?? "").trim();
        if (href) up({ links: [...el.links, { kind: f.get("kind") as never, href }] });
        e.currentTarget.reset();
      }}>
        <select name="kind" className="input" style={{ width: 86 }} aria-label={t("Link kind")}>
          {["repo", "runbook", "adr", "doc", "other"].map((k) => <option key={k}>{k}</option>)}
        </select>
        <input name="href" className="input" placeholder={t("https://…")} aria-label={t("Link URL")} />
        <button className="btn" type="submit">{t("Add")}</button>
      </form>
      {node && view && (
        <>
          <label className="label" htmlFor="f-fill">{t("Fill colour in this view")}</label>
          <div className="flex gap-1">
            <input id="f-fill" type="color" value={String(node.style?.fill ?? def?.fill ?? "#f8fafc")} onChange={(e) => dispatch({ type: "updateNodes", view: view.id, nodes: [{ element: el.id, style: { ...node.style, fill: e.target.value } }] }, t("Change colour"), { coalesce: true })} />
            {node.style?.fill && <button className="btn" onClick={() => dispatch({ type: "updateNodes", view: view.id, nodes: [{ element: el.id, style: undefined }] }, t("Change colour"))}>{t("Reset")}</button>}
          </div>
        </>
      )}
      {[...registry.packs.values()].flatMap((p) => p.viewpoints.filter((vp) => vp.kind === "form" && vp.form?.subjectTypes.includes(presentationType(ws, el, p.id, registry) ?? "")).map((vp) => (
        <button key={vp.id} className="btn mt-2" onClick={() => {
          const existing = Object.values(model.state.views).find((v) => v.viewpoint === vp.id && v.subject === el.id);
          if (existing) set({ activeView: existing.id, page: "diagram" });
          else createView(p.id, vp.id, `${el.name} – ${vp.name}`, { subject: el.id });
        }}>{t("Open {name}", { name: vp.name })}</button>
      )))}
      {view && node && (() => {
        const present = new Set(view.nodes.map((n) => n.element));
        const mine = Object.values(ws.relationships).filter((r) => (r.source === el.id || r.target === el.id) && present.has(r.source) && present.has(r.target));
        if (!mine.length) return null;
        const shown = new Set(view.edges.map((e) => e.relationship));
        return (
          <details>
            <summary className="label" style={{ cursor: "pointer" }}>{t("Relationships in this view ({shown} of {total} shown)", { shown: mine.filter((r) => shown.has(r.id)).length, total: mine.length })}</summary>
            {mine.map((r) => (
              <label key={r.id} className="flex items-center gap-2" style={{ fontSize: 12 }}>
                <input type="checkbox" checked={shown.has(r.id)} onChange={(e) => dispatch(e.target.checked ? { type: "putEdge", view: view.id, edge: { relationship: r.id } } : { type: "removeEdge", view: view.id, relationship: r.id }, t("Show or hide relationship"))} />
                <span>{r.source === el.id ? "→ " + ws.elements[r.target]?.name : "← " + ws.elements[r.source]?.name} <span className="muted">· {registry.relationshipType(r.type)?.name ?? r.type}</span></span>
              </label>
            ))}
          </details>
        );
      })()}
      <div className="label">{t("Shown in views")}</div>
      {others.map((v) => (
        <div key={v.id} className={`row${v.id === activeView ? " active" : ""}`} style={{ paddingLeft: 4 }} role="button" tabIndex={0} onClick={() => set({ activeView: v.id, page: "diagram" })}>
          {v.name} <span className="muted" style={{ marginLeft: "auto", fontSize: 11 }}>{registry.packs.get(v.notation)?.name}</span>
        </div>
      ))}
      {!others.length && <div className="muted">{t("Not shown in any view")}</div>}
      {!!linked.length && <div className="label">{t("Decisions")}</div>}
      {linked.map((a) => (
        <div key={a.id} className="row" style={{ paddingLeft: 4 }} role="button" tabIndex={0} onClick={() => set({ page: "adrs", openAdr: a.id })}>
          {a.id} {a.title} <span className="chip" style={{ marginLeft: "auto" }}>{a.status}</span>
        </div>
      ))}
      <Comments target={{ kind: "element", id: el.id }} />
      <div className="muted" style={{ marginTop: 10, fontSize: 10 }}>{el.id}</div>
    </div>
  );
}

export const phaseLabel = (p: string) => ({ plan: t("Plan"), phaseIn: t("Phase in"), active: t("Active"), phaseOut: t("Phase out"), endOfLife: t("End of life") })[p] ?? p;

function RelationshipProps({ id }: { id: Id }) {
  const r = useModel((ws) => ws.relationships[id]);
  const activeView = useApp((s) => s.activeView);
  if (!r) return null;
  const ws = model.state;
  const view = activeView ? ws.views[activeView] : undefined;
  const notation = r.type.slice(0, r.type.indexOf(":"));
  const s = ws.elements[r.source], tg = ws.elements[r.target];
  const st = s && (presentationType(ws, s, notation, registry) ?? s.type);
  const tt = tg && (presentationType(ws, tg, notation, registry) ?? tg.type);
  const valid = st && tt ? registry.validRelationships(notation, st, tt).types : [];
  const options = [...new Set([r.type, ...valid])];
  const up = (patch: object) => dispatch({ type: "updateRelationship", id, patch }, t("Edit relationship"));
  const edge = view?.edges.find((e) => e.relationship === id);
  return (
    <div style={{ padding: "0 10px 14px" }}>
      <div className="muted" style={{ marginTop: 6 }}>{s?.name} → {tg?.name}</div>
      <label className="label" htmlFor="r-type">{t("Type")}</label>
      <select id="r-type" className="input" value={r.type} onChange={(e) => up({ type: e.target.value })}>
        {options.map((o) => <option key={o} value={o}>{registry.relationshipType(o)?.name ?? o}</option>)}
      </select>
      <Field label={t("Label")} value={r.label ?? ""} onCommit={(v) => up({ label: v || undefined })} />
      <Field label={t("Technology")} value={r.technology ?? ""} onCommit={(v) => up({ technology: v || undefined })} />
      <div className="flex gap-2">
        <div><Field label={t("Source multiplicity")} value={r.multiplicity?.source ?? ""} onCommit={(v) => up({ multiplicity: { ...r.multiplicity, source: v || undefined } })} /></div>
        <div><Field label={t("Target multiplicity")} value={r.multiplicity?.target ?? ""} onCommit={(v) => up({ multiplicity: { ...r.multiplicity, target: v || undefined } })} /></div>
      </div>
      {(registry.relationshipType(r.type)?.properties ?? []).map((d) => (
        <PropertyField key={d.key} def={d} value={r.properties[d.key]} onChange={(v) => {
          const properties = { ...r.properties };
          if (v === undefined) delete properties[d.key];
          else properties[d.key] = v;
          up({ properties });
        }} />
      ))}
      {view && edge && (
        <Field label={t("Step number (dynamic views)")} type="number" value={edge.order === undefined ? "" : String(edge.order)} onCommit={(v) => dispatch({ type: "putEdge", view: view.id, edge: { ...edge, order: v === "" ? undefined : Number(v) } }, t("Edit step"))} />
      )}
      <div className="flex gap-2 mt-3">
        <button className="btn" onClick={() => dispatch({ type: "updateRelationship", id, patch: { source: r.target, target: r.source } }, t("Reverse"))}>{t("Reverse direction")}</button>
        {view && edge && <button className="btn" onClick={() => (dispatch({ type: "removeEdge", view: view.id, relationship: id }, t("Hide")), select())}>{t("Hide in this view")}</button>}
      </div>
    </div>
  );
}

function ViewProps({ id }: { id: Id }) {
  const v = useModel((ws) => ws.views[id]);
  if (!v) return null;
  const pack = registry.packs.get(v.notation);
  const up = (patch: object) => dispatch({ type: "updateView", id, patch }, t("Edit view"));
  const defs = [...registry.packs.values()].flatMap((p) => p.viewProperties ?? []);
  const subject = v.subject ? model.state.elements[v.subject] : undefined;
  return (
    <div style={{ padding: "0 10px 14px" }}>
      <Field label={t("View name")} value={v.name} onCommit={(name) => up({ name })} />
      <div className="muted" style={{ marginTop: 4 }}>{pack?.name ?? v.notation}</div>
      <label className="label" htmlFor="v-vp">{t("Viewpoint")}</label>
      <select id="v-vp" className="input" value={v.viewpoint ?? ""} onChange={(e) => up({ viewpoint: e.target.value || undefined })}>
        <option value="">—</option>
        {pack?.viewpoints.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <Field label={t("Description")} value={v.description ?? ""} multiline onCommit={(d) => up({ description: d || undefined })} />
      {subject && <div className="muted" style={{ marginTop: 6 }}>{t("Drills into {name}", { name: subject.name })}</div>}
      <label className="flex items-center gap-2 mt-2">
        <input type="checkbox" checked={v.properties.showImplied !== false} onChange={(e) => {
          const properties = { ...v.properties };
          if (e.target.checked) delete properties.showImplied;
          else properties.showImplied = false;
          up({ properties });
        }} /> {t("Show implied relationships")}
      </label>
      {defs.map((d) => (
        <PropertyField key={d.key} def={d} value={v.properties[d.key]} onChange={(val) => {
          const properties = { ...v.properties };
          if (val === undefined) delete properties[d.key];
          else properties[d.key] = val;
          up({ properties });
        }} />
      ))}
      <div className="mt-3">
        <button className="btn" style={{ color: "var(--danger)" }} onClick={() => {
          dispatch({ type: "removeView", id }, t("Delete view"));
          set({ activeView: Object.keys(model.state.views)[0] });
        }}>{t("Delete view")}</button>
      </div>
    </div>
  );
}

export function Properties() {
  useRegistryVersion();
  const selection = useApp((s) => s.selection);
  const activeView = useApp((s) => s.activeView);
  const el = useModel((ws) => (selection.elements.length === 1 ? ws.elements[selection.elements[0]] : undefined));
  const count = selection.elements.length + selection.relationships.length;
  return (
    <aside className="panel chrome border-l scroll" style={{ width: 290, minWidth: 290 }} aria-label={t("Properties")} data-testid="properties">
      <div className="h">{el ? t("Element") : selection.relationships.length === 1 && !selection.elements.length ? t("Relationship") : count > 1 ? t("{count} selected", { count }) : t("View")}</div>
      {el ? (
        <ElementProps el={el} />
      ) : selection.relationships.length === 1 && !selection.elements.length ? (
        <RelationshipProps id={selection.relationships[0]} />
      ) : count > 1 ? (
        <div className="muted" style={{ padding: "0 10px" }}>{t("Use the toolbar to align or distribute the selection.")}</div>
      ) : activeView ? (
        <ViewProps id={activeView} />
      ) : null}
      {[...registry.panels.values()].map((p) => <PluginPanel key={p.id} panel={p} />)}
    </aside>
  );
}

/**
 * A plugin's side panel: its HTML is shown in an iframe that can run no scripts, with its own policy that
 * blocks every network load (images and styles included), so the panel cannot send the model anywhere.
 */
const PANEL_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:";
function PluginPanel({ panel }: { panel: SidePanel }) {
  const ws = useModel((w) => w);
  const [html, setHtml] = useState(panel.html ?? "");
  useEffect(() => {
    if (!panel.render) return;
    let cancelled = false;
    const timer = setTimeout(() => void Promise.resolve(panel.render!(ws)).then((h) => !cancelled && setHtml(String(h))).catch((e) => !cancelled && setHtml(`<p>${String(e)}</p>`)), 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ws, panel]);
  return (
    <details open style={{ borderTop: "1px solid var(--border)" }} data-panel={panel.id}>
      <summary className="h" style={{ cursor: "pointer" }}>{panel.title}</summary>
      <iframe title={panel.title} sandbox="" srcDoc={`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PANEL_CSP}"><style>body{font:12px system-ui,sans-serif;margin:8px}</style>${html}`} style={{ width: "100%", height: 180, border: 0, background: "#fff" }} />
    </details>
  );
}
