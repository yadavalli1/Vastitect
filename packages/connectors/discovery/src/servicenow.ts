import type { Element, ImportInput, ModelPatch, Workspace, WriteBackItem } from "@vastitecture/plugin-sdk";
import { Draft, type J } from "./util";
import { parseCsv } from "@vastitecture/core";

/** CMDB tables read by default: business applications, services, applications, databases and hosts. */
export const SERVICENOW_TABLES = [
  "cmdb_ci_business_app",
  "cmdb_ci_service",
  "cmdb_ci_service_discovered",
  "cmdb_ci_appl",
  "cmdb_ci_db_instance",
  "cmdb_ci_server",
  "cmdb_ci_vm_instance",
];
const FIELDS = [
  "sys_id",
  "name",
  "sys_class_name",
  "short_description",
  "description",
  "owned_by",
  "managed_by",
  "it_application_owner",
  "support_group",
  "busines_criticality",
  "business_criticality",
  "operational_status",
  "install_status",
  "life_cycle_stage",
  "life_cycle_stage_status",
  "version",
  "ip_address",
  "fqdn",
  "os",
  "category",
  "vendor",
];

/** Read a field whether it came back raw, as a display value, or as {value, display_value}. */
const val = (x: unknown): string => (x && typeof x === "object" ? String((x as J).value ?? "") : x === undefined || x === null ? "" : String(x));
const disp = (x: unknown): string => (x && typeof x === "object" ? String((x as J).display_value ?? (x as J).value ?? "") : x === undefined || x === null ? "" : String(x));

type Kind = { type: string; extra?: J };
/** CMDB class to model type. Subclasses are matched by prefix (cmdb_ci_linux_server is a server). */
function kindOf(cls: string): Kind | undefined {
  if (cls === "cmdb_ci_business_app") return { type: "c4:SoftwareSystem" };
  if (/^(cmdb_ci_service|service_offering)/.test(cls)) return { type: "archimate:Service", extra: { domain: "Business" } };
  if (/^cmdb_ci_db_/.test(cls)) return { type: "c4:Container", extra: { kind: "Database" } };
  if (/^(cmdb_ci_appl|cmdb_ci_app_server)/.test(cls)) return { type: "c4:Container" };
  if (/(server|computer|vm_instance|vm_object|esx|cloud_service_account|datacenter|kubernetes_cluster)/.test(cls)) return { type: "c4:DeploymentNode" };
  if (/(lb|load_balancer|netgear|ip_router|ip_switch|ip_firewall|storage)/.test(cls)) return { type: "c4:InfrastructureNode" };
  return undefined;
}

const CRITICALITY: Record<string, string> = { "1": "Mission critical", "2": "Business critical", "3": "Business operational", "4": "Administrative" };

function lifecycle(r: J): "plan" | "phaseIn" | "active" | "phaseOut" | "endOfLife" | undefined {
  const s = [disp(r.life_cycle_stage), disp(r.life_cycle_stage_status), disp(r.install_status), disp(r.operational_status)].join(" ").toLowerCase();
  if (/retired|end of life|decommissioned|disposed|absent/.test(s)) return "endOfLife";
  if (/pending retirement|retiring|sunset|phase.?out/.test(s)) return "phaseOut";
  if (/ideation|planning|design|on order|requirements/.test(s)) return "plan";
  if (/development|build|pilot|implementation|in maintenance|testing/.test(s)) return "phaseIn";
  if (/operational|installed|production|in use|live/.test(s)) return "active";
  return undefined;
}

/** Relationship types are "Parent descriptor::Child descriptor", e.g. "Depends on::Used by". */
type RelKind = "uses" | "hosted" | "contains" | "provides" | "other";
function relKind(type: string): RelKind {
  const t = type.toLowerCase();
  if (/^(runs on|hosted on|virtualized by|deployed on|instantiated by)/.test(t)) return "hosted";
  if (/^(contains|members|has registered)/.test(t)) return "contains";
  if (/^provided by/.test(t)) return "provides";
  if (/^(depends on|uses|consumes|sends data to|connects to|calls|receives data from)/.test(t)) return "uses";
  return "other";
}

