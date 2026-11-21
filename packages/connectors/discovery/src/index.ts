import { definePlugin, type ModelPatch } from "@vastitecture/plugin-sdk";
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
import { codeOwners, fetchGithub, GH_FIELDS, parseGithubFiles, reposToPatch } from "./github";
import { fetchAzureDevOps, fetchJira, linkWorkItems, parseWorkItemFiles } from "./workitems";
import { ardoqToPatch, leanixToPatch, sparxToPatch } from "./enterprise";
import { applyServiceNowWriteBack, fetchServiceNow, parseServiceNowFiles, planServiceNowWriteBack, serviceNowToPatch, SERVICENOW_TABLES } from "./servicenow";

export { discoverApis, discoverCompose, discoverKubernetes, discoverTerraform, discoverBackstage, discoverGit, discoverAws };
export { applyServiceNowWriteBack, planServiceNowWriteBack };
export { AWS_COMMANDS, discoverAzure, discoverGcp, AZ_COMMANDS, GCLOUD_COMMANDS, fetchServiceNow, parseServiceNowFiles, serviceNowToPatch, SERVICENOW_TABLES };
export { fetchDatadog, observeTraces, tracesToPatch };
export { codeOwners, fetchGithub, parseGithubFiles, reposToPatch, fetchAzureDevOps, fetchJira, linkWorkItems, parseWorkItemFiles, ardoqToPatch, leanixToPatch, sparxToPatch };
export { MANIFESTS } from "./git";

/**
 * Read-only discovery from files the user picks. None of these connectors touch the network:
 * they parse specs, manifests and state exports and return a draft patch shown as a diff.
 */
