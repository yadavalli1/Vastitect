import type { ImportInput, ModelPatch } from "@vastitecture/plugin-sdk";
import { Draft, docs, titleCase, type J } from "./util";

const WORKLOADS = new Set(["Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob", "ReplicaSet", "Pod"]);
const DB = /postgres|mysql|mariadb|mongo|redis|cassandra|elasticsearch|opensearch|clickhouse|mssql/i;
const QUEUE = /kafka|rabbitmq|nats|pulsar|redpanda/i;

const podSpec = (o: J): J => (o.kind === "Pod" ? o.spec : o.kind === "CronJob" ? o.spec?.jobTemplate?.spec?.template?.spec : o.spec?.template?.spec) ?? {};
const podLabels = (o: J): J => (o.kind === "Pod" ? o.metadata?.labels : o.kind === "CronJob" ? o.spec?.jobTemplate?.spec?.template?.metadata?.labels : o.spec?.template?.metadata?.labels) ?? {};
const matches = (selector: J | undefined, labels: J) => !!selector && Object.keys(selector).length > 0 && Object.entries(selector).every(([k, v]) => labels[k] === v);

/**
 * Kubernetes manifests (and `helm template` output) become containers, grouped into deployment nodes
 * per namespace inside a cluster node. Services and Ingresses become relationships.
 * Helm charts are read from Chart.yaml (name, version, dependencies).
 */
export function discoverKubernetes(files: ImportInput[], config: { cluster?: string; system?: string; environment?: string } = {}): ModelPatch {
  const d = new Draft("kubernetes");
  const env = config.environment || "Production";
  const cluster = d.element(`k8s-cluster:${config.cluster || "cluster"}`, "c4:DeploymentNode", config.cluster || "Kubernetes cluster", { properties: { technology: "Kubernetes", environment: env } });
  const objects: J[] = [];
  const charts: J[] = [];
  for (const f of files) {
    if (/(^|\/)Chart\.ya?ml$/.test(f.name)) charts.push(...docs(f, d.report));
    else for (const o of docs(f, d.report)) (o.kind === "List" ? o.items ?? [] : [o]).forEach((x: J) => x?.kind && objects.push(x));
  }
  const systemName = config.system || charts[0]?.name || "Application";
  const system = d.element(`k8s-system:${String(systemName).toLowerCase()}`, "c4:SoftwareSystem", titleCase(String(systemName)), charts[0]?.description ? { description: String(charts[0].description) } : {});
  for (const c of charts) {
    system.properties.helmChart = `${c.name}@${c.version ?? "?"}`;
    for (const dep of c.dependencies ?? []) {
      const ext = d.element(`helm-dep:${dep.name}`, "c4:Container", titleCase(String(dep.name)), {
        parent: system.id,
        properties: { technology: `Helm chart ${dep.name}${dep.version ? " " + dep.version : ""}`, ...(DB.test(dep.name) ? { kind: "Database" } : QUEUE.test(dep.name) ? { kind: "Queue" } : {}) },
      });
      d.relate("c4:Uses", system, ext, { label: "Depends on (Helm)" });
    }
  }

  const ns = (o: J) => String(o.metadata?.namespace ?? "default");
  const nsNode = (name: string) => d.element(`k8s-ns:${name}`, "c4:DeploymentNode", `Namespace ${name}`, { parent: cluster.id, properties: { technology: "Kubernetes namespace", environment: env } });
  const workloads: { o: J; el: ReturnType<Draft["element"]> }[] = [];
  for (const o of objects.filter((x) => WORKLOADS.has(x.kind))) {
    const name = String(o.metadata?.name ?? "unnamed");
    const images = (podSpec(o).containers ?? []).map((c: J) => String(c.image ?? ""));
    const image = images[0] ?? "";
    const el = d.element(`k8s:${ns(o)}/${o.kind}/${name}`, "c4:Container", titleCase(name), {
      parent: system.id,
      properties: {
        technology: image.split("/").pop()?.split(":")[0] || o.kind,
        workloadKind: o.kind,
        namespace: ns(o),
        ...(images.length ? { images } : {}),
        ...(o.spec?.replicas !== undefined ? { replicas: Number(o.spec.replicas) } : {}),
        ...(DB.test(image) ? { kind: "Database" } : QUEUE.test(image) ? { kind: "Queue" } : {}),
      },
    });
    workloads.push({ o, el });
    // Placement is recorded by the node's stable external id; the deployment view draws containers inside it.
    el.properties.deployedIn = nsNode(ns(o)).properties.externalId as string;
  }
  const services = new Map<string, ReturnType<Draft["element"]>[]>();
  for (const s of objects.filter((x) => x.kind === "Service")) {
    const targets = workloads.filter((w) => ns(w.o) === ns(s) && matches(s.spec?.selector, podLabels(w.o))).map((w) => w.el);
    services.set(`${ns(s)}/${s.metadata?.name}`, targets);
    if (!targets.length) d.report.push(`Service ${ns(s)}/${s.metadata?.name} selects no workload in these files`);
  }
  for (const ing of objects.filter((x) => x.kind === "Ingress")) {
    const lb = d.element(`k8s-ingress:${ns(ing)}/${ing.metadata?.name}`, "c4:InfrastructureNode", `Ingress ${ing.metadata?.name}`, { parent: nsNode(ns(ing)).id, properties: { technology: String(ing.spec?.ingressClassName ?? "Ingress"), environment: env } });
    for (const rule of ing.spec?.rules ?? [])
      for (const p of rule.http?.paths ?? []) {
        const svc = p.backend?.service?.name ?? p.backend?.serviceName;
        for (const t of services.get(`${ns(ing)}/${svc}`) ?? []) d.relate("c4:Uses", lb, t, { label: `Routes ${rule.host ?? ""}${p.path ?? "/"}`.trim(), technology: "HTTPS" });
      }
  }
  // Env vars that name another Service (http://orders:8080, DB_HOST=postgres) imply a dependency.
  for (const w of workloads) {
    const envs = (podSpec(w.o).containers ?? []).flatMap((c: J) => (c.env ?? []).map((e: J) => String(e.value ?? "")));
    for (const [key, targets] of services) {
      const svc = key.split("/")[1];
      if (envs.some((v: string) => new RegExp(`(^|[/@:])${svc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([.:/]|$)`).test(v))) for (const t of targets) d.relate("c4:Uses", w.el, t, { label: "Calls" });
    }
  }
  d.view("c4", "c4:container", `${system.name} – containers (discovered)`, (e) => e === system || e.parent === system.id, undefined, system);
  d.view("c4", "c4:deployment", `${system.name} – Kubernetes (discovered)`, (e) => e.type === "c4:DeploymentNode" || e.type === "c4:InfrastructureNode" || !!e.properties.deployedIn, (e) => d.idOf(e.properties.deployedIn));
  return d.patch(`Kubernetes: ${workloads.length} workload(s), ${services.size} service(s), ${objects.filter((x) => x.kind === "Ingress").length} ingress(es)${charts.length ? `, Helm chart ${charts.map((c) => c.name).join(", ")}` : ""}`);
}
