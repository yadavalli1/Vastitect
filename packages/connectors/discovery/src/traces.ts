import { makeView, slugify, type Element, type ImportInput, type ModelPatch, type Workspace } from "@vastitecture/plugin-sdk";
import { Draft, docs, type J } from "./util";

/**
 * Runtime dependencies from distributed traces. Static files say what *should* call what; traces say
 * what *does*. Services are matched to elements already in the model by name, so the result is a
 * comparison: calls seen in production but missing from the model are proposed as relationships, and
 * modelled dependencies that never appear in the traces are listed in the report (never deleted).
 */

type Kind = "server" | "client" | "producer" | "consumer" | "internal";
interface Span {
  trace: string;
  id: string;
  parent?: string;
  service: string;
  kind: Kind;
  error: boolean;
  attrs: Record<string, string>;
  language?: string;
}
interface Target {
  key: string;
  name: string;
  kind: "service" | "Database" | "Queue" | "External";
  technology?: string;
}
export interface Observation {
  services: Map<string, { spans: number; language?: string }>;
  targets: Map<string, Target>;
  edges: Map<string, { from: string; to: string; calls: number; errors: number; label: string }>;
  format: Set<string>;
}

const KINDS: Record<string, Kind> = { "1": "internal", "2": "server", "3": "client", "4": "producer", "5": "consumer" };
const kindOf = (v: unknown): Kind => {
  const s = String(v ?? "").toLowerCase().replace(/^span_kind_/, "");
  return KINDS[s] ?? ((["server", "client", "producer", "consumer"].includes(s) ? s : "internal") as Kind);
};
/** OTLP attributes: [{ key, value: { stringValue | intValue | boolValue … } }] */
const otlpAttrs = (list: unknown): Record<string, string> =>
  Object.fromEntries(((list as J[]) ?? []).map((a) => [a.key, String(Object.values(a.value ?? {})[0] ?? "")]));
const tagsOf = (list: unknown): Record<string, string> => Object.fromEntries(((list as J[]) ?? []).map((t) => [t.key, String(t.value)]));

function spansFrom(doc: J, format: Set<string>): Span[] {
  const out: Span[] = [];
  if (Array.isArray(doc.resourceSpans)) {
    format.add("OpenTelemetry");
    for (const rs of doc.resourceSpans) {
      const res = otlpAttrs(rs.resource?.attributes);
      const service = res["service.name"] ?? "unknown_service";
      for (const ss of [...(rs.scopeSpans ?? []), ...(rs.instrumentationLibrarySpans ?? [])])
        for (const s of ss.spans ?? [])
          out.push({ trace: s.traceId, id: s.spanId, parent: s.parentSpanId || undefined, service, kind: kindOf(s.kind), error: s.status?.code === 2 || s.status?.code === "STATUS_CODE_ERROR", attrs: otlpAttrs(s.attributes), language: res["telemetry.sdk.language"] });
    }
  } else if (Array.isArray(doc.data) && doc.data.some((t: J) => Array.isArray(t?.spans))) {
    format.add("Jaeger");
    for (const t of doc.data) {
      const procs = (t.processes ?? {}) as J;
      for (const s of t.spans ?? []) {
        const tags = tagsOf(s.tags);
        const p = procs[s.processID] ?? {};
        const ref = (s.references ?? []).find((r: J) => r.refType === "CHILD_OF") ?? (s.references ?? [])[0];
        out.push({ trace: s.traceID, id: s.spanID, parent: ref?.spanID, service: p.serviceName ?? "unknown_service", kind: kindOf(tags["span.kind"]), error: tags.error === "true" || Number(tags["http.status_code"]) >= 500, attrs: tags, language: tagsOf(p.tags)["telemetry.sdk.language"] ?? tagsOf(p.tags)["jaeger.version"]?.split("-")[0] });
      }
    }
  } else if (Array.isArray(doc) || (doc.traceId && doc.localEndpoint)) {
    const list = (Array.isArray(doc) ? doc.flat() : [doc]) as J[];
    if (!list.some((s) => s?.traceId && s?.localEndpoint)) return out;
    format.add("Zipkin");
    for (const s of list) {
      const tags = (s.tags ?? {}) as Record<string, string>;
      const attrs = { ...tags, ...(s.remoteEndpoint?.serviceName ? { "peer.service": s.remoteEndpoint.serviceName } : {}) };
      out.push({ trace: s.traceId, id: s.id, parent: s.parentId, service: s.localEndpoint?.serviceName ?? "unknown_service", kind: kindOf(s.kind), error: "error" in tags || Number(tags["http.status_code"]) >= 500, attrs });
    }
  }
  return out;
}

