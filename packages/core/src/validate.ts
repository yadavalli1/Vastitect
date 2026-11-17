import type { Id, Workspace } from "./model";
import { presentationType } from "./queries";
import type { Problem, Registry } from "./registry";

/**
 * Notation-agnostic validation. Pack-specific rules arrive as data (validity, viewpoints)
 * or as registered validators; nothing here names a notation.
 */
export function validate(ws: Workspace, reg: Registry): Problem[] {
  const problems: Problem[] = [];
  const connected = new Set<Id>();
  const placed = new Set<Id>();
  const viewsOfRel = new Map<Id, Id[]>();
  for (const v of Object.values(ws.views)) {
    for (const n of v.nodes) placed.add(n.element);
    for (const e of v.edges) viewsOfRel.set(e.relationship, [...(viewsOfRel.get(e.relationship) ?? []), v.id]);
  }

  for (const r of Object.values(ws.relationships)) {
    const s = ws.elements[r.source];
    const t = ws.elements[r.target];
    if (!s || !t) {
      problems.push({
        code: "dangling-relationship",
        severity: "error",
        message: `Relationship points to a missing element`,
        target: { kind: "relationship", id: r.id },
        fixes: [{ label: "Delete relationship", commands: [{ type: "removeRelationship", id: r.id }] }],
      });
      continue;
    }
    connected.add(r.source).add(r.target);
    const notation = r.type.slice(0, r.type.indexOf(":"));
    const pack = reg.packs.get(notation);
    if (!pack) continue;
    if (!reg.relationshipType(r.type)) {
      problems.push({ code: "unknown-type", severity: "warning", message: `Unknown relationship type ${r.type}`, target: { kind: "relationship", id: r.id } });
      continue;
    }
    const st = presentationType(ws, s, notation, reg);
    const tt = presentationType(ws, t, notation, reg);
    if (!st || !tt) continue;
    const { types, strict } = reg.validRelationships(notation, st, tt);
    if (strict && !types.includes(r.type)) {
      const name = reg.relationshipType(r.type)?.name ?? r.type;
      problems.push({
        code: "invalid-relationship",
        severity: "error",
        message: `${name} is not valid from ${reg.elementType(st)?.name ?? st} "${s.name}" to ${reg.elementType(tt)?.name ?? tt} "${t.name}"`,
        target: { kind: "relationship", id: r.id },
        view: viewsOfRel.get(r.id)?.[0],
        fixes: [
          ...types.slice(0, 3).map((ty) => ({
            label: `Change to ${reg.relationshipType(ty)?.name ?? ty}`,
            commands: [{ type: "updateRelationship" as const, id: r.id, patch: { type: ty } }],
          })),
          { label: "Delete relationship", commands: [{ type: "removeRelationship" as const, id: r.id }] },
        ],
      });
    }
  }

  const names = new Map<string, Id[]>();
  const parents = new Set<Id>();
  for (const e of Object.values(ws.elements)) if (e.parent) parents.add(e.parent);
  for (const e of Object.values(ws.elements)) {
    const def = reg.elementType(e.type);
    if (!def && reg.packs.size) {
      problems.push({ code: "unknown-type", severity: "warning", message: `"${e.name}" has unknown type ${e.type}`, target: { kind: "element", id: e.id } });
    }
    if (e.parent && !ws.elements[e.parent]) {
      problems.push({
        code: "dangling-parent",
        severity: "error",
        message: `"${e.name}" has a missing parent`,
        target: { kind: "element", id: e.id },
        fixes: [{ label: "Clear parent", commands: [{ type: "updateElement", id: e.id, patch: { parent: undefined } }] }],
      });
    }
    if (!e.name.trim()) {
      problems.push({ code: "missing-name", severity: "warning", message: `An element of type ${def?.name ?? e.type} has no name`, target: { kind: "element", id: e.id } });
    } else {
      const key = `${e.type}|${e.parent ?? ""}|${e.name.trim().toLowerCase()}`;
      names.set(key, [...(names.get(key) ?? []), e.id]);
    }
    if (!e.description?.trim()) {
      problems.push({ code: "missing-description", severity: "info", message: `"${e.name}" has no description`, target: { kind: "element", id: e.id } });
    }
    if (!connected.has(e.id) && !placed.has(e.id) && !e.parent && !parents.has(e.id)) {
      problems.push({
        code: "orphan",
        severity: "info",
        message: `"${e.name}" is not connected to anything and appears in no view`,
        target: { kind: "element", id: e.id },
        fixes: [{ label: "Delete element", commands: [{ type: "removeElement", id: e.id }] }],
      });
    }
  }
  for (const ids of names.values()) {
    if (ids.length < 2) continue;
    for (const id of ids)
      problems.push({
        code: "duplicate-name",
        severity: "warning",
        message: `${ids.length} elements of the same type are named "${ws.elements[id].name}"`,
        target: { kind: "element", id },
      });
  }

  for (const v of Object.values(ws.views)) {
    const allowed = reg.viewpoint(v.notation, v.viewpoint)?.elementTypes;
    for (const n of v.nodes) {
      const e = ws.elements[n.element];
      if (!e) {
        problems.push({
          code: "dangling-node",
          severity: "error",
          message: `View "${v.name}" places a missing element`,
          target: { kind: "view", id: v.id },
          view: v.id,
          fixes: [{ label: "Remove from view", commands: [{ type: "removeNode", view: v.id, element: n.element }] }],
        });
        continue;
      }
      if (!reg.packs.has(v.notation)) continue;
      const pt = presentationType(ws, e, v.notation, reg);
      if (!pt) {
        problems.push({
          code: "no-mapping",
          severity: "warning",
          message: `"${e.name}" (${reg.elementType(e.type)?.name ?? e.type}) has no mapping to ${reg.packs.get(v.notation)?.name} in view "${v.name}"`,
          target: { kind: "element", id: e.id },
          view: v.id,
        });
      } else if (allowed && !allowed.includes(pt)) {
        problems.push({
          code: "not-in-viewpoint",
          severity: "warning",
          message: `${reg.elementType(pt)?.name ?? pt} "${e.name}" is not part of the ${reg.viewpoint(v.notation, v.viewpoint)?.name} viewpoint`,
          target: { kind: "element", id: e.id },
          view: v.id,
          fixes: [{ label: "Remove from view", commands: [{ type: "removeNode", view: v.id, element: e.id }] }],
        });
      }
    }
    for (const ed of v.edges) {
      if (!ws.relationships[ed.relationship])
        problems.push({
          code: "dangling-edge",
          severity: "error",
          message: `View "${v.name}" shows a missing relationship`,
          target: { kind: "view", id: v.id },
          view: v.id,
          fixes: [{ label: "Remove from view", commands: [{ type: "removeEdge", view: v.id, relationship: ed.relationship }] }],
        });
    }
  }

  for (const p of reg.packs.values()) {
    if (p.validity?.note && ws.packs.includes(p.id)) {
      problems.push({ code: "validity-note", severity: "info", message: `${p.name}: ${p.validity.note}`, target: { kind: "workspace" } });
    }
  }
  return problems;
}
