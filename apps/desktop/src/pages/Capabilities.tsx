import { useMemo, useState } from "react";
import { equivalentTypes, type Element, type Id, type Workspace } from "@vastitecture/core";
import { model, select, set, useModel } from "../state";
import { t } from "../i18n";

const FIT = ["Unreasonable", "Insufficient", "Adequate", "Excellent"];
const PHASE_RANK: Record<string, number> = { endOfLife: 0, phaseOut: 1, plan: 2, phaseIn: 3, active: 4 };
/** Colour-blind-safe sequential palette (light to dark blue); the value is always printed too. */
const SCALE = ["#f7fbff", "#c6dbef", "#6baed6", "#2171b5", "#08306b"];

interface Metric {
  id: string;
  label: string;
  value(cap: Element, apps: Element[], ws: Workspace): number | undefined;
  format(v: number): string;
  /** Higher is better (dark = good) or worse. */
  higherIsBetter: boolean;
}

const fitScore = (v: unknown) => (typeof v === "string" && FIT.includes(v) ? FIT.indexOf(v) : undefined);
const avg = (xs: (number | undefined)[]) => {
  const ys = xs.filter((x): x is number => x !== undefined);
  return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : undefined;
};

const METRICS: Metric[] = [
  { id: "apps", label: "Application count", value: (_c, apps) => apps.length, format: (v) => String(v), higherIsBetter: false },
  { id: "functionalFit", label: "Functional fit", value: (c, apps) => fitScore(c.properties.functionalFit) ?? avg(apps.map((a) => fitScore(a.properties.functionalFit))), format: (v) => FIT[Math.round(v)], higherIsBetter: true },
  { id: "technicalFit", label: "Technical fit (of applications)", value: (_c, apps) => avg(apps.map((a) => fitScore(a.properties.technicalFit))), format: (v) => FIT[Math.round(v)], higherIsBetter: true },
  {
    id: "cost",
    label: "Annual cost",
    value: (c, apps) => {
      const own = typeof c.properties.annualCost === "number" ? c.properties.annualCost : undefined;
      const sum = apps.reduce((s, a) => s + (typeof a.properties.annualCost === "number" ? a.properties.annualCost : 0), 0);
      return own ?? (apps.length ? sum : undefined);
    },
    format: (v) => v.toLocaleString(),
    higherIsBetter: false,
  },
  {
    id: "lifecycle",
    label: "Lifecycle risk (worst application phase)",
    value: (_c, apps) => {
      const r = apps.map((a) => PHASE_RANK[a.lifecycle?.phase ?? ""]).filter((x) => x !== undefined);
      return r.length ? Math.min(...r) : undefined;
    },
    format: (v) => ["End of life", "Phase out", "Plan", "Phase in", "Active"][v],
    higherIsBetter: true,
  },
];

/** Applications supporting a capability: business systems linked to it or to any of its sub-capabilities. */
function supporting(ws: Workspace, cap: Element, appTypes: Set<string>, under: Map<Id, Id[]>): Element[] {
  const ids = new Set<Id>();
  const caps = [cap.id];
  for (let i = 0; i < caps.length; i++) caps.push(...(under.get(caps[i]) ?? []));
  const capSet = new Set(caps);
  for (const r of Object.values(ws.relationships)) {
    const other = capSet.has(r.target) ? r.source : capSet.has(r.source) ? r.target : undefined;
    if (other && appTypes.has(ws.elements[other]?.type ?? "")) ids.add(other);
  }
  return [...ids].map((id) => ws.elements[id]);
}

