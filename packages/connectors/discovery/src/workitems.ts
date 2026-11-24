import { slugify, type Element, type ImportInput, type ModelPatch, type Workspace } from "@vastitecture/plugin-sdk";
import { docs, type J } from "./util";
import { parseCsv } from "@vastitecture/core";

/**
 * Delivery work (Jira issues, Azure DevOps work items) linked to the elements it changes. Items are
 * matched by label, tag, component or area path equal to an element's name (or its `workItemKey`
 * property). Matched elements get links to their items and a delivery status; nothing else changes.
 */
export interface WorkItem {
  key: string;
  title: string;
  type?: string;
  status: string;
  category: "todo" | "doing" | "done";
  url?: string;
  /** Labels, tags, components and area-path segments: what links an item to elements. */
  refs: string[];
  due?: string;
}

const DONE = /^(done|closed|resolved|removed|completed|cancel+ed|won'?t do)$/i;
const DOING = /^(in progress|active|committed|doing|in review|review|testing|in development)$/i;
export const categoryOf = (status: string, hint?: string): WorkItem["category"] => {
  const h = (hint ?? "").toLowerCase();
  if (h === "done" || h === "complete" || h === "completed") return "done";
  if (h === "indeterminate" || h === "in progress" || h === "inprogress") return "doing";
  if (h === "new" || h === "to do" || h === "proposed") return "todo";
  return DONE.test(status.trim()) ? "done" : DOING.test(status.trim()) ? "doing" : "todo";
};

/** Jira REST (search or search/jql) issues. */
export function fromJira(issues: J[], site?: string): WorkItem[] {
  return issues.map((i) => {
    const f = (i.fields ?? {}) as J;
    const status = String(f.status?.name ?? "");
    return {
      key: String(i.key),
      title: String(f.summary ?? ""),
      type: f.issuetype?.name,
      status,
      category: categoryOf(status, f.status?.statusCategory?.key),
      url: site ? `https://${site}/browse/${i.key}` : i.self ? String(i.self).replace(/\/rest\/api\/.*$/, `/browse/${i.key}`) : undefined,
      refs: [...(f.labels ?? []), ...(f.components ?? []).map((c: J) => c.name)].map(String),
      due: f.duedate ?? undefined,
    };
  });
}

/** Azure DevOps work items (REST `value` array). */
export function fromAzureDevOps(items: J[], base?: string): WorkItem[] {
  return items.map((w) => {
    const f = (w.fields ?? {}) as J;
    const status = String(f["System.State"] ?? "");
    const area = String(f["System.AreaPath"] ?? "").split("\\").slice(1);
    return {
      key: String(w.id),
      title: String(f["System.Title"] ?? ""),
      type: f["System.WorkItemType"],
      status,
      category: categoryOf(status),
      url: w._links?.html?.href ?? (base ? `${base}/_workitems/edit/${w.id}` : undefined),
      refs: [...String(f["System.Tags"] ?? "").split(";").map((s) => s.trim()), ...area].filter(Boolean),
      due: f["Microsoft.VSTS.Scheduling.TargetDate"]?.slice(0, 10) ?? f["Microsoft.VSTS.Scheduling.DueDate"]?.slice(0, 10),
    };
  });
}

/** CSV exports from Jira ("Issue key", "Summary", repeated "Labels" columns, "Component/s") or Azure DevOps ("ID", "Title", "Tags", "Area Path"). */
export function fromCsv(text: string): WorkItem[] {
  const [head, ...rows] = parseCsv(text);
  if (!head) return [];
  const cols = (re: RegExp) => head.map((h, i) => (re.test(h.trim()) ? i : -1)).filter((i) => i >= 0);
  const one = (r: string[], re: RegExp) => cols(re).map((i) => r[i]).find((v) => v?.trim()) ?? "";
  const many = (r: string[], re: RegExp) => cols(re).flatMap((i) => (r[i] ?? "").split(/[;,]/)).map((s) => s.trim()).filter(Boolean);
  return rows.map((r) => {
    const status = one(r, /^(status|state)$/i);
    const area = one(r, /^area path$/i).split("\\").slice(1);
    return {
      key: one(r, /^(issue key|key|id)$/i),
      title: one(r, /^(summary|title)$/i),
      type: one(r, /^(issue type|work item type|type)$/i) || undefined,
      status,
      category: categoryOf(status, one(r, /^status category$/i)),
      refs: [...many(r, /^(labels?|tags|component\/s|components?)$/i), ...area],
      due: one(r, /^(due date|due|target date)$/i) || undefined,
    };
  }).filter((w) => w.key);
}

export function parseWorkItemFiles(files: ImportInput[], report: string[] = []): WorkItem[] {
  const out: WorkItem[] = [];
  for (const f of files) {
    if (/\.csv$/i.test(f.name)) {
      out.push(...fromCsv(f.text));
      continue;
    }
    for (const doc of docs(f, report)) {
      if (Array.isArray(doc.issues)) out.push(...fromJira(doc.issues));
      else if (Array.isArray(doc.value) && doc.value.some((w: J) => w?.fields?.["System.Title"] !== undefined)) out.push(...fromAzureDevOps(doc.value));
      else report.push(`${f.name}: not a Jira search result or Azure DevOps work item list, skipped`);
    }
  }
  return out;
}

const norm = (s: string) => slugify(s);

export function linkWorkItems(ws: Workspace, items: WorkItem[], source: string): ModelPatch {
  const byKey = new Map<string, Element[]>();
  for (const e of Object.values(ws.elements)) {
    for (const k of [e.name, typeof e.properties.workItemKey === "string" ? e.properties.workItemKey : undefined]) {
      if (!k) continue;
      const list = byKey.get(norm(k)) ?? [];
      if (!list.includes(e)) list.push(e);
      byKey.set(norm(k), list);
    }
  }
  const per = new Map<string, { el: Element; items: WorkItem[] }>();
  const unmatched = new Map<string, number>();
  let linked = 0;
  for (const w of items) {
    const hits = new Set<Element>();
    for (const r of w.refs) for (const e of byKey.get(norm(r)) ?? []) hits.add(e);
    if (!hits.size) for (const r of w.refs) unmatched.set(r, (unmatched.get(r) ?? 0) + 1);
    if (hits.size) linked++;
    for (const e of hits) {
      const cur = per.get(e.id) ?? { el: e, items: [] };
      cur.items.push(w);
      per.set(e.id, cur);
    }
  }
  const elements: Element[] = [];
  for (const { el, items: list } of per.values()) {
    const next = structuredClone(el);
    const known = new Set(next.links.map((l) => l.href));
    for (const w of list) if (w.url && !known.has(w.url)) next.links.push({ kind: "other", label: `${w.key}: ${w.title}`.slice(0, 120), href: w.url });
    const n = (c: WorkItem["category"]) => list.filter((w) => w.category === c).length;
    next.properties.workItems = `${n("todo")} to do, ${n("doing")} in progress, ${n("done")} done (${source})`;
    const due = list.filter((w) => w.category !== "done" && w.due).map((w) => w.due!).sort()[0];
    if (due) next.properties.nextDue = due;
    else delete next.properties.nextDue;
    if (JSON.stringify(next) !== JSON.stringify(el)) elements.push(next);
  }
  const top = [...unmatched.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  return {
    elements,
    report: [
      `${source}: ${items.length} work item(s), ${linked} linked to ${per.size} element(s)`,
      ...(items.length - linked ? [`${items.length - linked} item(s) matched no element. Most common labels/components without a matching element: ${top.map(([k, c]) => `${k} (${c})`).join(", ") || "none"}. Name elements the same, or set an element's workItemKey property.`] : []),
    ],
  };
}

type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; text: string }>;
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

/** Jira Cloud: issues matching a JQL query, read with an e-mail address and API token. */
export async function fetchJira(fetch: Fetch, o: { site: string; email: string; token: string; jql?: string; limit?: number }): Promise<WorkItem[]> {
  const site = o.site.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9-]+\.atlassian\.net$/i.test(site)) throw new Error("Enter your Jira Cloud site, e.g. acme.atlassian.net");
  const headers = { Authorization: `Basic ${b64(`${o.email}:${o.token}`)}`, Accept: "application/json" };
  const issues: J[] = [];
  let next: string | undefined;
  do {
    const q = new URLSearchParams({ jql: o.jql || "statusCategory != Done ORDER BY updated DESC", fields: "summary,status,issuetype,labels,components,duedate", maxResults: "100", ...(next ? { nextPageToken: next } : {}) });
    const res = await fetch(`https://${site}/rest/api/3/search/jql?${q}`, { headers });
    if (res.status === 401 || res.status === 403) throw new Error("Jira refused the e-mail address and API token");
    if (res.status >= 400) throw new Error(`Jira answered ${res.status}: ${res.text.slice(0, 200)}`);
    const body = JSON.parse(res.text) as J;
    issues.push(...(body.issues ?? []));
    next = body.nextPageToken;
  } while (next && issues.length < (o.limit ?? 2000));
  return fromJira(issues, site);
}

