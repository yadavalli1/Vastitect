import { makeElement, makeRelationship, makeView, type Annotation, type Element, type Id, type ModelPatch, type Relationship, type View } from "@vastitecture/plugin-sdk";
import { Migration, parseXml, text, type X } from "./common";

/** Import an Archi native model (.archimate), including its diagrams, and migrate it to ArchiMate 4. */
export function parseArchi(xml: string): ModelPatch {
  const doc = parseXml(xml, ["folder", "element", "child", "sourceConnection", "property", "bendpoint", "feature"]);
  const model: X = doc["archimate:model"];
  if (!model) throw new Error("Not an Archi model: no <archimate:model> root element");
  const mig = new Migration();
  const extra: string[] = [];
  const elements: Element[] = [];
  const pendingRels: X[] = [];
  const diagrams: X[] = [];
  const ids = new Set<Id>();
  let otherDiagrams = 0;

  const props = (x: X) => Object.fromEntries((x.property ?? []).filter((p: X) => p["@key"]).map((p: X) => [p["@key"], String(p["@value"] ?? "")]));
  const walkFolders = (folder: X) => {
    for (const e of folder.element ?? []) {
      const t = String(e["@xsi:type"] ?? "").replace(/^archimate:/, "");
      if (t === "ArchimateDiagramModel") diagrams.push(e);
      else if (t.endsWith("DiagramModel") || t === "SketchModel" || t === "CanvasModel") otherDiagrams++;
      else if (t.endsWith("Relationship")) pendingRels.push(e);
      else {
        const el = makeElement("", e["@name"] ?? "", { id: e["@id"], properties: props(e) });
        const d = text(e.documentation);
        if (d) el.description = d;
        // Archi stores both junction kinds as "Junction" with a type attribute.
        mig.element(el, t === "Junction" ? (e["@type"] === "or" ? "OrJunction" : "AndJunction") : t);
        elements.push(el);
        ids.add(el.id);
      }
    }
    for (const f of folder.folder ?? []) walkFolders(f);
  };
  walkFolders(model);

  const relationships: Relationship[] = [];
  const relIds = new Set<Id>();
  let skipped = 0;
  for (const r of pendingRels) {
    const type = mig.relationshipType(String(r["@xsi:type"]).replace(/^archimate:/, ""));
    if (!type || !ids.has(r["@source"]) || !ids.has(r["@target"])) {
      skipped++;
      continue;
    }
    const rel = makeRelationship(type, r["@source"], r["@target"], { id: r["@id"], properties: props(r) });
    if (r["@name"]) rel.label = r["@name"];
    if (r["@accessType"] !== undefined) rel.properties.accessType = { "1": "Read", "2": "Access", "3": "ReadWrite" }[String(r["@accessType"])] ?? "Write";
    else if (type === "archimate:Access") rel.properties.accessType = "Write";
    if (r["@strength"]) rel.properties.modifier = r["@strength"];
    if (r["@directed"] === "true") rel.properties.isDirected = "true";
    const d = text(r.documentation);
    if (d) rel.properties.documentation = d;
    relationships.push(rel);
    relIds.add(rel.id);
  }
  if (skipped) extra.push(`${skipped} relationship(s) skipped: they connect to another relationship or to a missing element`);

  const views: View[] = [];
  let duplicates = 0;
  let references = 0;
  for (const d of diagrams) {
    const view = makeView("archimate", d["@name"] ?? "View", { id: d["@id"], properties: props(d) });
    const docu = text(d.documentation);
    if (docu) view.description = docu;
    const connections: X[] = [];
    const walk = (children: X[], parent: { el?: Id; x: number; y: number }) => {
      for (const c of children) {
        const t = String(c["@xsi:type"]).replace(/^archimate:/, "");
        const b = c.bounds ?? {};
        const x = Number(b["@x"] ?? 0), y = Number(b["@y"] ?? 0), w = Number(b["@width"] ?? 120), h = Number(b["@height"] ?? 55);
        connections.push(...(c.sourceConnection ?? []));
        if (t === "DiagramObject" && ids.has(c["@archimateElement"])) {
          const el = c["@archimateElement"] as Id;
          const first = !view.nodes.some((k) => k.element === el);
          if (first) view.nodes.push({ element: el, x: parent.el ? x : parent.x + x, y: parent.el ? y : parent.y + y, w, h, ...(parent.el ? { parent: parent.el } : {}) });
          else duplicates++;
          // Archi bounds are relative to the parent, which is exactly how nested nodes are stored here.
          walk(c.child ?? [], { el, x: 0, y: 0 });
        } else if (t === "DiagramModelReference") {
          references++;
        } else {
          const ann: Annotation = { id: c["@id"], kind: t === "Group" ? "group" : "note", x: parent.x + x, y: parent.y + y, w, h };
          const label = c["@name"] ?? text(c.content) ?? (c.feature ?? []).find((f: X) => f["@name"] === "labelExpression")?.["@value"];
          if (label) ann.text = String(label).replace(/\r\n?/g, "\n").replace(/\$view\{name\}/g, view.name);
          if (!parent.el) view.annotations.push(ann);
          // Children of a visual group are positioned relative to it; annotations cannot be parents, so make them absolute.
          walk(c.child ?? [], { el: undefined, x: parent.x + x, y: parent.y + y });
        }
      }
    };
    walk(d.child ?? [], { x: 0, y: 0 });
    for (const c of connections) {
      const rel = c["@archimateRelationship"];
      if (rel && relIds.has(rel) && !view.edges.some((e) => e.relationship === rel)) view.edges.push({ relationship: rel });
    }
    views.push(view);
  }
  if (duplicates) extra.push(`${duplicates} repeated placement(s) of an element within one view were merged: a view shows each element once`);
  if (references) extra.push(`${references} link(s) from one diagram to another were not imported`);
  if (otherDiagrams) extra.push(`${otherDiagrams} sketch or canvas diagram(s) were not imported`);
  extra.push("Connection bend points and visual styles are not imported from Archi files; folders are not imported");
  const patch: ModelPatch = { elements, relationships, views };
  patch.report = mig.report(patch, `Archi model "${model["@name"] ?? ""}"`, extra);
  return patch;
}
