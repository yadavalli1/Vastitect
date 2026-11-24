import { useState } from "react";
import { draftModel, explainView, reviewModel, suggestRelationships, translateView } from "@vastitecture/ai";
import { markdownToHtml } from "@vastitecture/render";
import { aiConfig, aiFetch, useAiSettings } from "../ai";
import { model, registry, set, useApp, useModel, useRegistryVersion, openReview } from "../state";
import { t } from "../i18n";
import { Info, MessageSquare, Sparkles } from "lucide-react";
import { PageHeader } from "../ui";

/** The optional assistant. Proposals go to the review dialog; explanations are shown here. Nothing is applied silently. */
export function AssistantPage() {
  useRegistryVersion();
  const ai = useAiSettings();
  const views = useModel((ws) => ws.views);
  const active = useApp((s) => s.activeView);
  const [text, setText] = useState("");
  const [notation, setNotation] = useState("c4");
  const [viewId, setViewId] = useState(active ?? "");
  const [answer, setAnswer] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const notations = [...registry.packs.values()].filter((p) => p.elementTypes.length && p.viewpoints.length);
  const view = views[viewId];
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  };
  const review = openReview;
  return (
    <div className="page" data-testid="assistant-page">
      <PageHeader
        icon={Sparkles}
        title={t("Assistant")}
        description={t("Draft models from text, explain and review views, and translate between notations. Every change is shown for review first.")}
        actions={<button className="btn" title={t("Ask questions about the model, ask for changes in plain words, or draft a decision record about the selection.")} onClick={() => set({ page: "diagram", chatOpen: true })}><MessageSquare size={14} aria-hidden /> {t("Open the chat beside the canvas")}</button>}
      />
      {!ai.enabled && (
        <div className="callout" style={{ alignItems: "center" }}>
          <Info size={16} className="muted" style={{ flex: "none" }} aria-hidden />
          <div style={{ flex: 1 }}>
            <strong>{t("The AI assistant is off.")}</strong> <span className="muted">{t("Translating a view into another notation below works without it.")}</span>
          </div>
          <button className="btn" onClick={() => set({ page: "settings" })}>{t("Set it up in Settings")}</button>
        </div>
      )}
      <section>
        <h3>{t("Draft a model from a description")}</h3>
        <textarea className="input" aria-label={t("Description or document")} style={{ minHeight: 120 }} placeholder={t("Describe a system, or paste a design document…")} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex gap-2 mt-2 items-center">
          <label>{t("as")} <select className="btn" aria-label={t("Draft notation")} value={notation} onChange={(e) => setNotation(e.target.value)}>{notations.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <button className="btn primary" disabled={!ai.enabled || !text.trim() || !!busy} onClick={() => run("draft", async () => review(t("Assistant: drafted model"), await draftModel(await aiConfig(), aiFetch, model.state, registry, { text, notation })))}>
            {busy === "draft" ? t("Thinking…") : t("Draft")}
          </button>
        </div>
      </section>
      <section>
        <h3>{t("Work with a view")}</h3>
        <select className="input" aria-label={t("View")} value={viewId} onChange={(e) => setViewId(e.target.value)}>
          <option value="">—</option>
          {Object.values(views).sort((a, b) => a.name.localeCompare(b.name)).map((v) => <option key={v.id} value={v.id}>{v.name} ({registry.packs.get(v.notation)?.name ?? v.notation})</option>)}
        </select>
        <div className="flex gap-2 mt-2" style={{ flexWrap: "wrap" }}>
          <button className="btn" disabled={!ai.enabled || !view || !!busy} onClick={() => run("suggest", async () => review(t("Assistant: suggested relationships"), await suggestRelationships(await aiConfig(), aiFetch, model.state, registry, viewId)))}>{busy === "suggest" ? t("Thinking…") : t("Suggest missing relationships")}</button>
          <button className="btn" disabled={!ai.enabled || !view || !!busy} onClick={() => run("explain", async () => setAnswer(await explainView(await aiConfig(), aiFetch, model.state, registry, viewId)))}>{busy === "explain" ? t("Thinking…") : t("Explain this view")}</button>
          {view?.notation === "c4" && (
            <button className="btn" disabled={!!busy} onClick={() => run("translate", async () => review(t("Translate to ArchiMate"), translateView(model.state, registry, viewId, "archimate", "archimate:application")))}>{t("Translate into an ArchiMate view")}</button>
          )}
          {view && view.notation !== "c4" && (
            <button className="btn" disabled={!!busy} onClick={() => run("translate", async () => review(t("Translate to C4"), translateView(model.state, registry, viewId, "c4", "c4:landscape")))}>{t("Translate into a C4 view")}</button>
          )}
        </div>
      </section>
      <section>
        <h3>{t("Review the model")}</h3>
        <button className="btn" disabled={!ai.enabled || !!busy} onClick={() => run("review", async () => setAnswer(await reviewModel(await aiConfig(), aiFetch, model.state, registry)))}>{busy === "review" ? t("Thinking…") : t("Review against the validation rules")}</button>
      </section>
      {error && <p role="alert" className="sev-error">{error}</p>}
      {answer && <article className="panel adr-body" data-testid="assistant-answer" style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 12, marginTop: 12 }} dangerouslySetInnerHTML={{ __html: markdownToHtml(answer) }} />}
      <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>{t("Endpoint: {url} · model {model}", { url: ai.baseUrl, model: ai.model })}</p>
    </div>
  );
}
