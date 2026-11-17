import {
  impliedRelationships,
  makeElement,
  makeRelationship,
  makeView,
  presentationType,
  validate,
  type Element,
  type Id,
  type ModelPatch,
  type Registry,
  type Relationship,
  type View,
  type Workspace,
} from "@vastitecture/core";

/** Any OpenAI-compatible chat completions endpoint: OpenAI, LiteLLM, Ollama, vLLM, LM Studio, … */
export interface AiConfig {
  /** Base URL up to and including /v1, e.g. http://localhost:11434/v1 */
  baseUrl: string;
  model: string;
  apiKey?: string;
  temperature?: number;
}

export type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; text: string }>;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class AiError extends Error {}

export async function chat(cfg: AiConfig, messages: ChatMessage[], fetcher: Fetcher, json = false): Promise<string> {
  const url = cfg.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const res = await fetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
    body: JSON.stringify({ model: cfg.model, messages, temperature: cfg.temperature ?? 0.2, ...(json ? { response_format: { type: "json_object" } } : {}) }),
  });
  if (res.status === 401 || res.status === 403) throw new AiError("The endpoint rejected the API key");
  if (res.status >= 400) throw new AiError(`The endpoint returned HTTP ${res.status}: ${res.text.slice(0, 200)}`);
  let body: { choices?: { message?: { content?: string } }[] };
  try {
    body = JSON.parse(res.text);
  } catch {
    throw new AiError("The endpoint did not return JSON. Is the base URL an OpenAI-compatible /v1 address?");
  }
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new AiError("The response had no message content");
  return content;
}

