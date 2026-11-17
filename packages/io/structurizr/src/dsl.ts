import {
  makeElement,
  makeRelationship,
  makeView,
  slugify,
  type Element,
  type Id,
  type ModelPatch,
  type Relationship,
  type View,
  type ViewNode,
  type Workspace,
} from "@vastitecture/plugin-sdk";

export const SIZES: Record<string, [number, number]> = {
  "c4:Person": [150, 150],
  "c4:SoftwareSystem": [200, 110],
  "c4:Container": [190, 110],
  "c4:Component": [180, 100],
  "c4:DeploymentNode": [340, 220],
  "c4:InfrastructureNode": [180, 90],
};

const DEFAULT_TAGS = new Set(["Element", "Person", "Software System", "Container", "Component", "Deployment Node", "Infrastructure Node", "Relationship", "Container Instance", "Software System Instance"]);
const SHAPE_KIND: Record<string, string> = { cylinder: "Database", pipe: "Queue", webbrowser: "Browser", mobiledeviceportrait: "Mobile", mobiledevicelandscape: "Mobile", folder: "Folder" };

interface Line {
  tokens: string[];
  no: number;
}

/** Split DSL text into token lines. Handles quotes, comments, line continuations and ${constants}. */
export function tokenize(text: string): Line[] {
  const out: Line[] = [];
  const src = text.replace(/\r\n?/g, "\n").replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\\\n/g, " ");
  src.split("\n").forEach((raw, i) => {
    const tokens: string[] = [];
    let j = 0;
    while (j < raw.length) {
      const c = raw[j];
      if (c === " " || c === "\t") {
        j++;
      } else if (c === '"') {
        let s = "";
        j++;
        while (j < raw.length && raw[j] !== '"') {
          if (raw[j] === "\\" && j + 1 < raw.length) j++;
          s += raw[j++];
        }
        j++;
        tokens.push('"' + s);
      } else if ((c === "/" && raw[j + 1] === "/") || (c === "#" && !tokens.length)) {
        break;
      } else if (c === "{" || c === "}") {
        tokens.push(c);
        j++;
      } else {
        let s = "";
        while (j < raw.length && !/[\s{}]/.test(raw[j])) s += raw[j++];
        tokens.push(s);
      }
    }
    if (tokens.length) out.push({ tokens, no: i + 1 });
  });
  return out;
}

const unq = (t: string | undefined) => (t === undefined ? undefined : t.startsWith('"') ? t.slice(1) : t);
const splitTags = (t: string | undefined) => (unq(t) ?? "").split(",").map((x) => x.trim()).filter((x) => x && !DEFAULT_TAGS.has(x));

interface Scope {
  kind: string;
  element?: Element;
  path?: string;
  env?: string;
  group?: string;
}

