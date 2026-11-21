import { slugify, type Element, type ImportInput, type ModelPatch, type Workspace } from "@vastitecture/plugin-sdk";
import { csvRows } from "./util";

/**
 * Cloud cost exports (AWS Cost and Usage Report 1.0/2.0, Azure cost details, Google Cloud billing
 * export) summed per element. A line is matched by its resource id against elements that came from the
 * cloud connectors, or by a tag/label whose value names an element (e.g. system=Online Shop). The
 * result is a monthly cost on each matched element; the Insights page rolls it up through containment.
 */
interface Line {
  resource: string;
  cost: number;
  currency: string;
  date?: string;
  tags: Record<string, string>;
}

const COL = {
  resource: /^(lineitem\/resourceid|line_item_resource_id|resourceid|resource id|resource\.global_name|resource\.name|instanceid)$/i,
  cost: /^(lineitem\/unblendedcost|line_item_unblended_cost|costinbillingcurrency|pretaxcost|cost(\s*\(.*\))?|costusd)$/i,
  currency: /^(lineitem\/currencycode|line_item_currency_code|billingcurrency(code)?|currency)$/i,
  date: /^(lineitem\/usagestartdate|line_item_usage_start_date|date|usage_start_time|usagedatetime)$/i,
  tags: /^(tags|resource_tags|labels)$/i,
  tagCol: /^(resourceTags\/user:|resource_tags_user_|label:|tag:)(.+)$/i,
};

function parseTags(v: string): Record<string, string> {
  const t = v.trim();
  if (!t) return {};
  try {
    const j = JSON.parse(t.startsWith("{") ? t : `{${t}}`);
    if (Array.isArray(j)) return Object.fromEntries(j.map((x) => [x.key, String(x.value)]));
    return Object.fromEntries(Object.entries(j).map(([k, x]) => [k.replace(/^user:/, ""), String(x)]));
  } catch {
    return Object.fromEntries(t.split(/[;,]/).map((p) => p.split(/[=:]/).map((s) => s.trim().replace(/^"|"$/g, ""))).filter((p) => p.length === 2 && p[0]) as [string, string][]);
  }
}

export function parseCostFiles(files: ImportInput[], report: string[] = []): Line[] {
  const lines: Line[] = [];
  for (const f of files) {
    const [head, ...rows] = csvRows(f.text);
    if (!head) continue;
    const find = (re: RegExp) => head.findIndex((h) => re.test(h.trim()));
    const [ri, ci, ui, di, ti] = [find(COL.resource), find(COL.cost), find(COL.currency), find(COL.date), find(COL.tags)];
    const tagCols = head.map((h, i) => [i, COL.tagCol.exec(h.trim())?.[2]] as const).filter(([, k]) => k);
    if (ci < 0 || (ri < 0 && ti < 0 && !tagCols.length)) {
      report.push(`${f.name}: no cost column with a resource id or tags found, skipped`);
      continue;
    }
    for (const r of rows) {
      const cost = Number(String(r[ci] ?? "").replace(/[^0-9.eE-]/g, ""));
      if (!cost) continue;
      const tags = { ...(ti >= 0 ? parseTags(r[ti] ?? "") : {}), ...Object.fromEntries(tagCols.map(([i, k]) => [k!, r[i] ?? ""]).filter(([, v]) => v)) };
      lines.push({ resource: ri >= 0 ? (r[ri] ?? "").trim() : "", cost, currency: (ui >= 0 ? r[ui] : "") || "USD", date: di >= 0 ? (r[di] ?? "").slice(0, 10) : undefined, tags });
    }
  }
  return lines;
}

const last = (s: string) => s.toLowerCase().split(/[/:]/).filter(Boolean).pop() ?? "";

export function costsToPatch(ws: Workspace, lines: Line[], config: { tagKeys?: string } = {}): ModelPatch {
  // Index elements by their cloud resource id (full and last segment) and by name for tag matching.
  const full = new Map<string, Element>(), tail = new Map<string, Element | null>(), byName = new Map<string, Element>();
  for (const e of Object.values(ws.elements)) {
    byName.set(slugify(e.name), e);
    const x = typeof e.properties.externalId === "string" ? e.properties.externalId : undefined;
    if (!x || !/^(aws|azure|gcp|tf):/.test(x)) continue;
    const id = x.replace(/^\w+:/, "").toLowerCase();
    full.set(id, e);
    const k = last(id);
    tail.set(k, tail.has(k) ? null : e); // ambiguous tails match nothing
  }
  const keys = (config.tagKeys || "system,application,app,service,component,vastitecture").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const sums = new Map<string, { el: Element; cost: number }>();
  let matched = 0, unmatched = 0;
  const currencies = new Set<string>();
  const dates = lines.map((l) => l.date).filter(Boolean).sort() as string[];
  for (const l of lines) {
    currencies.add(l.currency);
    const rid = l.resource.toLowerCase();
    let el = (rid && (full.get(rid.replace(/^\/+/, "/")) ?? full.get(rid) ?? tail.get(last(rid)))) || undefined;
    if (!el) for (const [k, v] of Object.entries(l.tags)) if (keys.includes(k.toLowerCase()) && byName.has(slugify(v))) el = byName.get(slugify(v));
    if (!el) {
      unmatched += l.cost;
      continue;
    }
    matched += l.cost;
    const cur = sums.get(el.id) ?? { el, cost: 0 };
    cur.cost += l.cost;
    sums.set(el.id, cur);
  }
  const days = dates.length ? (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86_400_000 + 1 : 0;
  const months = days ? Math.max(1, Math.round(days / 30.44)) : 1;
  const currency = currencies.size === 1 ? [...currencies][0] : "mixed";
  const elements = [...sums.values()].map(({ el, cost }) => {
    const next = structuredClone(el);
    next.properties.monthlyCost = Math.round((cost / months) * 100) / 100;
    next.properties.costCurrency = currency;
    if (dates.length) next.properties.costPeriod = `${dates[0]} – ${dates[dates.length - 1]}`;
    return next;
  });
  const money = (n: number) => `${(n / months).toLocaleString("en", { maximumFractionDigits: 0 })} ${currency}/month`;
  return {
    elements,
    report: [
      `Cloud costs: ${lines.length} line(s) over ${dates.length ? `${months} month(s)` : "an unknown period (assumed one month)"}; ${money(matched)} matched to ${sums.size} element(s)`,
      ...(unmatched ? [`${money(unmatched)} could not be matched. Run the cloud connectors first, or tag resources with ${keys.slice(0, 3).join("/")}=<element name>.`] : []),
      ...(currencies.size > 1 ? [`Several currencies (${[...currencies].join(", ")}) were added together; convert the export to one currency first.`] : []),
    ],
  };
}