/** Pull the first JSON object out of a reply, tolerating code fences and surrounding prose. */
export function extractJson(text: string): Record<string, unknown> {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const src = fenced ? fenced[1] : text;
  const start = src.indexOf("{");
  if (start < 0) throw new AiError("The model's answer contained no JSON object");
  let depth = 0;
  let inStr = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(src.slice(start, i + 1));
      } catch (e) {
        throw new AiError(`The model's JSON could not be read: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  throw new AiError("The model's JSON was incomplete");
}

/** The vocabulary the model may use: element and relationship types of the enabled notations. */
function vocabulary(reg: Registry, notations: string[]) {
  const packs = notations.map((n) => reg.packs.get(n)).filter((p) => p && p.elementTypes.length) as NonNullable<ReturnType<Registry["packs"]["get"]>>[];
  return {
    elementTypes: packs.flatMap((p) => p.elementTypes.map((t) => `${t.id} (${t.name})`)),
    relationshipTypes: packs.flatMap((p) => p.relationshipTypes.map((t) => `${t.id} (${t.name})`)),
    elementIds: new Set(packs.flatMap((p) => p.elementTypes.map((t) => t.id))),
    relationshipIds: new Set(packs.flatMap((p) => p.relationshipTypes.map((t) => t.id))),
  };
}

const SYSTEM = `You are an enterprise architecture assistant inside a modelling tool. You answer with compact, accurate content.
When asked for model changes you reply with ONE JSON object and nothing else. Never invent type ids: use only the ids you are given.`;

/** Model a description of a system. Existing elements are referred to by name and reused, never duplicated. */
export async function draftModel(cfg: AiConfig, fetcher: Fetcher, ws: Workspace, reg: Registry, opts: { text: string; notation: string; viewName?: string }): Promise<ModelPatch> {
  const vocab = vocabulary(reg, [opts.notation]);
  const existing = Object.values(ws.elements).slice(0, 300).map((e) => `${e.name} [${e.type}]`);
  const prompt = `Model the following as ${reg.packs.get(opts.notation)?.name ?? opts.notation}.

Allowed element types:
${vocab.elementTypes.join("\n")}

Allowed relationship types:
${vocab.relationshipTypes.join("\n")}

Elements that already exist (reuse them by exact name instead of creating duplicates):
${existing.join("\n") || "(none)"}

Reply with JSON of this shape:
{"elements":[{"name":"…","type":"<type id>","description":"…","parent":"<name of containing element, optional>"}],
 "relationships":[{"source":"<element name>","target":"<element name>","type":"<type id>","label":"…","technology":"optional"}]}

Text to model:
"""
${opts.text.slice(0, 20000)}
"""`;
  const reply = extractJson(await chat(cfg, [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }], fetcher, true));
  return toPatch(ws, reply, vocab, { notation: opts.notation, viewName: opts.viewName ?? "Drafted by the assistant", reg });
}

/** Suggest relationships that are probably missing between elements of a view. */
export async function suggestRelationships(cfg: AiConfig, fetcher: Fetcher, ws: Workspace, reg: Registry, viewId: Id): Promise<ModelPatch> {
  const view = ws.views[viewId];
  const vocab = vocabulary(reg, [view.notation]);
  const lines = describeView(ws, reg, view);
  const prompt = `Here is a ${reg.packs.get(view.notation)?.name ?? view.notation} view.

${lines}

Which relationships between THESE elements are probably missing? Only suggest ones you are fairly confident about, at most 10.
Allowed relationship types:
${vocab.relationshipTypes.join("\n")}

Reply with JSON: {"relationships":[{"source":"<element name>","target":"<element name>","type":"<type id>","label":"…","reason":"…"}]}`;
  const reply = extractJson(await chat(cfg, [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }], fetcher, true));
  const patch = toPatch(ws, { relationships: reply.relationships ?? [] }, vocab, { notation: view.notation, reg, onlyExisting: true });
  // Show the suggestions in the view they were made for.
  patch.views = [{ ...view, edges: [...view.edges, ...(patch.relationships ?? []).map((r) => ({ relationship: r.id }))] }];
  return patch;
}

/** Explain a view in plain language. Returns Markdown. */
export async function explainView(cfg: AiConfig, fetcher: Fetcher, ws: Workspace, reg: Registry, viewId: Id): Promise<string> {
  const view = ws.views[viewId];
  return chat(cfg, [
    { role: "system", content: SYSTEM },
    { role: "user", content: `Explain this architecture view to a new team member in a few short paragraphs: what it shows, the main flows, and anything that looks risky or unclear.\n\n${describeView(ws, reg, view)}` },
  ], fetcher);
}

/** Review the model against the built-in validation rules and general good practice. Returns Markdown. */
export async function reviewModel(cfg: AiConfig, fetcher: Fetcher, ws: Workspace, reg: Registry): Promise<string> {
  const problems = validate(ws, reg).filter((p) => p.severity !== "info").slice(0, 80).map((p) => `- [${p.severity}] ${p.message}`);
  const summary = Object.values(ws.elements).slice(0, 200).map((e) => `- ${e.name} (${reg.elementType(e.type)?.name ?? e.type})${e.owner ? `, owner ${e.owner}` : ", no owner"}${e.lifecycle?.phase ? `, ${e.lifecycle.phase}` : ""}`);
  return chat(cfg, [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `Review this architecture model. The tool's validator reported:\n${problems.join("\n") || "- no problems"}\n\nElements:\n${summary.join("\n")}\n\nGive the five most important improvements, each with a one-line reason. Group related validator findings instead of repeating them.`,
    },
  ], fetcher);
}

function describeView(ws: Workspace, reg: Registry, view: View): string {
  const els = view.nodes.map((n) => ws.elements[n.element]).filter(Boolean);
  const type = (e: Element) => reg.elementType(presentationType(ws, e, view.notation, reg) ?? e.type)?.name ?? e.type;
  const rels = view.edges.map((e) => ws.relationships[e.relationship]).filter(Boolean);
  const implied = impliedRelationships(ws, view, reg);
  return [
    `View "${view.name}"${view.description ? `: ${view.description}` : ""}`,
    "Elements:",
    ...els.map((e) => `- ${e.name} (${type(e)})${e.description ? `: ${e.description}` : ""}${e.parent && ws.elements[e.parent] ? ` [inside ${ws.elements[e.parent].name}]` : ""}`),
    "Relationships:",
    ...rels.map((r) => `- ${ws.elements[r.source]?.name} -> ${ws.elements[r.target]?.name}: ${reg.relationshipType(r.type)?.name ?? r.type}${r.label ? ` "${r.label}"` : ""}${r.technology ? ` [${r.technology}]` : ""}`),
    ...implied.map((i) => `- ${ws.elements[i.source]?.name} -> ${ws.elements[i.target]?.name}: implied by ${i.via.length} lower-level relationship(s)`),
  ].join("\n");
}

