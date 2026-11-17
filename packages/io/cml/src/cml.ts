import { makeElement, makeRelationship, makeView, type Element, type Id, type ModelPatch, type Relationship, type View, type Workspace } from "@vastitecture/plugin-sdk";

interface Tok {
  t: string;
  kind: "id" | "str" | "sym";
  start: number;
  end: number;
  line: number;
}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  const re = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|<->|->|<-|[{}[\](),=;:]|[A-Za-z_^][\w.]*(?:-[A-Za-z]\w*)*|\S/g;
  let line = 1;
  let last = 0;
  for (let m; (m = re.exec(src)); ) {
    for (let i = last; i < m.index; i++) if (src[i] === "\n") line++;
    last = m.index;
    const t = m[0];
    if (t.startsWith("//") || t.startsWith("/*")) continue;
    out.push({ t: t.startsWith('"') ? t.slice(1, -1).replace(/\\(.)/g, "$1") : t, kind: t.startsWith('"') ? "str" : /^[A-Za-z_^]/.test(t) ? "id" : "sym", start: m.index, end: m.index + t.length, line });
  }
  return out;
}

const SUBDOMAIN_TYPE: Record<string, string> = { CORE_DOMAIN: "Core", SUPPORTING_DOMAIN: "Supporting", GENERIC_SUBDOMAIN: "Generic" };
const CONTEXT_TYPE: Record<string, string> = { FEATURE: "Feature", APPLICATION: "Application", SYSTEM: "System", TEAM: "Team" };
const TACTICAL: Record<string, string> = { Entity: "ddd:Entity", ValueObject: "ddd:ValueObject", DomainEvent: "ddd:DomainEvent", Event: "ddd:DomainEvent", CommandEvent: "ddd:Command", Command: "ddd:Command" };
const KEYWORD_REL: Record<string, { type: string; flip?: boolean }> = {
  Partnership: { type: "ddd:Partnership" },
  "Shared-Kernel": { type: "ddd:SharedKernel" },
  "Customer-Supplier": { type: "ddd:CustomerSupplier", flip: true },
  "Supplier-Customer": { type: "ddd:CustomerSupplier" },
  "Upstream-Downstream": { type: "ddd:UpstreamDownstream" },
  "Downstream-Upstream": { type: "ddd:UpstreamDownstream", flip: true },
};
const SIZE: Record<string, [number, number]> = { "ddd:BoundedContext": [210, 120], "ddd:Subdomain": [200, 110], "ddd:Domain": [520, 320] };

