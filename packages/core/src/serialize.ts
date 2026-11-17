import { stringify } from "yaml";
import { load, JSON_SCHEMA } from "js-yaml";

/** Reading uses js-yaml (several times faster on thousands of small files); writing uses yaml for stable output. */
const parse = (text: string): unknown => load(text, { schema: JSON_SCHEMA });
import {
  AdrSchema,
  ElementSchema,
  RelationshipSchema,
  SettingsSchema,
  ViewSchema,
  localName,
  packOf,
  type Adr,
  type Element,
  type Id,
  type Relationship,
  type View,
  type Workspace,
} from "./model";

export const SETTINGS_FILE = "vastitecture.yaml";
export const RELATIONSHIPS_FILE = "model/relationships.yaml";

export type FileMap = Record<string, string>;
/** Remembers which file each entity lives in so renames do not move files. */
export type PathIndex = Record<string, string>;

export const slugify = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "unnamed";

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[^A-Za-z0-9]+/g, "-").toLowerCase();

const isEmpty = (v: unknown) =>
  v === undefined ||
  v === null ||
  v === "" ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);

const sortKeys = (o: Record<string, unknown> | undefined): Record<string, unknown> | undefined =>
  o ? Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : o;

/** Build an object with keys in canonical order, dropping empty values. */
function ordered(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (!isEmpty(obj[k])) out[k] = obj[k];
  return out;
}

const toYaml = (v: unknown) => stringify(v, { lineWidth: 0, indent: 2, aliasDuplicateObjects: false });
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const round = (n: number) => Math.round(n);

function elementDoc(e: Element) {
  return ordered(
    {
      ...e,
      tags: [...e.tags].sort(),
      properties: sortKeys(e.properties),
      facets: sortKeys(e.facets as Record<string, unknown> | undefined),
      lifecycle: e.lifecycle ? ordered({ phase: e.lifecycle.phase, dates: sortKeys(e.lifecycle.dates) }, ["phase", "dates"]) : undefined,
    },
    ["id", "type", "name", "description", "parent", "owner", "lifecycle", "tags", "properties", "facets", "links"],
  );
}

function relationshipDoc(r: Relationship) {
  return ordered({ ...r, properties: sortKeys(r.properties) }, [
    "id",
    "type",
    "source",
    "target",
    "label",
    "technology",
    "multiplicity",
    "properties",
  ]);
}

function viewDoc(v: View) {
  return ordered(
    {
      ...v,
      properties: sortKeys(v.properties),
      nodes: [...v.nodes]
        .sort((a, b) => cmp(a.element, b.element))
        .map((n) =>
          ordered({ ...n, x: round(n.x), y: round(n.y), w: round(n.w), h: round(n.h), collapsed: n.collapsed || undefined, style: sortKeys(n.style) }, [
            "element",
            "x",
            "y",
            "w",
            "h",
            "parent",
            "collapsed",
            "style",
          ]),
        ),
      edges: [...v.edges]
        .sort((a, b) => cmp(a.relationship, b.relationship))
        .map((e) =>
          ordered(
            { ...e, hidden: e.hidden || undefined, waypoints: e.waypoints?.map((p) => ({ x: round(p.x), y: round(p.y) })), style: sortKeys(e.style) },
            ["relationship", "order", "waypoints", "hidden", "style"],
          ),
        ),
      annotations: [...v.annotations]
        .sort((a, b) => cmp(a.id, b.id))
        .map((a) =>
          ordered({ ...a, x: round(a.x), y: round(a.y), w: round(a.w), h: round(a.h), style: sortKeys(a.style) }, [
            "id",
            "kind",
            "x",
            "y",
            "w",
            "h",
            "text",
            "href",
            "style",
          ]),
        ),
    },
    ["id", "notation", "viewpoint", "name", "description", "subject", "properties", "nodes", "edges", "annotations"],
  );
}

function adrToMarkdown(a: Adr): string {
  const fm = ordered({ ...a, body: undefined }, ["id", "title", "status", "date", "elements"]);
  return `---\n${toYaml(fm)}---\n\n${a.body.trim()}\n`;
}

function adrFromMarkdown(text: string, path: string): Adr {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  const file = path.split("/").pop()!.replace(/\.md$/, "");
  const fm = (m ? parse(m[1]) : {}) ?? {};
  return AdrSchema.parse({ id: file.slice(0, 4), title: file.slice(5), ...fm, body: (m ? m[2] : text).trim() });
}

function unique(path: string, used: Set<string>, ext: string): string {
  let p = path + ext;
  for (let i = 2; used.has(p); i++) p = `${path}-${i}${ext}`;
  used.add(p);
  return p;
}