interface RawEl {
  name?: unknown;
  type?: unknown;
  description?: unknown;
  parent?: unknown;
}
interface RawRel {
  source?: unknown;
  target?: unknown;
  type?: unknown;
  label?: unknown;
  technology?: unknown;
  reason?: unknown;
}

/** Turn the model's JSON into a patch, dropping anything that uses unknown types or names, and say what was dropped. */
export function toPatch(
  ws: Workspace,
  reply: Record<string, unknown>,
  vocab: { elementIds: Set<string>; relationshipIds: Set<string> },
  opts: { notation: string; viewName?: string; reg: Registry; onlyExisting?: boolean },
): ModelPatch {
  const report: string[] = [];
  const byName = new Map<string, Element>();
  for (const e of Object.values(ws.elements)) if (!byName.has(e.name.toLowerCase())) byName.set(e.name.toLowerCase(), e);
  const created: Element[] = [];
  const rawEls = (Array.isArray(reply.elements) ? reply.elements : []) as RawEl[];
  for (const r of rawEls) {
    const name = typeof r.name === "string" ? r.name.trim() : "";
    const type = typeof r.type === "string" ? r.type.replace(/\s*\(.*\)$/, "").trim() : "";
    if (!name) continue;
    if (byName.has(name.toLowerCase())) continue;
    if (!vocab.elementIds.has(type)) {
      report.push(`Skipped "${name}": unknown type ${type || "(none)"}`);
      continue;
    }
    const e = makeElement(type, name, typeof r.description === "string" && r.description ? { description: r.description } : {});
    e.properties.source = "assistant";
    created.push(e);
    byName.set(name.toLowerCase(), e);
  }
  for (const r of rawEls) {
    const e = typeof r.name === "string" ? byName.get(r.name.trim().toLowerCase()) : undefined;
    const p = typeof r.parent === "string" ? byName.get(r.parent.trim().toLowerCase()) : undefined;
    if (e && p && p !== e && created.includes(e)) e.parent = p.id;
  }
  const rels: Relationship[] = [];
  for (const r of (Array.isArray(reply.relationships) ? reply.relationships : []) as RawRel[]) {
    const s = typeof r.source === "string" ? byName.get(r.source.trim().toLowerCase()) : undefined;
    const t = typeof r.target === "string" ? byName.get(r.target.trim().toLowerCase()) : undefined;
    const type = typeof r.type === "string" ? r.type.replace(/\s*\(.*\)$/, "").trim() : "";
    if (!s || !t) {
      report.push(`Skipped a relationship: "${String(r.source)}" or "${String(r.target)}" is not an element`);
      continue;
    }
    if (!vocab.relationshipIds.has(type)) {
      report.push(`Skipped ${s.name} → ${t.name}: unknown relationship type ${type || "(none)"}`);
      continue;
    }
    if (Object.values(ws.relationships).some((x) => x.source === s.id && x.target === t.id && x.type === type)) continue;
    const rel = makeRelationship(type, s.id, t.id, {
      ...(typeof r.label === "string" && r.label ? { label: r.label } : {}),
      ...(typeof r.technology === "string" && r.technology ? { technology: r.technology } : {}),
    });
    if (typeof r.reason === "string" && r.reason) {
      rel.properties.reason = r.reason;
      report.push(`${s.name} → ${t.name}: ${r.reason}`);
    }
    rels.push(rel);
  }
  const patch: ModelPatch = { elements: created, relationships: rels, report: [`The assistant proposes ${created.length} element(s) and ${rels.length} relationship(s). Review before applying.`, ...report] };
  if (!opts.onlyExisting && (created.length || rels.length)) {
    const members = new Set<Id>([...created.map((e) => e.id), ...rels.flatMap((r) => [r.source, r.target])]);
    const ids = new Set(members);
    const view = makeView(opts.notation, opts.viewName ?? "Drafted by the assistant");
    view.nodes = [...members].map((id) => {
      const e = created.find((c) => c.id === id) ?? ws.elements[id];
      const [w, h] = opts.reg.elementType(presentationType(ws, e, opts.notation, opts.reg) ?? e.type)?.size ?? [160, 80];
      return { element: id, x: 0, y: 0, w, h, ...(e.parent && ids.has(e.parent) ? { parent: e.parent } : {}) };
    });
    view.edges = rels.map((r) => ({ relationship: r.id }));
    patch.views = [view];
    patch.layout = [view.id];
  }
  return patch;
}