export interface ServiceNowData {
  /** CI records from any of the tables, each with sys_id and sys_class_name. */
  cis: J[];
  /** cmdb_rel_ci records: parent, child, type. */
  rels: J[];
  /** Instance base URL, used for links back to the record. */
  instance?: string;
}

/** Turn CMDB records into a draft model with a landscape view, container views and a deployment view. */
export function serviceNowToPatch(data: ServiceNowData, source = "ServiceNow"): ModelPatch {
  const d = new Draft("servicenow");
  const byId = new Map<string, ReturnType<Draft["element"]>>();
  const skipped = new Map<string, number>();
  for (const r of data.cis) {
    const id = val(r.sys_id);
    const cls = val(r.sys_class_name) || "cmdb_ci";
    const k = kindOf(cls);
    if (!id || !val(r.name)) continue;
    if (!k) {
      skipped.set(cls, (skipped.get(cls) ?? 0) + 1);
      continue;
    }
    const phase = lifecycle(r);
    const crit = CRITICALITY[val(r.business_criticality ?? r.busines_criticality).slice(0, 1)];
    const owner = disp(r.it_application_owner) || disp(r.owned_by) || disp(r.managed_by) || disp(r.support_group);
    const el = d.element(`servicenow:${id}`, k.type, disp(r.name), {
      description: disp(r.short_description) || disp(r.description) || undefined,
      owner: owner || undefined,
      ...(phase ? { lifecycle: { phase } } : {}),
      links: data.instance ? [{ kind: "doc", label: "ServiceNow", href: `${data.instance.replace(/\/+$/, "")}/nav_to.do?uri=${encodeURIComponent(`${cls}.do?sys_id=${id}`)}` }] : [],
      properties: {
        ...k.extra,
        cmdbClass: cls,
        ...(crit ? { criticality: crit } : {}),
        ...(disp(r.version) ? { version: disp(r.version) } : {}),
        ...(disp(r.os) ? { technology: disp(r.os) } : disp(r.vendor) ? { technology: disp(r.vendor) } : {}),
        ...(disp(r.fqdn) || disp(r.ip_address) ? { address: disp(r.fqdn) || disp(r.ip_address) } : {}),
      },
    });
    byId.set(id, el);
  }
  const counted = new Map<string, number>();
  for (const r of data.rels) {
    const p = byId.get(val(r.parent)), c = byId.get(val(r.child));
    if (!p || !c) continue;
    const type = disp(r.type);
    const kind = relKind(type);
    counted.set(kind, (counted.get(kind) ?? 0) + 1);
    const host = (x: typeof p) => x.type === "c4:DeploymentNode" || x.type === "c4:InfrastructureNode";
    if (kind === "hosted" && host(c) && !host(p)) p.properties.deployedIn = c.properties.externalId as string;
    else if (kind === "hosted" && host(c) && host(p)) p.parent = c.id;
    else if (kind === "contains" && !p.parent && p !== c && (p.type === "c4:SoftwareSystem" || host(p)) && (c.type === "c4:Container" || host(c))) c.parent = p.id;
    else if (kind === "provides") d.relate("archimate:Realization", c, p, { label: "Provides" });
    else d.relate("c4:Uses", p, c, { label: type.split("::")[0] || "Depends on" });
  }

  const els = [...d.elements.values()];
  d.view("c4", "c4:landscape", `${source} – application landscape`, (e) => e.type === "c4:SoftwareSystem");
  d.view("archimate", "archimate:application", `${source} – services and applications`, (e) => e.type === "archimate:Service" || e.type === "c4:SoftwareSystem");
  for (const sys of els.filter((e) => e.type === "c4:SoftwareSystem"))
    if (els.some((e) => e.parent === sys.id)) d.view("c4", "c4:container", `${sys.name} – from ${source}`, (e) => e === sys || e.parent === sys.id, undefined, sys);
  if (els.some((e) => e.properties.deployedIn || e.type === "c4:DeploymentNode"))
    d.view("c4", "c4:deployment", `${source} – infrastructure`, (e) => e.type === "c4:DeploymentNode" || e.type === "c4:InfrastructureNode" || !!e.properties.deployedIn, (e) => d.idOf(e.properties.deployedIn));

  if (skipped.size) d.report.push(`CI classes not modelled: ${[...skipped].map(([c, n]) => `${c} (${n})`).join(", ")}`);
  if (counted.get("other")) d.report.push(`${counted.get("other")} relationship(s) of other types were imported as "uses"`);
  return d.patch(`${source}: ${byId.size} configuration item(s), ${[...counted.values()].reduce((a, b) => a + b, 0)} relationship(s)`);
}

