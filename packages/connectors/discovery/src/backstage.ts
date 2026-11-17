import type { ImportInput, ModelPatch } from "@vastitecture/plugin-sdk";
import { Draft, docs, titleCase, type J } from "./util";

const LIFECYCLE: Record<string, "plan" | "phaseIn" | "active" | "phaseOut" | "endOfLife"> = { experimental: "phaseIn", production: "active", deprecated: "phaseOut" };

/** Parse a Backstage entity reference: [kind:][namespace/]name. */
function ref(r: string, defaultKind: string, ns = "default") {
  const m = /^(?:([\w-]+):)?(?:([\w-]+)\/)?([\w.-]+)$/.exec(String(r).trim());
  if (!m) return undefined;
  return `${(m[1] ?? defaultKind).toLowerCase()}:${(m[2] ?? ns).toLowerCase()}/${m[3].toLowerCase()}`;
}

/** Backstage catalog-info.yaml files become systems, components, APIs, resources and owners. */
export function discoverBackstage(files: ImportInput[]): ModelPatch {
  const d = new Draft("backstage");
  const entities: J[] = [];
  for (const f of files) for (const e of docs(f, d.report)) if (e.kind && e.metadata?.name) entities.push(e);
  const el = new Map<string, ReturnType<Draft["element"]>>();
  const key = (e: J) => `${String(e.kind).toLowerCase()}:${String(e.metadata.namespace ?? "default").toLowerCase()}/${String(e.metadata.name).toLowerCase()}`;
  const owners = new Map<string, string>();
  for (const e of entities) if (["group", "user"].includes(String(e.kind).toLowerCase())) owners.set(key(e), String(e.spec?.profile?.displayName ?? e.metadata.title ?? e.metadata.name));
  const ownerName = (e: J) => {
    const o = e.spec?.owner;
    if (!o) return undefined;
    const k = ref(o, "group", e.metadata.namespace);
    return (k && owners.get(k)) ?? titleCase(String(o).replace(/^\w+:/, "").split("/").pop()!);
  };
  const links = (e: J) => [
    ...(e.metadata.links ?? []).map((l: J) => ({ kind: /runbook/i.test(l.title ?? "") ? "runbook" : "doc", label: l.title, href: String(l.url) })),
    ...(e.metadata.annotations?.["github.com/project-slug"] ? [{ kind: "repo", href: `https://github.com/${e.metadata.annotations["github.com/project-slug"]}` }] : []),
    ...(e.metadata.annotations?.["backstage.io/source-location"] ? [{ kind: "repo", href: String(e.metadata.annotations["backstage.io/source-location"]).replace(/^url:/, "") }] : []),
  ];
  for (const e of entities) {
    const kind = String(e.kind).toLowerCase();
    const type = { domain: "ddd:Domain", system: "c4:SoftwareSystem", component: "c4:Container", api: "archimate:ApplicationInterface", resource: "c4:Container", group: "c4:Person", user: "c4:Person" }[kind];
    if (!type) {
      d.report.push(`${e.kind} ${e.metadata.name} is not modelled`);
      continue;
    }
    const x = d.element(`backstage:${key(e)}`, type, String(e.metadata.title ?? (kind === "group" || kind === "user" ? owners.get(key(e)) : titleCase(e.metadata.name))), {
      description: e.metadata.description ? String(e.metadata.description) : undefined,
      owner: ownerName(e),
      tags: (e.metadata.tags ?? []).map(String),
      links: links(e),
      ...(LIFECYCLE[e.spec?.lifecycle] ? { lifecycle: { phase: LIFECYCLE[e.spec.lifecycle] } } : {}),
      properties: {
        backstageKind: e.kind,
        ...(e.spec?.type ? { technology: String(e.spec.type) } : {}),
        ...(kind === "resource" && /database|db|postgres|mysql/i.test(String(e.spec?.type ?? "")) ? { kind: "Database" } : {}),
        ...(kind === "group" || kind === "user" ? { team: kind === "group" } : {}),
      },
    });
    el.set(key(e), x);
  }
  for (const e of entities) {
    const me = el.get(key(e));
    if (!me) continue;
    const ns = e.metadata.namespace;
    const find = (r: string, kind: string) => {
      const k = ref(r, kind, ns);
      const hit = k && el.get(k);
      if (!hit && k) d.report.push(`${e.kind} ${e.metadata.name} refers to ${r}, which is not in these files`);
      return hit;
    };
    if (e.spec?.system) {
      const sys = find(e.spec.system, "system");
      if (sys) me.parent = sys.id;
    }
    if (e.spec?.domain) {
      const dom = find(e.spec.domain, "domain");
      if (dom) me.parent = dom.id;
    }
    if (e.spec?.subcomponentOf) {
      const p = find(e.spec.subcomponentOf, "component");
      if (p) me.parent = p.id;
    }
    for (const a of e.spec?.providesApis ?? []) {
      const api = find(a, "api");
      if (api) d.relate("archimate:Realization", me, api, { label: "Provides" });
    }
    for (const a of e.spec?.consumesApis ?? []) {
      const api = find(a, "api");
      if (api) d.relate("archimate:Serving", api, me, { label: "Consumed by" });
    }
    for (const dep of e.spec?.dependsOn ?? []) {
      const to = find(dep, "component");
      if (to) d.relate("c4:Uses", me, to, { label: "Depends on" });
    }
  }
  d.view("c4", "c4:landscape", "Software catalog (discovered from Backstage)", (e) => e.type === "c4:SoftwareSystem" || (e.type === "c4:Person" && e.properties.team === true));
  for (const sys of [...d.elements.values()].filter((e) => e.type === "c4:SoftwareSystem"))
    if ([...d.elements.values()].some((e) => e.parent === sys.id && e.type === "c4:Container")) d.view("c4", "c4:container", `${sys.name} – components (discovered)`, (e) => e === sys || (e.parent === sys.id && e.type === "c4:Container"), undefined, sys);
  return d.patch(`Backstage: ${entities.length} entities`);
}