/** Parse Structurizr DSL into a patch of C4 elements, relationships and views (to be auto-laid out). */
export function parseDsl(text: string): ModelPatch {
  const lines = tokenize(text);
  const report: string[] = [];
  const elements: Element[] = [];
  const relationships: Relationship[] = [];
  const views: View[] = [];
  const idents = new Map<string, Id>();
  const byId = new Map<Id, Element>();
  const relIdents = new Map<string, Id>();
  const constants = new Map<string, string>();
  const tagShapes = new Map<string, string>();
  /** For duplicates: which deployment node each instance lives in, per view. */
  const instances: { node: Id; target: Id; env: string }[] = [];
  let hierarchical = false;
  let name = "";
  let pos = 0;

  const subst = (t: string) => t.replace(/\$\{([^}]+)\}/g, (_, k) => constants.get(k) ?? "");
  const skipBlock = () => {
    let depth = 1;
    while (pos < lines.length && depth > 0) {
      for (const t of lines[pos].tokens) depth += t === "{" ? 1 : t === "}" ? -1 : 0;
      pos++;
    }
  };

  const register = (ident: string | undefined, el: Element, scope: Scope[]) => {
    byId.set(el.id, el);
    elements.push(el);
    if (!ident) return undefined;
    const parentPath = [...scope].reverse().find((s) => s.path)?.path;
    const path = hierarchical && parentPath ? `${parentPath}.${ident}` : ident;
    idents.set(path.toLowerCase(), el.id);
    if (!idents.has(ident.toLowerCase())) idents.set(ident.toLowerCase(), el.id);
    return path;
  };
  const resolve = (ref: string, scope: Scope[]): Id | undefined => {
    const r = ref.toLowerCase();
    if (r === "this") return [...scope].reverse().find((s) => s.element)?.element!.id;
    for (let i = scope.length - 1; i >= 0; i--) {
      const p = scope[i].path;
      if (p && idents.has(`${p}.${r}`.toLowerCase())) return idents.get(`${p}.${r}`.toLowerCase());
    }
    return idents.get(r);
  };
  const applyTags = (el: Element, tags: string[]) => {
    for (const t of tags) {
      if (t === "External") el.properties.location = "External";
      if (!el.tags.includes(t)) el.tags.push(t);
    }
  };

  const parseModel = (scope: Scope[]) => {
    while (pos < lines.length) {
      const { tokens: raw, no } = lines[pos++];
      const t = raw.map(subst);
      if (t[0] === "}") return;
      const opens = t[t.length - 1] === "{";
      const body = opens ? t.slice(0, -1) : t;
      let ident: string | undefined;
      let rest = body;
      if (body[1] === "=") {
        ident = body[0];
        rest = body.slice(2);
      }
      const cur = scope[scope.length - 1];
      const parent = [...scope].reverse().find((s) => s.element)?.element;
      const group = [...scope].reverse().find((s) => s.group)?.group;
      const kw = rest[0]?.toLowerCase();

      // relationship: a -> b "desc" "tech" "tags"   |   -> b "desc"
      const arrow = rest.indexOf("->");
      if (arrow === 0 || arrow === 1) {
        const srcRef = arrow === 0 ? "this" : rest[0];
        const s = resolve(srcRef, scope);
        const d = resolve(rest[arrow + 1] ?? "", scope);
        if (!s || !d) report.push(`Line ${no}: relationship skipped, unknown element "${!s ? srcRef : rest[arrow + 1]}"`);
        else {
          const rel = makeRelationship("c4:Uses", s, d);
          const label = unq(rest[arrow + 2]);
          const tech = unq(rest[arrow + 3]);
          if (label) rel.label = label;
          if (tech) rel.technology = tech;
          const tags = splitTags(rest[arrow + 4]);
          if (tags.length) rel.properties.tags = tags;
          relationships.push(rel);
          if (ident) relIdents.set(ident.toLowerCase(), rel.id);
        }
        if (opens) skipBlock();
        continue;
      }

      const make = (type: string, nm: string | undefined, desc?: string, tech?: string, tags?: string, extra: Partial<Element> = {}) => {
        const el = makeElement(type, unq(nm) ?? ident ?? "Unnamed", { ...(parent ? { parent: parent.id } : {}), ...extra });
        if (unq(desc)) el.description = unq(desc);
        if (unq(tech)) el.properties.technology = unq(tech)!;
        applyTags(el, splitTags(tags));
        if (group) el.properties.group = group;
        const path = register(ident, el, scope);
        if (opens) parseModel([...scope, { kind: type, element: el, path, env: cur?.env }]);
        return el;
      };

      switch (kw) {
        case "person":
          make("c4:Person", rest[1], rest[2], undefined, rest[3]);
          break;
        case "softwaresystem":
          make("c4:SoftwareSystem", rest[1], rest[2], undefined, rest[3]);
          break;
        case "container":
          make("c4:Container", rest[1], rest[2], rest[3], rest[4]);
          break;
        case "component":
          make("c4:Component", rest[1], rest[2], rest[3], rest[4]);
          break;
        case "deploymentnode": {
          const el = make("c4:DeploymentNode", rest[1], rest[2], rest[3], rest[4], cur?.env ? { properties: { environment: cur.env } } : {});
          if (unq(rest[5])) el.properties.instances = unq(rest[5])!;
          break;
        }
        case "infrastructurenode":
          make("c4:InfrastructureNode", rest[1], rest[2], rest[3], rest[4], cur?.env ? { properties: { environment: cur.env } } : {});
          break;
        case "containerinstance":
        case "softwaresysteminstance": {
          const target = resolve(rest[1] ?? "", scope);
          if (!target || !parent) report.push(`Line ${no}: instance skipped, unknown element "${rest[1]}"`);
          else {
            instances.push({ node: parent.id, target, env: cur?.env ?? "" });
            if (ident) idents.set(ident.toLowerCase(), target);
          }
          if (opens) skipBlock();
          break;
        }
        case "deploymentenvironment":
          if (opens) parseModel([...scope, { kind: "env", env: unq(rest[1]) ?? "Default" }]);
          break;
        case "group":
          if (opens) parseModel([...scope, { kind: "group", env: cur?.env, group: unq(rest[1]) }]);
          break;
        case "enterprise":
          if (opens) parseModel(scope);
          break;
        case "description":
          if (parent) parent.description = unq(rest[1]);
          break;
        case "technology":
          if (parent && unq(rest[1])) parent.properties.technology = unq(rest[1])!;
          break;
        case "tags":
        case "tag":
          if (parent) applyTags(parent, rest.slice(1).flatMap((x) => splitTags(x)));
          break;
        case "url":
          if (parent && unq(rest[1])) parent.links.push({ kind: "doc", href: unq(rest[1])! });
          break;
        case "properties":
          while (pos < lines.length && lines[pos].tokens[0] !== "}") {
            const [k, v] = lines[pos++].tokens.map(subst);
            if (parent && k && v !== undefined) parent.properties[unq(k)!] = unq(v)!;
          }
          pos++;
          break;
        case "!identifiers":
          hierarchical = rest[1]?.toLowerCase() === "hierarchical";
          break;
        case "!impliedrelationships":
          break;
        default:
          if (kw && kw !== "{") report.push(`Line ${no}: "${rest[0]}" is not supported and was skipped`);
          if (opens) skipBlock();
      }
    }
  };

  const top = (id: Id): Id => {
    let cur = byId.get(id)!;
    while (cur.parent && byId.has(cur.parent) && cur.type !== "c4:SoftwareSystem" && cur.type !== "c4:Person") cur = byId.get(cur.parent)!;
    return cur.id;
  };
  const isDeployment = (e: Element) => e.type === "c4:DeploymentNode" || e.type === "c4:InfrastructureNode";
  const ancestorsOf = (id: Id) => {
    const out: Id[] = [];
    for (let p = byId.get(id)?.parent; p && byId.has(p); p = byId.get(p)!.parent) out.push(p);
    return out;
  };
  const within = (id: Id, root: Id) => id === root || ancestorsOf(id).includes(root);

  /** Elements shown for `include *`, following the C4 rules for each view type. */
  const defaultScope = (kind: string, subject: Id | undefined, env: string | undefined): Id[] => {
    const out = new Set<Id>();
    const statics = elements.filter((e) => !isDeployment(e));
    if (kind === "c4:landscape") for (const e of statics) if (e.type === "c4:Person" || e.type === "c4:SoftwareSystem") out.add(e.id);
    if (kind === "c4:context" && subject) {
      out.add(subject);
      for (const r of relationships) {
        const a = within(r.source, subject), b = within(r.target, subject);
        if (a !== b) out.add(top(a ? r.target : r.source));
      }
    }
    if ((kind === "c4:container" || kind === "c4:component") && subject) {
      out.add(subject);
      const inner = statics.filter((e) => e.parent === subject);
      for (const e of inner) out.add(e.id);
      const system = kind === "c4:component" ? byId.get(subject)?.parent : undefined;
      for (const r of relationships) {
        const a = within(r.source, subject), b = within(r.target, subject);
        if (a === b) continue;
        const other = a ? r.target : r.source;
        // In a component view, sibling containers of the same system stay as containers.
        if (system && within(other, system)) out.add([other, ...ancestorsOf(other)].find((x) => byId.get(x)?.parent === system) ?? top(other));
        else out.add(top(other));
      }
    }
    if (kind === "c4:deployment") {
      for (const e of elements) if (isDeployment(e) && (!env || e.properties.environment === env)) out.add(e.id);
      for (const i of instances) if (!env || i.env === env) if (!subject || within(i.target, subject)) out.add(i.target);
    }
    return [...out];
  };

  const parseViews = () => {
    while (pos < lines.length) {
      const { tokens: raw, no } = lines[pos++];
      const t = raw.map(subst);
      if (t[0] === "}") return;
      const opens = t[t.length - 1] === "{";
      const a = opens ? t.slice(0, -1) : t;
      const kw = a[0].toLowerCase();
      const kinds: Record<string, string> = {
        systemlandscape: "c4:landscape",
        systemcontext: "c4:context",
        container: "c4:container",
        component: "c4:component",
        dynamic: "c4:dynamic",
        deployment: "c4:deployment",
      };
      if (kw === "styles" && opens) {
        while (pos < lines.length && lines[pos].tokens[0] !== "}") {
          const l = lines[pos++].tokens;
          if (l[0].toLowerCase() === "element" && l[l.length - 1] === "{") {
            const tag = unq(l[1])!;
            while (pos < lines.length && lines[pos].tokens[0] !== "}") {
              const [k, v] = lines[pos++].tokens;
              if (k.toLowerCase() === "shape" && v) tagShapes.set(tag, unq(v)!.toLowerCase());
            }
            pos++;
          } else if (l[l.length - 1] === "{") skipBlock();
        }
        pos++;
        continue;
      }
      const viewpoint = kinds[kw];
      if (!viewpoint) {
        if (!["theme", "themes", "branding", "terminology", "properties"].includes(kw)) report.push(`Line ${no}: view statement "${a[0]}" is not supported and was skipped`);
        if (opens) skipBlock();
        continue;
      }
      let args = a.slice(1);
      let subject: Id | undefined;
      let env: string | undefined;
      if (viewpoint !== "c4:landscape") {
        const ref = args.shift();
        if (ref && ref !== "*") {
          subject = resolve(unq(ref)!, []);
          if (!subject) report.push(`Line ${no}: view scope "${ref}" not found`);
        }
      }
      if (viewpoint === "c4:deployment") env = unq(args.shift());
      const key = unq(args[0]);
      const desc = unq(args[1]);
      const subjectName = subject ? byId.get(subject)!.name : undefined;
      const vpName = { "c4:landscape": "System Landscape", "c4:context": "System Context", "c4:container": "Containers", "c4:component": "Components", "c4:dynamic": "Dynamic", "c4:deployment": "Deployment" }[viewpoint];
      const view = makeView("c4", key ?? [subjectName, vpName, env].filter(Boolean).join(" – "), { viewpoint, ...(subject ? { subject } : {}) });
      if (desc) view.description = desc;
      if (env) view.properties.environment = env;
      if (key) view.properties.key = key;
      const included = new Set<Id>();
      const excluded = new Set<Id>();
      let sawInclude = false;
      let order = 1;
      while (opens && pos < lines.length && lines[pos].tokens[0] !== "}") {
        const l = lines[pos++];
        const s = l.tokens.map(subst);
        const k = s[0].toLowerCase();
        if (s[s.length - 1] === "{") {
          skipBlock();
          continue;
        }
        const arrowAt = s.indexOf("->");
        if (viewpoint === "c4:dynamic" && arrowAt >= 1) {
          const src = resolve(unq(s[arrowAt - 1])!, []);
          const dst = resolve(unq(s[arrowAt + 1] ?? "")!, []);
          if (!src || !dst) {
            report.push(`Line ${l.no}: dynamic step skipped, unknown element`);
            continue;
          }
          const label = unq(s[arrowAt + 2]);
          let rel = relationships.find((r) => r.source === src && r.target === dst && (!label || r.label === label)) ?? relationships.find((r) => r.source === src && r.target === dst);
          if (!rel) {
            rel = makeRelationship("c4:Uses", src, dst, label ? { label } : {});
            relationships.push(rel);
          }
          included.add(src).add(dst);
          view.edges.push({ relationship: rel.id, order: order++ });
        } else if (k === "include" || k === "exclude") {
          const set = k === "include" ? included : excluded;
          if (k === "include") sawInclude = true;
          for (const ref of s.slice(1)) {
            if (ref === "*" || ref === "*?") for (const id of defaultScope(viewpoint, subject, env)) set.add(id);
            else if (ref.includes("->") || ref.includes("=")) report.push(`Line ${l.no}: expression "${s.slice(1).join(" ")}" is not supported; add the elements by identifier`);
            else {
              const id = resolve(unq(ref)!, []) ?? relIdents.get(unq(ref)!.toLowerCase());
              if (id && byId.has(id)) set.add(id);
              else if (!id) report.push(`Line ${l.no}: "${ref}" not found`);
            }
          }
        } else if (k === "title") view.name = unq(s[1]) ?? view.name;
        else if (k === "description") view.description = unq(s[1]);
        else if (k === "autolayout") view.properties.autoLayout = (unq(s[1]) ?? "tb").toLowerCase();
      }
      if (opens) pos++;
      if (!sawInclude && viewpoint !== "c4:dynamic") for (const id of defaultScope(viewpoint, subject, env)) included.add(id);
      for (const id of excluded) included.delete(id);
      if (subject && (viewpoint === "c4:container" || viewpoint === "c4:component")) included.add(subject);

      // Deployment: instances are drawn inside their node. One placement per element per view.
      const instanceParent = new Map<Id, Id>();
      if (viewpoint === "c4:deployment")
        for (const i of instances) {
          if (env && i.env !== env) continue;
          if (instanceParent.has(i.target)) report.push(`"${byId.get(i.target)!.name}" is deployed more than once in ${env ?? "this environment"}; only the first instance is drawn`);
          else instanceParent.set(i.target, i.node);
        }
      for (const id of included) {
        const el = byId.get(id)!;
        const [w, h] = SIZES[el.type] ?? [160, 80];
        const node: ViewNode = { element: id, x: 0, y: 0, w, h };
        const p = viewpoint === "c4:deployment" ? instanceParent.get(id) ?? (isDeployment(el) ? el.parent : undefined) : el.parent;
        if (p && included.has(p)) node.parent = p;
        view.nodes.push(node);
      }
      if (viewpoint !== "c4:dynamic")
        for (const r of relationships) if (included.has(r.source) && included.has(r.target)) view.edges.push({ relationship: r.id });
      views.push(view);
    }
  };

  const parseWorkspace = () => {
    while (pos < lines.length) {
      const { tokens: raw, no } = lines[pos++];
      const t = raw.map(subst);
      const kw = t[0].toLowerCase();
      const opens = t[t.length - 1] === "{";
      if (kw === "}") return;
      if (kw === "workspace") {
        if (t[1] && t[1] !== "{" && t[1].toLowerCase() !== "extends") name = unq(t[1])!;
        if (t[1]?.toLowerCase() === "extends") report.push(`Line ${no}: "workspace extends" is not supported; only this file was read`);
        if (opens) parseWorkspace();
      } else if (kw === "model") parseModel([]);
      else if (kw === "views") parseViews();
      else if (kw === "!identifiers") hierarchical = t[1]?.toLowerCase() === "hierarchical";
      else if (kw === "!constant" || kw === "!const" || kw === "!var") constants.set(unq(t[1])!, unq(t[2]) ?? "");
      else if (kw === "name") name = unq(t[1]) ?? name;
      else {
        if (!["!impliedrelationships", "description", "configuration", "!docs", "!adrs"].includes(kw)) report.push(`Line ${no}: "${t[0]}" is not supported and was skipped`);
        else if (kw === "!docs" || kw === "!adrs") report.push(`Line ${no}: ${t[0]} is not imported`);
        if (opens) skipBlock();
      }
    }
  };
  parseWorkspace();

  for (const e of elements) {
    for (const tag of e.tags) {
      const kind = SHAPE_KIND[tagShapes.get(tag) ?? ""] ?? (tag === "Database" ? "Database" : undefined);
      if (kind && e.type === "c4:Container") e.properties.kind = kind;
    }
  }
  if (name) report.unshift(`Workspace "${name}": ${elements.length} elements, ${relationships.length} relationships, ${views.length} views`);
  return { elements, relationships, views, layout: views.map((v) => v.id), report };
}