export function CapabilitiesPage() {
  const elements = useModel((ws) => ws.elements);
  const relationships = useModel((ws) => ws.relationships);
  const mappings = useModel((ws) => ws.mappings);
  const [metricId, setMetricId] = useState("functionalFit");
  const metric = METRICS.find((m) => m.id === metricId)!;
  const { roots, under, appTypes, values } = useMemo(() => {
    const ws = model.state;
    const capTypes = new Set(equivalentTypes(ws, "archimate:Capability"));
    const caps = Object.values(ws.elements).filter((e) => capTypes.has(e.type));
    const capIds = new Set(caps.map((c) => c.id));
    const under = new Map<Id, Id[]>();
    for (const c of caps) if (c.parent && capIds.has(c.parent)) under.set(c.parent, [...(under.get(c.parent) ?? []), c.id]);
    const roots = caps.filter((c) => !c.parent || !capIds.has(c.parent)).sort((a, b) => a.name.localeCompare(b.name));
    const appTypes = new Set(ws.mappings.find((m) => m.concept === "business-system") ? Object.values(ws.mappings.find((m) => m.concept === "business-system")!.members).flat() : ["archimate:ApplicationComponent"]);
    const values = new Map<Id, { v?: number; apps: Element[] }>();
    for (const c of caps) {
      const apps = supporting(ws, c, appTypes, under);
      values.set(c.id, { v: metric.value(c, apps, ws), apps });
    }
    return { roots, under, appTypes, values };
  }, [elements, relationships, mappings, metric]);
  void appTypes;
  const nums = [...values.values()].map((x) => x.v).filter((x): x is number => x !== undefined);
  const [lo, hi] = [Math.min(...nums), Math.max(...nums)];
  const shade = (v: number | undefined) => {
    if (v === undefined || !nums.length) return { bg: "transparent", fg: "var(--text)", label: t("no data") };
    let k = hi === lo ? 0.5 : (v - lo) / (hi - lo);
    if (!metric.higherIsBetter) k = 1 - k;
    const i = Math.min(SCALE.length - 1, Math.round(k * (SCALE.length - 1)));
    return { bg: SCALE[i], fg: i >= 3 ? "#fff" : "#0f172a", label: metric.format(v) };
  };
  const tile = (id: Id, depth: number): JSX.Element => {
    const c = elements[id];
    const val = values.get(id)!;
    const s = shade(val.v);
    const kids = (under.get(id) ?? []).map((k) => elements[k]).sort((a, b) => a.name.localeCompare(b.name));
    return (
      <div key={id} role="group" aria-label={`${c.name}: ${metric.label} ${s.label}`} data-capability={c.name}
        style={{ background: s.bg, color: s.fg, border: "1px solid var(--node-stroke)", borderRadius: 6, padding: 8, margin: 4, minWidth: depth ? 150 : 220, flex: depth ? "0 0 auto" : "1 1 260px" }}>
        <button className="btn ghost" style={{ padding: 0, color: "inherit", fontWeight: 700 }} onClick={() => (select([id]), set({ page: "inventory" }))}>{c.name}</button>
        <div style={{ fontSize: 12 }}>{metric.label}: <strong data-testid="heat-value">{s.label}</strong></div>
        <div style={{ fontSize: 11, opacity: 0.85 }}>{val.apps.map((a) => a.name).join(", ") || t("No supporting applications")}</div>
        {!!kids.length && <div className="flex" style={{ flexWrap: "wrap", marginTop: 4 }}>{kids.map((k) => tile(k.id, depth + 1))}</div>}
      </div>
    );
  };
  return (
    <div style={{ padding: 16 }} data-testid="capabilities-page">
      <div className="flex items-center gap-3" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>{t("Business capability map")}</h2>
        <label className="flex items-center gap-2">{t("Heat map by")}
          <select className="btn" aria-label={t("Heat map metric")} value={metricId} onChange={(e) => setMetricId(e.target.value)}>
            {METRICS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
        <span className="flex items-center gap-1" aria-label={t("Legend")} style={{ fontSize: 11 }}>
          {metric.higherIsBetter ? t("worse") : t("higher")}
          {SCALE.map((c) => <span key={c} style={{ width: 18, height: 12, background: c, border: "1px solid var(--border)", display: "inline-block" }} />)}
          {metric.higherIsBetter ? t("better") : t("lower")}
        </span>
      </div>
      {!roots.length && <p className="muted">{t("No capabilities in the model yet. Add ArchiMate Capability elements, nested under each other, and relate applications to them.")}</p>}
      <div className="flex" style={{ flexWrap: "wrap", alignItems: "flex-start" }}>{roots.map((r) => tile(r.id, 0))}</div>
    </div>
  );
}