/** Where a client or messaging span goes when no span in another service answers it. */
function targetOf(s: Span): Target | undefined {
  const a = s.attrs;
  const dest = a["messaging.destination.name"] ?? a["messaging.destination"];
  if (a["messaging.system"] || ((s.kind === "producer" || s.kind === "consumer") && dest)) {
    const name = dest ?? a["messaging.system"];
    return { key: `queue:${a["messaging.system"] ?? "queue"}:${name}`, name, kind: "Queue", technology: a["messaging.system"] };
  }
  if (a["db.system"]) {
    const name = a["db.name"] ?? a["db.namespace"] ?? a["peer.service"] ?? a["db.system"];
    return { key: `db:${a["db.system"]}:${name}`, name, kind: "Database", technology: a["db.system"] };
  }
  if (a["peer.service"]) return { key: `service:${a["peer.service"]}`, name: a["peer.service"], kind: "service" };
  const host = a["server.address"] ?? a["net.peer.name"] ?? a["http.host"] ?? (a["http.url"] ?? a["url.full"])?.replace(/^\w+:\/\/([^/:]+).*/, "$1");
  if (host && s.kind === "client") return { key: `external:${host}`, name: host, kind: "External" };
  return undefined;
}

export function observeTraces(files: ImportInput[], report: string[] = []): Observation {
  const obs: Observation = { services: new Map(), targets: new Map(), edges: new Map(), format: new Set() };
  const edge = (from: string, to: Target, error: boolean, label: string) => {
    if (to.kind === "service" && to.name === from) return;
    obs.targets.set(to.key, to);
    const key = `${from}|${to.key}`;
    const e = obs.edges.get(key) ?? { from, to: to.key, calls: 0, errors: 0, label };
    e.calls++;
    if (error) e.errors++;
    obs.edges.set(key, e);
  };
  for (const f of files) {
    for (const doc of docs(f, report)) {
      // Pre-aggregated dependency graphs: Jaeger /api/dependencies and Datadog service dependencies.
      if (Array.isArray(doc.data) && doc.data.some((d: J) => d?.parent && d?.child)) {
        obs.format.add("Jaeger dependencies");
        for (const d of doc.data) {
          for (const s of [d.parent, d.child]) obs.services.set(s, obs.services.get(s) ?? { spans: 0 });
          const e = obs.edges.get(`${d.parent}|service:${d.child}`) ?? { from: d.parent, to: `service:${d.child}`, calls: 0, errors: 0, label: "Calls" };
          e.calls += Number(d.callCount ?? 1);
          obs.edges.set(`${d.parent}|service:${d.child}`, e);
          obs.targets.set(`service:${d.child}`, { key: `service:${d.child}`, name: d.child, kind: "service" });
        }
        continue;
      }
      const dd = Object.entries(doc).filter(([, v]) => v && typeof v === "object" && Array.isArray((v as J).calls));
      if (!Array.isArray(doc) && dd.length && dd.length === Object.keys(doc).length) {
        obs.format.add("Datadog service dependencies");
        for (const [svc, v] of dd) {
          obs.services.set(svc, obs.services.get(svc) ?? { spans: 0 });
          for (const callee of (v as J).calls as string[]) edge(svc, { key: `service:${callee}`, name: callee, kind: "service" }, false, "Calls");
        }
        continue;
      }
      const spans = spansFrom(doc, obs.format);
      if (!spans.length) {
        report.push(`${f.name}: no spans or dependency data found, skipped`);
        continue;
      }
      const byId = new Map(spans.map((s) => [`${s.trace}|${s.id}`, s]));
      const answered = new Set<string>();
      for (const s of spans) {
        const svc = obs.services.get(s.service) ?? { spans: 0 };
        svc.spans++;
        svc.language ??= s.language;
        obs.services.set(s.service, svc);
        const p = s.parent ? byId.get(`${s.trace}|${s.parent}`) : undefined;
        if (!p || p.service === s.service) continue;
        answered.add(`${p.trace}|${p.id}`);
        // Messaging is drawn through its queue; a consumer is not "called" by the producer.
        if (s.kind === "consumer" && targetOf(s)?.kind === "Queue") continue;
        edge(p.service, { key: `service:${s.service}`, name: s.service, kind: "service" }, s.error, p.attrs["http.method"] || p.attrs["http.request.method"] || p.attrs["rpc.system"] ? "Calls" : "Calls");
      }
      for (const s of spans) {
        if (s.kind === "server" || s.kind === "internal") continue;
        const t = targetOf(s);
        if (!t || (t.kind === "service" && answered.has(`${s.trace}|${s.id}`))) continue;
        if (t.kind !== "Queue" && answered.has(`${s.trace}|${s.id}`)) continue;
        edge(s.service, t, s.error, t.kind === "Database" ? "Reads from and writes to" : t.kind === "Queue" ? (s.kind === "consumer" ? "Consumes from" : "Publishes to") : "Calls");
      }
    }
  }
  for (const t of obs.targets.values()) if (t.kind === "service") obs.services.set(t.name, obs.services.get(t.name) ?? { spans: 0 });
  return obs;
}

