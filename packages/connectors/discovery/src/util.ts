import { parseAllDocuments } from "yaml";
import { makeElement, makeRelationship, makeView, type Element, type ImportInput, type ModelPatch, type Relationship, type View } from "@vastitecture/plugin-sdk";

 
export type J = Record<string, any>;

/** Parse YAML or JSON, including multi-document YAML streams. Unparseable files are reported, not fatal. */
export function docs(file: ImportInput, report: string[]): J[] {
  try {
    if (/^\s*[[{]/.test(file.text)) return [JSON.parse(file.text)].flat();
    return parseAllDocuments(file.text)
      .map((d) => {
        if (d.errors.length) throw d.errors[0];
        return d.toJS();
      })
      .filter((d) => d && typeof d === "object");
  } catch (e) {
    report.push(`${file.name}: could not be read (${e instanceof Error ? e.message.split("\n")[0] : e})`);
    return [];
  }
}

/**
 * Builds a draft patch. Every element carries a stable `externalId`, so running the connector again
 * updates the same elements instead of adding duplicates.
 */
export class Draft {
  elements = new Map<string, Element>();
  relationships = new Map<string, Relationship>();
  report: string[] = [];
  constructor(public source: string) {}

  element(externalId: string, type: string, name: string, extra: Partial<Element> = {}): Element {
    const cur = this.elements.get(externalId);
    if (cur) {
      for (const [k, v] of Object.entries(extra)) if (v !== undefined && (cur as J)[k] === undefined) (cur as J)[k] = v;
      if (extra.properties) cur.properties = { ...extra.properties, ...cur.properties };
      return cur;
    }
    const e = makeElement(type, name, extra);
    e.properties = { ...e.properties, externalId, discoveredBy: this.source };
    this.elements.set(externalId, e);
    return e;
  }

  relate(type: string, source: Element, target: Element, extra: Partial<Relationship> = {}): Relationship | undefined {
    if (source.id === target.id) return undefined;
    // One relationship per type and direction: the first label found wins.
    const key = `${type}|${source.id}|${target.id}`;
    if (this.relationships.has(key)) return this.relationships.get(key);
    const r = makeRelationship(type, source.id, target.id, extra);
    this.relationships.set(key, r);
    return r;
  }

  views: View[] = [];

  /**
   * A draft view of some of the discovered elements, nested by containment. `placedIn` overrides
   * nesting for this view only (e.g. a container drawn inside the deployment node it runs on).
   */
  view(notation: string, viewpoint: string, name: string, include: (e: Element) => boolean, placedIn?: (e: Element) => string | undefined, subject?: Element) {
    const els = [...this.elements.values()].filter(include);
    if (!els.length) return;
    const ids = new Set(els.map((e) => e.id));
    const size = (e: Element): [number, number] => (e.type === "c4:DeploymentNode" ? [340, 220] : e.type === "c4:SoftwareSystem" ? [220, 120] : e.type === "c4:Person" ? [150, 150] : [190, 100]);
    const v = makeView(notation, name, { viewpoint, ...(subject ? { subject: subject.id } : {}) });
    v.nodes = els.map((e) => {
      const p = placedIn?.(e) ?? e.parent;
      const [w, h] = size(e);
      return { element: e.id, x: 0, y: 0, w, h, ...(p && ids.has(p) ? { parent: p } : {}) };
    });
    v.edges = [...this.relationships.values()].filter((r) => ids.has(r.source) && ids.has(r.target) && r.type.startsWith(notation + ":")).map((r) => ({ relationship: r.id }));
    this.views.push(v);
  }

  /** Element id for an external id (for placement links such as deployedIn). */
  idOf(externalId: unknown) {
    return typeof externalId === "string" ? this.elements.get(externalId)?.id : undefined;
  }

  patch(summary: string): ModelPatch {
    return {
      elements: [...this.elements.values()],
      relationships: [...this.relationships.values()],
      views: this.views,
      layout: this.views.map((v) => v.id),
      report: [summary, ...this.report],
    };
  }
}

export const titleCase = (s: string) => s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

