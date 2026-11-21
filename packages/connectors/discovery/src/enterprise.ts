import { XMLParser } from "fast-xml-parser";
import type { ImportInput, ModelPatch } from "@vastitecture/plugin-sdk";
import { Draft, csvRows, docs, type J } from "./util";

/**
 * Imports from other enterprise architecture repositories: LeanIX, Ardoq and Sparx Enterprise Architect.
 * Each becomes ArchiMate elements with a stable externalId, so importing again updates instead of
 * duplicating. These read exports (and LeanIX's GraphQL answer); none of them writes back.
 */
type Mapped = { type: string; domain?: string; kind?: string };

/** LeanIX fact sheet types. */
const LEANIX: Record<string, Mapped> = {
  Application: { type: "archimate:ApplicationComponent" },
  ITComponent: { type: "archimate:SystemSoftware" },
  BusinessCapability: { type: "archimate:Capability" },
  Interface: { type: "archimate:ApplicationInterface" },
  DataObject: { type: "archimate:DataObject" },
  Provider: { type: "archimate:BusinessActor" },
  UserGroup: { type: "archimate:Role", domain: "Business" },
  Process: { type: "archimate:Process", domain: "Business" },
  Project: { type: "archimate:WorkPackage" },
  Initiative: { type: "archimate:WorkPackage" },
  Objective: { type: "archimate:Goal" },
  TechnicalStack: { type: "archimate:Grouping" },
  TechCategory: { type: "archimate:Grouping" },
  Platform: { type: "archimate:Grouping" },
  BusinessContext: { type: "archimate:ValueStream" },
};

const PHASE: Record<string, "plan" | "phaseIn" | "active" | "phaseOut" | "endOfLife"> = { plan: "plan", phasein: "phaseIn", active: "active", phaseout: "phaseOut", endoflife: "endOfLife" };
const phaseOf = (s: unknown) => (typeof s === "string" ? PHASE[s.replace(/[^a-z]/gi, "").toLowerCase()] : undefined);

/** How a LeanIX relation between two fact sheet types reads in ArchiMate (source, target, type). */
function leanixRelation(fromType: string, toType: string): { type: string; reverse?: boolean } {
  if (toType === "BusinessCapability" || toType === "Objective") return { type: "archimate:Realization" };
  if (fromType === "Application" && toType === "ITComponent") return { type: "archimate:Serving", reverse: true };
  if (fromType === "Application" && toType === "DataObject") return { type: "archimate:Access" };
  if (fromType === "Application" && toType === "UserGroup") return { type: "archimate:Serving" };
  if (fromType === "Application" && toType === "Process") return { type: "archimate:Serving" };
  if (toType === "Provider") return { type: "archimate:Serving", reverse: true };
  if (fromType === "Project" || fromType === "Initiative") return { type: "archimate:Association" };
  return { type: "archimate:Association" };
}

