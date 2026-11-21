import { useMemo, useState } from "react";
import {
  CLASSIFICATIONS,
  comparePlateaus,
  costRollup,
  dataExposure,
  diffWorkspaces,
  fromFiles,
  isWorkspacePath,
  makeElement,
  makeRelationship,
  makeView,
  presenceAt,
  structure,
  viewsContaining,
  type Id,
  type ModelPatch,
  type PatchDiff,
  type Workspace,
} from "@vastitecture/core";
import { app, model, registry, select, set, useApp, useModel } from "../state";
import { isTauri } from "../platform";
import type { Overlay } from "../canvas/context";
import { t } from "../i18n";

type Tab = "changes" | "plateaus" | "structure" | "data" | "costs";
const today = () => new Date().toISOString().slice(0, 10);
const inAYear = () => new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);

/** Draw an analysis over the canvas, on the view that shows most of the marked elements. */
function showOnCanvas(overlay: Overlay) {
  const ids = Object.keys(overlay.elements);
  const ws = model.state;
  const score = (vid: Id) => ws.views[vid].nodes.filter((n) => overlay.elements[n.element]).length;
  const current = app.getState().activeView;
  const best = Object.keys(ws.views).sort((a, b) => score(b) - score(a))[0];
  const target = current && score(current) ? current : best && score(best) ? best : viewsContaining(ws, ids[0] ?? "")[0]?.id;
  set({ overlay, page: "diagram", ...(target ? { activeView: target } : {}) });
}

function Name({ id }: { id: Id }) {
  const el = useModel((ws) => ws.elements[id]);
  if (!el) return <span className="muted">{id}</span>;
  return (
    <a href="#" onClick={(e) => (e.preventDefault(), select([id]), showOnCanvas({ title: el.name, elements: { [id]: { tone: "info" } } }))}>
      {el.name}
    </a>
  );
}

async function pickWorkspaceFolder(): Promise<Record<string, string> | undefined> {
  const picker = (window as unknown as { showDirectoryPicker?: (o?: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  if (!picker) return undefined;
  const root = await picker({ mode: "read" }).catch(() => undefined);
  if (!root) return undefined;
  const files: Record<string, string> = {};
  const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
    for await (const [name, h] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (name.startsWith(".") || name === "node_modules") continue;
      const path = prefix + name;
      if (h.kind === "directory") await walk(h as FileSystemDirectoryHandle, `${path}/`);
      else if (isWorkspacePath(path)) files[path] = await (await (h as FileSystemFileHandle).getFile()).text();
    }
  };
  await walk(root, "");
  return files;
}

function ChangesTab() {
  const root = useApp((s) => s.fsLabel);
  const [base, setBase] = useState<{ label: string; ws: Workspace }>();
  const [commits, setCommits] = useState<{ hash: string; subject: string; date: string }[]>();
  const [error, setError] = useState<string>();
  const ws = useModel((w) => w);
  const diff: PatchDiff | undefined = useMemo(() => (base ? diffWorkspaces(base.ws, ws) : undefined), [base, ws]);
  const git = isTauri && /^([/\\]|[A-Za-z]:)/.test(root);
  const load = async (label: string, files: Record<string, string> | undefined) => {
    setError(undefined);
    if (!files) return;
    if (!files["vastitecture.yaml"]) return setError(t("That folder is not a Vastitecture workspace (no vastitecture.yaml)."));
    setBase({ label, ws: fromFiles(files).workspace });
  };
  const fromGit = async (rev: string, label: string) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await load(label, await invoke<Record<string, string>>("git_files_at", { root, rev }));
    } catch (e) {
      setError(String(e));
    }
  };
  const overlay = (): Overlay => {
    const elements: Overlay["elements"] = {};
    const relationships: NonNullable<Overlay["relationships"]> = {};
    for (const a of diff!.added) if (a.kind === "element") elements[a.id] = { tone: "add", badge: t("new") };
    else if (a.kind === "relationship") relationships[a.id] = "add";
    for (const c of diff!.changed) if (c.kind === "element") elements[c.id] = { tone: "change", badge: c.fields.map((f) => f.field).slice(0, 2).join(", ") };
    else if (c.kind === "relationship") relationships[c.id] = "change";
    return { title: t("Changes since {base}", { base: base!.label }), elements, relationships };
  };
  return (
    <div>
      <p className="muted">{t("Compare the model with an earlier version: the last commit, any recent commit, or another copy of the workspace. Added and changed elements are marked on the diagrams.")}</p>
      <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
        {git && <button className="btn" onClick={() => void fromGit("HEAD", t("the last commit"))}>{t("Compare with the last commit")}</button>}
        {git && (
          <button className="btn" onClick={async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            setCommits(await invoke("git_log", { root }));
          }}>{t("Pick a commit…")}</button>
        )}
        {"showDirectoryPicker" in window && <button className="btn" onClick={async () => void load(t("the chosen folder"), await pickWorkspaceFolder())}>{t("Compare with a folder…")}</button>}
      </div>
      {commits && (
        <select className="input mt-2" aria-label={t("Commit")} onChange={(e) => e.target.value && void fromGit(e.target.value, e.target.value)} defaultValue="">
          <option value="">{t("Choose a commit")}</option>
          {commits.map((c) => <option key={c.hash} value={c.hash}>{c.date} {c.hash} {c.subject}</option>)}
        </select>
      )}
      {!git && !("showDirectoryPicker" in window) && <p className="muted">{t("Open a workspace folder in the desktop app to compare with Git history.")}</p>}
      {error && <p className="sev-error" role="alert">{error}</p>}
      {diff && (
        <div data-testid="changes">
          <h3>{t("Since {base}", { base: base!.label })}: <span style={{ color: "var(--ok)" }}>+{diff.added.length}</span> · <span style={{ color: "var(--warn)" }}>~{diff.changed.length}</span> · <span style={{ color: "var(--danger)" }}>−{diff.removed.length}</span></h3>
          {!!(diff.added.length + diff.changed.length) && <button className="btn primary" onClick={() => showOnCanvas(overlay())}>{t("Show on the diagrams")}</button>}
          <ul style={{ fontSize: 13 }}>
            {diff.added.map((a) => <li key={a.kind + a.id} style={{ color: "var(--ok)" }}>+ {a.kind}: {a.label}</li>)}
            {diff.changed.map((c) => <li key={c.kind + c.id} style={{ color: "var(--warn)" }}>~ {c.kind}: {c.label} ({c.fields.map((f) => f.field).join(", ")})</li>)}
            {diff.removed.map((r) => <li key={r.kind + r.id} style={{ color: "var(--danger)" }}>− {r.kind}: {r.label}</li>)}
          </ul>
          {!diff.added.length && !diff.changed.length && !diff.removed.length && <p>{t("No differences.")}</p>}
        </div>
      )}
    </div>
  );
}