/**
 * Translate a view into another notation without guessing: elements are presented through the
 * workspace mapping table, and each relationship is re-expressed with a rule for the target notation.
 * (Deterministic, so it also works with the assistant switched off.)
 */
export function translateView(ws: Workspace, reg: Registry, viewId: Id, notation: string, viewpoint?: string): ModelPatch {
  const src = ws.views[viewId];
  const report: string[] = [];
  const view = makeView(notation, `${src.name} (${reg.packs.get(notation)?.name ?? notation})`, { ...(viewpoint ? { viewpoint } : {}), ...(src.subject ? { subject: src.subject } : {}) });
  const placed = new Set<Id>();
  for (const n of src.nodes) {
    const e = ws.elements[n.element];
    if (!e) continue;
    const t = presentationType(ws, e, notation, reg);
    if (!t) {
      report.push(`"${e.name}" has no mapping to ${reg.packs.get(notation)?.name ?? notation} and was left out`);
      continue;
    }
    placed.add(e.id);
    const [w, h] = reg.elementType(t)?.size ?? [n.w, n.h];
    view.nodes.push({ element: e.id, x: n.x, y: n.y, w, h, ...(n.parent ? { parent: n.parent } : {}) });
  }
  for (const n of view.nodes) if (n.parent && !placed.has(n.parent)) delete n.parent;
  const relationships: Relationship[] = [];
  const pick = (source: Element, target: Element, preferred: string[]) => {
    const st = presentationType(ws, source, notation, reg)!, tt = presentationType(ws, target, notation, reg)!;
    const { types, strict } = reg.validRelationships(notation, st, tt, viewpoint);
    return preferred.find((p) => types.includes(p) || (!strict && reg.relationshipType(p))) ?? (strict ? types[0] : reg.packs.get(notation)?.defaultRelationship);
  };
  for (const ed of src.edges) {
    const r = ws.relationships[ed.relationship];
    if (!r || !placed.has(r.source) || !placed.has(r.target)) continue;
    if (r.type.startsWith(notation + ":")) {
      view.edges.push({ relationship: r.id });
      continue;
    }
    const s = ws.elements[r.source], t = ws.elements[r.target];
    // "A uses B" reads as "B serves A" in ArchiMate; other notations keep the direction.
    const dep = reg.relationshipType(r.type)?.dependency ?? "forward";
    const reverse = notation === "archimate" && dep === "forward";
    const [a, b] = reverse ? [t, s] : [s, t];
    const type = pick(a, b, notation === "archimate" ? ["archimate:Serving", "archimate:Flow", "archimate:Association"] : notation === "c4" ? ["c4:Uses"] : []);
    if (!type) {
      report.push(`${s.name} → ${t.name}: no ${notation} relationship type is valid between these elements`);
      continue;
    }
    const existing = Object.values(ws.relationships).find((x) => x.type === type && x.source === a.id && x.target === b.id);
    const rel = existing ?? makeRelationship(type, a.id, b.id, { ...(r.label ? { label: r.label } : {}), ...(r.technology ? { technology: r.technology } : {}), properties: { translatedFrom: r.id } });
    if (!existing) relationships.push(rel);
    view.edges.push({ relationship: rel.id });
  }
  report.unshift(`${view.nodes.length} element(s) and ${view.edges.length} relationship(s) in the translated view; ${relationships.length} new ${notation} relationship(s).`);
  return { relationships, views: [view], report };
}