/** Azure DevOps: work items from a WIQL query, read with a personal access token (Work Items: Read). */
export async function fetchAzureDevOps(fetch: Fetch, o: { organization: string; project: string; token: string; wiql?: string; limit?: number }): Promise<WorkItem[]> {
  const org = o.organization.trim().replace(/^https?:\/\/dev\.azure\.com\//, "").replace(/\/.*$/, "");
  if (!/^[A-Za-z0-9-]+$/.test(org) || !o.project.trim()) throw new Error("Enter the Azure DevOps organisation and project");
  const base = `https://dev.azure.com/${org}/${encodeURIComponent(o.project.trim())}`;
  const headers = { Authorization: `Basic ${b64(`:${o.token}`)}`, "Content-Type": "application/json", Accept: "application/json" };
  const query = o.wiql || "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.StateCategory] <> 'Completed' ORDER BY [System.ChangedDate] DESC";
  const res = await fetch(`${base}/_apis/wit/wiql?api-version=7.1`, { method: "POST", headers, body: JSON.stringify({ query }) });
  if (res.status === 401 || res.status === 403 || res.status === 203) throw new Error("Azure DevOps refused the personal access token (it needs Work Items: Read)");
  if (res.status >= 400) throw new Error(`Azure DevOps answered ${res.status}: ${res.text.slice(0, 200)}`);
  const ids = ((JSON.parse(res.text) as J).workItems ?? []).map((w: J) => w.id).slice(0, o.limit ?? 2000);
  const out: J[] = [];
  const fields = ["System.Title", "System.State", "System.WorkItemType", "System.Tags", "System.AreaPath", "Microsoft.VSTS.Scheduling.TargetDate"].join(",");
  for (let i = 0; i < ids.length; i += 200) {
    const r = await fetch(`https://dev.azure.com/${org}/_apis/wit/workitems?ids=${ids.slice(i, i + 200).join(",")}&fields=${fields}&api-version=7.1`, { headers });
    if (r.status >= 400) throw new Error(`Azure DevOps answered ${r.status}: ${r.text.slice(0, 200)}`);
    out.push(...((JSON.parse(r.text) as J).value ?? []));
  }
  return fromAzureDevOps(out, base);
}
