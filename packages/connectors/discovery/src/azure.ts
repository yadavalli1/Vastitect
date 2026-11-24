import type { ImportInput, ModelPatch } from "@vastitecture/plugin-sdk";
import { Draft, type J } from "./util";

/** Read-only az commands the connector understands (each run with -o json). */
export const AZ_COMMANDS: string[][] = [
  ["account", "show"],
  ["group", "list"],
  ["network", "vnet", "list"],
  ["vm", "list"],
  ["aks", "list"],
  ["webapp", "list"],
  ["functionapp", "list"],
  ["sql", "server", "list"],
  ["postgres", "flexible-server", "list"],
  ["cosmosdb", "list"],
  ["redis", "list"],
  ["storage", "account", "list"],
  ["servicebus", "namespace", "list"],
  ["resource", "list"],
];

/** Azure resource type → how it is modelled. Unlisted types still appear, as infrastructure nodes. */
const TYPES: Record<string, { type: string; technology: string; kind?: string }> = {
  "microsoft.compute/virtualmachines": { type: "c4:DeploymentNode", technology: "Azure VM" },
  "microsoft.containerservice/managedclusters": { type: "c4:DeploymentNode", technology: "AKS" },
  "microsoft.web/sites": { type: "c4:InfrastructureNode", technology: "App Service" },
  "microsoft.sql/servers": { type: "c4:InfrastructureNode", technology: "Azure SQL", kind: "Database" },
  "microsoft.dbforpostgresql/flexibleservers": { type: "c4:InfrastructureNode", technology: "Azure Database for PostgreSQL", kind: "Database" },
  "microsoft.dbformysql/flexibleservers": { type: "c4:InfrastructureNode", technology: "Azure Database for MySQL", kind: "Database" },
  "microsoft.documentdb/databaseaccounts": { type: "c4:InfrastructureNode", technology: "Cosmos DB", kind: "Database" },
  "microsoft.cache/redis": { type: "c4:InfrastructureNode", technology: "Azure Cache for Redis", kind: "Database" },
  "microsoft.storage/storageaccounts": { type: "c4:InfrastructureNode", technology: "Storage account" },
  "microsoft.servicebus/namespaces": { type: "c4:InfrastructureNode", technology: "Service Bus", kind: "Queue" },
  "microsoft.eventhub/namespaces": { type: "c4:InfrastructureNode", technology: "Event Hubs", kind: "Queue" },
  "microsoft.network/loadbalancers": { type: "c4:InfrastructureNode", technology: "Load Balancer" },
  "microsoft.network/applicationgateways": { type: "c4:InfrastructureNode", technology: "Application Gateway" },
  "microsoft.keyvault/vaults": { type: "c4:InfrastructureNode", technology: "Key Vault" },
};
/** Plumbing that would only clutter the model. */
const NOISE = /^microsoft\.(network\/(networkinterfaces|networksecuritygroups|publicipaddresses|networkwatchers|privatednszones.*|privateendpoints)|compute\/(disks|snapshots|virtualmachines\/extensions)|insights\/|operationalinsights\/|managedidentity\/|alertsmanagement\/|web\/serverfarms)/;