/** Parse ServiceNow exports: Table API JSON ({ result: [...] }, or a list export's { records: [...] }), or CSV. */
export function parseServiceNowFiles(files: ImportInput[]): ServiceNowData {
  const cis: J[] = [];
  const rels: J[] = [];
  for (const f of files) {
    let rows: J[] = [];
    const tableFromName = /(cmdb_[a-z0-9_]+)/i.exec(f.name)?.[1]?.toLowerCase();
    if (/^\s*[[{]/.test(f.text)) {
      const j = JSON.parse(f.text);
      rows = Array.isArray(j) ? j : j.result ?? j.records ?? [];
    } else rows = csvObjects(f.text);
    for (const r of rows) {
      if (r.parent !== undefined && r.child !== undefined) rels.push(r);
      else cis.push(r.sys_class_name || !tableFromName ? r : { ...r, sys_class_name: tableFromName });
    }
  }
  return { cis, rels };
}

function csvObjects(text: string): J[] {
  const rows = parseCsv(text);
  const [head, ...body] = rows;
  if (!head) return [];
  const keys = head.map((h) => h.trim().replace(/^﻿/, "").replace(/^.*\./, ""));
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ""])));
}

export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string> }) => Promise<{ status: number; text: string }>;

/**
 * Read CIs and relationships live through the Table API, page by page. Read-only (GET only).
 * Auth: a username plus password (Basic) or an OAuth access token (Bearer).
 */
export async function fetchServiceNow(
  fetch: Fetch,
  opts: { instance: string; username?: string; password?: string; token?: string; tables?: string[]; query?: string; limit?: number },
): Promise<ServiceNowData> {
  const host = opts.instance.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!host) throw new Error("Enter your ServiceNow instance, e.g. acme.service-now.com");
  const base = `https://${host.includes(".") ? host : `${host}.service-now.com`}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  else if (opts.username && opts.password) headers.Authorization = `Basic ${btoa(`${opts.username}:${opts.password}`)}`;
  else throw new Error("Enter a username and password, or an OAuth token");
  const limit = opts.limit ?? 5000;
  const page = 500;
  const get = async (table: string, query: string, fields: string[]) => {
    const out: J[] = [];
    for (let offset = 0; offset < limit; offset += page) {
      const url = `${base}/api/now/table/${table}?sysparm_display_value=all&sysparm_exclude_reference_link=true&sysparm_limit=${page}&sysparm_offset=${offset}&sysparm_fields=${fields.join(",")}${query ? `&sysparm_query=${encodeURIComponent(query)}` : ""}`;
      const r = await fetch(url, { method: "GET", headers });
      if (r.status === 401 || r.status === 403) throw new Error(`ServiceNow refused access to ${table} (HTTP ${r.status}). Check the credentials and that the user has the cmdb_read role.`);
      if (r.status === 404) return out; // table not present on this instance
      if (r.status >= 400) throw new Error(`ServiceNow returned HTTP ${r.status} for ${table}: ${r.text.slice(0, 200)}`);
      const rows = (JSON.parse(r.text).result ?? []) as J[];
      out.push(...rows);
      if (rows.length < page) break;
    }
    return out;
  };
  const cis: J[] = [];
  for (const t of opts.tables?.length ? opts.tables : SERVICENOW_TABLES) {
    for (const row of await get(t, opts.query ?? "", FIELDS)) if (!cis.some((c) => val(c.sys_id) === val(row.sys_id))) cis.push(row);
  }
  const ids = cis.map((c) => val(c.sys_id)).filter(Boolean);
  const rels: J[] = [];
  for (let i = 0; i < ids.length; i += 100) rels.push(...(await get("cmdb_rel_ci", `parentIN${ids.slice(i, i + 100).join(",")}`, ["parent", "child", "type"])));
  return { cis, rels, instance: base };
}

type WriteFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; text: string }>;
export interface SnAuth {
  instance: string;
  username?: string;
  password?: string;
  token?: string;
}
function connection(o: SnAuth) {
  const host = o.instance.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!host) throw new Error("Enter your ServiceNow instance, e.g. acme.service-now.com");
  const base = `https://${host.includes(".") ? host : `${host}.service-now.com`}`;
  const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
  if (o.token) headers.Authorization = `Bearer ${o.token}`;
  else if (o.username && o.password) headers.Authorization = `Basic ${btoa(`${o.username}:${o.password}`)}`;
  else throw new Error("Enter a username and password, or an OAuth token");
  return { base, headers };
}

