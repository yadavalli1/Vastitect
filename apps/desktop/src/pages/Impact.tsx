import { useMemo, useState } from "react";
import { GAP_QUERIES, gapQuery, whatBreaks, whoUses, type QueryResult } from "@vastitecture/core";
import { app, model, registry, select, set, useModel } from "../state";
import { t } from "../i18n";

/** Questions over the whole model: what breaks if X is retired, what uses Y, and data-quality gaps. */
export function ImpactPage() {
  const elements = useModel((ws) => ws.elements);
  const relationships = useModel((ws) => ws.relationships);
  const [question, setQuestion] = useState("breaks");
  const [target, setTarget] = useState<string>(app.getState().selection.elements[0] ?? "");
  const [scope, setScope] = useState("business-system");
  const sorted = useMemo(() => Object.values(elements).sort((a, b) => a.name.localeCompare(b.name)), [elements]);
  const scopeTypes = (concept: string) => (concept ? new Set(Object.values(model.state.mappings.find((m) => m.concept === concept)?.members ?? {}).flat()) : undefined);
  const result: QueryResult | undefined = useMemo(() => {
    if (question === "breaks") return target && elements[target] ? whatBreaks(model.state, target, registry) : undefined;
    if (question === "uses") return target && elements[target] ? whoUses(model.state, target, scopeTypes(scope)) : undefined;
    const g = GAP_QUERIES.find((q) => q.id === question);
    return g ? gapQuery(model.state, g, scopeTypes(scope)) : undefined;
  }, [question, target, scope, elements, relationships]);
  const needsTarget = question === "breaks" || question === "uses";
  return (
    <div style={{ padding: 16, maxWidth: 980 }} data-testid="impact-page">
      <h2 style={{ marginTop: 0 }}>{t("Impact analysis")}</h2>
      <div className="flex gap-2 items-end" style={{ flexWrap: "wrap" }}>
        <div>
          <label className="label" htmlFor="iq-question">{t("Question")}</label>
          <select id="iq-question" className="input" value={question} onChange={(e) => setQuestion(e.target.value)}>
            <option value="breaks">{t("What breaks if we retire…")}</option>
            <option value="uses">{t("What uses…")}</option>
            {GAP_QUERIES.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
          </select>
        </div>
        {needsTarget && (
          <div>
            <label className="label" htmlFor="iq-target">{t("Element")}</label>
            <select id="iq-target" className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">—</option>
              {sorted.map((e) => <option key={e.id} value={e.id}>{e.name} ({registry.elementType(e.type)?.name ?? e.type})</option>)}
            </select>
          </div>
        )}
        {question !== "breaks" && (
          <div>
            <label className="label" htmlFor="iq-scope">{t("Limit to")}</label>
            <select id="iq-scope" className="input" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="">{t("Any element")}</option>
              {model.state.mappings.map((m) => <option key={m.concept} value={m.concept}>{m.label ?? m.concept}</option>)}
            </select>
          </div>
        )}
      </div>
      {result && (
        <section style={{ marginTop: 16 }} aria-live="polite" data-testid="impact-result">
          <h3 style={{ marginBottom: 4 }}>{result.title}</h3>
          <p className="muted" style={{ marginTop: 0 }}>{result.summary}</p>
          <table className="grid">
            <thead><tr><th>{t("Element")}</th><th>{t("Type")}</th><th>{t("Owner")}</th><th>{t("Why")}</th></tr></thead>
            <tbody>
              {result.rows.map((r) => {
                const e = elements[r.element];
                return (
                  <tr key={r.element}>
                    <td><button className="btn ghost" style={{ padding: 0, color: "var(--accent)" }} onClick={() => (select([r.element]), set({ page: "inventory" }))}>{e.name}</button></td>
                    <td>{registry.elementType(e.type)?.name ?? e.type}</td>
                    <td>{e.owner ?? ""}</td>
                    <td>{r.detail}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {question === "breaks" && target && (
            <button className="btn mt-2" onClick={() => {
              const v = Object.values(model.state.views).find((x) => x.nodes.some((n) => n.element === target));
              select([target]);
              set({ impact: "usedBy", page: "diagram", ...(v ? { activeView: v.id } : {}) });
            }}>{t("Highlight on a diagram")}</button>
          )}
        </section>
      )}
    </div>
  );
}
