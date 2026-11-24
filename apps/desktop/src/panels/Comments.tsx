import { useState } from "react";
import { newId, type Comment } from "@vastitecture/core";
import { dispatch, useModel, today } from "../state";
import { t } from "../i18n";

const AUTHOR_KEY = "vastitecture/author";
const getAuthor = () => {
  try {
    return localStorage.getItem(AUTHOR_KEY) ?? "";
  } catch {
    return "";
  }
};

/**
 * Review comments on an element, relationship or view. They are stored in the workspace (comments/,
 * one file per comment), so they travel with the model through Git and pull requests.
 */
export function Comments({ target }: { target: Comment["target"] }) {
  const all = useModel((ws) => ws.comments);
  const list = Object.values(all ?? {}).filter((c) => c.target.kind === target.kind && c.target.id === target.id).sort((a, b) => a.id.localeCompare(b.id));
  const roots = list.filter((c) => !c.replyTo);
  const [text, setText] = useState("");
  const [author, setAuthor] = useState(getAuthor);
  const [replyTo, setReplyTo] = useState<string>();
  const [showResolved, setShowResolved] = useState(false);
  const post = () => {
    if (!text.trim()) return;
    try {
      localStorage.setItem(AUTHOR_KEY, author);
    } catch {
      /* private mode: the name is just not remembered */
    }
    dispatch({ type: "putComment", comment: { id: newId(), target, author: author.trim(), date: today(), text: text.trim(), ...(replyTo ? { replyTo } : {}) } }, t("Comment"));
    setText("");
    setReplyTo(undefined);
  };
  const open = roots.filter((c) => !c.resolved);
  const shown = showResolved ? roots : open;
  return (
    <div data-testid="comments">
      <div className="label">{t("Comments")} {!!open.length && <span className="chip">{open.length}</span>}</div>
      {shown.map((c) => (
        <div key={c.id} style={{ borderLeft: `3px solid ${c.resolved ? "var(--border)" : "var(--accent)"}`, padding: "2px 0 2px 6px", margin: "4px 0", opacity: c.resolved ? 0.6 : 1 }}>
          {[c, ...list.filter((r) => r.replyTo === c.id)].map((x) => (
            <div key={x.id} style={{ fontSize: 12, marginLeft: x === c ? 0 : 10 }}>
              <strong>{x.author || t("Someone")}</strong> <span className="muted">{x.date}</span>
              <div style={{ whiteSpace: "pre-wrap" }}>{x.text}</div>
            </div>
          ))}
          <div className="flex gap-2">
            <button className="btn ghost" style={{ fontSize: 11 }} onClick={() => setReplyTo(c.id)}>{t("Reply")}</button>
            <button className="btn ghost" style={{ fontSize: 11 }} onClick={() => dispatch({ type: "putComment", comment: { ...c, resolved: !c.resolved } }, c.resolved ? t("Reopen comment") : t("Resolve comment"))}>{c.resolved ? t("Reopen") : t("Resolve")}</button>
            <button className="btn ghost" style={{ fontSize: 11 }} onClick={() => dispatch({ type: "removeComment", id: c.id }, t("Delete comment"))}>{t("Delete")}</button>
          </div>
        </div>
      ))}
      {roots.length > open.length && <button className="btn ghost" style={{ fontSize: 11 }} onClick={() => setShowResolved(!showResolved)}>{showResolved ? t("Hide resolved") : t("Show {count} resolved", { count: roots.length - open.length })}</button>}
      {replyTo && <div className="muted" style={{ fontSize: 11 }}>{t("Replying")} <button className="btn ghost" style={{ fontSize: 11 }} onClick={() => setReplyTo(undefined)}>{t("Cancel")}</button></div>}
      <textarea className="input" aria-label={t("New comment")} placeholder={t("Add a comment…")} style={{ minHeight: 44, fontSize: 12 }} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && post()} />
      <div className="flex gap-2 mt-2 items-center">
        <input className="input" aria-label={t("Comment author")} placeholder={t("Your name")} style={{ fontSize: 12, flex: 1 }} value={author} onChange={(e) => setAuthor(e.target.value)} />
        <button className="btn" disabled={!text.trim()} onClick={post}>{t("Comment")}</button>
      </div>
    </div>
  );
}
