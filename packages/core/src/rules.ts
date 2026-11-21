import { z } from "zod";
import { stringify } from "yaml";
import { load } from "js-yaml";
import { LIFECYCLE_PHASES, type Element, type Id, type Workspace } from "./model";
import type { Problem } from "./registry";

/**
 * Architecture rules as data. They live in `vastitecture.yaml` under `rules:`, so they are reviewed in
 * pull requests like any other change, and the same engine runs in the app and in the command line.
 * Rules are declarative on purpose: no code is loaded or evaluated.
 */
const OneOrMany = z.union([z.string(), z.array(z.string())]);
export const SelectorSchema = z
  .object({
    /** Element type id; `c4:*` matches every type of a pack. */
    type: OneOrMany.optional(),
    tag: OneOrMany.optional(),
    lifecycle: z.union([z.enum(LIFECYCLE_PHASES), z.array(z.enum(LIFECYCLE_PHASES))]).optional(),
    /** Property values that must match exactly (compared as text). */
    property: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
    /** Regular expression on the name (case-insensitive). */
    name: z.string().optional(),
    owner: z.string().optional(),
  })
  .strict();
export type Selector = z.infer<typeof SelectorSchema>;

export const REQUIREMENTS = ["owner", "description", "lifecycle", "parent", "inView", "connected", "adr"] as const;
const Requirement = z.union([z.enum(REQUIREMENTS), z.string().regex(/^(property|tag|link):.+$/)]);