const q = (s: string | undefined) => `"${(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;

function trimArgs(args: (string | undefined)[]): string {
  const a = [...args];
  while (a.length && !a[a.length - 1]) a.pop();
  return a.map((x) => q(x)).join(" ");
}

export interface DslOptions {
  /** Export only this view and what it shows. */
  view?: Id;
  /** How an element is presented in C4, so elements from other notations export through the mapping table. */
  typeOf(el: Element): string | undefined;
}

/** Write a workspace (or one view) as Structurizr DSL. */
export function writeDsl(ws: Workspace, opts: DslOptions): string {
  const onlyView = opts.view ? ws.views[opts.view] : undefined;
  const views = (onlyView ? [onlyView] : Object.values(ws.views).filter((v) => v.notation === "c4")).sort((a, b) => a.name.localeCompare(b.name));
  let scope: Set<Id> | undefined;
  if (onlyView) {
    scope = new Set<Id>();
    for (const n of onlyView.nodes) for (let id: Id | undefined = n.element; id && ws.elements[id]; id = ws.elements[id].parent) scope.add(id);
  }
  const type = new Map<Id, string>();
  for (const e of Object.values(ws.elements)) {
    const t = opts.typeOf(e);
    if (t && (!scope || scope.has(e.id))) type.set(e.id, t);
  }
  const kids = new Map<Id | undefined, Element[]>();
  for (const e of Object.values(ws.elements)) {
    if (!type.has(e.id)) continue;
    const p = e.parent && type.has(e.parent) ? e.parent : undefined;
    kids.set(p, [...(kids.get(p) ?? []), e]);
  }
  for (const list of kids.values()) list.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  const path = new Map<Id, string>();
  const out: string[] = [];
  const ind = (n: number) => "    ".repeat(n);
  const keyword: Record<string, string> = {
    "c4:Person": "person",
    "c4:SoftwareSystem": "softwareSystem",
    "c4:Container": "container",
    "c4:Component": "component",
    "c4:DeploymentNode": "deploymentNode",
    "c4:InfrastructureNode": "infrastructureNode",
  };
  const allowedChild: Record<string, string[]> = {
    "c4:SoftwareSystem": ["c4:Container"],
    "c4:Container": ["c4:Component"],
    "c4:DeploymentNode": ["c4:DeploymentNode", "c4:InfrastructureNode"],
  };
  const skipped: string[] = [];

  const identFor = (e: Element, siblings: Set<string>) => {
    let base = slugify(e.name).replace(/-(.)/g, (_, c) => c.toUpperCase()).replace(/-/g, "") || "element";
    if (/^\d/.test(base)) base = "e" + base;
    let id = base;
    for (let i = 2; siblings.has(id.toLowerCase()); i++) id = `${base}${i}`;
    siblings.add(id.toLowerCase());
    return id;
  };

  const writeElement = (e: Element, depth: number, parentPath: string | undefined, siblings: Set<string>, deploymentOnly: boolean, instancesOf?: Map<Id, Id[]>) => {
    const t = type.get(e.id)!;
    const isDep = t === "c4:DeploymentNode" || t === "c4:InfrastructureNode";
    if (isDep !== deploymentOnly) return;
    const ident = identFor(e, siblings);
    const full = parentPath ? `${parentPath}.${ident}` : ident;
    path.set(e.id, full);
    const tech = typeof e.properties.technology === "string" ? e.properties.technology : undefined;
    const tags = [...e.tags, ...(e.properties.location === "External" && !e.tags.includes("External") ? ["External"] : []), ...(e.properties.kind === "Database" && !e.tags.includes("Database") ? ["Database"] : [])];
    const tagStr = tags.join(",") || undefined;
    const args =
      t === "c4:Person" || t === "c4:SoftwareSystem"
        ? trimArgs([e.name, e.description, tagStr])
        : t === "c4:DeploymentNode"
          ? trimArgs([e.name, e.description, tech, tagStr, typeof e.properties.instances === "string" ? e.properties.instances : undefined])
          : trimArgs([e.name, e.description, tech, tagStr]);
    const children = (kids.get(e.id) ?? []).filter((c) => {
      const ok = allowedChild[t]?.includes(type.get(c.id)!);
      if (!ok) skipped.push(`${c.name} (${type.get(c.id)} cannot be nested in ${t})`);
      return ok;
    });
    const props = Object.entries(e.properties).filter(([k, v]) => !["technology", "location", "kind", "environment", "instances", "group", "externalId"].includes(k) && typeof v !== "object");
    const inst = instancesOf?.get(e.id) ?? [];
    const url = e.links[0]?.href;
    if (!children.length && !props.length && !inst.length && !url) {
      out.push(`${ind(depth)}${ident} = ${keyword[t]} ${args}`);
      return;
    }
    out.push(`${ind(depth)}${ident} = ${keyword[t]} ${args} {`);
    if (url) out.push(`${ind(depth + 1)}url ${q(url)}`);
    if (props.length) {
      out.push(`${ind(depth + 1)}properties {`);
      for (const [k, v] of props) out.push(`${ind(depth + 2)}${q(k)} ${q(String(v))}`);
      out.push(`${ind(depth + 1)}}`);
    }
    const sib = new Set<string>();
    for (const c of children) writeElement(c, depth + 1, full, sib, deploymentOnly, instancesOf);
    for (const target of inst) {
      const tt = type.get(target);
      if (path.has(target)) out.push(`${ind(depth + 1)}${tt === "c4:SoftwareSystem" ? "softwareSystemInstance" : "containerInstance"} ${path.get(target)}`);
    }
    out.push(`${ind(depth)}}`);
  };

  out.push(`workspace ${q(ws.name)} {`, "", `${ind(1)}!identifiers hierarchical`, "", `${ind(1)}model {`);
  const rootIds = new Set<string>();
  for (const e of kids.get(undefined) ?? []) {
    const t = type.get(e.id)!;
    if (t === "c4:Container" || t === "c4:Component") skipped.push(`${e.name} (${t} has no parent ${t === "c4:Container" ? "software system" : "container"})`);
    else writeElement(e, 2, undefined, rootIds, false);
  }
  const shown = scope && onlyView ? new Set(onlyView.edges.map((e) => e.relationship)) : undefined;
  const rels = Object.values(ws.relationships)
    .filter((r) => path.has(r.source) && path.has(r.target) && (!shown || shown.has(r.id)))
    .sort((a, b) => path.get(a.source)!.localeCompare(path.get(b.source)!) || path.get(a.target)!.localeCompare(path.get(b.target)!) || (a.label ?? "").localeCompare(b.label ?? "") || a.id.localeCompare(b.id));
  if (rels.length) out.push("");
  for (const r of rels) out.push(`${ind(2)}${path.get(r.source)} -> ${path.get(r.target)} ${trimArgs([r.label, r.technology])}`.trimEnd());

  // Deployment environments come from deployment views: nodes placed there, with instances nested inside them.
  const envs = new Map<string, View[]>();
  for (const v of views) if (v.viewpoint === "c4:deployment") envs.set(String(v.properties.environment ?? v.name), [...(envs.get(String(v.properties.environment ?? v.name)) ?? []), v]);
  const depRoots = (kids.get(undefined) ?? []).filter((e) => ["c4:DeploymentNode", "c4:InfrastructureNode"].includes(type.get(e.id)!));
  const envNames = new Set([...envs.keys(), ...depRoots.map((e) => String(e.properties.environment ?? "Default"))]);
  for (const env of [...envNames].sort()) {
    const inst = new Map<Id, Id[]>();
    const inView = new Set<Id>();
    for (const v of envs.get(env) ?? [])
      for (const n of v.nodes) {
        inView.add(n.element);
        const t = type.get(n.element);
        if (n.parent && (t === "c4:Container" || t === "c4:SoftwareSystem") && type.get(n.parent) === "c4:DeploymentNode") inst.set(n.parent, [...(inst.get(n.parent) ?? []), n.element]);
      }
    const roots = depRoots.filter((e) => String(e.properties.environment ?? "Default") === env || inView.has(e.id));
    if (!roots.length) continue;
    out.push("", `${ind(2)}deploymentEnvironment ${q(env)} {`);
    const sib = new Set<string>();
    for (const e of roots) if (!path.has(e.id)) writeElement(e, 3, undefined, sib, true, inst);
    out.push(`${ind(2)}}`);
  }
  for (const r of Object.values(ws.relationships)) {
    // relationships touching deployment elements are written after the environments exist
    if (rels.includes(r) || !path.has(r.source) || !path.has(r.target) || (shown && !shown.has(r.id))) continue;
    out.push(`${ind(2)}${path.get(r.source)} -> ${path.get(r.target)} ${trimArgs([r.label, r.technology])}`.trimEnd());
  }
  for (const s of skipped) out.push(`${ind(2)}// not exported: ${s}`);
  out.push(`${ind(1)}}`, "", `${ind(1)}views {`);

  const keys = new Set<string>();
  for (const v of views) {
    const kw = { "c4:landscape": "systemLandscape", "c4:context": "systemContext", "c4:container": "container", "c4:component": "component", "c4:dynamic": "dynamic", "c4:deployment": "deployment" }[v.viewpoint ?? ""] ?? "systemLandscape";
    let key = String(v.properties.key ?? v.name).replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "view";
    for (let i = 2; keys.has(key); i++) key = `${key}-${i}`;
    keys.add(key);
    const subjectType = { container: "c4:SoftwareSystem", component: "c4:Container", systemContext: "c4:SoftwareSystem" }[kw as string];
    let subject = v.subject && path.has(v.subject) ? v.subject : undefined;
    if (subjectType && (!subject || type.get(subject) !== subjectType)) subject = v.nodes.map((n) => n.element).find((id) => type.get(id) === subjectType && (kw === "systemContext" || v.nodes.some((n) => n.parent === id)));
    if (subjectType && !subject) {
      out.push(`${ind(2)}// not exported: view ${q(v.name)} has no ${subjectType === "c4:Container" ? "container" : "software system"} in scope`);
      continue;
    }
    const head =
      kw === "systemLandscape"
        ? `systemLandscape ${q(key)}`
        : kw === "deployment"
          ? `deployment ${subject ? path.get(subject) : "*"} ${q(String(v.properties.environment ?? v.name))} ${q(key)}`
          : kw === "dynamic"
            ? `dynamic ${subject ? path.get(subject) : "*"} ${q(key)}`
            : `${kw} ${path.get(subject!)} ${q(key)}`;
    out.push(`${ind(2)}${head}${v.description ? " " + q(v.description) : ""} {`);
    if (v.name !== key) out.push(`${ind(3)}title ${q(v.name)}`);
    if (kw === "dynamic") {
      for (const e of [...v.edges].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
        const r = ws.relationships[e.relationship];
        if (r && path.has(r.source) && path.has(r.target)) out.push(`${ind(3)}${path.get(r.source)} -> ${path.get(r.target)} ${trimArgs([r.label])}`.trimEnd());
      }
    } else if (kw === "deployment") out.push(`${ind(3)}include *`);
    else {
      const ids = v.nodes.map((n) => n.element).filter((id) => path.has(id) && id !== (kw === "systemLandscape" ? undefined : kw === "systemContext" ? undefined : subject));
      const refs = ids.map((id) => path.get(id)!).sort();
      if (refs.length) out.push(`${ind(3)}include ${refs.join(" ")}`);
    }
    const dir = String(v.properties.autoLayout ?? "tb");
    out.push(`${ind(3)}autoLayout${dir !== "tb" ? " " + dir : ""}`, `${ind(2)}}`, "");
  }
  if (Object.values(ws.elements).some((e) => type.get(e.id) === "c4:Container" && e.properties.kind === "Database")) {
    out.push(`${ind(2)}styles {`, `${ind(3)}element "Database" {`, `${ind(4)}shape Cylinder`, `${ind(3)}}`, `${ind(2)}}`);
  } else if (out[out.length - 1] === "") out.pop();
  out.push(`${ind(1)}}`, "}", "");
  return out.join("\n");
}
