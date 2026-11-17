import { makeElement, makeRelationship, makeView, type Element, type Id, type ModelPatch, type Relationship, type View, type Workspace } from "@vastitecture/plugin-sdk";
import { SIZES, type DslOptions } from "./dsl";

/* eslint-disable @typescript-eslint/no-explicit-any */
type J = Record<string, any>;

const TAG_DEFAULTS = new Set(["Element", "Person", "Software System", "Container", "Component", "Deployment Node", "Infrastructure Node", "Relationship", "Container Instance", "Software System Instance"]);
const tagsOf = (s: string | undefined) => (s ?? "").split(",").map((t) => t.trim()).filter((t) => t && !TAG_DEFAULTS.has(t));

/** Import a Structurizr workspace JSON file, keeping the diagram positions it carries. */
export function parseWorkspaceJson(text: string): ModelPatch {
  const doc: J = JSON.parse(text);
  const model: J = doc.model ?? {};
  const elements: Element[] = [];
  const relationships: Relationship[] = [];
  const views: View[] = [];
  const report: string[] = [];
  const ids = new Map<string, Id>();
  const relIds = new Map<string, Id>();
  const pendingRels: J[] = [];
  const instanceNode = new Map<Id, { target: string; node: Id }>();

  const add = (type: string, j: J, parent?: Id, extra: Record<string, string> = {}): Element => {
    const el = makeElement(type, j.name ?? "Unnamed", parent ? { parent } : {});
    if (j.description) el.description = j.description;
    if (j.technology) el.properties.technology = j.technology;
    if (j.location === "External") el.properties.location = "External";
    if (j.group) el.properties.group = j.group;
    for (const [k, v] of Object.entries({ ...(j.properties ?? {}), ...extra })) el.properties[k] = String(v);
    el.tags = tagsOf(j.tags);
    if (el.tags.includes("Database") && type === "c4:Container") el.properties.kind = "Database";
    if (j.url) el.links.push({ kind: "doc", href: j.url });
    ids.set(String(j.id), el.id);
    elements.push(el);
    for (const r of j.relationships ?? []) pendingRels.push(r);
    return el;
  };
  for (const p of model.people ?? []) add("c4:Person", p);
  for (const s of model.softwareSystems ?? []) {
    const sys = add("c4:SoftwareSystem", s);
    for (const c of s.containers ?? []) {
      const con = add("c4:Container", c, sys.id);
      for (const k of c.components ?? []) add("c4:Component", k, con.id);
    }
  }
  const depNode = (n: J, parent?: Id) => {
    const el = add("c4:DeploymentNode", n, parent, n.environment ? { environment: n.environment } : {});
    if (n.instances && String(n.instances) !== "1") el.properties.instances = String(n.instances);
    for (const c of n.children ?? []) depNode(c, el.id);
    for (const i of n.infrastructureNodes ?? []) add("c4:InfrastructureNode", i, el.id, n.environment ? { environment: n.environment } : {});
    for (const i of [...(n.containerInstances ?? []), ...(n.softwareSystemInstances ?? [])]) {
      // Instances are placements of the real element, not separate model elements.
      const target = String(i.containerId ?? i.softwareSystemId);
      ids.set(String(i.id), `instance:${i.id}`);
      instanceNode.set(`instance:${i.id}`, { target, node: el.id });
      for (const r of i.relationships ?? []) if (!r.linkedRelationshipId) pendingRels.push(r);
    }
  };
  for (const n of model.deploymentNodes ?? []) depNode(n);

  const real = (id: string): Id | undefined => {
    const v = ids.get(String(id));
    if (!v) return undefined;
    return v.startsWith("instance:") ? ids.get(instanceNode.get(v)!.target) : v;
  };
  for (const r of pendingRels) {
    const s = real(r.sourceId), d = real(r.destinationId);
    if (!s || !d) {
      report.push(`Relationship ${r.id} skipped: unknown end`);
      continue;
    }
    if (r.linkedRelationshipId) {
      relIds.set(String(r.id), `linked:${r.linkedRelationshipId}`);
      continue;
    }
    const rel = makeRelationship("c4:Uses", s, d);
    if (r.description) rel.label = r.description;
    if (r.technology) rel.technology = r.technology;
    relIds.set(String(r.id), rel.id);
    relationships.push(rel);
  }
  const relOf = (id: string): Id | undefined => {
    const v = relIds.get(String(id));
    return v?.startsWith("linked:") ? relOf(v.slice(7)) : v;
  };

  const layout: Id[] = [];
  const kinds: [string, string, string?][] = [
    ["systemLandscapeViews", "c4:landscape"],
    ["systemContextViews", "c4:context", "softwareSystemId"],
    ["containerViews", "c4:container", "softwareSystemId"],
    ["componentViews", "c4:component", "containerId"],
    ["dynamicViews", "c4:dynamic", "elementId"],
    ["deploymentViews", "c4:deployment", "softwareSystemId"],
  ];
  const byId = new Map(elements.map((e) => [e.id, e]));
  for (const [key, viewpoint, subjectKey] of kinds) {
    for (const jv of doc.views?.[key] ?? []) {
      const subject = subjectKey && jv[subjectKey] ? real(jv[subjectKey]) : undefined;
      const view = makeView("c4", jv.title ?? jv.key ?? viewpoint, { viewpoint, ...(subject ? { subject } : {}) });
      if (jv.description) view.description = jv.description;
      if (jv.key) view.properties.key = jv.key;
      if (jv.environment) view.properties.environment = jv.environment;
      const placed = new Map<Id, { x: number; y: number; parent?: Id }>();
      let positioned = false;
      for (const e of jv.elements ?? []) {
        const mapped = ids.get(String(e.id));
        const id = real(e.id);
        if (!id || placed.has(id)) continue;
        if (e.x !== undefined) positioned = true;
        placed.set(id, { x: e.x ?? 0, y: e.y ?? 0, parent: mapped?.startsWith("instance:") ? instanceNode.get(mapped)!.node : undefined });
      }
      const boundary = subject && (viewpoint === "c4:container" || viewpoint === "c4:component") ? subject : undefined;
      if (boundary && !placed.has(boundary)) placed.set(boundary, { x: 0, y: 0 });
      for (const [id, p] of placed) {
        const el = byId.get(id)!;
        const [w, h] = SIZES[el.type] ?? [160, 80];
        const parent = p.parent ?? el.parent;
        // Structurizr positions are absolute and its boxes are ~450px wide; scale to our default sizes.
        view.nodes.push({ element: id, x: Math.round(p.x * 0.55), y: Math.round(p.y * 0.55), w, h, ...(parent && placed.has(parent) ? { parent } : {}) });
      }
      // Nested nodes need parent-relative positions and a boundary size, so nested views are always re-laid out.
      if (!positioned || view.nodes.some((n) => n.parent)) layout.push(view.id);
      for (const r of jv.relationships ?? []) {
        const id = relOf(r.id);
        if (id && !view.edges.some((e) => e.relationship === id)) view.edges.push({ relationship: id, ...(r.order && viewpoint === "c4:dynamic" ? { order: Number(r.order) } : {}) });
      }
      views.push(view);
    }
  }
  report.unshift(`Workspace "${doc.name ?? ""}": ${elements.length} elements, ${relationships.length} relationships, ${views.length} views`);
  return { elements, relationships, views, layout, report };
}

