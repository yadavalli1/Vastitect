import { useMemo, useState } from "react";
import { searchElements, type Id } from "@vastitecture/core";
import { app, model, registry, select, set, useApp, useModel, useRegistryVersion } from "../state";
import { createElementInView, createView, placeElement, sizeOf } from "../ops";
import { DND_ELEMENT, DND_TYPE } from "../canvas/Canvas";
import { focusCanvas } from "../canvas/nodes";
import { t } from "../i18n";

function NewView({ onDone }: { onDone(): void }) {
  const packs = [...registry.packs.values()].filter((p) => p.viewpoints.length);
  const [notation, setNotation] = useState(packs[0]?.id ?? "");
  const pack = registry.packs.get(notation);
  const [viewpoint, setViewpoint] = useState(pack?.viewpoints[0]?.id ?? "");
  const [name, setName] = useState("");
  const vps = pack?.viewpoints ?? [];
  const vp = vps.find((v) => v.id === viewpoint) ?? vps[0];
  return (
    <form
      style={{ padding: "4px 10px 10px" }}
      onSubmit={(e) => {
        e.preventDefault();
        createView(notation, vp?.id, name.trim() || vp?.name || t("New view"));
        onDone();
      }}
    >
      <label className="label" htmlFor="nv-notation">{t("Notation")}</label>
      <select id="nv-notation" className="input" value={notation} onChange={(e) => (setNotation(e.target.value), setViewpoint(registry.packs.get(e.target.value)?.viewpoints[0]?.id ?? ""))}>
        {packs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <label className="label" htmlFor="nv-viewpoint">{t("Viewpoint")}</label>
      <select id="nv-viewpoint" className="input" value={vp?.id ?? ""} onChange={(e) => setViewpoint(e.target.value)}>
        {vps.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
      <label className="label" htmlFor="nv-name">{t("Name")}</label>
      <input id="nv-name" className="input" value={name} placeholder={vp?.name} onChange={(e) => setName(e.target.value)} autoFocus />
      <div className="flex gap-2 mt-2">
        <button className="btn primary" type="submit">{t("Create view")}</button>
        <button className="btn" type="button" onClick={onDone}>{t("Cancel")}</button>
      </div>
    </form>
  );
}

export function Sidebar() {
  useRegistryVersion();
  const views = useModel((ws) => ws.views);
  const elements = useModel((ws) => ws.elements);
  const activeView = useApp((s) => s.activeView);
  const page = useApp((s) => s.page);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"palette" | "model">("palette");
  const view = activeView ? views[activeView] : undefined;

  const grouped = useMemo(() => {
    const g = new Map<string, typeof views[string][]>();
    for (const v of Object.values(views).sort((a, b) => a.name.localeCompare(b.name))) g.set(v.notation, [...(g.get(v.notation) ?? []), v]);
    return [...g.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [views]);

  const palette = view ? registry.paletteFor(view.notation, view.viewpoint) : [];
  const categories = [...new Set(palette.map((p) => p.category ?? ""))];
  const found = useMemo(() => searchElements({ elements } as never, q).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 300), [elements, q]);
  const inView = new Set(view?.nodes.map((n) => n.element));

  const addAtCentre = (type: string) => {
    if (!view) return;
    const [w, h] = sizeOf(type);
    const n = view.nodes.filter((x) => !x.parent).length;
    createElementInView(view.id, type, { x: 80 + (n % 5) * (w + 40), y: 80 + Math.floor(n / 5) * (h + 50) });
    focusCanvas();
  };

  return (
    <aside className="panel chrome flex flex-col border-r" style={{ width: 250, minWidth: 250 }} aria-label={t("Views and palette")}>
      <div className="flex items-center">
        <div className="h" style={{ flex: 1 }}>{t("Views")}</div>
        <button className="btn ghost" aria-label={t("New view")} title={t("New view")} onClick={() => setAdding(!adding)}>＋</button>
      </div>
      {adding && <NewView onDone={() => setAdding(false)} />}
      <nav className="scroll" style={{ maxHeight: "38%", minHeight: 60 }} aria-label={t("Views")}>
        {grouped.map(([notation, list]) => (
          <div key={notation}>
            <div className="muted" style={{ padding: "4px 10px 0", fontSize: 11 }}>{registry.packs.get(notation)?.name ?? notation}</div>
            {list.map((v) => (
              <div
                key={v.id}
                role="button"
                tabIndex={0}
                className={`row${v.id === activeView && page === "diagram" ? " active" : ""}`}
                onClick={() => (set({ activeView: v.id, page: "diagram" }), select())}
                onKeyDown={(e) => e.key === "Enter" && (set({ activeView: v.id, page: "diagram" }), select())}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.name}</span>
                <span className="muted" style={{ marginLeft: "auto", fontSize: 11 }}>{v.nodes.length}</span>
              </div>
            ))}
          </div>
        ))}
        {!grouped.length && <div className="row muted">{t("No views yet")}</div>}
      </nav>
      <div className="flex border-t" style={{ borderColor: "var(--border)" }} role="tablist">
        <button role="tab" aria-selected={tab === "palette"} className={`btn ghost flex-1${tab === "palette" ? " on" : ""}`} onClick={() => setTab("palette")}>{t("Palette")}</button>
        <button role="tab" aria-selected={tab === "model"} className={`btn ghost flex-1${tab === "model" ? " on" : ""}`} onClick={() => setTab("model")}>{t("Model")}</button>
      </div>
      {tab === "palette" ? (
        <div className="scroll flex-1" data-testid="palette">
          {!view && <div className="row muted">{t("Open a view to see its palette")}</div>}
          {categories.map((c) => (
            <div key={c}>
              {c && <div className="h">{c}</div>}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, padding: "2px 8px 6px" }}>
                {palette.filter((p) => (p.category ?? "") === c).map((p) => (
                  <button
                    key={p.id}
                    className="btn"
                    style={{ justifyContent: "flex-start", overflow: "hidden", borderLeft: `5px solid ${p.fill ?? "var(--border)"}` }}
                    draggable
                    title={t("Drag onto the canvas, or click to add")}
                    data-palette={p.id}
                    onDragStart={(e) => e.dataTransfer.setData(DND_TYPE, p.id)}
                    onClick={() => addAtCentre(p.id)}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{p.icon && !p.icon.startsWith("path:") ? p.icon + " " : ""}{p.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col flex-1" style={{ minHeight: 0 }}>
          <div style={{ padding: 8 }}>
            <input className="input" aria-label={t("Search the model")} placeholder={t("Search… (type:, tag:, owner:)")} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="scroll flex-1">
            {found.map((e) => (
              <div
                key={e.id}
                className={`row${app.getState().selection.elements.includes(e.id) ? " active" : ""}`}
                draggable
                title={t("Drag into a view to show this element there")}
                onDragStart={(ev) => ev.dataTransfer.setData(DND_ELEMENT, e.id)}
                onClick={() => select([e.id])}
                onDoubleClick={() => view && placeElement(view.id, e.id, { x: 60, y: 60 })}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: inView.has(e.id) ? 1 : 0.75 }}>{e.name}</span>
                <span className="muted" style={{ marginLeft: "auto", fontSize: 10, whiteSpace: "nowrap" }}>{registry.elementType(e.type)?.name ?? e.type}</span>
              </div>
            ))}
            {!found.length && <div className="row muted">{t("No elements")}</div>}
          </div>
        </div>
      )}
    </aside>
  );
}

export const elementName = (id: Id) => model.state.elements[id]?.name ?? id;
