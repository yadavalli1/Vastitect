import { useMemo, useState } from "react";
import { searchElements } from "@vastitecture/core";
import { app, registry, select, set, useApp, useModel, useRegistryVersion } from "../state";
import { createElementInView, createView, placeElement, sizeOf } from "../ops";
import { DND_ELEMENT, DND_TYPE } from "../canvas/Canvas";
import { focusCanvas } from "../canvas/nodes";
import { t } from "../i18n";
import { GripVertical, LayoutTemplate, Plus, Search } from "lucide-react";
import { IconButton } from "../ui";

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
      className="card card-pad"
      style={{ margin: "0 8px 8px", padding: "4px 12px 12px" }}
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
      <div className="flex gap-2 mt-3">
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
    <aside className="side chrome flex flex-col border-r" style={{ width: 264, minWidth: 264 }} aria-label={t("Views and palette")}>
      <div className="flex items-center" style={{ padding: "6px 8px 0 0" }}>
        <div className="h" style={{ flex: 1 }}>{t("Views")}</div>
        <IconButton size="sm" icon={Plus} label={t("New view")} pressed={adding} onClick={() => setAdding(!adding)} />
      </div>
      {adding && <NewView onDone={() => setAdding(false)} />}
      <nav className="scroll" style={{ maxHeight: "42%", minHeight: 60, paddingBottom: 6 }} aria-label={t("Views")}>
        {grouped.map(([notation, list]) => (
          <div key={notation}>
            <div className="faint" style={{ padding: "8px 16px 3px", fontSize: 11.5, fontWeight: 500 }}>{registry.packs.get(notation)?.name ?? notation}</div>
            {list.map((v) => (
              <div
                key={v.id}
                role="button"
                tabIndex={0}
                className={`row${v.id === activeView && page === "diagram" ? " active" : ""}`}
                onClick={() => (set({ activeView: v.id, page: "diagram" }), select())}
                onKeyDown={(e) => e.key === "Enter" && (set({ activeView: v.id, page: "diagram" }), select())}
              >
                <LayoutTemplate size={14} strokeWidth={1.8} className="faint" style={{ flex: "none" }} aria-hidden />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.name}</span>
                <span className="faint" style={{ marginLeft: "auto", fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{v.nodes.length}</span>
              </div>
            ))}
          </div>
        ))}
        {!grouped.length && <div className="row muted">{t("No views yet")}</div>}
      </nav>
      <div style={{ padding: "8px 10px", borderTop: "1px solid var(--border)" }}>
        <div className="tabs" role="tablist" style={{ display: "flex" }}>
          <button role="tab" aria-selected={tab === "palette"} style={{ flex: 1 }} onClick={() => setTab("palette")}>{t("Palette")}</button>
          <button role="tab" aria-selected={tab === "model"} style={{ flex: 1 }} onClick={() => setTab("model")}>{t("Model")}</button>
        </div>
      </div>
      {tab === "palette" ? (
        <div className="scroll flex-1" data-testid="palette" style={{ paddingBottom: 8 }}>
          {!view && <div className="row muted">{t("Open a view to see its palette")}</div>}
          {categories.map((c) => (
            <div key={c}>
              {c && <div className="h" style={{ paddingTop: 10 }}>{c}</div>}
              {palette.filter((p) => (p.category ?? "") === c).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="row palette-item"
                  draggable
                  title={t("Drag onto the canvas, or click to add")}
                  data-palette={p.id}
                  onDragStart={(e) => e.dataTransfer.setData(DND_TYPE, p.id)}
                  onClick={() => addAtCentre(p.id)}
                >
                  <span className="swatch" style={{ background: p.fill ?? "var(--panel-3)" }} aria-hidden />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                  <GripVertical size={13} className="faint grip" aria-hidden />
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col flex-1" style={{ minHeight: 0 }}>
          <div style={{ padding: "2px 10px 8px", position: "relative" }}>
            <Search size={14} className="faint" style={{ position: "absolute", left: 20, top: 9 }} aria-hidden />
            <input className="input" style={{ paddingLeft: 30 }} aria-label={t("Search the model")} placeholder={t("Search… (type:, tag:, owner:)")} value={q} onChange={(e) => setQ(e.target.value)} />
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
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: inView.has(e.id) ? 1 : 0.7 }}>{e.name}</span>
                <span className="faint" style={{ marginLeft: "auto", fontSize: 11, whiteSpace: "nowrap" }}>{registry.elementType(e.type)?.name ?? e.type}</span>
              </div>
            ))}
            {!found.length && <div className="row muted">{t("No elements")}</div>}
          </div>
        </div>
      )}
    </aside>
  );
}