/** Only things that can run are candidates for a traced service: never a capability, a person or a concept. */
const RUNNABLE = /:(Container|Component|SoftwareSystem|ApplicationComponent|ApplicationService|SystemSoftware|TechnologyService|Node|InfrastructureNode)$/;
const norm = (s: string) => slugify(s).replace(/-(service|svc|api|app|server|backend)$/g, "");

/** Turn observations into a patch against the current model, reusing elements that already exist. */
export function tracesToPatch(obs: Observation, ws?: Workspace, config: { environment?: string } = {}): ModelPatch {
  const d = new Draft("traces");
  const existing = new Map<string, Element>();
  const rank = (e: Element) => (/Container$|Component$/.test(e.type) ? 0 : /System$/.test(e.type) ? 1 : 2);
  for (const e of Object.values(ws?.elements ?? {}).filter((x) => RUNNABLE.test(x.type) || typeof x.properties.service === "string").sort((a, b) => rank(a) - rank(b))) {
    for (const k of [typeof e.properties.service === "string" ? e.properties.service : undefined, typeof e.properties.externalId === "string" ? e.properties.externalId.replace(/^\w+:/, "") : undefined, e.name])
      if (k && !existing.has(norm(k))) existing.set(norm(k), e);
  }
  const resolved = new Map<string, Element>();
  let matched = 0;
  const resolve = (key: string, name: string, kind: Target["kind"], technology?: string): Element => {
    const hit = resolved.get(key);
    if (hit) return hit;
    const found = existing.get(norm(name)) ?? existing.get(norm(key.replace(/^[^:]+:/, "")));
    let el: Element;
    if (found) {
      matched++;
      el = found;
    } else
      el = d.element(key, kind === "External" ? "c4:SoftwareSystem" : "c4:Container", name, {
        properties: { ...(technology ? { technology } : {}), ...(kind === "Database" || kind === "Queue" ? { kind } : {}), ...(kind === "service" ? { service: name } : {}), ...(kind === "External" ? { external: true } : {}) },
        tags: ["observed"],
      });
    resolved.set(key, el);
    return el;
  };
  for (const [name, s] of obs.services) resolve(`service:${name}`, name, "service", s.language);
  const observedPairs = new Set<string>();
  const already = new Set(Object.values(ws?.relationships ?? {}).map((r) => `${r.source}|${r.target}`));
  const missing: string[] = [];
  let confirmed = 0;
  for (const e of obs.edges.values()) {
    const from = resolved.get(`service:${e.from}`)!;
    const t = obs.targets.get(e.to)!;
    const to = resolve(t.key, t.name, t.kind, t.technology);
    observedPairs.add(`${from.id}|${to.id}`);
    if (already.has(`${from.id}|${to.id}`)) {
      confirmed++;
      continue;
    }
    missing.push(`${from.name} → ${to.name}`);
    d.relate("c4:Uses", from, to, { label: e.label, properties: { observedCalls: e.calls, ...(e.errors ? { observedErrors: e.errors } : {}), observedIn: config.environment ?? "runtime" } });
  }
  // Modelled dependencies between services that were seen, but never observed calling each other.
  const seen = new Set([...resolved.values()].map((e) => e.id));
  const unused = Object.values(ws?.relationships ?? {}).filter((r) => seen.has(r.source) && seen.has(r.target) && !observedPairs.has(`${r.source}|${r.target}`));

  // One view of everything observed, including elements that were already in the model.
  const els = [...new Map([...resolved.values()].map((e) => [e.id, e])).values()];
  const view = makeView("c4", `Runtime dependencies – ${config.environment ?? "observed"}`, { viewpoint: "c4:container" });
  view.nodes = els.map((e) => ({ element: e.id, x: 0, y: 0, w: 190, h: 100 }));
  const ids = new Set(els.map((e) => e.id));
  view.edges = [...d.relationships.values(), ...Object.values(ws?.relationships ?? {}).filter((r) => observedPairs.has(`${r.source}|${r.target}`))]
    .filter((r) => ids.has(r.source) && ids.has(r.target))
    .map((r) => ({ relationship: r.id }));
  d.views.push(view);

  const patch = d.patch(`Traces (${[...obs.format].join(", ") || "no data"}): ${obs.services.size} service(s), ${obs.edges.size} observed dependency(ies); ${matched} matched to existing elements`);
  patch.report!.push(`Already modelled and confirmed by traces: ${confirmed}`);
  if (missing.length) patch.report!.push(`Observed but not modelled (${missing.length}, proposed below): ${missing.slice(0, 30).join("; ")}${missing.length > 30 ? "; …" : ""}`);
  if (unused.length)
    patch.report!.push(`Modelled but never observed (${unused.length}, review by hand): ${unused.slice(0, 30).map((r) => `${ws!.elements[r.source].name} → ${ws!.elements[r.target].name}`).join("; ")}`);
  return patch;
}