/** The relationship type written for "depends on" in the CMDB. */
export const DEPENDS_ON = "Depends on::Used by";

/**
 * What writing the model back to the CMDB would change: names and descriptions edited in the model,
 * and dependencies drawn in the model between two CIs that the CMDB does not have yet. It reads the
 * current CMDB values first, so the plan compares against the instance as it is now. Nothing is deleted.
 */
export async function planServiceNowWriteBack(fetch: WriteFetch, auth: SnAuth, ws: Workspace): Promise<{ items: WriteBackItem[]; report: string[] }> {
  const { base, headers } = connection(auth);
  const sysId = (e: Element) => (typeof e.properties.externalId === "string" && e.properties.externalId.startsWith("servicenow:") ? e.properties.externalId.slice(11) : undefined);
  const backed = Object.values(ws.elements).filter((e) => sysId(e));
  const report: string[] = [];
  if (!backed.length) return { items: [], report: ["No elements in this workspace came from ServiceNow, so there is nothing to write back. Discover from ServiceNow first."] };
  const get = async (table: string, query: string, fields: string) => {
    const out: J[] = [];
    for (let offset = 0; ; offset += 500) {
      const r = await fetch(`${base}/api/now/table/${table}?sysparm_query=${encodeURIComponent(query)}&sysparm_fields=${fields}&sysparm_limit=500&sysparm_offset=${offset}&sysparm_exclude_reference_link=true`, { method: "GET", headers });
      if (r.status === 401 || r.status === 403) throw new Error(`ServiceNow refused to read ${table} (HTTP ${r.status})`);
      if (r.status >= 400) throw new Error(`ServiceNow returned HTTP ${r.status} for ${table}: ${r.text.slice(0, 200)}`);
      const rows = (JSON.parse(r.text).result ?? []) as J[];
      out.push(...rows);
      if (rows.length < 500) return out;
    }
  };
  const ids = backed.map((e) => sysId(e)!);
  const current = new Map<string, J>();
  for (let i = 0; i < ids.length; i += 100) for (const r of await get("cmdb_ci", `sys_idIN${ids.slice(i, i + 100).join(",")}`, "sys_id,name,short_description")) current.set(val(r.sys_id), r);
  const items: WriteBackItem[] = [];
  let gone = 0;
  for (const e of backed) {
    const id = sysId(e)!;
    const rec = current.get(id);
    if (!rec) {
      gone++;
      continue;
    }
    const name = val(rec.name), desc = val(rec.short_description);
    if (e.name.trim() && e.name !== name)
      items.push({ id: `name:${id}`, kind: "update", label: `Rename "${name}" to "${e.name}"`, before: name, after: e.name, request: { method: "PATCH", path: `/api/now/table/cmdb_ci/${id}`, body: { name: e.name } } });
    if (e.description?.trim() && e.description !== desc)
      items.push({ id: `desc:${id}`, kind: "update", label: `Description of "${e.name}"`, before: desc, after: e.description, request: { method: "PATCH", path: `/api/now/table/cmdb_ci/${id}`, body: { short_description: e.description } } });
  }
  if (gone) report.push(`${gone} element(s) point at CIs that no longer exist in ServiceNow; they were skipped`);

  // Dependencies: "A uses B" (C4) and "B serves A" (ArchiMate) both mean A depends on B.
  const wanted = new Map<string, { parent: Element; child: Element }>();
  for (const r of Object.values(ws.relationships)) {
    const [a, b] = r.type === "archimate:Serving" ? [ws.elements[r.target], ws.elements[r.source]] : r.type === "c4:Uses" ? [ws.elements[r.source], ws.elements[r.target]] : [];
    if (!a || !b || !sysId(a) || !sysId(b) || !current.has(sysId(a)!) || !current.has(sysId(b)!)) continue;
    wanted.set(`${sysId(a)}|${sysId(b)}`, { parent: a, child: b });
  }
  if (wanted.size) {
    const existing = new Set<string>();
    const parents = [...new Set([...wanted.values()].map((w) => sysId(w.parent)!))];
    for (let i = 0; i < parents.length; i += 100) for (const r of await get("cmdb_rel_ci", `parentIN${parents.slice(i, i + 100).join(",")}`, "parent,child")) existing.add(`${val(r.parent)}|${val(r.child)}`);
    const missing = [...wanted].filter(([k]) => !existing.has(k));
    if (missing.length) {
      const [type] = await get("cmdb_rel_type", `name=${DEPENDS_ON}`, "sys_id");
      if (!type) report.push(`The relationship type "${DEPENDS_ON}" was not found, so ${missing.length} new dependency(ies) cannot be written`);
      else
        for (const [k, { parent, child }] of missing)
          items.push({ id: `rel:${k}`, kind: "create", label: `"${parent.name}" depends on "${child.name}"`, after: DEPENDS_ON, request: { method: "POST", path: "/api/now/table/cmdb_rel_ci", body: { parent: sysId(parent), child: sysId(child), type: val(type.sys_id) } } });
    }
  }
  report.unshift(`${backed.length} element(s) came from ServiceNow; ${items.length} change(s) to write`);
  return { items, report };
}

/** Send reviewed changes one at a time; a failure is reported and the rest still run. Only CMDB tables are allowed. */
export async function applyServiceNowWriteBack(fetch: WriteFetch, auth: SnAuth, items: WriteBackItem[]): Promise<string[]> {
  const { base, headers } = connection(auth);
  const out: string[] = [];
  for (const it of items) {
    if (!/^\/api\/now\/table\/(cmdb_ci|cmdb_rel_ci)(\/[0-9a-f]{32})?$/.test(it.request.path) || !["PATCH", "POST"].includes(it.request.method)) {
      out.push(`✗ ${it.label}: refused (not a CMDB update)`);
      continue;
    }
    const r = await fetch(base + it.request.path, { method: it.request.method, headers, body: JSON.stringify(it.request.body) });
    if (r.status === 401 || r.status === 403) out.push(`✗ ${it.label}: ServiceNow refused (HTTP ${r.status}); writing needs a role such as itil or cmdb_editor`);
    else if (r.status >= 400) out.push(`✗ ${it.label}: HTTP ${r.status} ${r.text.slice(0, 120)}`);
    else out.push(`✓ ${it.label}`);
  }
  return out;
}