/** az CLI JSON output becomes a deployment model: subscription, resource groups, VNets and subnets, and resources. */
export function discoverAzure(files: ImportInput[], config: { environment?: string } = {}): ModelPatch {
  const d = new Draft("azure");
  const env = config.environment || "Production";
  const items: J[] = [];
  let account: J | undefined;
  for (const f of files) {
    try {
      const j = JSON.parse(f.text);
      if (Array.isArray(j)) items.push(...j);
      else if (j && j.tenantId && j.id && !j.type) account = j;
      else if (j && typeof j === "object") items.push(j);
    } catch {
      d.report.push(`${f.name}: not JSON output from the Azure CLI (use -o json)`);
    }
  }
  const subId = account?.id ?? /\/subscriptions\/([^/]+)/i.exec(String(items[0]?.id ?? ""))?.[1] ?? "";
  const sub = d.element(`azure:sub:${subId || "subscription"}`, "c4:DeploymentNode", account?.name ?? (subId ? `Azure subscription ${subId}` : "Azure subscription"), {
    properties: { technology: "Microsoft Azure", environment: env, provider: "azure", ...(subId ? { subscriptionId: subId } : {}) },
  });
  const props = (extra: J) => ({ environment: env, provider: "azure", ...extra });
  const groups = new Map<string, ReturnType<Draft["element"]>>();
  const group = (name: string | undefined) => {
    if (!name) return sub;
    const key = name.toLowerCase();
    if (!groups.has(key)) groups.set(key, d.element(`azure:rg:${subId}/${key}`, "c4:DeploymentNode", name, { parent: sub.id, properties: props({ technology: "Resource group" }) }));
    return groups.get(key)!;
  };
  const rgOf = (i: J) => i.resourceGroup ?? /\/resourceGroups\/([^/]+)/i.exec(String(i.id ?? ""))?.[1];
  for (const g of items.filter((i) => String(i.type).toLowerCase() === "microsoft.resources/resourcegroups")) group(g.name).properties.location = g.location;
  const seen = new Set<string>();
  let count = 0;
  const subnets = new Map<string, ReturnType<Draft["element"]>>();
  for (const v of items.filter((i) => String(i.type).toLowerCase() === "microsoft.network/virtualnetworks")) {
    const id = String(v.id).toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    count++;
    const vnet = d.element(`azure:${id}`, "c4:DeploymentNode", v.name, { parent: group(rgOf(v)).id, properties: props({ technology: "Virtual network", location: v.location, cidr: (v.addressSpace?.addressPrefixes ?? []).join(", ") }) });
    for (const s of v.subnets ?? []) subnets.set(String(s.id).toLowerCase(), d.element(`azure:${String(s.id).toLowerCase()}`, "c4:DeploymentNode", s.name, { parent: vnet.id, properties: props({ technology: "Subnet", cidr: s.addressPrefix }) }));
  }
  const skipped = new Map<string, number>();
  for (const r of items) {
    const t = String(r.type ?? "").toLowerCase();
    const id = String(r.id ?? "").toLowerCase();
    if (!t.startsWith("microsoft.") || !id || seen.has(id) || t === "microsoft.resources/resourcegroups" || t === "microsoft.network/virtualnetworks") continue;
    if (NOISE.test(t)) {
      skipped.set(t, (skipped.get(t) ?? 0) + 1);
      continue;
    }
    seen.add(id);
    count++;
    const def = TYPES[t];
    const isFunction = t === "microsoft.web/sites" && /functionapp/i.test(String(r.kind ?? ""));
    // AKS clusters and VMs in a subnet go in that subnet when the output says so.
    const subnetId = String(r.agentPoolProfiles?.[0]?.vnetSubnetId ?? r.virtualNetworkSubnetId ?? "").toLowerCase();
    const parent = subnets.get(subnetId) ?? group(rgOf(r));
    d.element(`azure:${id}`, def?.type ?? "c4:InfrastructureNode", r.name, {
      parent: parent.id,
      properties: props({
        technology: isFunction ? "Azure Functions" : def?.technology ?? t.replace(/^microsoft\./, ""),
        ...(def?.kind ? { kind: def.kind } : {}),
        location: r.location,
        azureId: r.id,
        ...(r.hardwareProfile?.vmSize ? { size: r.hardwareProfile.vmSize } : {}),
        ...(r.sku?.name ? { sku: r.sku.name } : {}),
      }),
    });
  }
  d.view("c4", "c4:deployment", `Azure ${account?.name ?? subId} – discovered`, () => true);
  if (skipped.size) d.report.push(`Left out as plumbing: ${[...skipped].map(([k, n]) => `${k} (${n})`).join(", ")}`);
  if (!items.length && !account) d.report.push(`Run: ${AZ_COMMANDS.map((c) => `az ${c.join(" ")} -o json`).join("; ")} and pick the output files.`);
  return d.patch(`Azure: ${count} resource(s) in ${groups.size} resource group(s)`);
}
