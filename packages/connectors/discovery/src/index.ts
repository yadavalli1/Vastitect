import { definePlugin } from "@vastitecture/plugin-sdk";
import { discoverApis } from "./openapi";
import { discoverCompose } from "./compose";
import { discoverKubernetes } from "./kubernetes";
import { discoverTerraform } from "./terraform";
import { discoverBackstage } from "./backstage";
import { discoverGit } from "./git";
import { AWS_COMMANDS, discoverAws } from "./aws";
import { AZ_COMMANDS, discoverAzure } from "./azure";
import { GCLOUD_COMMANDS, discoverGcp } from "./gcp";
import { fetchDatadog, observeTraces, tracesToPatch } from "./traces";
import { fetchServiceNow, parseServiceNowFiles, serviceNowToPatch, SERVICENOW_TABLES } from "./servicenow";

export { discoverApis, discoverCompose, discoverKubernetes, discoverTerraform, discoverBackstage, discoverGit, discoverAws };
export { AWS_COMMANDS, discoverAzure, discoverGcp, AZ_COMMANDS, GCLOUD_COMMANDS, fetchServiceNow, parseServiceNowFiles, serviceNowToPatch, SERVICENOW_TABLES };
export { fetchDatadog, observeTraces, tracesToPatch };
export { MANIFESTS } from "./git";

/**
 * Read-only discovery from files the user picks. None of these connectors touch the network:
 * they parse specs, manifests and state exports and return a draft patch shown as a diff.
 */