function PlateausTab() {
  const ws = useModel((w) => w);
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(inAYear());
  const d = useMemo(() => comparePlateaus(ws, from, to, registry), [ws, from, to]);
  const dated = Object.values(ws.elements).filter((e) => e.lifecycle?.dates && Object.keys(e.lifecycle.dates).length).length;
  const overlay = (): Overlay => ({
    title: t("Migration {from} → {to}", { from, to }),
    elements: Object.fromEntries([
      ...d.introduced.map((id) => [id, { tone: "add" as const, badge: t("new by {date}", { date: to }) }]),
      ...d.retired.map((id) => [id, { tone: "remove" as const, badge: t("gone by {date}", { date: to }) }]),
      ...d.changed.map((c) => [c.id, { tone: "change" as const, badge: c.to }]),
      ...d.broken.map((b) => [b.dependent, { tone: "warn" as const, badge: t("at risk") }]),
    ]),
    relationships: Object.fromEntries(d.broken.map((b) => [b.relationship, "warn" as const])),
  });
  const migrationView = () => {
    const asIs = makeElement("archimate:Plateau", t("As-is {date}", { date: from }));
    const toBe = makeElement("archimate:Plateau", t("To-be {date}", { date: to }));
    const members = (date: string) => Object.values(ws.elements).filter((e) => e.lifecycle?.dates && !["planned", "retired", "unknown"].includes(presenceAt(e, date)));
    const rels = [
      ...members(from).map((e) => makeRelationship("archimate:Aggregation", asIs.id, e.id)),
      ...members(to).map((e) => makeRelationship("archimate:Aggregation", toBe.id, e.id)),
      makeRelationship("archimate:Triggering", asIs.id, toBe.id, { label: t("migrates to") }),
    ];
    const v = makeView("archimate", t("Migration {from} → {to}", { from, to }));
    const ids = new Set([asIs.id, toBe.id, ...rels.map((r) => r.target)]);
    v.nodes = [...ids].map((id) => ({ element: id, x: 0, y: 0, w: id === asIs.id || id === toBe.id ? 220 : 160, h: id === asIs.id || id === toBe.id ? 100 : 70 }));
    v.edges = rels.map((r) => ({ relationship: r.id }));
    const patch: ModelPatch = { elements: [asIs, toBe], relationships: rels, views: [v], layout: [v.id], report: [t("Plateaus for {from} and {to}, aggregating the {count} element(s) that have lifecycle dates.", { from, to, count: ids.size - 2 })] };
    set({ review: { title: t("Create migration view"), patch, layoutViews: patch.layout } });
  };
  return (
    <div>
      <p className="muted">{t("Plateaus come from lifecycle dates (plan, phase in, active, phase out, end of life) on each element. {count} element(s) have dates.", { count: dated })}</p>
      <div className="flex gap-2 items-center">
        <label>{t("As-is")} <input className="input" type="date" aria-label={t("As-is date")} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>{t("To-be")} <input className="input" type="date" aria-label={t("To-be date")} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="btn" onClick={() => showOnCanvas(overlay())}>{t("Show on the diagrams")}</button>
        <button className="btn" disabled={!dated} onClick={migrationView}>{t("Create migration view…")}</button>
      </div>
      <div className="flex gap-4" style={{ flexWrap: "wrap" }} data-testid="plateaus">
        <section><h4>{t("Introduced ({count})", { count: d.introduced.length })}</h4><ul>{d.introduced.map((id) => <li key={id}><Name id={id} /></li>)}</ul></section>
        <section><h4>{t("Retired ({count})", { count: d.retired.length })}</h4><ul>{d.retired.map((id) => <li key={id}><Name id={id} /></li>)}</ul></section>
        <section><h4>{t("Changing phase ({count})", { count: d.changed.length })}</h4><ul>{d.changed.map((c) => <li key={c.id}><Name id={c.id} />: {c.from} → {c.to}</li>)}</ul></section>
        <section>
          <h4 className={d.broken.length ? "sev-error" : undefined}>{t("Dependencies the migration breaks ({count})", { count: d.broken.length })}</h4>
          <ul>{d.broken.map((b) => <li key={b.relationship}><Name id={b.dependent} /> → <Name id={b.dependency} /></li>)}</ul>
        </section>
      </div>
    </div>
  );
}

