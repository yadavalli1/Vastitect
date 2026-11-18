import { makeElement, makeRelationship, makeView, type Annotation, type Element, type Id, type ModelPatch, type Relationship, type View, type Workspace } from "@vastitecture/plugin-sdk";
import { toArchimate3Type } from "@vastitecture/notation-archimate";
import { Migration, esc, parseXml, text, type X } from "./common";

/** Import an ArchiMate Model Exchange File Format document (3.x), migrating it to ArchiMate 4. */
export function parseExchange(xml: string): ModelPatch {
  const doc = parseXml(xml, ["element", "relationship", "view", "node", "connection", "property", "propertyDefinition", "bendpoint", "item"]);
  const model: X = doc.model;
  if (!model) throw new Error("Not an ArchiMate exchange file: no <model> root element");
  const mig = new Migration();
  const extra: string[] = [];
  const propNames = new Map<string, string>();
  for (const d of model.propertyDefinitions?.propertyDefinition ?? []) propNames.set(d["@identifier"], text(d.name) ?? d["@identifier"]);
  const props = (x: X): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const p of x.properties?.property ?? []) out[propNames.get(p["@propertyDefinitionRef"]) ?? p["@propertyDefinitionRef"]] = text(p.value) ?? "";
    return out;
  };

  const elements: Element[] = [];
  const ids = new Set<Id>();
  for (const e of model.elements?.element ?? []) {
    const el = makeElement("", text(e.name) ?? "", { id: e["@identifier"], properties: props(e) });
    const doc = text(e.documentation);
    if (doc) el.description = doc;
    mig.element(el, e["@xsi:type"]);
    elements.push(el);
    ids.add(el.id);
  }

  const relationships: Relationship[] = [];
  const relIds = new Set<Id>();
  let skippedRels = 0;
  for (const r of model.relationships?.relationship ?? []) {
    const type = mig.relationshipType(r["@xsi:type"]);
    if (!type || !ids.has(r["@source"]) || !ids.has(r["@target"])) {
      skippedRels++;
      continue;
    }
    const rel = makeRelationship(type, r["@source"], r["@target"], { id: r["@identifier"], properties: props(r) });
    const name = text(r.name);
    if (name) rel.label = name;
    if (r["@accessType"]) rel.properties.accessType = r["@accessType"];
    if (r["@modifier"]) rel.properties.modifier = r["@modifier"];
    if (r["@isDirected"]) rel.properties.isDirected = r["@isDirected"];
    const doc = text(r.documentation);
    if (doc) rel.properties.documentation = doc;
    relationships.push(rel);
    relIds.add(rel.id);
  }
  if (skippedRels) extra.push(`${skippedRels} relationship(s) skipped: they connect to another relationship or to a missing element`);

  const views: View[] = [];
  let duplicates = 0;
  for (const v of model.views?.diagrams?.view ?? []) {
    const view = makeView("archimate", text(v.name) ?? "View", { id: v["@identifier"], properties: props(v) });
    const doc = text(v.documentation);
    if (doc) view.description = doc;
    if (v["@viewpoint"]) view.properties.viewpointName = v["@viewpoint"];
    const nodeElement = new Map<string, Id>();
    const walk = (nodes: X[], parent: { el?: Id; x: number; y: number }) => {
      for (const n of nodes) {
        const x = Number(n["@x"] ?? 0), y = Number(n["@y"] ?? 0), w = Number(n["@w"] ?? 120), h = Number(n["@h"] ?? 55);
        const kind = n["@xsi:type"];
        if (kind === "Element" && ids.has(n["@elementRef"])) {
          const el = n["@elementRef"] as Id;
          nodeElement.set(n["@identifier"], el);
          if (view.nodes.some((k) => k.element === el)) duplicates++;
          else view.nodes.push({ element: el, x: x - parent.x, y: y - parent.y, w, h, ...(parent.el ? { parent: parent.el } : {}) });
          walk(n.node ?? [], { el, x, y });
        } else {
          const ann: Annotation = { id: n["@identifier"], kind: kind === "Container" ? "group" : "note", x, y, w, h };
          const label = text(n.label);
          if (label) ann.text = label;
          view.annotations.push(ann);
          // annotations cannot be parents, so their children keep absolute positions
          walk(n.node ?? [], { el: undefined, x: 0, y: 0 });
        }
      }
    };
    walk(v.node ?? [], { x: 0, y: 0 });
    for (const c of v.connection ?? []) {
      const rel = c["@relationshipRef"];
      if (!rel || !relIds.has(rel) || view.edges.some((e) => e.relationship === rel)) continue;
      const waypoints = (c.bendpoint ?? []).map((b: X) => ({ x: Number(b["@x"]), y: Number(b["@y"]) }));
      view.edges.push({ relationship: rel, ...(waypoints.length ? { waypoints } : {}) });
    }
    views.push(view);
  }
  if (duplicates) extra.push(`${duplicates} repeated placement(s) of an element within one view were merged: a view shows each element once`);
  if (model.organizations) extra.push("Folder organisation is not imported; views are grouped by notation and viewpoint instead");
  const patch: ModelPatch = { elements, relationships, views };
  patch.report = mig.report(patch, `Model "${text(model.name) ?? ""}" (exchange format)`, extra);
  return patch;
}

