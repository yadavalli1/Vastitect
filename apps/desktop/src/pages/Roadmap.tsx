import { useMemo, useState } from "react";
import { LIFECYCLE_PHASES, type Element } from "@vastitecture/core";
import { registry, select, set, useModel } from "../state";
import { phaseLabel } from "../panels/Properties";
import { t } from "../i18n";

/** Distinct hues plus a pattern per phase, so phases differ in more than colour. */
const PHASE_STYLE: Record<string, { bg: string; pattern?: string }> = {
  plan: { bg: "#e2e8f0", pattern: "repeating-linear-gradient(45deg,transparent 0 4px,rgba(0,0,0,.18) 4px 6px)" },
  phaseIn: { bg: "#93c5fd", pattern: "repeating-linear-gradient(90deg,transparent 0 6px,rgba(0,0,0,.15) 6px 8px)" },
  active: { bg: "#2563eb" },
  phaseOut: { bg: "#f59e0b", pattern: "repeating-linear-gradient(-45deg,transparent 0 4px,rgba(0,0,0,.2) 4px 6px)" },
  endOfLife: { bg: "#7f1d1d" },
};
const DAY = 86400000;

/** Timeline of every element with lifecycle dates, one bar segment per phase. */
export function RoadmapPage() {
  const elements = useModel((ws) => ws.elements);
  const [owner, setOwner] = useState("");
  const [type, setType] = useState("");
  const rows = useMemo(
    () =>
      Object.values(elements)
        .filter((e) => e.lifecycle?.dates && Object.keys(e.lifecycle.dates).length)
        .filter((e) => (!owner || e.owner === owner) && (!type || e.type === type))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [elements, owner, type],
  );
  const owners = [...new Set(Object.values(elements).map((e) => e.owner).filter(Boolean))].sort() as string[];
  const types = [...new Set(Object.values(elements).filter((e) => e.lifecycle?.dates).map((e) => e.type))].sort();
  const now = Date.now();
  const dates = rows.flatMap((e) => Object.values(e.lifecycle!.dates!).map((d) => Date.parse(d))).filter(Number.isFinite);
  const start = new Date(new Date(Math.min(now, ...dates)).getFullYear(), 0, 1).getTime();
  const end = new Date(new Date(Math.max(now + 365 * DAY, ...dates)).getFullYear() + 1, 0, 1).getTime();
  const pct = (ms: number) => ((ms - start) / (end - start)) * 100;
  const first = new Date(start).getFullYear();
  const years = Array.from({ length: new Date(end).getFullYear() - first }, (_, i) => first + i);
  const segments = (e: Element) => {
    const d = e.lifecycle!.dates!;
    const known = LIFECYCLE_PHASES.filter((p) => d[p]).map((p) => ({ p, at: Date.parse(d[p]!) })).sort((a, b) => a.at - b.at);
    return known.map((k, i) => ({ phase: k.p, from: k.at, to: k.p === "endOfLife" ? Math.min(end, k.at + 180 * DAY) : known[i + 1]?.at ?? end }));
  };
  return (
    <div style={{ padding: 16 }} data-testid="roadmap-page">
      <div className="flex items-center gap-2" style={{ marginBottom: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: "0 12px 0 0" }}>{t("Lifecycle roadmap")}</h2>
        <select className="btn" aria-label={t("Owner")} value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">{t("All owners")}</option>
          {owners.map((o) => <option key={o}>{o}</option>)}
        </select>
        <select className="btn" aria-label={t("Element type")} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">{t("All types")}</option>
          {types.map((ty) => <option key={ty} value={ty}>{registry.elementType(ty)?.name ?? ty}</option>)}
        </select>
        <span className="flex items-center gap-2" aria-label={t("Legend")} style={{ marginLeft: 12, fontSize: 12 }}>
          {LIFECYCLE_PHASES.map((p) => (
            <span key={p} className="flex items-center gap-1"><span style={{ width: 22, height: 12, background: PHASE_STYLE[p].pattern ? `${PHASE_STYLE[p].pattern}, ${PHASE_STYLE[p].bg}` : PHASE_STYLE[p].bg, border: "1px solid var(--border)" }} />{phaseLabel(p)}</span>
          ))}
        </span>
      </div>
      {!rows.length && <p className="muted">{t("No element has lifecycle dates yet. Add them in an element's properties or the fact sheets.")}</p>}
      {!!rows.length && (
        <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", rowGap: 6 }} role="table" aria-label={t("Lifecycle roadmap")}>
          <div />
          <div style={{ position: "relative", height: 18, borderBottom: "1px solid var(--border)" }}>
            {years.map((y) => <span key={y} style={{ position: "absolute", left: `${pct(new Date(y, 0, 1).getTime())}%`, fontSize: 11 }} className="muted">{y}</span>)}
          </div>
          {rows.map((e) => (
            <div key={e.id} role="row" style={{ display: "contents" }}>
              <button role="rowheader" className="btn ghost" style={{ justifyContent: "flex-start", overflow: "hidden" }} onClick={() => (select([e.id]), set({ page: "inventory" }))}>{e.name}</button>
              <div role="cell" style={{ position: "relative", height: 24, background: "var(--panel-2)" }}>
                {years.map((y) => <span key={y} style={{ position: "absolute", left: `${pct(new Date(y, 0, 1).getTime())}%`, top: 0, bottom: 0, borderLeft: "1px dotted var(--border)" }} />)}
                {segments(e).map((s) => (
                  <span key={s.phase} data-phase={s.phase} title={`${phaseLabel(s.phase)}: ${new Date(s.from).toISOString().slice(0, 10)}`}
                    style={{ position: "absolute", left: `${pct(s.from)}%`, width: `${Math.max(0.5, pct(s.to) - pct(s.from))}%`, top: 3, bottom: 3, background: PHASE_STYLE[s.phase].pattern ? `${PHASE_STYLE[s.phase].pattern}, ${PHASE_STYLE[s.phase].bg}` : PHASE_STYLE[s.phase].bg, borderRadius: 3, fontSize: 10, color: s.phase === "active" || s.phase === "endOfLife" ? "#fff" : "#0f172a", overflow: "hidden", whiteSpace: "nowrap", paddingLeft: 3 }}>
                    {phaseLabel(s.phase)}
                  </span>
                ))}
                <span aria-label={t("Today")} style={{ position: "absolute", left: `${pct(now)}%`, top: -2, bottom: -2, borderLeft: "2px solid var(--danger)" }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
