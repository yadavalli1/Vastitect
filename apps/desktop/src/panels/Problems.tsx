import { useEffect, useMemo, useState } from "react";
import { validate, viewsContaining, type Problem } from "@vastitecture/core";
import { dispatch, model, registry, select, set, useModel, useRegistryVersion } from "../state";
import { t } from "../i18n";

export function useProblems(): Problem[] {
  const elements = useModel((ws) => ws.elements);
  const relationships = useModel((ws) => ws.relationships);
  const views = useModel((ws) => ws.views);
  const mappings = useModel((ws) => ws.mappings);
  const rules = useModel((ws) => ws.rules);
  const v = useRegistryVersion();
  const [fromPlugins, setFromPlugins] = useState<Problem[]>([]);
  // Validators contributed by plugins run in their sandbox, so they are asynchronous.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const out: Problem[] = [];
      for (const val of registry.validators.values()) {
        try {
          out.push(...(await val.run(model.state)));
        } catch (e) {
          out.push({ code: "validator-failed", severity: "warning", message: `Validator ${val.id} failed: ${e instanceof Error ? e.message : e}`, target: { kind: "workspace" } });
        }
      }
      if (!cancelled) setFromPlugins(out);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [elements, relationships, views, mappings, v]);
  return useMemo(() => {
    const order = { error: 0, warning: 1, info: 2 };
    return [...validate(model.state, registry), ...fromPlugins].sort((a, b) => order[a.severity] - order[b.severity]);
  }, [elements, relationships, views, mappings, rules, v, fromPlugins]);
}

const ICON = { error: "⛔", warning: "⚠", info: "ℹ" };

/** Show a problem: open its view when it has one, and select what it is about. */
export function goToProblem(p: Problem) {
  if (p.view && model.state.views[p.view]) set({ activeView: p.view, page: "diagram" });
  else if (p.target.kind === "view" && p.target.id) set({ activeView: p.target.id, page: "diagram" });
  else if (p.target.kind === "element" && p.target.id) {
    const v = viewsContaining(model.state, p.target.id)[0];
    set(v ? { activeView: v.id, page: "diagram" } : { page: "inventory" });
  } else if (p.target.kind === "relationship" && p.target.id) {
    const v = Object.values(model.state.views).find((x) => x.edges.some((e) => e.relationship === p.target.id));
    if (v) set({ activeView: v.id, page: "diagram" });
  }
  if (p.target.kind === "element" && p.target.id) select([p.target.id]);
  if (p.target.kind === "relationship" && p.target.id) select([], [p.target.id]);
}

export function Problems({ problems }: { problems: Problem[] }) {
  const go = goToProblem;
  return (
    <section className="panel chrome border-t scroll" style={{ height: 190 }} aria-label={t("Problems")} data-testid="problems">
      <div className="h">{t("Problems")} ({problems.length})</div>
      {problems.slice(0, 500).map((p, i) => (
        <div key={i} className="row" role="button" tabIndex={0} onClick={() => go(p)} onKeyDown={(e) => e.key === "Enter" && go(p)}>
          <span className={`sev-${p.severity}`} aria-label={p.severity}>{ICON[p.severity]}</span>
          <span>{p.message}</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
            {p.fixes?.map((f) => (
              <button key={f.label} className="btn" onClick={(e) => (e.stopPropagation(), dispatch(f.commands, f.label))}>{f.label}</button>
            ))}
          </span>
        </div>
      ))}
      {!problems.length && <div className="row muted">{t("No problems found")}</div>}
    </section>
  );
}
