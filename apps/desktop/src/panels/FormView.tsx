import type { Id } from "@vastitecture/core";
import { makeElement, presentationType } from "@vastitecture/core";
import { dispatch, model, registry, useModel } from "../state";
import { Field, PropertyField } from "./Properties";
import { t } from "../i18n";

/**
 * A form-backed card (e.g. the Bounded Context Canvas). The sections come from the pack's viewpoint
 * definition; the fields edit properties of the view's subject element, so they also show up in fact sheets.
 */
export function FormView({ viewId }: { viewId: Id }) {
  const view = useModel((ws) => ws.views[viewId]);
  const elements = useModel((ws) => ws.elements);
  const relationships = useModel((ws) => ws.relationships);
  const form = registry.viewpoint(view.notation, view.viewpoint)?.form;
  if (!form) return null;
  const ws = model.state;
  const subject = view.subject ? elements[view.subject] : undefined;
  const candidates = Object.values(elements)
    .filter((e) => form.subjectTypes.includes(presentationType(ws, e, view.notation, registry) ?? ""))
    .sort((a, b) => a.name.localeCompare(b.name));
  const typeName = registry.elementType(form.subjectTypes[0])?.name ?? t("element");

  if (!subject)
    return (
      <div style={{ padding: 30, maxWidth: 520 }} data-testid="form-view">
        <h2 style={{ marginTop: 0 }}>{view.name}</h2>
        <p className="muted">{t("Choose the {type} this card describes.", { type: typeName })}</p>
        <label className="label" htmlFor="form-subject">{typeName}</label>
        <select id="form-subject" className="input" value="" onChange={(e) => e.target.value && dispatch({ type: "updateView", id: viewId, patch: { subject: e.target.value } }, t("Choose subject"))}>
          <option value="">—</option>
          {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className="btn mt-3" onClick={() => {
          const el = makeElement(form.subjectTypes[0], view.name.replace(/\s*[–-].*$/, "") || typeName);
          dispatch([{ type: "addElement", element: el }, { type: "updateView", id: viewId, patch: { subject: el.id } }], t("New {type}", { type: typeName }));
        }}>{t("New {type}", { type: typeName })}</button>
      </div>
    );

  const up = (patch: object) => dispatch({ type: "updateElement", id: subject.id, patch }, t("Edit card"));
  const inbound = Object.values(relationships).filter((r) => r.target === subject.id && elements[r.source]);
  const outbound = Object.values(relationships).filter((r) => r.source === subject.id && elements[r.target]);
  const relList = (title: string, rels: typeof inbound, other: "source" | "target") => (
    <div className="panel" style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 10 }}>
      <div className="h" style={{ padding: 0 }}>{title}</div>
      {rels.map((r) => (
        <div key={r.id}>
          {elements[r[other]].name} <span className="muted">· {registry.relationshipType(r.type)?.name ?? r.type}{r.label ? ` · ${r.label}` : ""}</span>
        </div>
      ))}
      {!rels.length && <div className="muted">{t("None in the model")}</div>}
    </div>
  );
  return (
    <div className="scroll h-full" style={{ padding: 20 }} data-testid="form-view">
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div className="panel" style={{ border: "2px solid var(--node-stroke)", borderRadius: 8, padding: 14, marginBottom: 12 }}>
          <div className="flex gap-3 items-end">
            <div style={{ flex: 1 }}><Field id="form-name" label={t("Name")} value={subject.name} onCommit={(name) => name.trim() && up({ name: name.trim() })} /></div>
            <div style={{ flex: 1 }}><Field id="form-owner" label={t("Owner")} value={subject.owner ?? ""} onCommit={(v) => up({ owner: v || undefined })} /></div>
            <button className="btn" onClick={() => dispatch({ type: "updateView", id: viewId, patch: { subject: undefined } }, t("Change subject"))}>{t("Change…")}</button>
          </div>
          <Field id="form-description" label={t("Description")} value={subject.description ?? ""} multiline onCommit={(v) => up({ description: v || undefined })} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
          {form.sections.map((s) => (
            <section key={s.title} className="panel" style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "4px 10px 10px" }} aria-label={s.title}>
              <div className="h" style={{ padding: "6px 0 0" }}>{s.title}</div>
              {s.fields.map((d) => (
                <PropertyField key={d.key} def={{ ...d, key: d.key }} value={subject.properties[d.key]} onChange={(v) => {
                  const properties = { ...subject.properties };
                  if (v === undefined) delete properties[d.key];
                  else properties[d.key] = v;
                  up({ properties });
                }} />
              ))}
            </section>
          ))}
          {relList(t("Inbound relationships (from the model)"), inbound, "source")}
          {relList(t("Outbound relationships (from the model)"), outbound, "target")}
        </div>
      </div>
    </div>
  );
}