/** Datadog's service dependency map, read live with an API and application key (desktop app). */
export async function fetchDatadog(fetch: (url: string, init?: { headers?: Record<string, string> }) => Promise<{ status: number; text: string }>, o: { site?: string; env: string; apiKey: string; appKey: string }): Promise<ImportInput> {
  const site = (o.site || "datadoghq.com").replace(/^https?:\/\//, "").replace(/^api\./, "").replace(/\/.*$/, "");
  if (!/^(datadoghq\.(com|eu)|(us3|us5|ap1)\.datadoghq\.com|ddog-gov\.com)$/.test(site)) throw new Error(`Unknown Datadog site "${site}" (e.g. datadoghq.com, datadoghq.eu, us5.datadoghq.com)`);
  const res = await fetch(`https://api.${site}/api/v1/service_dependencies?env=${encodeURIComponent(o.env)}`, { headers: { "DD-API-KEY": o.apiKey, "DD-APPLICATION-KEY": o.appKey, Accept: "application/json" } });
  if (res.status === 401 || res.status === 403) throw new Error("Datadog refused the keys. The application key needs the apm_read scope.");
  if (res.status >= 400) throw new Error(`Datadog answered ${res.status}: ${res.text.slice(0, 200)}`);
  return { name: `datadog-${o.env}.json`, text: res.text };
}