export default definePlugin({
  manifest: { id: "vastitecture.discovery", name: "Discovery connectors", version: "0.1.0", apiVersion: "1.0.0", capabilities: ["connector"], permissions: { fs: ["read:pick"], network: ["*.service-now.com", "*.servicenowservices.com", "api.datadoghq.com", "api.datadoghq.eu", "api.us3.datadoghq.com", "api.us5.datadoghq.com", "api.ap1.datadoghq.com", "api.ddog-gov.com", "api.github.com", "*.atlassian.net", "dev.azure.com"], secrets: ["servicenow-password", "servicenow-token", "datadog-api-key", "datadog-app-key", "github-token", "jira-token", "azure-devops-token"] } },
  activate(ctx) {
    const files = { key: "files", label: "Files", type: "files" as const };
    const snAuth = (config: Record<string, string>) => snAuthWith(ctx, config);
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
      fields: [
        files,
        { key: "context", label: "kubectl context (live)", type: "string", placeholder: "current context" },
        { key: "namespace", label: "Namespace (live, optional)", type: "string", placeholder: "all namespaces" },
        { key: "cluster", label: "Cluster name", type: "string", placeholder: "Kubernetes cluster" },
        { key: "system", label: "System name (optional)", type: "string" },
        { key: "environment", label: "Environment", type: "string", placeholder: "Production" },
      ],
      cli: { tool: "kubectl", commands: [["get", "deployments,statefulsets,daemonsets,cronjobs,services,ingresses"]], flags: { context: "--context", namespace: "--namespace" } },
      discover: (i) => discoverKubernetes(i.files, { ...i.config, cluster: i.config.cluster || i.config.context || undefined }),
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
      // Write-back: compares the model with the CMDB as it is now; the user picks what to send.
      async planWriteBack(i, ws) {
        return planServiceNowWriteBack((url, init) => ctx.net.fetch(url, init), await snAuth(i.config), ws);
      },
      async applyWriteBack(i, items) {
        return applyServiceNowWriteBack((url, init) => ctx.net.fetch(url, init), await snAuth(i.config), items);
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
    ctx.connectors.register({
      id: "github",
      label: "GitHub organisation",
      description: `Every repository of an organisation becomes a container: language as technology, CODEOWNERS as owner, archived as end of life, topics as tags. A system-<name> topic groups repositories under a software system. Live in the desktop app (a token raises GitHub's rate limit and shows private repositories), or from \`gh repo list ORG --json ${GH_FIELDS}\` output plus CODEOWNERS files named <repo>.CODEOWNERS.`,
      fields: [
        { key: "org", label: "Organisation or user", type: "string", placeholder: "acme" },
        { key: "token", label: "Token (optional; read-only metadata and contents)", type: "secret", secret: "github-token" },
        { ...files, label: "…or gh output and CODEOWNERS files", optional: true },
      ],
      async discover(i) {
        if (i.files.length) return reposToPatch(parseGithubFiles(i.files));
        if (!i.config.org) throw new Error("Enter an organisation, or pick files");
        return reposToPatch(await fetchGithub((url, init) => ctx.net.fetch(url, init), { org: i.config.org, token: await ctx.secrets.get("github-token") }), `GitHub ${i.config.org}`);
      },
    });
    ctx.connectors.register({
      id: "jira",
      label: "Jira work items",
      description: "Links Jira issues to the elements they change, matching labels and components to element names (or an element's workItemKey property). Matched elements get links to their issues and a delivery status. Live from Jira Cloud with an e-mail address and API token, or from a CSV export or saved search JSON.",
      fields: [
        { key: "site", label: "Jira Cloud site", type: "string", placeholder: "acme.atlassian.net" },
        { key: "email", label: "E-mail address", type: "string" },
        { key: "token", label: "API token", type: "secret", secret: "jira-token" },
        { key: "jql", label: "JQL (optional)", type: "string", placeholder: "statusCategory != Done ORDER BY updated DESC" },
        { ...files, label: "…or a CSV export", optional: true },
      ],
      async discover(i, ws) {
        const report: string[] = [];
        if (i.files.length) return withReport(linkWorkItems(ws, parseWorkItemFiles(i.files, report), "Jira"), report);
        const token = await ctx.secrets.get("jira-token");
        if (!token || !i.config.email) throw new Error("Enter the site, e-mail address and API token, or pick a CSV export");
        return linkWorkItems(ws, await fetchJira((url, init) => ctx.net.fetch(url, init), { site: i.config.site ?? "", email: i.config.email, token, jql: i.config.jql }), "Jira");
      },
    });
    ctx.connectors.register({
      id: "azure-devops",
      label: "Azure DevOps work items",
      description: "Links Azure DevOps work items to elements by tag or area path. Live with a personal access token (Work Items: Read), or from a CSV export of a query.",
      fields: [
        { key: "organization", label: "Organisation", type: "string", placeholder: "acme" },
        { key: "project", label: "Project", type: "string" },
        { key: "token", label: "Personal access token", type: "secret", secret: "azure-devops-token" },
        { key: "wiql", label: "WIQL query (optional)", type: "string" },
        { ...files, label: "…or a CSV export", optional: true },
      ],
      async discover(i, ws) {
        const report: string[] = [];
        if (i.files.length) return withReport(linkWorkItems(ws, parseWorkItemFiles(i.files, report), "Azure DevOps"), report);
        const token = await ctx.secrets.get("azure-devops-token");
        if (!token) throw new Error("Enter a personal access token, or pick a CSV export");
        return linkWorkItems(ws, await fetchAzureDevOps((url, init) => ctx.net.fetch(url, init), { organization: i.config.organization ?? "", project: i.config.project ?? "", token, wiql: i.config.wiql }), "Azure DevOps");
      },
    });
    ctx.connectors.register({
      id: "leanix",
      label: "LeanIX (import)",
      description: "Fact sheets and their relations as ArchiMate: applications, IT components, capabilities, interfaces, data objects, providers, user groups, processes and projects, with lifecycle. Reads a GraphQL allFactSheets answer (JSON) or a CSV export with Type and Name columns.",
      fields: [files],
      discover: (i) => leanixToPatch(i.files),
    });
    ctx.connectors.register({
      id: "ardoq",
      label: "Ardoq (import)",
      description: "Components and references from Ardoq's REST API (JSON with a values list) or CSV exports. Component types are mapped by name (application, capability, server, data, …); unrecognised types are listed in the report.",
      fields: [files],
      discover: (i) => ardoqToPatch(i.files),
    });
    ctx.connectors.register({
      id: "sparx",
      label: "Sparx Enterprise Architect (XMI)",
      description: "UML from an XMI 2.x export: packages become groupings; components, interfaces, nodes, artifacts, actors and classes become ArchiMate elements; dependencies, realisations, associations, generalisations and information flows become relationships. ArchiMate models in Sparx are better exported as Open Exchange files and imported with Import.",
      fields: [files],
      discover: (i) => sparxToPatch(i.files),
    });
  },
});

async function snAuthWith(ctx: { secrets: { get(n: string): Promise<string | undefined> } }, config: Record<string, string>) {
  const token = await ctx.secrets.get("servicenow-token");
  return { instance: config.instance ?? "", username: config.username, token, password: token ? undefined : await ctx.secrets.get("servicenow-password") };
}

function withReport(patch: ModelPatch, extra: string[]): ModelPatch {
  return { ...patch, report: [...(patch.report ?? []), ...extra] };
}
