import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from "immer";
import type {
  Adr,
  Annotation,
  Comment,
  Element,
  Id,
  MappingRule,
  ModelPatch,
  Relationship,
  SavedFilter,
  View,
  ViewEdge,
  ViewNode,
  Workspace,
} from "./model";

enablePatches();

/**
 * Commands are the only write path. They are plain serialisable objects expressed as
 * fine-grained keyed operations so a Yjs binding can be added later without changing callers.
 */
export type Command =
  | { type: "addElement"; element: Element }
  | { type: "updateElement"; id: Id; patch: Partial<Element> }
  | { type: "removeElement"; id: Id }
  | { type: "addRelationship"; relationship: Relationship }
  | { type: "updateRelationship"; id: Id; patch: Partial<Relationship> }
  | { type: "removeRelationship"; id: Id }
  | { type: "addView"; view: View }
  | { type: "updateView"; id: Id; patch: Partial<View> }
  | { type: "removeView"; id: Id }
  | { type: "putNode"; view: Id; node: ViewNode }
  | { type: "updateNodes"; view: Id; nodes: (Partial<ViewNode> & { element: Id })[] }
  | { type: "removeNode"; view: Id; element: Id }
  | { type: "putEdge"; view: Id; edge: ViewEdge }
  | { type: "removeEdge"; view: Id; relationship: Id }
  | { type: "putAnnotation"; view: Id; annotation: Annotation }
  | { type: "removeAnnotation"; view: Id; id: Id }
  | { type: "setMappings"; mappings: MappingRule[] }
  | { type: "setSettings"; patch: { name?: string; packs?: string[]; savedFilters?: SavedFilter[]; pluginSettings?: Record<string, unknown>; rules?: unknown[] } }
  | { type: "putAdr"; adr: Adr }
  | { type: "removeAdr"; id: string }
  | { type: "putComment"; comment: Comment }
  | { type: "removeComment"; id: string }
  | { type: "applyPatch"; patch: ModelPatch }
  | { type: "replace"; workspace: Workspace };

function assign<T extends object>(target: T, patch: Partial<T>) {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete (target as Record<string, unknown>)[k];
    else (target as Record<string, unknown>)[k] = v;
  }
}

function removeElement(ws: Draft<Workspace>, id: Id) {
  if (!ws.elements[id]) return;
  delete ws.elements[id];
  for (const r of Object.values(ws.relationships)) if (r.source === id || r.target === id) removeRelationship(ws, r.id);
  for (const e of Object.values(ws.elements)) if (e.parent === id) delete e.parent;
  for (const v of Object.values(ws.views)) {
    v.nodes = v.nodes.filter((n) => n.element !== id);
    for (const n of v.nodes) if (n.parent === id) delete n.parent;
    if (v.subject === id) delete v.subject;
  }
  for (const a of Object.values(ws.adrs)) a.elements = a.elements.filter((e) => e !== id);
  for (const c of Object.values(ws.comments ?? {})) if (c.target.kind === "element" && c.target.id === id) delete ws.comments![c.id];
}

function removeRelationship(ws: Draft<Workspace>, id: Id) {
  delete ws.relationships[id];
  for (const v of Object.values(ws.views)) v.edges = v.edges.filter((e) => e.relationship !== id);
}