function StructureTab() {
  const ws = useModel((w) => w);
  const s = useMemo(() => structure(ws, registry), [ws]);
  const cut = [...s.metrics].filter(([, m]) => m.cutVertex).map(([id]) => id);
  const overlay = (): Overlay => ({
    title: t("Structure: single points of failure and cycles"),
    elements: Object.fromEntries([
      ...s.cycles.flat().map((id) => [id, { tone: "change" as const, badge: t("cycle") }]),
      ...cut.map((id) => [id, { tone: "warn" as const, badge: t("connects {n}", { n: s.metrics.get(id)!.reach }) }]),
    ]),
  });
  return (
    <div data-testid="structure">
      <p className="muted">{t("Dependencies only (containment is not counted). Reach is how many elements depend on an element, directly or indirectly. An element that connects otherwise separate parts is a single point of failure.")}</p>
      <button className="btn" onClick={() => showOnCanvas(overlay())}>{t("Show on the diagrams")}</button>
      <h4>{t("Hotspots")}</h4>
      <table className="grid">
        <thead><tr><th>{t("Element")}</th><th>{t("Reach")}</th><th>{t("Used by")}</th><th>{t("Depends on")}</th><th>{t("Instability")}</th><th>{t("Notes")}</th></tr></thead>
        <tbody>
          {s.hotspots.slice(0, 25).map((id) => {
            const m = s.metrics.get(id)!;
            return (
              <tr key={id}>
                <td><Name id={id} /></td><td>{m.reach}</td><td>{m.fanIn}</td><td>{m.fanOut}</td><td>{m.instability}</td>
                <td>{[m.cutVertex && t("single point of failure"), m.inCycle && t("in a cycle")].filter(Boolean).join(", ")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h4>{t("Dependency cycles ({count})", { count: s.cycles.length })}</h4>
      <ul>{s.cycles.map((c, i) => <li key={i}>{c.map((id, j) => <span key={id}>{j ? " → " : ""}<Name id={id} /></span>)}</li>)}</ul>
    </div>
  );
}

function DataTab() {
  const ws = useModel((w) => w);
  const x = useMemo(() => dataExposure(ws), [ws]);
  const classified = Object.values(ws.elements).filter((e) => CLASSIFICATIONS.includes(String(e.properties.dataClassification ?? "").toLowerCase() as never));
  const overlay = (): Overlay => ({
    title: t("Where classified data goes"),
    elements: Object.fromEntries([
      ...[...x.handles].filter(([, h]) => h.level !== "public").map(([id, h]) => [id, { tone: "info" as const, badge: h.level }]),
      ...x.findings.map((f) => [f.element, { tone: "warn" as const, badge: f.external ? t("{level} → external", { level: f.level }) : t("{level} > cleared {cleared}", { level: f.level, cleared: f.cleared ?? "" }) }]),
    ]),
  });
  return (
    <div data-testid="data">
      <p className="muted">{t("Set the property dataClassification (public, internal, confidential, restricted) on elements that hold data, and external: true on systems outside the organisation. Data is followed along relationships, except those with dataFlow: none.")}</p>
      <p>{t("{count} element(s) are classified.", { count: classified.length })} <button className="btn" onClick={() => showOnCanvas(overlay())}>{t("Show on the diagrams")}</button></p>
      <h4 className={x.findings.length ? "sev-error" : undefined}>{t("Findings ({count})", { count: x.findings.length })}</h4>
      <ul>
        {x.findings.map((f) => (
          <li key={f.element}>
            <Name id={f.element} /> {f.external ? t("is external and receives {level} data", { level: f.level }) : t("is cleared for {cleared} but receives {level} data", { cleared: f.cleared ?? "", level: f.level })}
            <div className="muted" style={{ fontSize: 12 }}>{f.path.map((id) => ws.elements[id]?.name).join(" › ")}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CostsTab() {
  const ws = useModel((w) => w);
  const costs = useMemo(() => costRollup(ws), [ws]);
  const rows = [...costs].filter(([, c]) => c.total > 0).sort((a, b) => b[1].total - a[1].total);
  const currency = new Set(rows.map(([id]) => String(ws.elements[id]?.properties.costCurrency ?? "")).filter(Boolean));
  const cur = currency.size === 1 ? [...currency][0] : "";
  const fmt = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}${cur ? ` ${cur}` : ""}`;
  const max = rows[0]?.[1].total ?? 0;
  const overlay = (): Overlay => ({
    title: t("Monthly cost (including contents)"),
    elements: Object.fromEntries(rows.map(([id, c]) => [id, { tone: (c.total >= max * 0.5 ? "warn" : "info") as "warn" | "info", badge: fmt(c.total) }])),
  });
  return (
    <div data-testid="costs">
      <p className="muted">{t("Costs come from the monthlyCost property, set by the Cloud costs connector or by hand, and are added up through containment.")}</p>
      {!rows.length ? <p>{t("No element has a monthlyCost yet.")}</p> : (
        <>
          <button className="btn" onClick={() => showOnCanvas(overlay())}>{t("Show on the diagrams")}</button>
          <table className="grid mt-2">
            <thead><tr><th>{t("Element")}</th><th>{t("Own")}</th><th>{t("Including contents")}</th></tr></thead>
            <tbody>{rows.slice(0, 50).map(([id, c]) => <tr key={id}><td><Name id={id} /></td><td>{c.own ? fmt(c.own) : ""}</td><td>{fmt(c.total)}</td></tr>)}</tbody>
          </table>
        </>
      )}
    </div>
  );
}

/** Analyses over the whole model: what changed, how it will change, how it hangs together, where data goes, what it costs. */
export function InsightsPage() {
  const [tab, setTab] = useState<Tab>("changes");
  const tabs: [Tab, string][] = [["changes", t("What changed")], ["plateaus", t("As-is / to-be")], ["structure", t("Structure")], ["data", t("Data")], ["costs", t("Costs")]];
  return (
    <div style={{ padding: 16, maxWidth: 1100 }} data-testid="insights-page">
      <h2 style={{ marginTop: 0 }}>{t("Insights")}</h2>
      <div role="tablist" className="flex gap-2 mb-3">
        {tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={`btn${tab === id ? " on" : ""}`} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      {tab === "changes" && <ChangesTab />}
      {tab === "plateaus" && <PlateausTab />}
      {tab === "structure" && <StructureTab />}
      {tab === "data" && <DataTab />}
      {tab === "costs" && <CostsTab />}
    </div>
  );
}