export const elementDir = (type: string) => `model/elements/${packOf(type)}/${kebab(localName(type))}/`;

/** Serialise a workspace to its on-disk files. Deterministic: same workspace and index give identical bytes. */
export function toFiles(ws: Workspace, index: PathIndex = {}): { files: FileMap; index: PathIndex } {
  const files: FileMap = {};
  const next: PathIndex = {};
  const used = new Set<string>();

  const settings = ordered(
    {
      format: ws.format,
      name: ws.name,
      packs: ws.packs,
      mappings: ws.mappings.map((m) => ordered({ ...m, members: sortKeys(m.members) }, ["concept", "label", "members"])),
      pluginSettings: sortKeys(ws.pluginSettings),
      savedFilters: ws.savedFilters,
    },
    ["format", "name", "packs", "mappings", "pluginSettings", "savedFilters"],
  );
  files[SETTINGS_FILE] = toYaml(settings);

  const place = (id: Id, dir: string, name: string, ext: string) => {
    const prev = index[id];
    if (prev && prev.startsWith(dir) && !used.has(prev)) {
      used.add(prev);
      return (next[id] = prev);
    }
    return (next[id] = unique(dir + slugify(name), used, ext));
  };

  // Entities that already have a file claim it first so new ones never steal a name.
  const known = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => Number(!!index[b.id]) - Number(!!index[a.id]) || cmp(a.id, b.id));

  for (const e of known(Object.values(ws.elements))) files[place(e.id, elementDir(e.type), e.name, ".yaml")] = toYaml(elementDoc(e));

  const rels = Object.values(ws.relationships).sort(
    (a, b) => cmp(a.source, b.source) || cmp(a.target, b.target) || cmp(a.type, b.type) || cmp(a.id, b.id),
  );
  files[RELATIONSHIPS_FILE] = rels.length ? toYaml(rels.map(relationshipDoc)) : "[]\n";

  for (const v of known(Object.values(ws.views))) files[place(v.id, `views/${v.notation}/`, v.name, ".yaml")] = toYaml(viewDoc(v));
  for (const a of known(Object.values(ws.adrs))) files[place("adr:" + a.id, "adrs/", `${a.id}-${a.title}`, ".md")] = adrToMarkdown(a);

  return { files, index: next };
}

export interface LoadIssue {
  path: string;
  message: string;
}

/** Parse on-disk files into a workspace. Bad files are reported, not fatal. */
export function fromFiles(files: FileMap): { workspace: Workspace; index: PathIndex; issues: LoadIssue[] } {
  const issues: LoadIssue[] = [];
  const index: PathIndex = {};
  const read = <T>(path: string, fn: (doc: unknown) => T, raw = false): T | undefined => {
    try {
      if (/^(<{7} |>{7} )/m.test(files[path])) throw new Error("File contains Git conflict markers");
      return fn(raw ? files[path] : parse(files[path]));
    } catch (err) {
      issues.push({ path, message: err instanceof Error ? err.message : String(err) });
      return undefined;
    }
  };

  const settings = (files[SETTINGS_FILE] !== undefined ? read(SETTINGS_FILE, (d) => SettingsSchema.parse(d)) : undefined) ??
    SettingsSchema.parse({ name: "Untitled" });
  const ws: Workspace = { ...settings, elements: {}, relationships: {}, views: {}, adrs: {} };

  for (const path of Object.keys(files).sort()) {
    if (path.startsWith("model/elements/") && path.endsWith(".yaml")) {
      const e = read(path, (d) => ElementSchema.parse(d));
      if (e) {
        ws.elements[e.id] = e;
        index[e.id] = path;
      }
    } else if (path === RELATIONSHIPS_FILE) {
      const rels = read(path, (d) => RelationshipSchema.array().parse(d ?? []));
      for (const r of rels ?? []) ws.relationships[r.id] = r;
    } else if (path.startsWith("views/") && path.endsWith(".yaml")) {
      const v = read(path, (d) => ViewSchema.parse(d));
      if (v) {
        ws.views[v.id] = v;
        index[v.id] = path;
      }
    } else if (path.startsWith("adrs/") && path.endsWith(".md")) {
      const a = read(path, () => adrFromMarkdown(files[path], path), true);
      if (a) {
        ws.adrs[a.id] = a;
        index["adr:" + a.id] = path;
      }
    }
  }
  return { workspace: ws, index, issues };
}

/** True for paths that belong to the workspace format (others are ignored by the watcher). */
export const isWorkspacePath = (p: string) =>
  p === SETTINGS_FILE || p === RELATIONSHIPS_FILE || /^(model\/elements|views)\/.+\.yaml$/.test(p) || /^adrs\/.+\.md$/.test(p);
