import { useMemo, useState } from "react";
import { STARTER_RULES, checkRules, parseRules, rulesFromYaml, rulesToYaml } from "@vastitecture/core";
import { dispatch, useModel } from "../state";
import { goToProblem } from "../panels/Problems";
import { t } from "../i18n";
import { ListChecks } from "lucide-react";
import { EmptyState, PageHeader, SeverityIcon } from "../ui";

/**
 * Architecture rules: checks written as data in vastitecture.yaml. The same rules run here, in the
 * Problems panel while you edit, and in CI through the command-line tool.
 */
export function RulesPage() {
  const ws = useModel((w) => w);
  const results = useMemo(() => checkRules(ws), [ws]);
  const broken = useMemo(() => parseRules(ws.rules).problems, [ws.rules]);
  const [text, setText] = useState<string>();
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState<string>();
  const save = () => {
    try {
      dispatch({ type: "setSettings", patch: { rules: rulesFromYaml(text ?? "") } }, t("Edit architecture rules"));
      setText(undefined);
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const failing = results.filter((r) => r.problems.length).length;
  return (
    <div className="page" data-testid="rules-page">
      <PageHeader icon={ListChecks} title={t("Architecture rules")} description={t("Rules are stored in vastitecture.yaml, so changes to them are reviewed like any other change. Violations appear in the Problems panel while you edit, and the command-line tool enforces them in CI (see docs/CLI.md).")} />
      {!ws.rules.length && text === undefined && (
        <EmptyState
          icon={ListChecks}
          title={t("No rules yet")}
          action={
            <div className="flex gap-2" style={{ justifyContent: "center" }}>
              <button className="btn primary" onClick={() => dispatch({ type: "setSettings", patch: { rules: STARTER_RULES } }, t("Add starter rules"))}>{t("Add starter rules")}</button>
              <button className="btn" onClick={() => setText("")}>{t("Write my own")}</button>
            </div>
          }
        >
          {t("Start with five common rules (owners, descriptions, no dependencies on retiring systems, no shared databases, limited fan-out) and adjust them, or write your own.")}
        </EmptyState>
      )}
      {!!ws.rules.length && <p data-testid="rules-summary">{t("{count} rule(s), {failing} with violations", { count: results.length, failing })}</p>}
      {broken.map((p) => <p key={p.message} className="sev-error" role="alert">{p.message}</p>)}
      {!!results.length && <table className="data-table" style={{ width: "100%" }}>
        <tbody>
          {results.map(({ rule, checked, problems }) => (
            <tr key={rule.id} data-testid={`rule-${rule.id}`}>
              <td style={{ width: 32 }}><SeverityIcon level={problems.length ? rule.severity : "ok"} /></td>
              <td>
                <strong>{rule.description ?? rule.id}</strong> <span className="muted" style={{ fontSize: 11 }}>{rule.id}</span>
                {open === rule.id && (
                  <ul style={{ margin: "4px 0", paddingLeft: 18, fontSize: 12 }}>
                    {problems.slice(0, 100).map((p) => (
                      <li key={p.message}><a href="#" onClick={(e) => (e.preventDefault(), goToProblem(p))}>{p.message.slice(p.message.indexOf(": ") + 2)}</a></li>
                    ))}
                  </ul>
                )}
              </td>
              <td className="muted" style={{ whiteSpace: "nowrap" }}>{t("{n} checked", { n: checked })}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                {problems.length ? <button className="btn ghost" onClick={() => setOpen(open === rule.id ? undefined : rule.id)}>{t("{n} violation(s)", { n: problems.length })}</button> : <span className="muted">{t("passes")}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>}
      {(!!ws.rules.length || text !== undefined) && <h3>{t("Edit rules")}</h3>}
      {text === undefined ? (!!ws.rules.length &&
        <button className="btn" onClick={() => setText(rulesToYaml(ws.rules))}>{t("Edit as YAML")}</button>
      ) : (
        <>
          <textarea className="input mono" aria-label={t("Rules (YAML)")} spellCheck={false} style={{ minHeight: 260, fontFamily: "ui-monospace, monospace", fontSize: 12 }} value={text} onChange={(e) => setText(e.target.value)} />
          {error && <p className="sev-error" role="alert">{error}</p>}
          <div className="flex gap-2 mt-2">
            <button className="btn primary" onClick={save}>{t("Save rules")}</button>
            <button className="btn" onClick={() => (setText(undefined), setError(undefined))}>{t("Cancel")}</button>
          </div>
          <details className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            <summary>{t("Rule reference")}</summary>
            <pre style={{ whiteSpace: "pre-wrap" }}>{`- id: lowercase-with-dashes
  description: Shown with every violation
  severity: error | warning | info
  match: { type: c4:Container, tag: pci, lifecycle: active, property: { kind: Database }, name: "^shop", owner: Team A }
  require: [owner, description, lifecycle, parent, inView, connected, adr, "property:tier", "tag:pci", "link:repo"]
  maxDependencies: 7
  maxDependents: 10
- id: a-relationship-rule
  forbid: { from: { … }, to: { … }, type: c4:Uses, acrossBoundaries: true }`}</pre>
          </details>
        </>
      )}
    </div>
  );
}
