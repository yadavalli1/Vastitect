import type { ImportInput, ModelPatch } from "@vastitecture/plugin-sdk";
import { Draft, type J } from "./util";

/** Resource types that become infrastructure, and how. Anything else is counted in the report. */
const NODE = /(_instance|_virtual_machine|_vm|_compute_instance|_droplet|_server)$/;
const NETWORK = /(_vpc|_virtual_network|_network|_subnet|_subnetwork)$/;
const CLUSTER = /(_eks_cluster|_kubernetes_cluster|_container_cluster|_ecs_cluster|_aks_cluster|_gke_cluster)$/;
const DATABASE = /(_db_instance|_rds_cluster|_sql_database_instance|_sql_server|_postgresql_server|_mysql_server|_cosmosdb_account|_dynamodb_table|_elasticache_cluster|_redis_cache|_docdb_cluster)$/;
const QUEUE = /(_sqs_queue|_sns_topic|_pubsub_topic|_servicebus_namespace|_kinesis_stream|_msk_cluster|_eventhub_namespace)$/;
const FUNCTION = /(_lambda_function|_function_app|_cloudfunctions_function|_cloud_run_service|_app_service|_linux_web_app)$/;
const STORAGE = /(_s3_bucket|_storage_account|_storage_bucket|_blob_container)$/;
const LB = /(_lb|_alb|_elb|_load_balancer|_lb_listener|_application_gateway|_api_gateway_rest_api|_apigatewayv2_api|_cloudfront_distribution)$/;

interface Res {
  address: string;
  type: string;
  name: string;
  values: J;
  deps: string[];
  change?: string;
}

/** Collect resources from `terraform show -json` (state or plan) or a raw .tfstate file. */
function resources(doc: J): Res[] {
  const out: Res[] = [];
  const walk = (mod: J | undefined) => {
    for (const r of mod?.resources ?? []) if (r.mode !== "data") out.push({ address: r.address, type: r.type, name: r.name, values: r.values ?? {}, deps: r.depends_on ?? [] });
    for (const c of mod?.child_modules ?? []) walk(c);
  };
  if (doc.values?.root_module) walk(doc.values.root_module); // show -json of state
  if (doc.planned_values?.root_module) walk(doc.planned_values.root_module); // show -json of a plan
  if (Array.isArray(doc.resources) && doc.version && !doc.values) {
    // raw terraform.tfstate (format version 4)
    for (const r of doc.resources)
      if (r.mode !== "data")
        (r.instances ?? []).forEach((i: J, n: number) =>
          out.push({ address: `${r.module ? r.module + "." : ""}${r.type}.${r.name}${r.instances.length > 1 ? `[${i.index_key ?? n}]` : ""}`, type: r.type, name: r.name, values: i.attributes ?? {}, deps: i.dependencies ?? [] }),
        );
  }
  const changes = new Map<string, string>((doc.resource_changes ?? []).map((c: J) => [String(c.address), (c.change?.actions ?? []).join("+")]));
  for (const r of out) if (changes.has(r.address)) r.change = changes.get(r.address);
  return out;
}

/** Readable name: a Name tag or name attribute, else the module name for the common `this`/`main` resource names. */
const label = (r: Res) => {
  const fallback = ["this", "main", "default"].includes(r.name) ? /module\.([\w-]+)\.[^.]+\.[^.]+$/.exec(r.address)?.[1] ?? r.name : r.name;
  return String(r.values.tags?.Name ?? r.values.name ?? r.values.identifier ?? r.values.bucket ?? r.values.function_name ?? fallback);
};
const provider = (type: string) => type.split("_")[0];