/** Parse Context Mapper CML into DDD elements, strategic relationships and one context-map view per ContextMap. */
export function parseCml(src: string): ModelPatch {
  const toks = tokenize(src);
  const report: string[] = [];
  const elements: Element[] = [];
  const relationships: Relationship[] = [];
  const views: View[] = [];
  const contexts = new Map<string, Element>();
  const subdomains = new Map<string, Element>();
  const pendingImpl: { ctx: Element; names: string[] }[] = [];
  const maps: { view: View; contains: string[]; rels: { up: string; down: string; rel: Relationship }[] }[] = [];
  let i = 0;

  const peek = (o = 0) => toks[i + o];
  const is = (s: string, o = 0) => toks[i + o]?.t === s && toks[i + o]?.kind !== "str";
  const matching = (open: number) => {
    let depth = 0;
    for (let j = open; j < toks.length; j++) {
      if (toks[j].kind === "sym" && toks[j].t === "{") depth++;
      if (toks[j].kind === "sym" && toks[j].t === "}" && --depth === 0) return j;
    }
    return toks.length - 1;
  };
  /** Read `key = value[, value]` or `key value`; returns the values. */
  const values = (): string[] => {
    i++;
    if (is("=")) i++;
    const out: string[] = [];
    while (peek() && (peek().kind === "str" || peek().kind === "id")) {
      out.push(toks[i++].t);
      if (is(",")) i++;
      else break;
    }
    if (is(";")) i++;
    return out;
  };
  const skipBlockOrStatement = () => {
    const line = peek().line;
    while (peek() && peek().line === line && !is("{")) i++;
    if (is("{")) i = matching(i) + 1;
  };
  const raw = (open: number, close: number) =>
    src
      .slice(toks[open].end, toks[close].start)
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .join("\n");

  const getContext = (name: string) => {
    let c = contexts.get(name);
    if (!c) {
      c = makeElement("ddd:BoundedContext", name);
      contexts.set(name, c);
      elements.push(c);
    }
    return c;
  };

  const parseTacticalContainer = (parent: Element, end: number) => {
    while (i < end) {
      const t = peek();
      if (t.kind === "id" && t.t === "Aggregate" && peek(1)?.kind === "id") {
        const agg = makeElement("ddd:Aggregate", peek(1).t, { parent: parent.id });
        elements.push(agg);
        i += 2;
        if (!is("{")) continue;
        const close = matching(i);
        i++;
        while (i < close) {
          const k = peek();
          if (k.kind === "id" && TACTICAL[k.t] && peek(1)?.kind === "id") {
            const el = makeElement(TACTICAL[k.t], peek(1).t, { parent: agg.id });
            i += 2;
            while (i < close && !is("{") && peek().line === k.line) i++;
            if (is("{")) {
              const c2 = matching(i);
              const body = raw(i, c2);
              if (body) el.properties.cml = body;
              if (/(^|\n)aggregateRoot\b/.test(body)) el.properties.aggregateRoot = true;
              i = c2 + 1;
            }
            elements.push(el);
          } else if (k.kind === "id" && k.t === "owner") agg.owner = values()[0];
          else if (k.kind === "id" && k.t === "responsibilities") agg.properties.responsibilities = values();
          else if (k.kind === "id" && ["Service", "Enum", "Repository", "DataTransferObject", "BasicType", "Trait", "Resource", "Consumer"].includes(k.t)) {
            report.push(`Line ${k.line}: ${k.t} ${peek(1)?.t ?? ""} in aggregate ${agg.name} is not imported`);
            skipBlockOrStatement();
          } else if (k.kind === "id" && ["abstract", "securityZone", "contentVolatility", "availabilityCriticality", "consistencyCriticality", "storageSimilarity", "securityCriticality", "securityAccessGroup", "likelihoodForChange", "structuralVolatility", "knowledgeLevel"].includes(k.t)) {
            if (k.t === "abstract") i++;
            else values();
          } else i++;
        }
        i = close + 1;
      } else if (t.kind === "id" && t.t === "Module" && peek(1)?.kind === "id") {
        const mod = makeElement("ddd:Module", peek(1).t, { parent: parent.id });
        elements.push(mod);
        i += 2;
        if (is("{")) {
          const close = matching(i);
          i++;
          parseTacticalContainer(mod, close);
          i = close + 1;
        }
      } else if (t.kind === "id" && t.t === "domainVisionStatement") parent.description = values()[0];
      else if (t.kind === "id" && t.t === "responsibilities") parent.properties.responsibilities = values();
      else if (t.kind === "id" && t.t === "implementationTechnology") parent.properties.implementationTechnology = values()[0];
      else if (t.kind === "id" && t.t === "knowledgeLevel") parent.properties.knowledgeLevel = values()[0];
      else if (t.kind === "id" && t.t === "type") {
        const v = values()[0];
        if (parent.type === "ddd:Subdomain") parent.properties.subdomainType = SUBDOMAIN_TYPE[v] ?? v;
        else parent.properties.contextType = CONTEXT_TYPE[v] ?? v;
      } else if (t.kind === "id" && TACTICAL[t.t] && peek(1)?.kind === "id" && parent.type === "ddd:Subdomain") {
        // Entities directly inside a subdomain describe the domain model; kept as children of the subdomain.
        const el = makeElement(TACTICAL[t.t], peek(1).t, { parent: parent.id });
        elements.push(el);
        i += 2;
        if (is("{")) {
          const c2 = matching(i);
          const body = raw(i, c2);
          if (body) el.properties.cml = body;
          i = c2 + 1;
        }
      } else if (t.kind === "id" && ["Application", "Service", "Enum"].includes(t.t)) {
        report.push(`Line ${t.line}: ${t.t} in ${parent.name} is not imported`);
        skipBlockOrStatement();
      } else i++;
    }
  };

  const roles = (): string[] => {
    const out: string[] = [];
    if (!is("[")) return out;
    i++;
    while (peek() && !is("]")) {
      if (peek().kind === "id") out.push(peek().t);
      i++;
    }
    i++;
    return out;
  };

  const parseContextMap = () => {
    const start = peek();
    i++;
    const name = peek()?.kind === "id" && !is("{") ? toks[i++].t : "ContextMap";
    const view = makeView("ddd", name, { viewpoint: "ddd:context-map" });
    const entry = { view, contains: [] as string[], rels: [] as { up: string; down: string; rel: Relationship }[] };
    maps.push(entry);
    views.push(view);
    if (!is("{")) return void report.push(`Line ${start.line}: ContextMap without a body`);
    const close = matching(i);
    i++;
    while (i < close) {
      const t = peek();
      if (t.kind !== "id") {
        i++;
        continue;
      }
      if (t.t === "type" || t.t === "state") {
        const v = values()[0];
        if (v) view.properties[t.t === "type" ? "cmlType" : "cmlState"] = v;
      } else if (t.t === "contains") entry.contains.push(...values());
      else {
        const left = toks[i++].t;
        const lr = roles();
        const op = peek();
        if (!op || i >= close) break;
        let type: string | undefined;
        let up = left;
        let down: string;
        let rr: string[];
        const kw = op.kind === "id" ? KEYWORD_REL[op.t] : undefined;
        if (kw) {
          i++;
          rr = roles();
          const right = toks[i++].t;
          type = kw.type;
          [up, down] = kw.flip ? [right, left] : [left, right];
          if (kw.flip) [lr.length, rr.length] = [0, 0];
        } else if (op.kind === "sym" && ["<->", "->", "<-"].includes(op.t)) {
          i++;
          rr = roles();
          const right = toks[i++].t;
          const leftUp = lr.includes("U") || lr.includes("S") ? true : lr.includes("D") || lr.includes("C") ? false : rr.includes("U") || rr.includes("S") ? false : op.t !== "<-";
          [up, down] = leftUp ? [left, right] : [right, left];
          const [ur, dr] = leftUp ? [[...lr], [...rr]] : [[...rr], [...lr]];
          const all = [...lr, ...rr];
          if (op.t === "<->") type = all.includes("SK") ? "ddd:SharedKernel" : "ddd:Partnership";
          else if (all.includes("S") || all.includes("C")) type = "ddd:CustomerSupplier";
          else if (dr.includes("ACL")) type = "ddd:AnticorruptionLayer";
          else if (dr.includes("CF")) type = "ddd:Conformist";
          else if (ur.includes("OHS")) type = "ddd:OpenHostService";
          else if (ur.includes("PL")) type = "ddd:PublishedLanguage";
          else type = "ddd:UpstreamDownstream";
          lr.splice(0, lr.length, ...ur);
          rr.splice(0, rr.length, ...dr);
        } else {
          report.push(`Line ${t.line}: could not read "${left} ${op.t} …" in the context map`);
          skipBlockOrStatement();
          continue;
        }
        const rel = makeRelationship(type, "", "");
        const upRoles = lr.filter((r) => !["U", "D", "S", "C", "P", "SK"].includes(r));
        const downRoles = rr.filter((r) => !["U", "D", "S", "C", "P", "SK"].includes(r));
        if (upRoles.length) rel.properties.upstreamRoles = upRoles.join(",");
        if (downRoles.length) rel.properties.downstreamRoles = downRoles.join(",");
        if (is(":")) {
          i++;
          rel.label = toks[i++].t;
        }
        if (is("{")) {
          const c2 = matching(i);
          i++;
          while (i < c2) {
            const k = peek();
            if (k.kind === "id" && k.t === "implementationTechnology") rel.technology = values()[0];
            else if (k.kind === "id" && k.t === "exposedAggregates") rel.properties.exposedAggregates = values().join(", ");
            else if (k.kind === "id" && k.t === "downstreamRights") rel.properties.downstreamRights = values()[0];
            else i++;
          }
          i = c2 + 1;
        }
        entry.rels.push({ up, down, rel });
        relationships.push(rel);
      }
    }
    i = close + 1;
  };

  while (i < toks.length) {
    const t = peek();
    if (t.kind !== "id") {
      i++;
      continue;
    }
    if (t.t === "ContextMap") parseContextMap();
    else if (t.t === "BoundedContext" && peek(1)?.kind === "id") {
      const ctx = getContext(peek(1).t);
      i += 2;
      while (peek() && !is("{") && peek().kind === "id" && ["implements", "realizes", "refines"].includes(peek().t)) {
        const kw = peek().t;
        const names = values();
        if (kw === "implements") pendingImpl.push({ ctx, names });
        else ctx.properties[kw] = names.join(", ");
      }
      if (is("{")) {
        const close = matching(i);
        i++;
        parseTacticalContainer(ctx, close);
        i = close + 1;
      }
    } else if (t.t === "Domain" && peek(1)?.kind === "id") {
      const dom = makeElement("ddd:Domain", peek(1).t);
      elements.push(dom);
      i += 2;
      if (!is("{")) continue;
      const close = matching(i);
      i++;
      while (i < close) {
        const k = peek();
        if (k.kind === "id" && k.t === "Subdomain" && peek(1)?.kind === "id") {
          const sub = makeElement("ddd:Subdomain", peek(1).t, { parent: dom.id });
          subdomains.set(sub.name, sub);
          elements.push(sub);
          i += 2;
          while (i < close && !is("{") && peek().kind === "id" && peek().t === "supports") values();
          if (is("{")) {
            const c2 = matching(i);
            i++;
            parseTacticalContainer(sub, c2);
            i = c2 + 1;
          }
        } else if (k.kind === "id" && k.t === "domainVisionStatement") dom.description = values()[0];
        else i++;
      }
      i = close + 1;
    } else if (["UseCase", "UserStory", "Stakeholders", "ValueRegister", "import"].includes(t.t)) {
      report.push(`Line ${t.line}: ${t.t} is not imported`);
      i++;
      skipBlockOrStatement();
    } else i++;
  }

  for (const { ctx, names } of pendingImpl)
    for (const n of names) {
      const sub = subdomains.get(n);
      if (sub) relationships.push(makeRelationship("ddd:Implements", ctx.id, sub.id));
      else report.push(`Bounded context ${ctx.name} implements unknown subdomain ${n}`);
    }
  for (const m of maps) {
    const members = new Set<Id>();
    for (const n of m.contains) members.add(getContext(n).id);
    for (const r of m.rels) {
      r.rel.source = getContext(r.up).id;
      r.rel.target = getContext(r.down).id;
      members.add(r.rel.source).add(r.rel.target);
      m.view.edges.push({ relationship: r.rel.id });
    }
    for (const id of members) m.view.nodes.push({ element: id, x: 0, y: 0, w: SIZE["ddd:BoundedContext"][0], h: SIZE["ddd:BoundedContext"][1] });
  }
  report.unshift(`CML: ${elements.length} elements, ${relationships.length} relationships, ${views.length} context map(s)`);
  return { elements, relationships, views, layout: views.map((v) => v.id), report };
}