export function leanixToPatch(files: ImportInput[]): ModelPatch {
  const d = new Draft("leanix");
  const skipped = new Map<string, number>();
  const rels: { from: string; to: string; key: string }[] = [];
  const typeOf = new Map<string, string>();
  const add = (n: J) => {
    const t = LEANIX[n.type];
    if (!t) return void skipped.set(String(n.type), (skipped.get(String(n.type)) ?? 0) + 1);
    typeOf.set(String(n.id), n.type);
    const phase = phaseOf(n.lifecycle?.asString ?? n.lifecycle);
    d.element(`leanix:${n.id}`, t.type, String(n.displayName ?? n.name), {
      ...(n.description ? { description: String(n.description) } : {}),
      ...(phase ? { lifecycle: { phase } } : {}),
      properties: { leanixType: n.type, ...(t.domain ? { domain: t.domain } : {}), ...(n.businessCriticality ? { criticality: String(n.businessCriticality) } : {}), ...(n.technicalSuitability ? { technicalFit: String(n.technicalSuitability) } : {}) },
      tags: (n.tags ?? []).map((x: J) => (typeof x === "string" ? x : x?.name)).filter(Boolean),
    });
    if (n.parentId) rels.push({ from: String(n.id), to: String(n.parentId), key: "relToParent" });
    for (const [k, v] of Object.entries(n)) {
      if (!k.startsWith("rel") || !v || typeof v !== "object") continue;
      for (const edge of ((v as J).edges ?? []) as J[]) {
        const fs = edge?.node?.factSheet;
        if (fs?.id) {
          rels.push({ from: String(n.id), to: String(fs.id), key: k });
          if (fs.type && !typeOf.has(String(fs.id))) typeOf.set(String(fs.id), fs.type);
        }
      }
    }
  };
  for (const f of files) {
    if (/\.csv$/i.test(f.name)) {
      const [head, ...rows] = csvRows(f.text);
      const col = (re: RegExp) => head?.findIndex((h) => re.test(h.trim())) ?? -1;
      const [ci, cn, ct, cd, cl, cp] = [col(/^id$/i), col(/^(display ?name|name)$/i), col(/^(type|fact ?sheet ?type)$/i), col(/^description$/i), col(/^lifecycle/i), col(/^(parent|parent ?id)$/i)];
      for (const r of rows) add({ id: ci >= 0 ? r[ci] : r[cn], name: r[cn], type: r[ct]?.replace(/\s+/g, ""), description: cd >= 0 ? r[cd] : undefined, lifecycle: cl >= 0 ? r[cl] : undefined, parentId: cp >= 0 ? r[cp] || undefined : undefined });
      continue;
    }
    for (const doc of docs(f, d.report)) {
      const edges = doc.data?.allFactSheets?.edges ?? doc.allFactSheets?.edges ?? (Array.isArray(doc) ? doc.map((n: J) => ({ node: n })) : []);
      for (const e of edges as J[]) if (e?.node) add(e.node);
    }
  }
  for (const r of rels) {
    const a = d.elements.get(`leanix:${r.from}`), b = d.elements.get(`leanix:${r.to}`);
    if (!a || !b) continue;
    if (r.key === "relToParent") {
      if (!a.parent && a.type === b.type) a.parent = b.id;
      else if (!a.parent) d.relate("archimate:Composition", b, a);
      continue;
    }
    if (r.key === "relToChild") continue;
    const m = leanixRelation(typeOf.get(r.from) ?? "", typeOf.get(r.to) ?? "");
    d.relate(m.type, m.reverse ? b : a, m.reverse ? a : b);
  }
  views(d, "LeanIX");
  if (skipped.size) d.report.push(`Fact sheet types not imported: ${[...skipped].map(([k, n]) => `${k} (${n})`).join(", ")}`);
  return d.patch(`LeanIX: ${d.elements.size} fact sheet(s), ${d.relationships.size} relation(s)`);
}

/** Ardoq component types are user-defined, so they are mapped by keyword. */
function ardoqType(name: string): Mapped | undefined {
  const n = name.toLowerCase();
  if (/capabilit/.test(n)) return { type: "archimate:Capability" };
  if (/(application|system|service|software|app\b|microservice)/.test(n)) return { type: "archimate:ApplicationComponent" };
  if (/(interface|api|integration)/.test(n)) return { type: "archimate:ApplicationInterface" };
  if (/(data|entity|information|database)/.test(n)) return { type: "archimate:DataObject" };
  if (/(server|host|node|infrastructure|platform|cluster|vm\b)/.test(n)) return { type: "archimate:Node" };
  if (/(technology|component)/.test(n)) return { type: "archimate:SystemSoftware" };
  if (/(process|activity)/.test(n)) return { type: "archimate:Process", domain: "Business" };
  if (/(person|people|team|organi[sz]ation|department|unit|vendor|supplier)/.test(n)) return { type: "archimate:BusinessActor" };
  if (/(role|persona)/.test(n)) return { type: "archimate:Role", domain: "Business" };
  if (/(goal|objective)/.test(n)) return { type: "archimate:Goal" };
  if (/(project|initiative|epic)/.test(n)) return { type: "archimate:WorkPackage" };
  return undefined;
}