/** Terraform state or plan JSON becomes deployment nodes, infrastructure nodes and data stores. */
export function discoverTerraform(files: ImportInput[], config: { environment?: string } = {}): ModelPatch {
  const d = new Draft("terraform");
  const env = config.environment || "Production";
  const skipped = new Map<string, number>();
  let count = 0;
  for (const f of files) {
    let doc: J;
    try {
      doc = JSON.parse(f.text);
    } catch {
      d.report.push(`${f.name}: not JSON. Run \`terraform show -json\` (state) or \`terraform show -json plan.out\` (plan) and import that output.`);
      continue;
    }
    const all = resources(doc);
    if (!all.length) d.report.push(`${f.name}: no managed resources found`);
    const byAddr = new Map<string, ReturnType<Draft["element"]>>();
    const byId = new Map<string, ReturnType<Draft["element"]>>();
    for (const r of all) {
      const props = { technology: r.type, environment: env, provider: provider(r.type), terraformAddress: r.address, ...(r.change && r.change !== "no-op" ? { plannedChange: r.change } : {}), ...(r.values.region || r.values.location ? { region: String(r.values.region ?? r.values.location) } : {}) };
      let el;
      // Databases first: "aws_db_instance" would otherwise match the compute-instance pattern.
      if (DATABASE.test(r.type)) el = d.element(`tf:${r.address}`, "c4:InfrastructureNode", label(r), { properties: { ...props, kind: "Database", ...(r.values.engine ? { engine: String(r.values.engine) } : {}) } });
      else if (NETWORK.test(r.type)) el = d.element(`tf:${r.address}`, "c4:DeploymentNode", label(r), { properties: { ...props, ...(r.values.cidr_block ? { cidr: String(r.values.cidr_block) } : {}) } });
      else if (CLUSTER.test(r.type) || NODE.test(r.type)) el = d.element(`tf:${r.address}`, "c4:DeploymentNode", label(r), { properties: { ...props, ...(r.values.instance_type ? { instanceType: String(r.values.instance_type) } : {}) } });
      else if (QUEUE.test(r.type) || FUNCTION.test(r.type) || STORAGE.test(r.type) || LB.test(r.type)) el = d.element(`tf:${r.address}`, "c4:InfrastructureNode", label(r), { properties: props });
      else {
        skipped.set(r.type, (skipped.get(r.type) ?? 0) + 1);
        continue;
      }
      count++;
      byAddr.set(r.address, el);
      if (r.values.id) byId.set(String(r.values.id), el);
      if (r.values.arn) byId.set(String(r.values.arn), el);
    }
    // Place things inside their network: subnet_id / vpc_id attributes, falling back to explicit dependencies.
    for (const r of all) {
      const el = byAddr.get(r.address);
      if (!el) continue;
      const parentRef = [r.values.subnet_id, ...(r.values.subnet_ids ?? []), r.values.vpc_id, r.values.network_interface?.[0]?.subnetwork, r.values.virtual_network_name].find((x) => x && byId.has(String(x)));
      const parent = parentRef ? byId.get(String(parentRef)) : undefined;
      if (parent && parent !== el && parent.type === "c4:DeploymentNode") el.parent = parent.id;
      for (const dep of r.deps) {
        const to = byAddr.get(dep.replace(/\[.*\]$/, "")) ?? byAddr.get(dep);
        if (to && to !== el && to.id !== el.parent) d.relate("c4:Uses", el, to, { label: "Depends on" });
      }
    }
    // Lambdas / apps that reference another resource's ARN or id in their configuration use it.
    for (const r of all) {
      const el = byAddr.get(r.address);
      if (!el) continue;
      const text = JSON.stringify(r.values.environment ?? r.values.app_settings ?? {});
      for (const [id, to] of byId) if (to !== el && id.length > 6 && text.includes(id)) d.relate("c4:Uses", el, to, { label: "Uses" });
    }
  }
  if (skipped.size) d.report.push(`Not modelled: ${[...skipped].map(([t, n]) => `${t} (${n})`).join(", ")}`);
  d.view("c4", "c4:deployment", "Infrastructure (discovered from Terraform)", () => true);
  return d.patch(`Terraform: ${count} infrastructure resource(s)`);
}
