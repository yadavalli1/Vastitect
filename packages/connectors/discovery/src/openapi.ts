import type { ImportInput, ModelPatch } from "@vastitecture/plugin-sdk";
import { Draft, docs, type J } from "./util";

/**
 * OpenAPI (2/3.x) and AsyncAPI (2/3.x) specs become interfaces and the relationships between the
 * system that provides each API and the servers or channels it uses.
 */
export function discoverApis(files: ImportInput[], config: { system?: string } = {}): ModelPatch {
  const d = new Draft("openapi");
  let ops = 0, channels = 0;
  for (const f of files) {
    for (const doc of docs(f, d.report)) {
      const info: J = doc.info ?? {};
      const title = String(info.title ?? f.name.replace(/\.(ya?ml|json)$/, ""));
      const version = info.version ? String(info.version) : undefined;
      if (!doc.openapi && !doc.swagger && !doc.asyncapi) {
        d.report.push(`${f.name}: not an OpenAPI or AsyncAPI document, skipped`);
        continue;
      }
      const systemName = config.system || String(info["x-system"] ?? (title.replace(/\s+API$/i, "") || title));
      const system = d.element(`system:${systemName.toLowerCase()}`, "c4:SoftwareSystem", systemName, { description: info.description ? String(info.description).split("\n")[0] : undefined });
      if (doc.openapi || doc.swagger) {
        const api = d.element(`openapi:${title.toLowerCase()}`, "archimate:ApplicationInterface", title, {
          description: info.description ? String(info.description) : undefined,
          properties: { protocol: "HTTP", ...(version ? { apiVersion: version } : {}), specFile: f.name },
          links: info.contact?.url ? [{ kind: "doc", href: String(info.contact.url) }] : [],
        });
        d.relate("archimate:Composition", system, api);
        const paths = Object.entries((doc.paths ?? {}) as J);
        const verbs = paths.flatMap(([p, item]) => Object.keys(item ?? {}).filter((m) => ["get", "put", "post", "delete", "patch", "head", "options"].includes(m)).map((m) => `${m.toUpperCase()} ${p}`));
        ops += verbs.length;
        api.properties.operations = verbs;
        const servers: string[] = doc.servers ? doc.servers.map((s: J) => String(s.url)) : doc.host ? [`${(doc.schemes ?? ["https"])[0]}://${doc.host}${doc.basePath ?? ""}`] : [];
        if (servers.length) api.properties.servers = servers;
        const tags = (doc.tags ?? []).map((t: J) => String(t.name)).filter(Boolean);
        if (tags.length) api.tags = tags;
      } else {
        const api = d.element(`asyncapi:${title.toLowerCase()}`, "archimate:ApplicationInterface", title, {
          description: info.description ? String(info.description) : undefined,
          properties: { protocol: "Async", ...(version ? { apiVersion: version } : {}), specFile: f.name },
        });
        d.relate("archimate:Composition", system, api);
        for (const [key, ch] of Object.entries((doc.channels ?? {}) as J)) {
          channels++;
          const address = String(ch?.address ?? key);
          const topic = d.element(`channel:${address}`, "c4:Container", address, { description: ch?.description ? String(ch.description) : undefined, properties: { kind: "Queue", technology: "Message channel" } });
          // AsyncAPI 2 uses publish/subscribe from the client's view; 3 uses operations with send/receive.
          if (ch?.subscribe) d.relate("c4:Uses", system, topic, { label: "Publishes to" });
          if (ch?.publish) d.relate("c4:Uses", topic, system, { label: "Delivers to" });
        }
        for (const op of Object.values((doc.operations ?? {}) as J)) {
          const ref = String(op?.channel?.$ref ?? "").split("/").pop();
          const ch = ref && (doc.channels ?? {})[ref];
          if (!ch) continue;
          const topic = d.element(`channel:${String(ch.address ?? ref)}`, "c4:Container", String(ch.address ?? ref), { properties: { kind: "Queue", technology: "Message channel" } });
          if (op.action === "send") d.relate("c4:Uses", system, topic, { label: "Sends to" });
          if (op.action === "receive") d.relate("c4:Uses", topic, system, { label: "Delivers to" });
        }
        const protocols = Object.values((doc.servers ?? {}) as J).map((s: J) => String(s.protocol ?? "")).filter(Boolean);
        if (protocols.length) api.properties.technology = [...new Set(protocols)].join(", ");
      }
    }
  }
  d.view("archimate", "archimate:application", "APIs (discovered)", (e) => e.type === "archimate:ApplicationInterface" || e.type === "c4:SoftwareSystem");
  d.view("c4", "c4:landscape", "Message channels (discovered)", (e) => e.type === "c4:SoftwareSystem" || e.properties.technology === "Message channel");
  return d.patch(`APIs: ${[...d.elements.values()].filter((e) => e.type === "archimate:ApplicationInterface").length} interface(s), ${ops} operation(s), ${channels} channel(s)`);
}