export default definePlugin({
  manifest: { id: "vastitecture.discovery", name: "Discovery connectors", version: "0.1.0", apiVersion: "1.0.0", capabilities: ["connector"], permissions: { fs: ["read:pick"], network: ["*.service-now.com", "*.servicenowservices.com", "api.datadoghq.com", "api.datadoghq.eu", "api.us3.datadoghq.com", "api.us5.datadoghq.com", "api.ap1.datadoghq.com", "api.ddog-gov.com"], secrets: ["servicenow-password", "servicenow-token", "datadog-api-key", "datadog-app-key"] } },
  activate(ctx) {
    const files = { key: "files", label: "Files", type: "files" as const };
    ctx.connectors.register({
      id: "openapi",
      label: "OpenAPI / AsyncAPI",
      description: "API specs become interfaces, operations and channels, linked to the system that provides them.",
      fields: [files, { key: "system", label: "Providing system (optional)", type: "string", placeholder: "Taken from info.title" }],
      discover: (i) => discoverApis(i.files, i.config),
    });
    ctx.connectors.register({
      id: "docker-compose",
      label: "docker-compose",
      description: "Services become containers of one system; depends_on and service URLs become relationships.",
      fields: [files, { key: "system", label: "System name (optional)", type: "string" }, { key: "environment", label: "Environment", type: "string", placeholder: "Local" }],
      discover: (i) => discoverCompose(i.files, i.config),
    });
    ctx.connectors.register({
      id: "kubernetes",
      label: "Kubernetes / Helm",
      description: "Manifests or `helm template` output become containers in namespace nodes; Services and Ingresses become relationships. Chart.yaml adds Helm dependencies.",
      fields: [files, { key: "cluster", label: "Cluster name", type: "string", placeholder: "Kubernetes cluster" }, { key: "system", label: "System name (optional)", type: "string" }, { key: "environment", label: "Environment", type: "string", placeholder: "Production" }],
      discover: (i) => discoverKubernetes(i.files, i.config),
    });
    ctx.connectors.register({
      id: "terraform",
      label: "Terraform state or plan",
      description: "Output of `terraform show -json` (or a .tfstate file) becomes deployment and infrastructure nodes.",
      fields: [files, { key: "environment", label: "Environment", type: "string", placeholder: "Production" }],
      discover: (i) => discoverTerraform(i.files, i.config),
    });
    ctx.connectors.register({
      id: "backstage",
      label: "Backstage catalog",
      description: "catalog-info.yaml entities become systems, components, APIs, resources and owners.",
      fields: [files],
      discover: (i) => discoverBackstage(i.files),
    });
    ctx.connectors.register({
      id: "git",
      label: "Git repository",
      description: "Pick a repository's folder to link it to an element with its languages, declared dependencies and remote URL.",
      fields: [files, { key: "element", label: "Element to link (name; created if missing)", type: "string" }, { key: "repo", label: "Repository URL (optional)", type: "string" }],
      discover: (i) => discoverGit(i.files, i.config),
    });
    ctx.connectors.register({
      id: "aws",
      label: "AWS (read-only)",
      description: "Account, VPCs, subnets, instances, databases, functions, load balancers, buckets and queues, from read-only AWS CLI output.",
      fields: [files, { key: "profile", label: "AWS profile", type: "string", placeholder: "default" }, { key: "region", label: "Region", type: "string", placeholder: "eu-west-1" }, { key: "environment", label: "Environment", type: "string", placeholder: "Production" }],
      cli: { tool: "aws", commands: AWS_COMMANDS, flags: { profile: "--profile", region: "--region" } },
      discover: (i) => discoverAws(i.files, i.config),
    });
    ctx.connectors.register({
      id: "gcp",
      label: "Google Cloud (read-only)",
      description: "Project, VPC networks, subnets, Compute Engine VMs, Cloud SQL, GKE, Cloud Run, Cloud Functions, Pub/Sub and Cloud Storage, from read-only gcloud output.",
      fields: [files, { key: "project", label: "Project ID", type: "string", placeholder: "my-project" }, { key: "environment", label: "Environment", type: "string", placeholder: "Production" }],
      cli: { tool: "gcloud", commands: GCLOUD_COMMANDS, flags: { project: "--project" } },
      discover: (i) => discoverGcp(i.files, i.config),
    });
    ctx.connectors.register({
      id: "azure",
      label: "Microsoft Azure (read-only)",
      description: "Subscription, resource groups, VNets and subnets, VMs, AKS, App Service and Functions, SQL, PostgreSQL, Cosmos DB, Redis, storage and messaging, from read-only az output.",
      fields: [files, { key: "subscription", label: "Subscription (name or ID)", type: "string" }, { key: "environment", label: "Environment", type: "string", placeholder: "Production" }],
      cli: { tool: "az", commands: AZ_COMMANDS, flags: { subscription: "--subscription" } },
      discover: (i) => discoverAzure(i.files, i.config),
    });
    ctx.connectors.register({
      id: "servicenow",
      label: "ServiceNow CMDB",
      description: `Business applications, services, applications, databases and servers with their relationships, read live from your instance's Table API (desktop app) or from JSON/CSV exports of ${SERVICENOW_TABLES[0]}, cmdb_ci_appl, cmdb_rel_ci and similar tables.`,
      fields: [
        { key: "instance", label: "Instance", type: "string", placeholder: "acme.service-now.com" },
        { key: "username", label: "Username (for basic authentication)", type: "string" },
        { key: "password", label: "Password", type: "secret", secret: "servicenow-password" },
        { key: "token", label: "…or an OAuth access token", type: "secret", secret: "servicenow-token" },
        { key: "query", label: "Filter (encoded query, optional)", type: "string", placeholder: "operational_status=1" },
        { ...files, label: "…or exported files", optional: true },
      ],
      async discover(i) {
        if (i.files.length) return serviceNowToPatch(parseServiceNowFiles(i.files));
        const token = await ctx.secrets.get("servicenow-token");
        const password = token ? undefined : await ctx.secrets.get("servicenow-password");
        const data = await fetchServiceNow((url, init) => ctx.net.fetch(url, init), { instance: i.config.instance ?? "", username: i.config.username, password, token, query: i.config.query });
        return serviceNowToPatch(data, `ServiceNow (${new URL(data.instance!).host})`);
      },
    });
    ctx.connectors.register({
      id: "traces",
      label: "Runtime traces (OpenTelemetry, Jaeger, Zipkin, Datadog)",
      description:
        "Compares what actually calls what in production with the model. Services are matched to existing elements by name; observed calls that are not modelled are proposed as relationships, and modelled dependencies never seen in the traces are listed in the report. Reads OTLP JSON, Jaeger trace or dependency exports, Zipkin v2 JSON, or Datadog's service dependency map (live in the desktop app).",
      fields: [
        { ...files, label: "Trace or dependency exports", optional: true },
        { key: "environment", label: "Environment", type: "string", placeholder: "production" },
        { key: "site", label: "Datadog site (live)", type: "string", placeholder: "datadoghq.com" },
        { key: "apiKey", label: "Datadog API key", type: "secret", secret: "datadog-api-key" },
        { key: "appKey", label: "Datadog application key", type: "secret", secret: "datadog-app-key" },
      ],
      async discover(i, ws) {
        const report: string[] = [];
        let input = i.files;
        if (!input.length) {
          const [apiKey, appKey] = [await ctx.secrets.get("datadog-api-key"), await ctx.secrets.get("datadog-app-key")];
          if (!apiKey || !appKey) throw new Error("Pick trace exports, or enter Datadog API and application keys to read the live service map.");
          input = [await fetchDatadog((url, init) => ctx.net.fetch(url, init), { site: i.config.site, env: i.config.environment || "prod", apiKey, appKey })];
        }
        const patch = tracesToPatch(observeTraces(input, report), ws, { environment: i.config.environment || undefined });
        patch.report!.push(...report);
        return patch;
      },
    });
  },
});
