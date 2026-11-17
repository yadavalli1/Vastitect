import { XMLParser } from "fast-xml-parser";
import type { Element, ModelPatch, Relationship } from "@vastitecture/plugin-sdk";
import { migrateElementType, relationshipTypeIds } from "@vastitecture/notation-archimate";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type X = Record<string, any>;

export function parseXml(text: string, arrays: string[]): X {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    textNodeName: "#text",
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: false,
    htmlEntities: true,
    isArray: (name) => arrays.includes(name),
  }).parse(text);
}

export const text = (v: any): string | undefined => {
  if (v === undefined || v === null) return undefined;
  const first = Array.isArray(v) ? v[0] : v;
  const s = typeof first === "object" ? first["#text"] : first;
  return s === undefined ? undefined : String(s).trim() || undefined;
};

export const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Collects migration changes so the importer can report every one of them. */
export class Migration {
  changes: string[] = [];
  merged = new Map<string, number>();
  unknown = new Map<string, number>();

  element(el: Element, type3: string): Element {
    const m = migrateElementType(type3);
    el.type = m.type;
    Object.assign(el.properties, m.properties);
    if (m.unknown) this.unknown.set(type3, (this.unknown.get(type3) ?? 0) + 1);
    if (m.change?.kind === "removed") this.changes.push(`"${el.name}": ${m.change.from} → ${m.change.to.replace("archimate:", "")}. ${m.change.note ?? ""}`.trim());
    else if (m.change) {
      const key = `${m.change.from} → ${m.change.to.replace("archimate:", "")}`;
      this.merged.set(key, (this.merged.get(key) ?? 0) + 1);
    }
    return el;
  }

  relationshipType(type3: string): string | undefined {
    const id = "archimate:" + type3.replace(/Relationship$/, "");
    return relationshipTypeIds.has(id) ? id : undefined;
  }

  report(patch: ModelPatch, source: string, extra: string[]): string[] {
    const out = [`${source}: ${patch.elements?.length ?? 0} elements, ${patch.relationships?.length ?? 0} relationships, ${patch.views?.length ?? 0} views, migrated to ArchiMate 4`];
    for (const [k, n] of [...this.merged].sort()) out.push(`Merged into the Common Domain: ${k} (${n} element${n > 1 ? "s" : ""}, original domain kept in the Domain property)`);
    out.push(...this.changes.map((c) => `Removed concept: ${c}`));
    for (const [k, n] of this.unknown) out.push(`Unknown element type ${k} (${n}) was kept as-is`);
    out.push(...extra);
    if (!this.merged.size && !this.changes.length) out.push("No ArchiMate 3.x concepts needed migration");
    return out;
  }
}

export function accessLabel(r: Relationship, accessType: string | undefined) {
  if (accessType) r.properties.accessType = accessType;
}