export interface ExchangeOptions {
  /** How an element is presented in ArchiMate (own type, facet or mapping table). */
  typeOf(el: Element): string | undefined;
}

/** Export as ArchiMate Model Exchange File Format 3.x, the version every ArchiMate tool reads. */
export function writeExchange(ws: Workspace, opts: ExchangeOptions): string {
  const type = new Map<Id, string>();
  for (const e of Object.values(ws.elements)) {
    const t = opts.typeOf(e);
    if (t) type.set(e.id, t);
  }
  const xid = (id: string) => (/^[A-Za-z_]/.test(id) ? id : "id-" + id);
  const HIDDEN = new Set(["archimate3Type", "domain", "junctionType", "accessType", "modifier", "isDirected", "documentation"]);
  const defs = new Map<string, string>();
  const propId = (name: string) => defs.get(name) ?? (defs.set(name, `propid-${defs.size + 1}`), defs.get(name)!);
  const out: string[] = [];
  const props = (p: Record<string, unknown>, indent: string) => {
    const entries = Object.entries(p).filter(([k, v]) => !HIDDEN.has(k) && v !== null && typeof v !== "object").sort(([a], [b]) => a.localeCompare(b));
    if (!entries.length) return;
    out.push(`${indent}<properties>`);
    for (const [k, v] of entries) out.push(`${indent}  <property propertyDefinitionRef="${propId(k)}">`, `${indent}    <value xml:lang="en">${esc(v)}</value>`, `${indent}  </property>`);
    out.push(`${indent}</properties>`);
  };
  const body: string[] = [];
  const emit = (fn: () => void) => {
    const start = out.length;
    fn();
    body.push(...out.splice(start));
  };

  const els = Object.values(ws.elements).filter((e) => type.has(e.id)).sort((a, b) => a.id.localeCompare(b.id));
  emit(() => {
    out.push("  <elements>");
    for (const e of els) {
      out.push(`    <element identifier="${esc(xid(e.id))}" xsi:type="${esc(toArchimate3Type(type.get(e.id)!, e.properties))}">`, `      <name xml:lang="en">${esc(e.name)}</name>`);
      if (e.description) out.push(`      <documentation xml:lang="en">${esc(e.description)}</documentation>`);
      props(e.properties, "      ");
      out.push("    </element>");
    }
    out.push("  </elements>");
  });
  const rels = Object.values(ws.relationships).filter((r) => r.type.startsWith("archimate:") && type.has(r.source) && type.has(r.target)).sort((a, b) => a.id.localeCompare(b.id));
  const relSet = new Set(rels.map((r) => r.id));
  if (rels.length)
    emit(() => {
      out.push("  <relationships>");
      for (const r of rels) {
        const attrs = [`identifier="${esc(xid(r.id))}"`, `source="${esc(xid(r.source))}"`, `target="${esc(xid(r.target))}"`, `xsi:type="${esc(r.type.slice(10))}"`];
        for (const k of ["accessType", "modifier", "isDirected"]) if (r.properties[k] !== undefined) attrs.push(`${k}="${esc(r.properties[k])}"`);
        const inner = out.length;
        out.push(`    <relationship ${attrs.join(" ")}>`);
        if (r.label) out.push(`      <name xml:lang="en">${esc(r.label)}</name>`);
        if (r.properties.documentation) out.push(`      <documentation xml:lang="en">${esc(r.properties.documentation)}</documentation>`);
        props(r.properties, "      ");
        if (out.length === inner + 1) out[inner] = `    <relationship ${attrs.join(" ")} />`;
        else out.push("    </relationship>");
      }
      out.push("  </relationships>");
    });

  const views = Object.values(ws.views).filter((v) => v.notation === "archimate").sort((a, b) => a.id.localeCompare(b.id));
  if (views.length)
    emit(() => {
      out.push("  <views>", "    <diagrams>");
      for (const v of views) {
        out.push(`      <view identifier="${esc(xid(v.id))}" xsi:type="Diagram">`, `        <name xml:lang="en">${esc(v.name)}</name>`);
        if (v.description) out.push(`        <documentation xml:lang="en">${esc(v.description)}</documentation>`);
        props(Object.fromEntries(Object.entries(v.properties).filter(([k]) => k !== "viewpointName" && k !== "showImplied")), "        ");
        const nodeId = (el: Id) => `n-${xid(v.id)}-${xid(el)}`.replace(/[^\w.-]/g, "_");
        const kids = new Map<Id | undefined, typeof v.nodes>();
        for (const n of v.nodes) {
          if (!type.has(n.element)) continue;
          const p = n.parent && v.nodes.some((k) => k.element === n.parent) && type.has(n.parent) ? n.parent : undefined;
          kids.set(p, [...(kids.get(p) ?? []), n]);
        }
        const write = (parent: Id | undefined, ox: number, oy: number, indent: string) => {
          for (const n of (kids.get(parent) ?? []).sort((a, b) => a.element.localeCompare(b.element))) {
            const x = Math.round(ox + n.x), y = Math.round(oy + n.y);
            const head = `${indent}<node identifier="${esc(nodeId(n.element))}" elementRef="${esc(xid(n.element))}" xsi:type="Element" x="${x}" y="${y}" w="${Math.round(n.w)}" h="${Math.round(n.h)}"`;
            if (kids.has(n.element)) {
              out.push(head + ">");
              write(n.element, x, y, indent + "  ");
              out.push(`${indent}</node>`);
            } else out.push(head + " />");
          }
        };
        for (const a of [...v.annotations].sort((x, y) => x.id.localeCompare(y.id))) {
          out.push(`        <node identifier="${esc(xid(a.id))}" xsi:type="${a.kind === "group" ? "Container" : "Label"}" x="${Math.round(a.x)}" y="${Math.round(a.y)}" w="${Math.round(a.w)}" h="${Math.round(a.h)}">`);
          if (a.text) out.push(`          <label xml:lang="en">${esc(a.text)}</label>`);
          out.push("        </node>");
        }
        write(undefined, 0, 0, "        ");
        const placed = new Set(v.nodes.filter((n) => type.has(n.element)).map((n) => n.element));
        for (const e of [...v.edges].sort((a, b) => a.relationship.localeCompare(b.relationship))) {
          const r = ws.relationships[e.relationship];
          if (!r || !relSet.has(r.id) || !placed.has(r.source) || !placed.has(r.target)) continue;
          const head = `        <connection identifier="${esc(`c-${xid(v.id)}-${xid(r.id)}`.replace(/[^\w.-]/g, "_"))}" relationshipRef="${esc(xid(r.id))}" xsi:type="Relationship" source="${esc(nodeId(r.source))}" target="${esc(nodeId(r.target))}"`;
          if (e.waypoints?.length) {
            out.push(head + ">");
            for (const p of e.waypoints) out.push(`          <bendpoint x="${Math.round(p.x)}" y="${Math.round(p.y)}" />`);
            out.push("        </connection>");
          } else out.push(head + " />");
        }
        out.push("      </view>");
      }
      out.push("    </diagrams>", "  </views>");
    });

  const head = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.opengroup.org/xsd/archimate/3.0/ http://www.opengroup.org/xsd/archimate/3.1/archimate3_Diagram.xsd" identifier="${esc(xid("model-" + ws.name.replace(/\W+/g, "-")))}">`,
    `  <name xml:lang="en">${esc(ws.name)}</name>`,
  ];
  // Schema order: elements, relationships, organizations, propertyDefinitions, views.
  const viewsAt = body.indexOf("  <views>");
  const before = viewsAt >= 0 ? body.slice(0, viewsAt) : body;
  const after = viewsAt >= 0 ? body.slice(viewsAt) : [];
  const defsXml = defs.size
    ? ["  <propertyDefinitions>", ...[...defs].flatMap(([name, id]) => [`    <propertyDefinition identifier="${id}" type="string">`, `      <name>${esc(name)}</name>`, "    </propertyDefinition>"]), "  </propertyDefinitions>"]
    : [];
  return [...head, ...before, ...defsXml, ...after, "</model>", ""].join("\n");
}
