import type { ImportInput, ModelPatch } from "@vastitecture/plugin-sdk";
import { Draft, docs, titleCase, type J } from "./util";

const DB = /postgres|mysql|mariadb|mongo|redis|cassandra|elasticsearch|opensearch|couchdb|dynamodb|neo4j|clickhouse|mssql|oracle|sqlite|cockroach/i;
const QUEUE = /kafka|rabbitmq|nats|activemq|pulsar|zookeeper|redpanda|mosquitto|sqs/i;

const kindOf = (image: string) => (DB.test(image) ? "Database" : QUEUE.test(image) ? "Queue" : undefined);
const techOf = (image: string) => image.split("/").pop()!.split(":")[0];

/** docker-compose files become a system with one container per service and a deployment node for the host. */
export function discoverCompose(files: ImportInput[], config: { system?: string; environment?: string } = {}): ModelPatch {
  const d = new Draft("docker-compose");
  let services = 0;
  for (const f of files) {
    for (const doc of docs(f, d.report)) {
      if (!doc.services) {
        d.report.push(`${f.name}: no "services" section, skipped`);
        continue;
      }
      const project = config.system || String(doc.name ?? f.name.replace(/(docker-)?compose(\.\w+)?\.ya?ml$/i, "").replace(/[./\\]+$/, "")) || "Application";
      const system = d.element(`compose:${project}`, "c4:SoftwareSystem", titleCase(project));
      const env = config.environment || "Local";
      const host = d.element(`compose-host:${project}:${env}`, "c4:DeploymentNode", `Docker host (${titleCase(project)})`, { properties: { technology: "Docker Compose", environment: env } });
      const byName = new Map<string, ReturnType<Draft["element"]>>();
      for (const [name, svc] of Object.entries(doc.services as J)) {
        services++;
        const image = String(svc?.image ?? (svc?.build ? `build:${typeof svc.build === "string" ? svc.build : svc.build.context ?? "."}` : name));
        const c = d.element(`compose:${project}:${name}`, "c4:Container", titleCase(name), {
          parent: system.id,
          properties: {
            technology: image.startsWith("build:") ? "Built from source" : techOf(image),
            image,
            ...(kindOf(image) ? { kind: kindOf(image)! } : {}),
            ...(svc?.ports ? { ports: (svc.ports as unknown[]).map(String) } : {}),
          },
        });
        byName.set(name, c);
      }
      for (const [name, svc] of Object.entries(doc.services as J)) {
        const from = byName.get(name)!;
        const deps = Array.isArray(svc?.depends_on) ? svc.depends_on : Object.keys(svc?.depends_on ?? {});
        for (const dep of deps) {
          const to = byName.get(String(dep));
          if (to) d.relate("c4:Uses", from, to, { label: to.properties.kind === "Database" ? "Reads from and writes to" : "Uses" });
          else d.report.push(`${f.name}: ${name} depends on unknown service ${dep}`);
        }
        // Environment variables that point at another service (DB_HOST=postgres, http://api:8080) imply a dependency.
        const envs = Array.isArray(svc?.environment) ? svc.environment.map(String) : Object.entries(svc?.environment ?? {}).map(([k, v]) => `${k}=${v}`);
        for (const e of envs)
          for (const [other, to] of byName)
            if (other !== name && new RegExp(`(^|[=/@:,\\s])${other.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([:/,\\s]|$)`).test(e.slice(e.indexOf("=") + 1))) d.relate("c4:Uses", from, to, { label: "Uses" });
      }
      // Every service runs on the compose host; the deployment view nests the containers inside it.
      for (const c of byName.values()) c.properties.deployedIn = host.properties.externalId as string;
    }
  }
  for (const sys of [...d.elements.values()].filter((e) => e.type === "c4:SoftwareSystem")) {
    d.view("c4", "c4:container", `${sys.name} – containers (discovered)`, (e) => e === sys || e.parent === sys.id, undefined, sys);
    const host = d.idOf([...d.elements.values()].find((e) => e.parent === sys.id)?.properties.deployedIn);
    d.view("c4", "c4:deployment", `${sys.name} – deployment (discovered)`, (e) => e.id === host || (e.parent === sys.id && !!e.properties.deployedIn), (e) => d.idOf(e.properties.deployedIn));
  }
  return d.patch(`docker-compose: ${services} service(s)`);
}
