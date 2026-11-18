import { useEffect, useMemo, useRef, useState } from "react";
import { commands } from "../commands";
import { set } from "../state";
import { t } from "../i18n";

export function CommandPalette() {
  const all = useMemo(() => commands(), []);
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((c) => words.every((w) => c.label.toLowerCase().includes(w))).slice(0, 80);
  }, [q, all]);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => setIndex(0), [q]);
  const close = () => set({ commandOpen: false });
  const run = (i: number) => {
    const c = shown[i];
    close();
    if (c) void c.run();
  };
  return (
    <>
      <div className="overlay" onClick={close} />
      <div className="dialog" role="dialog" aria-label={t("Command palette")}>
        <input
          ref={input}
          className="input"
          style={{ border: 0, borderBottom: "1px solid var(--border)", borderRadius: 0, padding: 12, fontSize: 15 }}
          placeholder={t("Type a command…")}
          aria-label={t("Command")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") (setIndex((i) => Math.min(i + 1, shown.length - 1)), e.preventDefault());
            else if (e.key === "ArrowUp") (setIndex((i) => Math.max(i - 1, 0)), e.preventDefault());
            else if (e.key === "Enter") run(index);
            else if (e.key === "Escape") close();
          }}
        />
        <div className="scroll" role="listbox">
          {shown.map((c, i) => (
            <div key={c.id} role="option" aria-selected={i === index} className={`row${i === index ? " active" : ""}`} style={{ padding: "6px 12px" }} onClick={() => run(i)} onMouseEnter={() => setIndex(i)}>
              {c.label}
              {c.keys && <kbd className="muted" style={{ marginLeft: "auto" }}>{c.keys.replace("Mod", navigator.platform.includes("Mac") ? "⌘" : "Ctrl")}</kbd>}
            </div>
          ))}
          {!shown.length && <div className="row muted" style={{ padding: 12 }}>{t("No matching commands")}</div>}
        </div>
      </div>
    </>
  );
}