/** Export C4 content as Structurizr workspace JSON, including diagram positions. */
export function writeWorkspaceJson(ws: Workspace, opts: Pick<DslOptions, "typeOf">): string {
  let next = 1;
  const ids = new Map<Id, string>();
  const idOf = (id: Id) => ids.get(id) ?? (ids.set(id, String(next++)), ids.get(id)!);
  const type = new Map<Id, string>();
  for (const e of Object.values(ws.elements)) {
    const t = opts.typeOf(e);
    if (t) type.set(e.id, t);
  }
  const sorted = Object.values(ws.elements).filter((e) => type.has(e.id)).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const relsFrom = new Map<Id, J[]>();
  const relIds = new Map<Id, string>();
  const base = (e: Element, tag: string): J => {
    const props = Object.fromEntries(Object.entries(e.properties).filter(([k, v]) => !["technology", "location", "kind", "environment", "instances", "group"].includes(k) && typeof v !== "object").map(([k, v]) => [k, String(v)]));
    return {
      id: idOf(e.id),
      name: e.name,
      ...(e.description ? { description: e.description } : {}),
      ...(typeof e.properties.technology === "string" ? { technology: e.properties.technology } : {}),
      ...(e.properties.location === "External" ? { location: "External" } : {}),
      ...(typeof e.properties.group === "string" ? { group: e.properties.group } : {}),
      ...(e.links[0] ? { url: e.links[0].href } : {}),
      ...(Object.keys(props).length ? { properties: props } : {}),
      tags: ["Element", tag, ...e.tags].join(","),
    };
  };
  const kidsOf = (id: Id, t: string) => sorted.filter((e) => e.parent === id && type.get(e.id) === t);
  for (const e of sorted) idOf(e.id);
  for (const r of Object.values(ws.relationships).sort((a, b) => a.id.localeCompare(b.id))) {
    if (!type.has(r.source) || !type.has(r.target)) continue;
    const id = String(next++);
    relIds.set(r.id, id);
    relsFrom.set(r.source, [
      ...(relsFrom.get(r.source) ?? []),
      { id, sourceId: idOf(r.source), destinationId: idOf(r.target), ...(r.label ? { description: r.label } : {}), ...(r.technology ? { technology: r.technology } : {}), tags: "Relationship" },
    ]);
  }
  const withRels = (e: Element, j: J): J => (relsFrom.has(e.id) ? { ...j, relationships: relsFrom.get(e.id) } : j);
  const people = sorted.filter((e) => type.get(e.id) === "c4:Person").map((e) => withRels(e, base(e, "Person")));
  const softwareSystems = sorted
    .filter((e) => type.get(e.id) === "c4:SoftwareSystem")
    .map((s) =>
      withRels(s, {
        ...base(s, "Software System"),
        containers: kidsOf(s.id, "c4:Container").map((c) =>
          withRels(c, { ...base(c, "Container"), components: kidsOf(c.id, "c4:Component").map((k) => withRels(k, base(k, "Component"))) }),
        ),
      }),
    );
  // Instances come from deployment views: a container or system drawn inside a deployment node.
  const instances = new Map<Id, { id: string; target: Id }[]>();
  const instanceId = new Map<string, string>();
  for (const v of Object.values(ws.views))
    if (v.viewpoint === "c4:deployment")
      for (const n of v.nodes)
        if (n.parent && type.get(n.parent) === "c4:DeploymentNode" && ["c4:Container", "c4:SoftwareSystem"].includes(type.get(n.element) ?? "")) {
          const key = `${n.parent}|${n.element}`;
          if (!instanceId.has(key)) {
            instanceId.set(key, String(next++));
            instances.set(n.parent, [...(instances.get(n.parent) ?? []), { id: instanceId.get(key)!, target: n.element }]);
          }
        }
  const dep = (e: Element): J => {
    const env = String(e.properties.environment ?? "Default");
    const inst = instances.get(e.id) ?? [];
    return withRels(e, {
      ...base(e, "Deployment Node"),
      environment: env,
      instances: String(e.properties.instances ?? "1"),
      children: kidsOf(e.id, "c4:DeploymentNode").map(dep),
      infrastructureNodes: kidsOf(e.id, "c4:InfrastructureNode").map((i) => withRels(i, { ...base(i, "Infrastructure Node"), environment: env })),
      containerInstances: inst.filter((i) => type.get(i.target) === "c4:Container").map((i) => ({ id: i.id, containerId: idOf(i.target), environment: env, instanceId: 1, tags: "Container Instance" })),
      softwareSystemInstances: inst.filter((i) => type.get(i.target) === "c4:SoftwareSystem").map((i) => ({ id: i.id, softwareSystemId: idOf(i.target), environment: env, instanceId: 1, tags: "Software System Instance" })),
    });
  };
  const deploymentNodes = sorted.filter((e) => type.get(e.id) === "c4:DeploymentNode" && (!e.parent || type.get(e.parent) !== "c4:DeploymentNode")).map(dep);

  const out: J = { systemLandscapeViews: [], systemContextViews: [], containerViews: [], componentViews: [], dynamicViews: [], deploymentViews: [] };
  const keys = new Set<string>();
  for (const v of Object.values(ws.views).filter((x) => x.notation === "c4").sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = new Map<Id, { x: number; y: number }>();
    const pos = (id: Id): { x: number; y: number } => {
      if (abs.has(id)) return abs.get(id)!;
      const n = v.nodes.find((k) => k.element === id)!;
      const p = n.parent && v.nodes.some((k) => k.element === n.parent) ? pos(n.parent) : { x: 0, y: 0 };
      abs.set(id, { x: p.x + n.x, y: p.y + n.y });
      return abs.get(id)!;
    };
    let key = String(v.properties.key ?? v.name).replace(/[^\w-]+/g, "-") || "view";
    for (let i = 2; keys.has(key); i++) key = `${key}-${i}`;
    keys.add(key);
    const boundary = v.viewpoint === "c4:container" || v.viewpoint === "c4:component" ? v.subject : undefined;
    const jv: J = {
      key,
      title: v.name,
      ...(v.description ? { description: v.description } : {}),
      elements: v.nodes
        .filter((n) => type.has(n.element) && n.element !== boundary)
        .map((n) => ({ id: (n.parent && instanceId.get(`${n.parent}|${n.element}`)) || idOf(n.element), x: Math.round(pos(n.element).x / 0.55), y: Math.round(pos(n.element).y / 0.55) })),
      relationships: v.edges.filter((e) => relIds.has(e.relationship)).map((e) => ({ id: relIds.get(e.relationship), ...(e.order !== undefined ? { order: String(e.order) } : {}) })),
    };
    const subject = v.subject && type.has(v.subject) ? idOf(v.subject) : undefined;
    switch (v.viewpoint) {
      case "c4:context":
        if (subject) out.systemContextViews.push({ ...jv, softwareSystemId: subject });
        break;
      case "c4:container":
        if (subject) out.containerViews.push({ ...jv, softwareSystemId: subject });
        break;
      case "c4:component":
        if (subject) out.componentViews.push({ ...jv, containerId: subject });
        break;
      case "c4:dynamic":
        out.dynamicViews.push({ ...jv, ...(subject ? { elementId: subject } : {}) });
        break;
      case "c4:deployment":
        out.deploymentViews.push({ ...jv, environment: String(v.properties.environment ?? "Default"), ...(subject ? { softwareSystemId: subject } : {}) });
        break;
      default:
        out.systemLandscapeViews.push(jv);
    }
  }
  return JSON.stringify({ name: ws.name, description: "Exported from Vastitecture", model: { people, softwareSystems, deploymentNodes }, views: out }, null, 2) + "\n";
}
