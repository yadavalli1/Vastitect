import { makeView, presentationType, validate, type Adr, type Element, type Id, type ModelPatch, type Registry, type Workspace } from "@vastitecture/core";
import { chat, extractJson, toPatch, type AiConfig, type ChatMessage, type Fetcher } from "./index";

/**
 * The assistant chat beside the canvas. Every turn is answered as JSON with a Markdown answer and,
 * optionally, proposed changes. Changes come back as a ModelPatch for the review dialog: the chat itself
 * never writes to the model.
 */
export interface ChatContext {
  /** The view the user is looking at; new elements are added to it. */
  viewId?: Id;
  /** Selected elements, to resolve "this", "these" and "it". */
  selection?: Id[];
}
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}
export interface ChatReply {
  answer: string;
  patch?: ModelPatch;
}

const SYSTEM = `You are the architecture assistant inside a modelling tool. You see the user's model as text.
Answer questions ONLY from the model you are given; if the model does not contain the answer, say so plainly.
When the user asks for a change, propose it; the user reviews every change before it is applied.
Always reply with ONE JSON object:
{"answer":"<Markdown for the user, short>",
 "changes":null | {
   "elements":[{"name":"…","type":"<type id>","description":"…","parent":"<existing or new element name, optional>"}],
   "relationships":[{"source":"<name>","target":"<name>","type":"<type id>","label":"…","technology":"optional"}],
   "updates":[{"name":"<existing element name>","rename":"optional new name","description":"optional","owner":"optional","lifecycle":"plan|phaseIn|active|phaseOut|endOfLife (optional)","tags":["optional"],"properties":{"optional":"values"}}],
   "remove":["<existing element name>"]}}
Use only the type ids listed. Refer to existing elements by their exact names.`;

const MAX_ELEMENTS = 400;

