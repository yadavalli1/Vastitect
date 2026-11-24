import { useEffect, useRef, useState } from "react";
import { chatTurn, draftAdr, type ChatTurn } from "@vastitecture/ai";
import type { ModelPatch } from "@vastitecture/core";
import { markdownToHtml } from "@vastitecture/render";
import { aiConfig, aiFetch, useAiSettings } from "../ai";
import { model, registry, set, useApp, openReview, today } from "../state";
import { t } from "../i18n";
import { Sparkles, X } from "lucide-react";
import { EmptyState, IconButton } from "../ui";

interface Entry extends ChatTurn {
  patch?: ModelPatch;
  error?: boolean;
}

/** Kept for the session only: chats are not written to the workspace or to disk. */
let memory: Entry[] = [];

/**
 * The assistant chat beside the canvas. It sees the model, the open view and the selection. Answers are
 * shown here; proposed changes open in the review dialog and are applied only when the user says so.
 */
export function ChatPanel() {
  const ai = useAiSettings();
  const activeView = useApp((s) => s.activeView);
  const selection = useApp((s) => s.selection.elements);
  const [log, setLog] = useState<Entry[]>(memory);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    memory = log;
    end.current?.scrollIntoView?.({ block: "end" });
  }, [log]);

  const review = openReview;
  const send = async (message: string) => {
    if (!message.trim() || busy) return;
    const next = [...log, { role: "user" as const, content: message }];
    setLog(next);
    setText("");
    setBusy(true);
    try {
      const history = log.filter((e) => !e.error).map(({ role, content }) => ({ role, content }));
      const r = await chatTurn(await aiConfig(), aiFetch, model.state, registry, history, message, { viewId: activeView, selection });
      setLog([...next, { role: "assistant", content: r.answer || t("(no answer)"), patch: r.patch }]);
      if (r.patch) review(t("Assistant: proposed changes"), r.patch);
    } catch (e) {
      setLog([...next, { role: "assistant", content: e instanceof Error ? e.message : String(e), error: true }]);
    } finally {
      setBusy(false);
    }
  };
  const adr = async () => {
    setBusy(true);
    try {
      const patch = await draftAdr(await aiConfig(), aiFetch, model.state, registry, { elements: selection, topic: text, today: today() });
      setLog([...log, { role: "user", content: t("Draft a decision record: {topic}", { topic: text || t("the selection") }) }, { role: "assistant", content: patch.report?.[0] ?? "", patch }]);
      setText("");
      review(t("Assistant: draft decision record"), patch);
    } catch (e) {
      setLog([...log, { role: "assistant", content: e instanceof Error ? e.message : String(e), error: true }]);
    } finally {
      setBusy(false);
    }
  };

  const names = selection.map((id) => model.state.elements[id]?.name).filter(Boolean);
  return (
    <aside className="panel border-l flex flex-col" style={{ width: 340, minWidth: 340 }} aria-label={t("Assistant chat")} data-testid="chat">
      <div className="h flex items-center">
        <span className="flex items-center gap-2" style={{ flex: 1 }}><Sparkles size={13} aria-hidden /> {t("Assistant chat")}</span>
        {!!log.length && <button className="btn ghost" onClick={() => setLog([])}>{t("Clear")}</button>}
        <IconButton size="sm" icon={X} label={t("Close")} onClick={() => set({ chatOpen: false })} />
      </div>
      {!ai.enabled ? (
        <div style={{ padding: 16 }}>
          <EmptyState icon={Sparkles} title={t("The AI assistant is off.")} action={<button className="btn primary" onClick={() => set({ page: "settings" })}>{t("Set it up in Settings")}</button>}>
            {t("Connect any OpenAI-compatible endpoint, including a local model, to ask questions about the model and propose changes for review.")}
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="scroll flex-1" style={{ padding: 10, minHeight: 0 }}>
            {!log.length && (
              <div className="muted" style={{ fontSize: 12 }}>
                <p>{t("Ask about the model or ask for a change. Every change is shown for review before anything is applied.")}</p>
                {[t("Which systems depend on something being retired?"), t("Who owns the containers in this view?"), t("Add a cache in front of the database"), t("What looks risky in this view?")].map((q) => (
                  <button key={q} className="btn ghost" style={{ display: "block", textAlign: "left", marginBottom: 4 }} onClick={() => void send(q)}>{q}</button>
                ))}
              </div>
            )}
            {log.map((e, i) => (
              <div key={i} data-testid={`chat-${e.role}`} style={{ margin: "6px 0", padding: "6px 8px", borderRadius: 6, background: e.role === "user" ? "var(--node-fill)" : "transparent", border: e.role === "assistant" ? "1px solid var(--border)" : undefined }}>
                {e.role === "assistant" ? <div className={e.error ? "sev-error" : "adr-body"} style={{ fontSize: 13 }} dangerouslySetInnerHTML={{ __html: markdownToHtml(e.content) }} /> : <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{e.content}</div>}
                {e.patch && <button className="btn" style={{ marginTop: 4 }} onClick={() => review(t("Assistant: proposed changes"), e.patch!)}>{t("Review changes")}</button>}
              </div>
            ))}
            {busy && <p className="muted">{t("Thinking…")}</p>}
            <div ref={end} />
          </div>
          <div style={{ padding: 8, borderTop: "1px solid var(--border)" }}>
            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>
              {names.length ? t("Context: view and {names}", { names: names.slice(0, 3).join(", ") + (names.length > 3 ? "…" : "") }) : activeView ? t("Context: the whole model and this view") : t("Context: the whole model")}
            </div>
            <textarea
              className="input"
              aria-label={t("Message")}
              placeholder={t("Ask or describe a change… (Enter to send, Shift+Enter for a new line)")}
              style={{ minHeight: 60 }}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(text);
                }
              }}
            />
            <div className="flex gap-2 mt-2">
              <button className="btn primary" disabled={busy || !text.trim()} onClick={() => void send(text)}>{t("Send")}</button>
              <button className="btn" disabled={busy || (!text.trim() && !selection.length)} onClick={() => void adr()} title={t("Uses the text box as the topic and links the selected elements")}>{t("Draft a decision record")}</button>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