export function ardoqToPatch(files: ImportInput[]): ModelPatch {
  const d = new Draft("ardoq");
  const skipped = new Map<string, number>();
  const refs: J[] = [];
  const comps: J[] = [];
  for (const f of files) {
    if (/\.csv$/i.test(f.name)) {
      const [head, ...rows] = csvRows(f.text);
      const col = (re: RegExp) => head?.findIndex((h) => re.test(h.trim())) ?? -1;
      const [ci, cn, ct, cd, cp, cs, cg] = [col(/^(_id|id|ardoq id)$/i), col(/^name$/i), col(/^(type|component type)$/i), col(/^description$/i), col(/^parent/i), col(/^source/i), col(/^target/i)];
      if (cs >= 0 && cg >= 0) for (const r of rows) refs.push({ source: r[cs], target: r[cg], type: ct >= 0 ? r[ct] : undefined });
      else for (const r of rows) comps.push({ _id: ci >= 0 ? r[ci] : r[cn], name: r[cn], type: r[ct], description: cd >= 0 ? r[cd] : undefined, parent: cp >= 0 ? r[cp] || undefined : undefined });
      continue;
    }
    for (const doc of docs(f, d.report)) {
      const list = (Array.isArray(doc.values) ? doc.values : Array.isArray(doc) ? doc : []) as J[];
      for (const x of list) (x.source && x.target ? refs : comps).push(x);
    }
  }
  for (const c of comps) {
    const typeName = String(c.type ?? c.typeName ?? c.componentType ?? "");
    const t = ardoqType(typeName);
    if (!t) {
      skipped.set(typeName || "(no type)", (skipped.get(typeName || "(no type)") ?? 0) + 1);
      continue;
    }
    d.element(`ardoq:${c._id ?? c.id}`, t.type, String(c.name), { ...(c.description ? { description: String(c.description) } : {}), properties: { ardoqType: typeName, ...(t.domain ? { domain: t.domain } : {}) } });
  }
  // Ardoq lets components nest; keep nesting where both ends were imported.
  const byName = new Map([...d.elements.values()].map((e) => [e.name.toLowerCase(), e]));
  for (const c of comps) {
    const e = d.elements.get(`ardoq:${c._id ?? c.id}`);
    const p = c.parent && (d.elements.get(`ardoq:${c.parent}`) ?? byName.get(String(c.parent).toLowerCase()));
    if (e && p && p !== e) {
      if (p.type === e.type) e.parent = p.id;
      else d.relate("archimate:Composition", p, e);
    }
  }
  for (const r of refs) {
    const a = d.elements.get(`ardoq:${r.source}`) ?? byName.get(String(r.source).toLowerCase());
    const b = d.elements.get(`ardoq:${r.target}`) ?? byName.get(String(r.target).toLowerCase());
    if (!a || !b) continue;
    const label = String(r.displayText ?? r.type ?? "").trim();
    const type = /depends|uses|calls|consumes/i.test(label) ? "archimate:Serving" : /realiz|implements|supports/i.test(label) ? "archimate:Realization" : /flow|sends|integrat/i.test(label) ? "archimate:Flow" : "archimate:Association";
    if (type === "archimate:Serving") d.relate(type, b, a, label ? { label } : {});
    else d.relate(type, a, b, label ? { label } : {});
  }
  views(d, "Ardoq");
  if (skipped.size) d.report.push(`Component types not recognised (rename them or map by hand): ${[...skipped].map(([k, n]) => `${k} (${n})`).join(", ")}`);
  return d.patch(`Ardoq: ${d.elements.size} component(s), ${d.relationships.size} reference(s)`);
}

/** Sparx EA UML elements and how they read in ArchiMate. */
const UML: Record<string, Mapped> = {
  "uml:Component": { type: "archimate:ApplicationComponent" },
  "uml:Interface": { type: "archimate:ApplicationInterface" },
  "uml:Node": { type: "archimate:Node" },
  "uml:Device": { type: "archimate:Device" },
  "uml:ExecutionEnvironment": { type: "archimate:SystemSoftware" },
  "uml:Artifact": { type: "archimate:Artifact" },
  "uml:Actor": { type: "archimate:BusinessActor" },
  "uml:Class": { type: "archimate:DataObject" },
  "uml:Activity": { type: "archimate:Process", domain: "Business" },
};

