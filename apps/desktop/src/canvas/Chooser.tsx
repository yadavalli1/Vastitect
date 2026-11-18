import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "../i18n";

export interface ChooserItem {
  id: string;
  label: string;
  hint?: string;
  run(): void;
}

/** Small popup list with type-to-filter. The first (likeliest) item is preselected; Enter confirms. */
export function Chooser({ x, y, title, items, search, onClose }: { x: number; y: number; title: string; items: ChooserItem[]; search?: string; onClose(): void }) {
  const [q, setQ] = useState(search ?? "");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (s ? items.filter((i) => `${i.label} ${i.hint ?? ""}`.toLowerCase().includes(s)) : items).slice(0, 60);
  }, [q, items]);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => setIndex(0), [q]);
  const pick = (i: ChooserItem | undefined) => {
    onClose();
    i?.run();
  };
  return (
    <div
      role="dialog"
      aria-label={title}
      className="panel"
      style={{ position: "fixed", left: Math.min(x, window.innerWidth - 300), top: Math.min(y, window.innerHeight - 320), width: 290, zIndex: 40, border: "1px solid var(--border)", borderRadius: 6, boxShadow: "0 8px 24px rgba(0,0,0,.3)" }}
    >
      <div className="h">{title}</div>
      <div style={{ padding: "0 8px 6px" }}>
        <input
          ref={input}
          className="input"
          aria-label={t("Filter")}
          placeholder={t("Type to filter…")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onBlur={() => setTimeout(onClose, 150)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "ArrowDown") (setIndex((i) => Math.min(i + 1, shown.length - 1)), e.preventDefault());
            else if (e.key === "ArrowUp") (setIndex((i) => Math.max(i - 1, 0)), e.preventDefault());
            else if (e.key === "Enter") pick(shown[index]);
            else if (e.key === "Escape") onClose();
          }}
        />
      </div>
      <div className="scroll" role="listbox" style={{ maxHeight: 230, paddingBottom: 4 }}>
        {shown.map((it, i) => (
          <div key={it.id} role="option" aria-selected={i === index} className={`row${i === index ? " active" : ""}`} onMouseDown={(e) => (e.preventDefault(), pick(it))} onMouseEnter={() => setIndex(i)}>
            <span>{it.label}</span>
            {it.hint && <span className="muted" style={{ marginLeft: "auto", fontSize: 11 }}>{it.hint}</span>}
          </div>
        ))}
        {!shown.length && <div className="row muted">{t("No matches")}</div>}
      </div>
    </div>
  );
}
