import { useEffect, useMemo, useRef, useState } from "react";
import { viewsContaining } from "@vastitecture/core";
import { fullTextSearch, model, registry, select, set } from "../state";
import { t } from "../i18n";

interface Hit {
  key: string;
  kind: "element" | "view" | "adr";
  id: string;
  label: string;
  detail: string;
}

/** Search everything: elements (name, description, tags, owner, properties), views and decisions. */
export function SearchDialog() {
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const [fts, setFts] = useState<Hit[]>([]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const local = useMemo<Hit[]>(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const ws = model.state;
    const match = (text: string) => words.every((w) => text.includes(w));
    const out: Hit[] = [];
    for (const e of Object.values(ws.elements)) {
      const text = `${e.name} ${e.description ?? ""} ${e.owner ?? ""} ${e.tags.join(" ")} ${Object.values(e.properties).join(" ")}`.toLowerCase();
      if (match(text)) out.push({ key: "e" + e.id, kind: "element", id: e.id, label: e.name, detail: registry.elementType(e.type)?.name ?? e.type });
    }
    for (const v of Object.values(ws.views)) if (match(`${v.name} ${v.description ?? ""}`.toLowerCase())) out.push({ key: "v" + v.id, kind: "view", id: v.id, label: v.name, detail: t("View · {notation}", { notation: registry.packs.get(v.notation)?.name ?? v.notation }) });
    for (const a of Object.values(ws.adrs)) if (match(`${a.id} ${a.title} ${a.body}`.toLowerCase())) out.push({ key: "a" + a.id, kind: "adr", id: a.id, label: `${a.id} ${a.title}`, detail: t("Decision · {status}", { status: a.status }) });
    // Names that start with the query first.
    return out.sort((x, y) => Number(!x.label.toLowerCase().startsWith(words[0])) - Number(!y.label.toLowerCase().startsWith(words[0])) || x.label.localeCompare(y.label)).slice(0, 100);
  }, [q]);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() =>
      void fullTextSearch(q).then((hits) => {
        if (!live) return;
        const ws = model.state;
        setFts(hits.filter((h) => (h.kind === "element" ? ws.elements[h.id] : h.kind === "view" ? ws.views[h.id] : ws.adrs[h.id])).map((h) => ({ key: "f" + h.kind + h.id, kind: h.kind, id: h.id, label: h.kind === "element" ? ws.elements[h.id].name : h.kind === "view" ? ws.views[h.id].name : ws.adrs[h.id].title, detail: h.snippet.replace(/\s+/g, " ") })));
      }), 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q]);
  const hits = [...local, ...fts.filter((f) => !local.some((l) => l.kind === f.kind && l.id === f.id))];
  useEffect(() => setIndex(0), [q]);
  const close = () => set({ searchOpen: false });
  const open = (h?: Hit) => {
    if (!h) return;
    close();
    if (h.kind === "view") return set({ activeView: h.id, page: "diagram" });
    if (h.kind === "adr") return set({ page: "adrs", openAdr: h.id });
    const v = viewsContaining(model.state, h.id)[0];
    select([h.id]);
    set(v ? { page: "diagram", activeView: v.id } : { page: "inventory" });
  };
  return (
    <>
      <div className="overlay" onClick={close} />
      <div className="dialog" role="dialog" aria-label={t("Search")}>
        <input ref={input} className="input" style={{ border: 0, borderBottom: "1px solid var(--border)", borderRadius: 0, padding: 12, fontSize: 15 }} placeholder={t("Search elements, views and decisions…")} aria-label={t("Search")} value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") (setIndex((i) => Math.min(i + 1, hits.length - 1)), e.preventDefault());
            else if (e.key === "ArrowUp") (setIndex((i) => Math.max(i - 1, 0)), e.preventDefault());
            else if (e.key === "Enter") open(hits[index]);
            else if (e.key === "Escape") close();
          }} />
        <div className="scroll" role="listbox" data-testid="search-results">
          {hits.map((h, i) => (
            <div key={h.key} role="option" aria-selected={i === index} className={`row${i === index ? " active" : ""}`} style={{ padding: "6px 12px" }} onClick={() => open(h)} onMouseEnter={() => setIndex(i)}>
              <span>{h.label}</span>
              <span className="muted" style={{ marginLeft: "auto", fontSize: 11, maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.detail}</span>
            </div>
          ))}
          {q && !hits.length && <div className="row muted" style={{ padding: 12 }}>{t("Nothing found")}</div>}
        </div>
      </div>
    </>
  );
}
