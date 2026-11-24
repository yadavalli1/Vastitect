import { DEFAULT_MAPPINGS, type MappingRule } from "@vastitecture/core";
import { dispatch, registry, useModel, useRegistryVersion } from "../state";
import { t } from "../i18n";
import { ArrowLeftRight, Trash2 } from "lucide-react";
import { PageHeader } from "../ui";

/** The cross-notation mapping table: which types in each notation stand for the same concept. */
export function MappingsPage() {
  useRegistryVersion();
  const mappings = useModel((ws) => ws.mappings);
  const packs = [...registry.packs.values()].filter((p) => p.elementTypes.length && p.id !== "generic");
  const save = (next: MappingRule[], label = t("Edit mapping")) => dispatch({ type: "setMappings", mappings: next }, label);
  const setMembers = (i: number, pack: string, types: string[]) => {
    const members = { ...mappings[i].members };
    if (types.length) members[pack] = types;
    else delete members[pack];
    save(mappings.map((m, j) => (j === i ? { ...m, members } : m)));
  };
  return (
    <div className="page" data-testid="mappings-page">
      <PageHeader icon={ArrowLeftRight} title={t("Cross-notation mapping")} description={t("One element can appear in several notations. When an element is dropped into a view of another notation it is drawn as the first type listed for that notation in its row. Elements keep a single identity, so a rename shows everywhere.")} />
      <table className="data-table">
        <thead>
          <tr>
            <th>{t("Concept")}</th>
            {packs.map((p) => <th key={p.id}>{p.name}</th>)}
            <th />
          </tr>
        </thead>
        <tbody>
          {mappings.map((m, i) => (
            <tr key={m.concept + i}>
              <td style={{ minWidth: 160 }}>
                <input aria-label={t("Concept name")} defaultValue={m.label ?? m.concept} onBlur={(e) => e.target.value !== (m.label ?? m.concept) && save(mappings.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <div className="muted" style={{ fontSize: 10 }}>{m.concept}</div>
              </td>
              {packs.map((p) => {
                const cur = m.members[p.id] ?? [];
                return (
                  <td key={p.id} style={{ minWidth: 170 }}>
                    {cur.map((ty, k) => (
                      <div key={ty} className="flex items-center gap-1">
                        <span style={{ fontWeight: k === 0 ? 600 : 400 }}>{registry.elementType(ty)?.name ?? ty}</span>
                        <button className="btn ghost" style={{ padding: "0 4px" }} aria-label={t("Remove {type}", { type: ty })} onClick={() => setMembers(i, p.id, cur.filter((x) => x !== ty))}>×</button>
                      </div>
                    ))}
                    <select aria-label={t("Add {notation} type to {concept}", { notation: p.name, concept: m.label ?? m.concept })} value="" onChange={(e) => e.target.value && setMembers(i, p.id, [...cur, e.target.value])}>
                      <option value="">{t("+ add")}</option>
                      {p.elementTypes.filter((ty) => !cur.includes(ty.id)).map((ty) => <option key={ty.id} value={ty.id}>{ty.name}</option>)}
                    </select>
                  </td>
                );
              })}
              <td><button className="btn ghost" aria-label={t("Delete rule")} onClick={() => save(mappings.filter((_, j) => j !== i), t("Delete mapping rule"))}><Trash2 size={14} aria-hidden /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2 mt-3">
        <button className="btn" onClick={() => save([...mappings, { concept: `concept-${mappings.length + 1}`, label: t("New concept"), members: {} }], t("Add mapping rule"))}>{t("Add concept")}</button>
        <button className="btn" onClick={() => save(DEFAULT_MAPPINGS, t("Reset mappings"))}>{t("Reset to defaults")}</button>
      </div>
    </div>
  );
}