export const RuleSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes"),
    description: z.string().optional(),
    severity: z.enum(["error", "warning", "info"]).default("warning"),
    enabled: z.boolean().optional(),
    /** Which elements an element rule applies to. Omitted means every element. */
    match: SelectorSchema.optional(),
    require: z.array(Requirement).optional(),
    maxDependencies: z.number().int().nonnegative().optional(),
    maxDependents: z.number().int().nonnegative().optional(),
    /** A relationship rule: any relationship matching all of these is a violation. */
    forbid: z
      .object({
        from: SelectorSchema.optional(),
        to: SelectorSchema.optional(),
        type: OneOrMany.optional(),
        /** Only when source and target belong to different top-level elements (e.g. different systems). */
        acrossBoundaries: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((r) => r.forbid || r.require || r.maxDependencies !== undefined || r.maxDependents !== undefined, "a rule needs require, forbid, maxDependencies or maxDependents");
export type Rule = z.infer<typeof RuleSchema>;

const list = (v: string | string[] | undefined) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);
const typeMatches = (pattern: string, type: string) => (pattern.endsWith(":*") ? type.startsWith(pattern.slice(0, -1)) : pattern === type);

export function matches(e: Element, s: Selector | undefined): boolean {
  if (!s) return true;
  const types = list(s.type);
  if (types && !types.some((p) => typeMatches(p, e.type))) return false;
  const tags = list(s.tag);
  if (tags && !tags.some((t) => e.tags.includes(t))) return false;
  if (s.lifecycle) {
    const phases: string[] = Array.isArray(s.lifecycle) ? s.lifecycle : [s.lifecycle];
    if (!e.lifecycle?.phase || !phases.includes(e.lifecycle.phase)) return false;
  }
  for (const [k, v] of Object.entries(s.property ?? {})) if (String(e.properties[k] ?? "") !== String(v)) return false;
  if (s.name) {
    try {
      if (!new RegExp(s.name, "i").test(e.name)) return false;
    } catch {
      return false;
    }
  }
  if (s.owner !== undefined && (e.owner ?? "") !== s.owner) return false;
  return true;
}

export interface RuleResult {
  rule: Rule;
  checked: number;
  problems: Problem[];
}

/** Parse rules leniently: a broken rule becomes a problem instead of stopping the others. */
export function parseRules(raw: unknown): { rules: Rule[]; problems: Problem[] } {
  const rules: Rule[] = [];
  const problems: Problem[] = [];
  (Array.isArray(raw) ? raw : []).forEach((r, i) => {
    const parsed = RuleSchema.safeParse(r);
    if (parsed.success) rules.push(parsed.data);
    else
      problems.push({
        code: "rule-invalid",
        severity: "error",
        message: `Rule ${(r as { id?: string })?.id ?? `#${i + 1}`} in vastitecture.yaml is invalid: ${parsed.error.issues.map((x) => `${x.path.join(".") || "rule"} ${x.message}`).join("; ")}`,
        target: { kind: "workspace" },
      });
  });
  return { rules, problems };
}

function top(ws: Workspace, id: Id): Id {
  let cur = id;
  for (let i = 0; i < 64 && ws.elements[cur]?.parent && ws.elements[ws.elements[cur].parent!]; i++) cur = ws.elements[cur].parent!;
  return cur;
}

/** Evaluate every enabled rule. Problem codes are `rule:<id>` so they can be filtered and counted. */
export function checkRules(ws: Workspace, raw: unknown = ws.rules): RuleResult[] {
  const { rules } = parseRules(raw);
  const els = Object.values(ws.elements);
  const rels = Object.values(ws.relationships);
  const out = new Map<Id, number>();
  const inn = new Map<Id, number>();
  const connected = new Set<Id>();
  for (const r of rels) {
    out.set(r.source, (out.get(r.source) ?? 0) + 1);
    inn.set(r.target, (inn.get(r.target) ?? 0) + 1);
    connected.add(r.source).add(r.target);
  }
  const placed = new Set<Id>();
  for (const v of Object.values(ws.views)) for (const n of v.nodes) placed.add(n.element);
  const withAdr = new Set<Id>(Object.values(ws.adrs).flatMap((a) => a.elements));

  return rules
    .filter((r) => r.enabled !== false)
    .map((rule) => {
      const problems: Problem[] = [];
      const label = rule.description ?? rule.id;
      const add = (target: Problem["target"], detail: string) => problems.push({ code: `rule:${rule.id}`, severity: rule.severity, message: `${label}: ${detail}`, target });
      let checked = 0;
      if (rule.forbid) {
        const f = rule.forbid;
        const types = list(f.type);
        for (const r of rels) {
          const s = ws.elements[r.source], t = ws.elements[r.target];
          if (!s || !t) continue;
          if (types && !types.some((p) => typeMatches(p, r.type))) continue;
          if (!matches(s, f.from) || !matches(t, f.to)) continue;
          checked++;
          if (f.acrossBoundaries && top(ws, s.id) === top(ws, t.id)) continue;
          add({ kind: "relationship", id: r.id }, `"${s.name}" → "${t.name}"${r.label ? ` (${r.label})` : ""}`);
        }
      }
      if (rule.require || rule.maxDependencies !== undefined || rule.maxDependents !== undefined) {
        for (const e of els) {
          if (!matches(e, rule.match)) continue;
          checked++;
          const missing: string[] = [];
          for (const req of rule.require ?? []) {
            const [kind, arg] = req.includes(":") ? [req.slice(0, req.indexOf(":")), req.slice(req.indexOf(":") + 1)] : [req, ""];
            const ok =
              kind === "owner" ? !!e.owner?.trim()
              : kind === "description" ? !!e.description?.trim()
              : kind === "lifecycle" ? !!e.lifecycle?.phase
              : kind === "parent" ? !!e.parent
              : kind === "inView" ? placed.has(e.id)
              : kind === "connected" ? connected.has(e.id)
              : kind === "adr" ? withAdr.has(e.id)
              : kind === "property" ? e.properties[arg] !== undefined && String(e.properties[arg]).trim() !== ""
              : kind === "tag" ? e.tags.includes(arg)
              : kind === "link" ? e.links.some((l) => l.kind === arg)
              : true;
            if (!ok) missing.push(kind === "inView" ? "is in no view" : kind === "connected" ? "has no relationships" : `has no ${arg ? `${kind} "${arg}"` : kind}`);
          }
          if (rule.maxDependencies !== undefined && (out.get(e.id) ?? 0) > rule.maxDependencies) missing.push(`depends on ${out.get(e.id)} elements (limit ${rule.maxDependencies})`);
          if (rule.maxDependents !== undefined && (inn.get(e.id) ?? 0) > rule.maxDependents) missing.push(`is used by ${inn.get(e.id)} elements (limit ${rule.maxDependents})`);
          if (missing.length) add({ kind: "element", id: e.id }, `"${e.name}" ${missing.join(", ")}`);
        }
      }
      return { rule, checked, problems };
    });
}

/** Rule problems plus problems in the rules themselves, ready for the problems panel or the CLI. */
export function ruleProblems(ws: Workspace): Problem[] {
  return [...parseRules(ws.rules).problems, ...checkRules(ws).flatMap((r) => r.problems)];
}


/** Rules as the YAML users edit in the app (the same text as under `rules:` in vastitecture.yaml). */
export const rulesToYaml = (rules: unknown[]) => (rules.length ? stringify(rules, { lineWidth: 0, indent: 2 }) : "");
export function rulesFromYaml(text: string): unknown[] {
  const data = text.trim() ? load(text) : [];
  if (!Array.isArray(data)) throw new Error("Rules must be a YAML list (each rule starts with \"- id: …\")");
  return data;
}