/** Pure reducer over an immer draft. */
export function reduce(ws: Draft<Workspace>, c: Command): void {
  switch (c.type) {
    case "addElement":
      ws.elements[c.element.id] = c.element;
      break;
    case "updateElement":
      if (ws.elements[c.id]) assign(ws.elements[c.id], c.patch);
      break;
    case "removeElement":
      removeElement(ws, c.id);
      break;
    case "addRelationship":
      ws.relationships[c.relationship.id] = c.relationship;
      break;
    case "updateRelationship":
      if (ws.relationships[c.id]) assign(ws.relationships[c.id], c.patch);
      break;
    case "removeRelationship":
      removeRelationship(ws, c.id);
      break;
    case "addView":
      ws.views[c.view.id] = c.view;
      break;
    case "updateView":
      if (ws.views[c.id]) assign(ws.views[c.id], c.patch);
      break;
    case "removeView":
      delete ws.views[c.id];
      break;
    case "putNode": {
      const v = ws.views[c.view];
      if (!v) break;
      const i = v.nodes.findIndex((n) => n.element === c.node.element);
      if (i >= 0) v.nodes[i] = c.node;
      else v.nodes.push(c.node);
      break;
    }
    case "updateNodes": {
      const v = ws.views[c.view];
      if (!v) break;
      const byId = new Map(v.nodes.map((n) => [n.element, n]));
      for (const p of c.nodes) {
        const n = byId.get(p.element);
        if (n) assign(n, p);
      }
      break;
    }
    case "removeNode": {
      const v = ws.views[c.view];
      if (!v) break;
      v.nodes = v.nodes.filter((n) => n.element !== c.element);
      for (const n of v.nodes) if (n.parent === c.element) delete n.parent;
      break;
    }
    case "putEdge": {
      const v = ws.views[c.view];
      if (!v) break;
      const i = v.edges.findIndex((e) => e.relationship === c.edge.relationship);
      if (i >= 0) v.edges[i] = c.edge;
      else v.edges.push(c.edge);
      break;
    }
    case "removeEdge": {
      const v = ws.views[c.view];
      if (v) v.edges = v.edges.filter((e) => e.relationship !== c.relationship);
      break;
    }
    case "putAnnotation": {
      const v = ws.views[c.view];
      if (!v) break;
      const i = v.annotations.findIndex((a) => a.id === c.annotation.id);
      if (i >= 0) v.annotations[i] = c.annotation;
      else v.annotations.push(c.annotation);
      break;
    }
    case "removeAnnotation": {
      const v = ws.views[c.view];
      if (v) v.annotations = v.annotations.filter((a) => a.id !== c.id);
      break;
    }
    case "setMappings":
      ws.mappings = c.mappings;
      break;
    case "setSettings":
      assign(ws, c.patch);
      break;
    case "putAdr":
      ws.adrs[c.adr.id] = c.adr;
      break;
    case "removeAdr":
      delete ws.adrs[c.id];
      break;
    case "putComment":
      (ws.comments ??= {})[c.comment.id] = c.comment;
      break;
    case "removeComment":
      if (ws.comments) {
        delete ws.comments[c.id];
        for (const x of Object.values(ws.comments)) if (x.replyTo === c.id) delete ws.comments[x.id];
      }
      break;
    case "applyPatch": {
      const p = c.patch;
      for (const id of p.removeViews ?? []) delete ws.views[id];
      for (const id of p.removeRelationships ?? []) removeRelationship(ws, id);
      for (const id of p.removeElements ?? []) removeElement(ws, id);
      for (const e of p.elements ?? []) ws.elements[e.id] = e;
      for (const r of p.relationships ?? []) ws.relationships[r.id] = r;
      for (const v of p.views ?? []) ws.views[v.id] = v;
      for (const a of p.adrs ?? []) ws.adrs[a.id] = a;
      break;
    }
    case "replace":
      return void Object.assign(ws, c.workspace);
  }
}

interface HistoryEntry {
  label: string;
  patches: Patch[];
  inverse: Patch[];
  context?: unknown;
}

export interface DispatchOptions {
  label?: string;
  /** Opaque UI context (e.g. active view) restored on undo. */
  context?: unknown;
  /** Skip the undo stack (used for reloads from disk). */
  silent?: boolean;
  /** Merge into the previous undo entry if it has the same label (typing in a field). */
  coalesce?: boolean;
}

export type Listener = (state: Workspace, change: { patches: Patch[]; origin: "local" | "undo" | "redo" | "external" }) => void;

/** Immutable model store with command-based undo/redo across model and layout. */
export class ModelStore {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private listeners = new Set<Listener>();
  /** Monotonic counter, bumped on every change. */
  version = 0;

  constructor(public state: Workspace) {}

  getState = () => this.state;

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };

  private emit(patches: Patch[], origin: "local" | "undo" | "redo" | "external") {
    this.version++;
    for (const l of this.listeners) l(this.state, { patches, origin });
  }

  /** Apply one command, or several as a single undo step. */
  dispatch(commands: Command | Command[], opts: DispatchOptions = {}) {
    const list = Array.isArray(commands) ? commands : [commands];
    if (!list.length) return;
    const [next, patches, inverse] = produceWithPatches(this.state, (draft) => {
      for (const c of list) reduce(draft, c);
    });
    if (!patches.length) return;
    this.state = next;
    if (!opts.silent) {
      const label = opts.label ?? list[0].type;
      const last = this.undoStack[this.undoStack.length - 1];
      if (opts.coalesce && last && last.label === label) {
        last.patches.push(...patches);
        last.inverse.unshift(...inverse);
      } else {
        this.undoStack.push({ label, patches, inverse, context: opts.context });
        if (this.undoStack.length > 500) this.undoStack.shift();
      }
      this.redoStack = [];
    }
    this.emit(patches, opts.silent ? "external" : "local");
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  undo(): unknown {
    const e = this.undoStack.pop();
    if (!e) return undefined;
    this.state = applyPatches(this.state, e.inverse);
    this.redoStack.push(e);
    this.emit(e.inverse, "undo");
    return e.context;
  }

  redo(): unknown {
    const e = this.redoStack.pop();
    if (!e) return undefined;
    this.state = applyPatches(this.state, e.patches);
    this.undoStack.push(e);
    this.emit(e.patches, "redo");
    return e.context;
  }

  /** Replace the whole workspace (open, reload) and clear history. */
  reset(ws: Workspace) {
    this.state = ws;
    this.undoStack = [];
    this.redoStack = [];
    this.emit([], "external");
  }
}