export function sparxToPatch(files: ImportInput[]): ModelPatch {
  const d = new Draft("sparx");
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", isArray: (n) => ["packagedElement", "ownedAttribute", "generalization", "interfaceRealization", "nestedClassifier"].includes(n) });
  const skipped = new Map<string, number>();
  const links: { kind: string; client: string; supplier: string; name?: string }[] = [];
  let packages = 0;
  const walk = (node: J, parent?: string) => {
    for (const el of (node.packagedElement ?? []) as J[]) {
      const t = String(el["@xmi:type"] ?? "");
      const id = String(el["@xmi:id"] ?? "");
      if (t === "uml:Package" || t === "uml:Model") {
        packages++;
        const g = d.element(`sparx:${id}`, "archimate:Grouping", String(el["@name"] ?? "Package"), parent ? { parent } : {});
        walk(el, g.id);
        continue;
      }
      if (["uml:Dependency", "uml:Usage", "uml:Realization", "uml:Abstraction", "uml:InformationFlow"].includes(t)) {
        links.push({ kind: t, client: String(el["@client"] ?? el["@informationSource"] ?? ""), supplier: String(el["@supplier"] ?? el["@informationTarget"] ?? ""), name: el["@name"] });
        continue;
      }
      if (t === "uml:Association") {
        const ends = String(el["@memberEnd"] ?? "").split(/\s+/);
        if (ends.length === 2) links.push({ kind: t, client: ends[0], supplier: ends[1], name: el["@name"] });
        continue;
      }
      const m = UML[t];
      if (!m) {
        if (t) skipped.set(t, (skipped.get(t) ?? 0) + 1);
        continue;
      }
      const e = d.element(`sparx:${id}`, m.type, String(el["@name"] ?? "Unnamed"), { ...(parent ? { parent } : {}), properties: { umlType: t.slice(4), ...(m.domain ? { domain: m.domain } : {}), ...(el["@stereotype"] ? { stereotype: el["@stereotype"] } : {}) } });
      const doc = el.ownedComment?.["@body"] ?? el.ownedComment?.body;
      if (typeof doc === "string" && doc.trim()) e.description = doc.trim();
      for (const g of (el.generalization ?? []) as J[]) links.push({ kind: "uml:Generalization", client: id, supplier: String(g["@general"] ?? "") });
      for (const r of (el.interfaceRealization ?? []) as J[]) links.push({ kind: "uml:Realization", client: id, supplier: String(r["@supplier"] ?? r["@contract"] ?? "") });
      // Association ends point at owned attributes; remember which element owns each.
      for (const a of (el.ownedAttribute ?? []) as J[]) if (a["@association"]) ends.set(String(a["@xmi:id"]), { owner: id, type: String(a["@type"] ?? "") });
    }
  };
  const ends = new Map<string, { owner: string; type: string }>();
  for (const f of files) {
    let xml: J;
    try {
      xml = parser.parse(f.text);
    } catch (e) {
      d.report.push(`${f.name}: not XML (${e instanceof Error ? e.message : e})`);
      continue;
    }
    const root = xml["xmi:XMI"] ?? xml.XMI ?? xml;
    const model = root["uml:Model"] ?? root.Model ?? root;
    walk(Array.isArray(model) ? model[0] : model);
  }
  const resolve = (ref: string) => d.elements.get(`sparx:${ref}`) ?? (ends.has(ref) ? d.elements.get(`sparx:${ends.get(ref)!.type}`) : undefined);
  for (const l of links) {
    let a = resolve(l.client), b = resolve(l.supplier);
    if (l.kind === "uml:Association" && ends.has(l.client) && ends.has(l.supplier)) (a = d.elements.get(`sparx:${ends.get(l.client)!.owner}`)), (b = d.elements.get(`sparx:${ends.get(l.supplier)!.owner}`));
    if (!a || !b || a.type === "archimate:Grouping" || b.type === "archimate:Grouping") continue;
    const extra = l.name ? { label: String(l.name) } : {};
    if (l.kind === "uml:Generalization") d.relate("archimate:Specialization", a, b);
    else if (l.kind === "uml:Realization" || l.kind === "uml:Abstraction") d.relate("archimate:Realization", a, b, extra);
    else if (l.kind === "uml:InformationFlow") d.relate("archimate:Flow", a, b, extra);
    else if (l.kind === "uml:Association") d.relate("archimate:Association", a, b, extra);
    // "A depends on / uses B" reads in ArchiMate as "B serves A".
    else d.relate("archimate:Serving", b, a, extra);
  }
  views(d, "Sparx EA");
  if (skipped.size) d.report.push(`UML element types not imported: ${[...skipped].map(([k, n]) => `${k.slice(4)} (${n})`).join(", ")}`);
  return d.patch(`Sparx EA: ${d.elements.size - packages} element(s) in ${packages} package(s), ${d.relationships.size} relationship(s)`);
}

function views(d: Draft, source: string) {
  const els = [...d.elements.values()];
  const has = (re: RegExp) => els.some((e) => re.test(e.type));
  if (has(/ApplicationComponent|ApplicationInterface|DataObject/)) d.view("archimate", "archimate:application", `${source} – applications (imported)`, (e) => /Application|DataObject|Grouping/.test(e.type));
  if (has(/Capability/)) d.view("archimate", "archimate:capability-map", `${source} – capabilities (imported)`, (e) => /Capability|ApplicationComponent/.test(e.type));
  if (has(/Node|Device|SystemSoftware|Artifact/)) d.view("archimate", "archimate:technology", `${source} – technology (imported)`, (e) => /Node|Device|SystemSoftware|Artifact|ApplicationComponent/.test(e.type));
}
