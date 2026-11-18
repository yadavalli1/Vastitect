import { definePlugin } from "@vastitecture/plugin-sdk";
import { discoverApis } from "./openapi";
import { discoverCompose } from "./compose";
import { discoverKubernetes } from "./kubernetes";
import { discoverTerraform } from "./terraform";
import { discoverBackstage } from "./backstage";
import { discoverGit } from "./git";
import { discoverAws } from "./aws";

export { discoverApis, discoverCompose, discoverKubernetes, discoverTerraform, discoverBackstage, discoverGit, discoverAws };
export { AWS_COMMANDS } from "./aws";
export { MANIFESTS } from "./git";

/**
 * Read-only discovery from files the user picks. None of these connectors touch the network:
 * they parse specs, manifests and state exports and return a draft patch shown as a diff.
 */
export default definePlugin({
  manifest: { id: "vastitecture.discovery", name: "Discovery connectors", version: "0.1.0", apiVersion: "1.0.0", capabilities: ["connector"], permissions: { fs: ["read:pick"] } },
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
      fields: [files, { key: "region", label: "Region", type: "string", placeholder: "eu-west-1" }, { key: "environment", label: "Environment", type: "string", placeholder: "Production" }],
      discover: (i) => discoverAws(i.files, i.config),
    });
  },
});
