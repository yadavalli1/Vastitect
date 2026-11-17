import { definePlugin, type ElementTypeDef, type NotationPack, type RelationshipTypeDef, type Validity, type ViewpointDef } from "@vastitecture/plugin-sdk";
import elementsJson from "../../../../packs/archimate/elements.json";
import relationshipsJson from "../../../../packs/archimate/relationships.json";
import viewpointsJson from "../../../../packs/archimate/viewpoints.json";
import validityJson from "../../../../packs/archimate/validity.json";
import migrationJson from "../../../../packs/archimate/migration-3-to-4.json";

export interface ArchimateData {
  elements: { domains: Record<string, string>; elements: { id: string; name: string; domain: string; aspect: string; shape: string; icon?: string; size?: number[] }[]; verified?: boolean };
  relationships: { relationships: (RelationshipTypeDef & { id: string })[]; verified?: boolean };
  viewpoints: { viewpoints: { id: string; name: string; elements?: string[] }[] };
  validity: { mode: string; note?: string; table?: unknown; rules?: unknown };
}

const ALWAYS = ["archimate:Grouping", "archimate:Junction"];
const DOMAIN_OPTIONS = ["Business", "Application", "Technology", "Implementation"];

/** Build the pack purely from the JSON data files: nothing about the language lives in code. */
export function buildPack(data: ArchimateData): NotationPack {
  const elementTypes: ElementTypeDef[] = data.elements.elements.map((e) => ({
    id: e.id,
    name: e.name,
    category: e.domain,
    shape: e.shape as ElementTypeDef["shape"],
    fill: e.aspect === "connector" ? "#334155" : data.elements.domains[e.domain],
    icon: e.icon || undefined,
    size: (e.size as [number, number] | undefined) ?? (e.shape === "group" ? [300, 200] : [150, 65]),
    container: e.shape === "group" ? true : undefined,
    nestable: e.aspect !== "connector",
    // Elements merged into the Common Domain remember which domain they are used in.
    properties:
      e.domain === "Common" && e.aspect !== "composite" && e.aspect !== "connector"
        ? [{ key: "domain", label: "Domain", type: "enum", options: DOMAIN_OPTIONS }]
        : e.aspect === "connector"
          ? [{ key: "junctionType", label: "Junction type", type: "enum", options: ["and", "or"] }]
          : undefined,
    variants:
      e.domain === "Common" && e.aspect !== "composite" && e.aspect !== "connector"
        ? [{ property: "domain", values: Object.fromEntries(DOMAIN_OPTIONS.map((d) => [d, { fill: data.elements.domains[d] }])) }]
        : undefined,
  }));
  const byDomain = (d: string) => data.elements.elements.filter((e) => e.domain === d).map((e) => e.id);
  const viewpoints: ViewpointDef[] = data.viewpoints.viewpoints.map((v) => ({
    id: v.id,
    name: v.name,
    elementTypes: v.elements ? [...new Set([...v.elements.flatMap((x) => (x.startsWith("domain:") ? byDomain(x.slice(7)) : [x])), ...ALWAYS])] : undefined,
  }));
  const v = data.validity;
  const unverified = data.elements.verified === false ? " The element list is unverified against the ArchiMate 4 specification (see packs/archimate/elements.json)." : "";
  const validity: Validity =
    v.mode === "table" ? { mode: "table", table: v.table as never } : v.mode === "rules" ? { mode: "rules", rules: v.rules as never } : { mode: "permissive", note: (v.note ?? "") + unverified };
  return {
    id: "archimate",
    name: "ArchiMate 4",
    description: "ArchiMate® 4 elements, relationships and viewpoints, loaded from packs/archimate.",
    elementTypes,
    relationshipTypes: data.relationships.relationships,
    viewpoints,
    validity,
    defaultRelationship: "archimate:Association",
  };
}

export const pack = buildPack({ elements: elementsJson, relationships: relationshipsJson as never, viewpoints: viewpointsJson, validity: validityJson });

interface Rule {
  to: string;
  domain?: string;
  note?: string;
}
const rename = migrationJson.rename as Record<string, Rule>;
const removed = migrationJson.removed as Record<string, Rule>;
const junctions = migrationJson.junctions as Record<string, string>;
const known = new Set(pack.elementTypes.map((t) => t.id));

export interface Migrated {
  type: string;
  properties: Record<string, string>;
  /** Set when the concept was changed by the migration. */
  change?: { kind: "merged" | "removed"; from: string; to: string; note?: string };
  unknown?: boolean;
}

/** Map an ArchiMate 3.x element type name to ArchiMate 4. The original type is kept so 3.x exports are lossless. */
export function migrateElementType(type3: string): Migrated {
  if (junctions[type3]) return { type: "archimate:Junction", properties: { junctionType: junctions[type3] } };
  const r = removed[type3];
  if (r) return { type: r.to, properties: { archimate3Type: type3, ...(r.domain ? { domain: r.domain } : {}) }, change: { kind: "removed", from: type3, to: r.to, note: r.note } };
  const m = rename[type3];
  if (m) return { type: m.to, properties: { ...(m.domain ? { domain: m.domain } : {}) }, change: { kind: "merged", from: type3, to: m.to } };
  const id = "archimate:" + type3;
  return known.has(id) ? { type: id, properties: {} } : { type: id, properties: {}, unknown: true };
}

/** The ArchiMate 3.x type name for an ArchiMate 4 element, for the exchange format. */
export function toArchimate3Type(type4: string, properties: Record<string, unknown>): string {
  if (typeof properties.archimate3Type === "string") return properties.archimate3Type;
  const local = type4.replace(/^archimate:/, "");
  if (local === "Junction") return properties.junctionType === "or" ? "OrJunction" : "AndJunction";
  const domain = typeof properties.domain === "string" ? properties.domain : "Business";
  const hit = Object.entries(rename).find(([, r]) => r.to === type4 && r.domain === domain) ?? Object.entries(rename).find(([, r]) => r.to === type4);
  return hit ? hit[0] : local;
}

export const relationshipTypeIds = new Set(pack.relationshipTypes.map((r) => r.id));

export default definePlugin({
  manifest: { id: "vastitecture.archimate", name: "ArchiMate 4", version: "0.1.0", apiVersion: "1.0.0", capabilities: ["notation"] },
  activate(ctx) {
    ctx.notations.register(pack);
  },
});
