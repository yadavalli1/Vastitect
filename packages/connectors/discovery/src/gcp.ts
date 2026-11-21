import type { ImportInput, ModelPatch } from "@vastitecture/plugin-sdk";
import { Draft, type J } from "./util";

/** Read-only gcloud commands the connector understands (each run with --format=json). */
export const GCLOUD_COMMANDS: string[][] = [
  ["config", "get-value", "project"],
  ["compute", "networks", "list"],
  ["compute", "networks", "subnets", "list"],
  ["compute", "instances", "list"],
  ["sql", "instances", "list"],
  ["container", "clusters", "list"],
  ["run", "services", "list"],
  ["functions", "list"],
  ["pubsub", "topics", "list"],
  ["storage", "buckets", "list"],
];

const last = (url: unknown) => String(url ?? "").split("/").pop() ?? "";

/** gcloud JSON output becomes a deployment model: project, VPC networks, subnets, VMs and managed services. */
export function discoverGcp(files: ImportInput[], config: { project?: string; environment?: string } = {}): ModelPatch {
  const d = new Draft("gcp");
  const env = config.environment || "Production";
  const items: J[] = [];
  let projectId = config.project || "";
  for (const f of files) {
    let j: unknown;
    try {
      j = JSON.parse(f.text);
    } catch {
      d.report.push(`${f.name}: not JSON output from gcloud (use --format=json)`);
      continue;
    }
    if (typeof j === "string") projectId ||= j; // `gcloud config get-value project --format=json`
    else if (Array.isArray(j)) items.push(...(j as J[]));
    else if (j && typeof j === "object") items.push(j as J);
  }
  projectId ||= String(items.map((i) => /projects\/([^/]+)/.exec(String(i.selfLink ?? i.name ?? ""))?.[1]).find(Boolean) ?? "");
  const project = d.element(`gcp:project:${projectId || "project"}`, "c4:DeploymentNode", projectId ? `GCP project ${projectId}` : "GCP project", { properties: { technology: "Google Cloud", environment: env, provider: "gcp" } });
  const props = (extra: J) => ({ environment: env, provider: "gcp", ...extra });
  const nets = new Map<string, ReturnType<Draft["element"]>>();
  const subnets = new Map<string, ReturnType<Draft["element"]>>();
  const inNet = (url: unknown) => nets.get(last(url)) ?? project;
  let count = 0;
  const kind = (i: J) => String(i.kind ?? "");
  for (const n of items.filter((i) => kind(i) === "compute#network")) {
    count++;
    nets.set(n.name, d.element(`gcp:${n.selfLink ?? n.name}`, "c4:DeploymentNode", n.name, { parent: project.id, properties: props({ technology: "VPC network", gcpId: n.selfLink ?? n.name }) }));
  }
  for (const s of items.filter((i) => kind(i) === "compute#subnetwork")) {
    count++;
    subnets.set(String(s.selfLink ?? s.name), d.element(`gcp:${s.selfLink ?? s.name}`, "c4:DeploymentNode", s.name, { parent: inNet(s.network).id, properties: props({ technology: `Subnet (${last(s.region)})`, cidr: s.ipCidrRange, region: last(s.region) }) }));
  }
  for (const i of items.filter((x) => kind(x) === "compute#instance")) {
    count++;
    const nic = (i.networkInterfaces ?? [])[0] ?? {};
    const parent = subnets.get(String(nic.subnetwork)) ?? inNet(nic.network);
    d.element(`gcp:${i.selfLink ?? i.name}`, "c4:DeploymentNode", i.name, { parent: parent.id, properties: props({ technology: `Compute Engine ${last(i.machineType)}`, zone: last(i.zone), state: i.status }) });
  }
  for (const s of items.filter((x) => kind(x) === "sql#instance")) {
    count++;
    d.element(`gcp:sql:${s.name}`, "c4:InfrastructureNode", s.name, { parent: inNet(s.settings?.ipConfiguration?.privateNetwork).id, properties: props({ technology: `Cloud SQL ${s.databaseVersion ?? ""}`.trim(), kind: "Database", region: s.region }) });
  }
  for (const c of items.filter((x) => Array.isArray(x.nodePools) && x.currentMasterVersion)) {
    count++;
    d.element(`gcp:gke:${c.selfLink ?? c.name}`, "c4:DeploymentNode", c.name, { parent: inNet(c.network).id, properties: props({ technology: `GKE ${c.currentMasterVersion}`, region: c.location }) });
  }
  for (const r of items.filter((x) => x.kind === "Service" && String(x.apiVersion ?? "").startsWith("serving.knative.dev"))) {
    count++;
    const name = r.metadata?.name ?? "service";
    d.element(`gcp:run:${r.metadata?.selfLink ?? name}`, "c4:InfrastructureNode", name, { parent: project.id, properties: props({ technology: "Cloud Run", region: r.metadata?.labels?.["cloud.googleapis.com/location"], url: r.status?.url }) });
  }
  for (const f of items.filter((x) => x.entryPoint || x.buildConfig?.entryPoint)) {
    count++;
    const name = last(f.name);
    d.element(`gcp:fn:${f.name}`, "c4:InfrastructureNode", name, { parent: project.id, properties: props({ technology: `Cloud Functions ${f.runtime ?? f.buildConfig?.runtime ?? ""}`.trim(), region: /locations\/([^/]+)/.exec(String(f.name))?.[1] }) });
  }
  for (const t of items.filter((x) => /^projects\/[^/]+\/topics\/[^/]+$/.test(String(x.name ?? "")))) {
    count++;
    d.element(`gcp:topic:${t.name}`, "c4:InfrastructureNode", last(t.name), { parent: project.id, properties: props({ technology: "Pub/Sub topic", kind: "Queue" }) });
  }
  for (const b of items.filter((x) => String(x.storage_url ?? "").startsWith("gs://") || x.kind === "storage#bucket")) {
    count++;
    d.element(`gcp:bucket:${b.name}`, "c4:InfrastructureNode", b.name, { parent: project.id, properties: props({ technology: "Cloud Storage", region: String(b.location ?? "").toLowerCase() }) });
  }
  d.view("c4", "c4:deployment", `Google Cloud ${projectId || ""} – discovered`.replace("  ", " "), () => true);
  if (!items.length) d.report.push(`Run: ${GCLOUD_COMMANDS.map((c) => `gcloud ${c.join(" ")} --format=json`).join("; ")} and pick the output files.`);
  return d.patch(`Google Cloud: ${count} resource(s)${projectId ? ` in project ${projectId}` : ""}`);
}