export interface CmlOptions {
  view?: Id;
  /** How an element is presented in DDD, so systems from other notations export as bounded contexts. */
  typeOf(el: Element): string | undefined;
}

const ident = (name: string) => {
  const s = name.replace(/[^A-Za-z0-9_ ]+/g, " ").trim().split(/\s+/).map((w, i) => (i === 0 && /^[A-Za-z_]\w*$/.test(name) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join("");
  return /^[A-Za-z_]/.test(s) ? s : "X" + s;
};
const q = (s: unknown) => `"${String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\s*\n\s*/g, " ")}"`;

/** Write DDD content as Context Mapper CML. */
export function writeCml(ws: Workspace, opts: CmlOptions): string {
  const type = new Map<Id, string>();
  for (const e of Object.values(ws.elements)) {
    const t = opts.typeOf(e);
    if (t) type.set(e.id, t);
  }
  const names = new Map<Id, string>();
  const used = new Set<string>();
  // CML names are scoped: contexts, domains and subdomains share one namespace, everything else its container's.
  const scopeOf = (id: Id) => (["ddd:BoundedContext", "ddd:ExternalSystem", "ddd:Domain", "ddd:Subdomain"].includes(type.get(id) ?? "") ? "" : ws.elements[id].parent ?? "");
  const nameOf = (id: Id) => {
    if (names.has(id)) return names.get(id)!;
    const base = ident(ws.elements[id].name);
    let n = base;
    for (let k = 2; used.has(`${scopeOf(id)}/${n}`); k++) n = `${base}${k}`;
    used.add(`${scopeOf(id)}/${n}`);
    names.set(id, n);
    return n;
  };
  const sorted = Object.values(ws.elements).filter((e) => type.has(e.id)).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const isContext = (id: Id) => type.get(id) === "ddd:BoundedContext" || type.get(id) === "ddd:ExternalSystem";
  const onlyView = opts.view ? ws.views[opts.view] : undefined;
  const mapViews = (onlyView ? [onlyView] : Object.values(ws.views).filter((v) => v.viewpoint === "ddd:context-map")).sort((a, b) => a.name.localeCompare(b.name));
  const inScope = onlyView ? new Set(onlyView.nodes.map((n) => n.element)) : undefined;
  const out: string[] = [];
  const STRATEGIC = new Set(["ddd:Partnership", "ddd:SharedKernel", "ddd:CustomerSupplier", "ddd:UpstreamDownstream", "ddd:Conformist", "ddd:AnticorruptionLayer", "ddd:OpenHostService", "ddd:PublishedLanguage"]);

  const relLine = (r: Relationship): string | undefined => {
    if (!isContext(r.source) || !isContext(r.target)) return undefined;
    const a = nameOf(r.source), b = nameOf(r.target);
    const extra = (k: string) => (typeof r.properties[k] === "string" && r.properties[k] ? String(r.properties[k]).split(",").map((x) => x.trim()) : []);
    let line: string;
    if (r.type === "ddd:Partnership") line = `${a} [P]<->[P] ${b}`;
    else if (r.type === "ddd:SharedKernel") line = `${a} [SK]<->[SK] ${b}`;
    else if (STRATEGIC.has(r.type)) {
      const up = new Set(extra("upstreamRoles")), down = new Set(extra("downstreamRoles"));
      if (r.type === "ddd:OpenHostService") up.add("OHS");
      if (r.type === "ddd:PublishedLanguage") up.add("PL");
      if (r.type === "ddd:AnticorruptionLayer") down.add("ACL");
      if (r.type === "ddd:Conformist") down.add("CF");
      const cs = r.type === "ddd:CustomerSupplier";
      line = `${a} [${["U", ...(cs ? ["S"] : []), ...["OHS", "PL"].filter((x) => up.has(x))].join(",")}]->[${["D", ...(cs ? ["C"] : []), ...["ACL", "CF"].filter((x) => down.has(x))].join(",")}] ${b}`;
    } else return `\t// ${a} — ${b}: ${r.type.slice(4)} has no CML equivalent`;
    if (r.label && /^[A-Za-z_]\w*$/.test(r.label)) line += ` : ${r.label}`;
    const body: string[] = [];
    if (r.technology) body.push(`implementationTechnology = ${q(r.technology)}`);
    if (typeof r.properties.exposedAggregates === "string" && r.properties.exposedAggregates) body.push(`exposedAggregates = ${r.properties.exposedAggregates}`);
    if (typeof r.properties.downstreamRights === "string") body.push(`downstreamRights = ${r.properties.downstreamRights}`);
    return "\t" + line + (body.length ? ` {\n${body.map((l) => "\t\t" + l).join("\n")}\n\t}` : "");
  };
  const relSort = (a: Relationship, b: Relationship) => nameOf(a.source).localeCompare(nameOf(b.source)) || nameOf(a.target).localeCompare(nameOf(b.target)) || a.id.localeCompare(b.id);
  for (const e of sorted) nameOf(e.id);

  const writeMap = (name: string, members: Id[], rels: Relationship[], props: Record<string, unknown>) => {
    out.push(`ContextMap ${ident(name)} {`);
    if (props.cmlType) out.push(`\ttype = ${props.cmlType}`);
    if (props.cmlState) out.push(`\tstate = ${props.cmlState}`);
    const ctxs = members.filter(isContext).map(nameOf).sort();
    if (ctxs.length) out.push(`\tcontains ${ctxs.join(", ")}`);
    const lines = rels.sort(relSort).map(relLine).filter(Boolean) as string[];
    if (lines.length) out.push("", ...lines);
    out.push("}", "");
  };
  if (mapViews.length)
    for (const v of mapViews)
      writeMap(v.name, v.nodes.map((n) => n.element), v.edges.map((e) => ws.relationships[e.relationship]).filter((r) => r && r.type.startsWith("ddd:") && r.type !== "ddd:Implements" && r.type !== "ddd:Owns"), v.properties);
  else if (sorted.some((e) => isContext(e.id)))
    writeMap(`${ws.name} Context Map`, sorted.filter((e) => isContext(e.id)).map((e) => e.id), Object.values(ws.relationships).filter((r) => STRATEGIC.has(r.type)), {});

  const kids = (id: Id, t: string) => sorted.filter((e) => e.parent === id && type.get(e.id) === t);
  const KW: Record<string, string> = { "ddd:Entity": "Entity", "ddd:ValueObject": "ValueObject", "ddd:DomainEvent": "DomainEvent", "ddd:Command": "CommandEvent" };
  const tactical = (e: Element, depth: number) => {
    const ind = "\t".repeat(depth);
    const body = typeof e.properties.cml === "string" ? e.properties.cml.split("\n") : e.properties.aggregateRoot ? ["aggregateRoot"] : [];
    out.push(body.length ? `${ind}${KW[type.get(e.id)!]} ${nameOf(e.id)} {` : `${ind}${KW[type.get(e.id)!]} ${nameOf(e.id)}`);
    if (body.length) out.push(...body.map((l) => ind + "\t" + l), `${ind}}`);
  };
  const aggregates = (parent: Id, depth: number) => {
    const ind = "\t".repeat(depth);
    for (const m of kids(parent, "ddd:Module")) {
      out.push(`${ind}Module ${nameOf(m.id)} {`);
      aggregates(m.id, depth + 1);
      out.push(`${ind}}`);
    }
    for (const a of kids(parent, "ddd:Aggregate")) {
      out.push(`${ind}Aggregate ${nameOf(a.id)} {`);
      if (a.owner) out.push(`${ind}\towner = ${ident(a.owner)}`);
      for (const c of sorted.filter((e) => e.parent === a.id && KW[type.get(e.id)!])) tactical(c, depth + 1);
      out.push(`${ind}}`);
    }
  };
  const REV = (m: Record<string, string>, v: unknown) => Object.entries(m).find(([, x]) => x === v)?.[0] ?? (typeof v === "string" ? v : undefined);
  for (const c of sorted.filter((e) => isContext(e.id) && (!inScope || inScope.has(e.id)))) {
    const impl = Object.values(ws.relationships).filter((r) => r.type === "ddd:Implements" && r.source === c.id && type.get(r.target) === "ddd:Subdomain").map((r) => nameOf(r.target)).sort();
    out.push(`BoundedContext ${nameOf(c.id)}${impl.length ? ` implements ${impl.join(", ")}` : ""} {`);
    const ct = REV(CONTEXT_TYPE, c.properties.contextType);
    if (ct) out.push(`\ttype = ${ct}`);
    if (c.description) out.push(`\tdomainVisionStatement = ${q(c.description)}`);
    if (Array.isArray(c.properties.responsibilities) && c.properties.responsibilities.length) out.push(`\tresponsibilities = ${c.properties.responsibilities.map(q).join(", ")}`);
    const tech = c.properties.implementationTechnology ?? c.properties.technology;
    if (tech) out.push(`\timplementationTechnology = ${q(tech)}`);
    if (typeof c.properties.knowledgeLevel === "string") out.push(`\tknowledgeLevel = ${c.properties.knowledgeLevel}`);
    aggregates(c.id, 1);
    out.push("}", "");
  }
  for (const d of sorted.filter((e) => type.get(e.id) === "ddd:Domain" && !inScope)) {
    out.push(`Domain ${nameOf(d.id)} {`);
    if (d.description) out.push(`\tdomainVisionStatement = ${q(d.description)}`);
    for (const s of kids(d.id, "ddd:Subdomain")) {
      out.push(`\tSubdomain ${nameOf(s.id)} {`);
      const st = REV(SUBDOMAIN_TYPE, s.properties.subdomainType);
      if (st) out.push(`\t\ttype = ${st}`);
      if (s.description) out.push(`\t\tdomainVisionStatement = ${q(s.description)}`);
      for (const c of sorted.filter((e) => e.parent === s.id && KW[type.get(e.id)!])) tactical(c, 2);
      out.push("\t}");
    }
    out.push("}", "");
  }
  return out.join("\n").replace(/\n+$/, "\n");
}