/** A compact text form of the model for the prompt. Large models are trimmed to the view and the selection's neighbourhood. */
export function describeModel(ws: Workspace, reg: Registry, ctx: ChatContext = {}): string {
  const view = ctx.viewId ? ws.views[ctx.viewId] : undefined;
  const focus = new Set<Id>([...(ctx.selection ?? []), ...(view?.nodes.map((n) => n.element) ?? [])]);
  for (const r of Object.values(ws.relationships)) if (focus.has(r.source) || focus.has(r.target)) focus.add(r.source).add(r.target);
  const all = Object.values(ws.elements);
  const els = all.length <= MAX_ELEMENTS ? all : [...all.filter((e) => focus.has(e.id)), ...all.filter((e) => !focus.has(e.id))].slice(0, MAX_ELEMENTS);
  const shown = new Set(els.map((e) => e.id));
  const typeName = (e: Element) => reg.elementType(e.type)?.name ?? e.type;
  const line = (e: Element) =>
    [
      `- ${e.name} [${typeName(e)}]`,
      e.parent && ws.elements[e.parent] ? ` in ${ws.elements[e.parent].name}` : "",
      e.owner ? ` owner: ${e.owner}` : "",
      e.lifecycle?.phase ? ` lifecycle: ${e.lifecycle.phase}${e.lifecycle.dates ? ` ${JSON.stringify(e.lifecycle.dates)}` : ""}` : "",
      e.tags.length ? ` tags: ${e.tags.join(", ")}` : "",
      Object.keys(e.properties).filter((k) => !["externalId", "discoveredBy", "source"].includes(k)).length
        ? ` ${Object.entries(e.properties).filter(([k]) => !["externalId", "discoveredBy", "source"].includes(k)).slice(0, 6).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" ")}`
        : "",
      e.description ? ` — ${e.description.slice(0, 160)}` : "",
    ].join("");
  const rels = Object.values(ws.relationships).filter((r) => shown.has(r.source) && shown.has(r.target));
  const problems = validate(ws, reg).filter((p) => p.severity !== "info").slice(0, 30);
  const adrs = Object.values(ws.adrs).slice(0, 30);
  return [
    `Workspace "${ws.name}": ${all.length} elements, ${Object.keys(ws.relationships).length} relationships, ${Object.keys(ws.views).length} views${all.length > MAX_ELEMENTS ? ` (showing ${MAX_ELEMENTS} most relevant elements)` : ""}.`,
    "Elements:",
    ...els.map(line),
    "Relationships:",
    ...rels.slice(0, 800).map((r) => `- ${ws.elements[r.source].name} -> ${ws.elements[r.target].name} [${reg.relationshipType(r.type)?.name ?? r.type}]${r.label ? ` "${r.label}"` : ""}${r.technology ? ` (${r.technology})` : ""}`),
    `Views: ${Object.values(ws.views).map((v) => v.name).join("; ")}`,
    adrs.length ? `Decisions (ADRs): ${adrs.map((a) => `${a.id} "${a.title}" (${a.status})`).join("; ")}` : "",
    problems.length ? `Validator findings:\n${problems.map((p) => `- ${p.message}`).join("\n")}` : "",
    view ? `The user is looking at view "${view.name}" (${reg.packs.get(view.notation)?.name ?? view.notation}).` : "",
    ctx.selection?.length ? `Selected: ${ctx.selection.map((id) => ws.elements[id]?.name).filter(Boolean).join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function vocabFor(reg: Registry, ws: Workspace, ctx: ChatContext) {
  const view = ctx.viewId ? ws.views[ctx.viewId] : undefined;
  const notations = view ? [view.notation] : ws.packs.length ? ws.packs : [...reg.packs.keys()];
  const packs = notations.map((n) => reg.packs.get(n)).filter((p) => p && p.elementTypes.length) as NonNullable<ReturnType<Registry["packs"]["get"]>>[];
  return {
    text: `Element types: ${packs.flatMap((p) => p.elementTypes.map((t) => `${t.id} (${t.name})`)).join(", ")}\nRelationship types: ${packs.flatMap((p) => p.relationshipTypes.map((t) => `${t.id} (${t.name})`)).join(", ")}`,
    elementIds: new Set(packs.flatMap((p) => p.elementTypes.map((t) => t.id))),
    relationshipIds: new Set(packs.flatMap((p) => p.relationshipTypes.map((t) => t.id))),
    notation: view?.notation ?? packs[0]?.id ?? "generic",
  };
}

const PHASES = new Set(["plan", "phaseIn", "active", "phaseOut", "endOfLife"]);

export async function chatTurn(cfg: AiConfig, fetcher: Fetcher, ws: Workspace, reg: Registry, history: ChatTurn[], message: string, ctx: ChatContext = {}): Promise<ChatReply> {
  const vocab = vocabFor(reg, ws, ctx);
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "system", content: `${vocab.text}\n\nThe model:\n${describeModel(ws, reg, ctx)}` },
    ...history.slice(-12).map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: message.slice(0, 20000) },
  ];
  const raw = await chat(cfg, messages, fetcher, true);
  let reply: Record<string, unknown>;
  try {
    reply = extractJson(raw);
  } catch {
    // Models without JSON mode sometimes answer in prose: show it, propose nothing.
    return { answer: raw.trim() };
  }
  const answer = typeof reply.answer === "string" ? reply.answer : "";
  const changes = reply.changes && typeof reply.changes === "object" ? (reply.changes as Record<string, unknown>) : undefined;
  if (!changes) return { answer };
  const patch = changesToPatch(ws, reg, changes, vocab, ctx);
  const empty = !patch.elements?.length && !patch.relationships?.length && !patch.removeElements?.length;
  if (!empty) return { answer, patch };
  // Nothing usable was proposed: say why instead of opening an empty review.
  const why = patch.report!.slice(1);
  return { answer: why.length ? `${answer}\n\n${why.map((r) => `- ${r}`).join("\n")}` : answer };
}

/** Additions go through the same checks as drafting; updates and removals only touch elements that exist. */
export function changesToPatch(ws: Workspace, reg: Registry, changes: Record<string, unknown>, vocab: { elementIds: Set<string>; relationshipIds: Set<string>; notation: string }, ctx: ChatContext = {}): ModelPatch {
  const added = toPatch(ws, { elements: changes.elements ?? [], relationships: changes.relationships ?? [] }, vocab, { notation: vocab.notation, reg, onlyExisting: true });
  const report = [...(added.report ?? []).slice(1)];
  const byName = new Map(Object.values(ws.elements).map((e) => [e.name.toLowerCase(), e]));
  const updated: Element[] = [];
  for (const u of (Array.isArray(changes.updates) ? changes.updates : []) as Record<string, unknown>[]) {
    const cur = typeof u.name === "string" ? byName.get(u.name.trim().toLowerCase()) : undefined;
    if (!cur) {
      report.push(`Skipped an update: "${String(u.name)}" is not an element`);
      continue;
    }
    const next: Element = structuredClone(cur);
    if (typeof u.rename === "string" && u.rename.trim()) next.name = u.rename.trim();
    if (typeof u.description === "string") next.description = u.description;
    if (typeof u.owner === "string") next.owner = u.owner;
    if (typeof u.lifecycle === "string" && PHASES.has(u.lifecycle)) next.lifecycle = { ...next.lifecycle, phase: u.lifecycle as NonNullable<Element["lifecycle"]>["phase"] };
    if (Array.isArray(u.tags)) next.tags = [...new Set(u.tags.map(String))];
    if (u.properties && typeof u.properties === "object") next.properties = { ...next.properties, ...(u.properties as Element["properties"]) };
    if (JSON.stringify(next) !== JSON.stringify(cur)) updated.push(next);
  }
  const removeElements: Id[] = [];
  for (const n of (Array.isArray(changes.remove) ? changes.remove : []) as unknown[]) {
    const cur = typeof n === "string" ? byName.get(n.trim().toLowerCase()) : undefined;
    if (cur) removeElements.push(cur.id);
    else report.push(`Skipped a removal: "${String(n)}" is not an element`);
  }
  const patch: ModelPatch = {
    elements: [...(added.elements ?? []), ...updated],
    relationships: added.relationships ?? [],
    ...(removeElements.length ? { removeElements } : {}),
    report: [`The assistant proposes ${added.elements?.length ?? 0} new element(s), ${added.relationships?.length ?? 0} relationship(s), ${updated.length} update(s) and ${removeElements.length} removal(s). Review before applying.`, ...report],
  };
  // New things appear in the view the user is looking at.
  const view = ctx.viewId ? ws.views[ctx.viewId] : undefined;
  const fresh = added.elements ?? [];
  if (view && (fresh.length || patch.relationships!.length)) {
    const placed = new Set(view.nodes.map((n) => n.element));
    const need = new Set<Id>(fresh.map((e) => e.id));
    for (const r of patch.relationships!) for (const id of [r.source, r.target]) if (!placed.has(id)) need.add(id);
    const lookup = (id: Id) => fresh.find((e) => e.id === id) ?? ws.elements[id];
    const nodes = [...need].map((id, i) => {
      const e = lookup(id);
      const [w, h] = reg.elementType(presentationType(ws, e, view.notation, reg) ?? e.type)?.size ?? [160, 80];
      const maxX = Math.max(0, ...view.nodes.map((n) => n.x + n.w));
      return { element: id, x: maxX + 60 + (i % 3) * (w + 40), y: Math.floor(i / 3) * (h + 40), w, h, ...(e.parent && (placed.has(e.parent) || need.has(e.parent)) ? { parent: e.parent } : {}) };
    });
    patch.views = [{ ...view, nodes: [...view.nodes, ...nodes], edges: [...view.edges, ...patch.relationships!.map((r) => ({ relationship: r.id }))] }];
  } else if (!view && fresh.length) {
    const v = makeView(vocab.notation, "From the assistant chat");
    v.nodes = fresh.map((e) => ({ element: e.id, x: 0, y: 0, w: 160, h: 80 }));
    v.edges = patch.relationships!.map((r) => ({ relationship: r.id }));
    patch.views = [v];
    patch.layout = [v.id];
  }
  return patch;
}

/** Draft an Architecture Decision Record about the selected elements, for review before it is saved. */
export async function draftAdr(cfg: AiConfig, fetcher: Fetcher, ws: Workspace, reg: Registry, opts: { elements: Id[]; topic: string; today: string }): Promise<ModelPatch> {
  const names = opts.elements.map((id) => ws.elements[id]?.name).filter(Boolean);
  const raw = await chat(
    cfg,
    [
      { role: "system", content: SYSTEM },
      { role: "system", content: `The model:\n${describeModel(ws, reg, { selection: opts.elements })}` },
      {
        role: "user",
        content: `Draft an Architecture Decision Record (Michael Nygard format: Context, Decision, Consequences, plus Options considered) about: ${opts.topic || "the selected elements"}.
It concerns: ${names.join(", ") || "the model as a whole"}. Base it on the model; mark anything you had to assume with "(assumption)".
Reply with JSON: {"title":"…","body":"<Markdown with ## Context, ## Options considered, ## Decision, ## Consequences>"}`,
      },
    ],
    fetcher,
    true,
  );
  const reply = extractJson(raw);
  const n = Math.max(0, ...Object.keys(ws.adrs).map((k) => Number(k) || 0)) + 1;
  const adr: Adr = {
    id: String(n).padStart(4, "0"),
    title: typeof reply.title === "string" && reply.title.trim() ? reply.title.trim() : opts.topic || "Untitled decision",
    status: "proposed",
    date: opts.today,
    elements: opts.elements.filter((id) => ws.elements[id]),
    body: typeof reply.body === "string" ? reply.body : "",
  };
  return { adrs: [adr], report: [`The assistant drafted ${adr.id} "${adr.title}" with status "proposed". Review it, then edit it on the Decisions page.`] };
}
