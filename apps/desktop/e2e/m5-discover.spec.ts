import { expect, test } from "@playwright/test";
import { newWorkspace, node, openView, state } from "./helpers";

const FIX = new URL("../../../fixtures/discovery/", import.meta.url).pathname;

async function discover(page: import("@playwright/test").Page, connector: string, files: string[]) {
  await page.getByRole("button", { name: "Discover", exact: true }).first().click();
  const p = page.getByTestId("discover-page");
  await p.getByRole("button", { name: connector }).click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), p.getByRole("button", { name: "Add files…" }).click()]);
  await chooser.setFiles(files.map((f) => FIX + f));
  await p.getByRole("button", { name: "Discover", exact: true }).click();
  await expect(page.getByTestId("review")).toBeVisible();
}

test("discovering from Kubernetes manifests shows a diff, then builds containers and a deployment view", async ({ page }) => {
  await page.goto("/");
  await newWorkspace(page, "m5-discover");
  await discover(page, "Kubernetes / Helm", ["k8s.yaml", "chart/Chart.yaml"]);
  const review = page.getByTestId("review");
  await expect(review).toContainText("Kubernetes: 4 workload(s), 3 service(s), 1 ingress(es), Helm chart shop");
  await expect(review).toContainText("+ element: Orders (c4:Container)");
  // nothing is applied until the user says so
  expect(Object.keys((await state(page)).elements)).toHaveLength(0);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByTestId("breadcrumbs")).toContainText("(discovered)");
  await openView(page, "Shop – Kubernetes (discovered)");
  await expect(node(page, "Orders")).toBeVisible();
  await expect(node(page, "Namespace shop")).toBeVisible();

  // running it again changes nothing
  await discover(page, "Kubernetes / Helm", ["k8s.yaml", "chart/Chart.yaml"]);
  await expect(page.getByTestId("review")).toContainText("+0 added");
  await expect(page.getByTestId("review")).toContainText("Nothing would change.");
});

test("every connector runs on its fixture", async ({ page }) => {
  await page.goto("/");
  await newWorkspace(page, "m5-all");
  for (const [connector, files, text] of [
    ["docker-compose", ["compose.yaml"], "docker-compose: 6 service(s)"],
    ["Terraform state or plan", ["terraform-show.json"], "Terraform: 7 infrastructure resource(s)"],
    ["OpenAPI / AsyncAPI", ["asyncapi.yaml"], "3 channel(s)"],
  ] as const) {
    await discover(page, connector, [...files]);
    await expect(page.getByTestId("review")).toContainText(text);
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByTestId("review")).toBeHidden();
  }
  const ws = await state(page);
  expect(Object.values(ws.elements).some((e: any) => e.name === "orders-db" && e.properties.kind === "Database")).toBe(true);
});

test("ServiceNow CMDB, Google Cloud and Azure run from exported files", async ({ page }) => {
  await page.goto("/");
  await newWorkspace(page, "m5-cloud");
  // ServiceNow shows its live-connection fields, with secrets as password inputs, but files alone are enough
  await page.getByRole("button", { name: "Discover", exact: true }).first().click();
  const p = page.getByTestId("discover-page");
  await p.getByRole("button", { name: "ServiceNow CMDB" }).click();
  await expect(p.getByLabel("Password")).toHaveAttribute("type", "password");
  for (const [connector, files, text] of [
    ["ServiceNow CMDB", ["servicenow/cmdb_ci_business_app.json", "servicenow/cmdb_ci_appl.json", "servicenow/servers.csv", "servicenow/cmdb_rel_ci.json"], "ServiceNow: 8 configuration item(s), 8 relationship(s)"],
    ["Google Cloud (read-only)", ["gcp/gcloud-config-get-value-project.json", "gcp/gcloud-compute-instances-list.json", "gcp/gcloud-compute-networks-list.json", "gcp/gcloud-compute-networks-subnets-list.json"], "Google Cloud: 3 resource(s) in project shop-prod-123"],
    ["Microsoft Azure (read-only)", ["azure/az-account-show.json", "azure/az-group-list.json", "azure/az-resource-list.json"], "Azure: 6 resource(s) in 2 resource group(s)"],
  ] as const) {
    await discover(page, connector, [...files]);
    await expect(page.getByTestId("review")).toContainText(text);
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByTestId("review")).toBeHidden();
  }
  const names = Object.values((await state(page)).elements).map((e: any) => e.name);
  expect(names).toEqual(expect.arrayContaining(["Online Shop", "lnx-db-01", "api-1", "aks-shop", "pg-orders"]));
});
