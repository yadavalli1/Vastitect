import { dispatch, registry, select, set, useModel, useRegistryVersion } from "../state";
import { t } from "../i18n";

/** Architecture repository: every view grouped by ADM phase and architecture domain. */
export function RepositoryPage() {
  useRegistryVersion();
  const views = useModel((ws) => ws.views);
  const elements = useModel((ws) => ws.elements);
  const defs = [...registry.packs.values()].flatMap((p) => p.viewProperties ?? []);
  const phases = defs.find((d) => d.key === "admPhase")?.options ?? [];
  const domains = defs.find((d) => d.key === "architectureDomain")?.options ?? [];
  const list = Object.values(views).sort((a, b) => a.name.localeCompare(b.name));
  const cell = (phase: string, domain: string) => list.filter((v) => String(v.properties.admPhase ?? "") === phase && String(v.properties.architectureDomain ?? "") === domain);
  const setProp = (id: string, key: string, value: string) => {
    const properties = { ...views[id].properties };
    if (value) properties[key] = value;
    else delete properties[key];
    dispatch({ type: "updateView", id, patch: { properties } }, t("Tag view"));
  };
  const open = (id: string) => (set({ activeView: id, page: "diagram" }), select());
  const tagged = (phase: string) => Object.values(elements).filter((e) => e.properties.admPhase === phase).length;
  return (
    <div style={{ padding: 16 }} data-testid="repository-page">
      <h2 style={{ marginTop: 0 }}>{t("Architecture repository")}</h2>
      <p className="muted">{t("Views grouped by ADM phase and architecture domain. Tag a view in its properties, or with the selectors under “Untagged views”.")}</p>
      <table className="grid">
        <thead>
          <tr>
            <th>{t("ADM phase")}</th>
            {["", ...domains].map((d) => <th key={d}>{d || t("No domain")}</th>)}
            <th>{t("Tagged elements")}</th>
          </tr>
        </thead>
        <tbody>
          {phases.map((p) => (
            <tr key={p}>
              <th scope="row" style={{ position: "static" }}>{p}</th>
              {["", ...domains].map((d) => (
                <td key={d}>
                  {cell(p, d).map((v) => (
                    <div key={v.id}><button className="btn ghost" style={{ padding: "0 4px", color: "var(--accent)" }} onClick={() => open(v.id)}>{v.name}</button></div>
                  ))}
                </td>
              ))}
              <td>{tagged(p) || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>{t("Untagged views")}</h3>
      <table className="grid" style={{ maxWidth: 900 }}>
        <tbody>
          {list.filter((v) => !v.properties.admPhase).map((v) => (
            <tr key={v.id}>
              <td><button className="btn ghost" style={{ padding: "0 4px", color: "var(--accent)" }} onClick={() => open(v.id)}>{v.name}</button></td>
              <td className="muted">{registry.packs.get(v.notation)?.name}</td>
              <td>
                <select aria-label={t("ADM phase for {name}", { name: v.name })} value="" onChange={(e) => setProp(v.id, "admPhase", e.target.value)}>
                  <option value="">{t("Set ADM phase…")}</option>
                  {phases.map((p) => <option key={p}>{p}</option>)}
                </select>
              </td>
              <td>
                <select aria-label={t("Domain for {name}", { name: v.name })} value={String(v.properties.architectureDomain ?? "")} onChange={(e) => setProp(v.id, "architectureDomain", e.target.value)}>
                  <option value="">{t("Domain…")}</option>
                  {domains.map((p) => <option key={p}>{p}</option>)}
                </select>
              </td>
            </tr>
          ))}
          {!list.some((v) => !v.properties.admPhase) && <tr><td className="muted">{t("Every view is tagged")}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
