import { expect, test } from "@playwright/test";
import { newWorkspace } from "./helpers";

const A = "a".repeat(32), B = "b".repeat(32);

test("ServiceNow write-back: discover live, edit, compare, pick, confirm, write", async ({ page }) => {
  const writes: { method: string; path: string; body: any; auth?: string }[] = [];
  const cmdb: Record<string, { name: string; short_description: string; sys_class_name: string }> = {
    [A]: { name: "shop-web", short_description: "Web front end", sys_class_name: "cmdb_ci_appl" },
    [B]: { name: "shop-api", short_description: "", sys_class_name: "cmdb_ci_appl" },
  };
  await page.route("https://acme.service-now.com/**", async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const table = u.pathname.split("/")[4];
    if (req.method() !== "GET") {
      writes.push({ method: req.method(), path: u.pathname, body: req.postDataJSON(), auth: req.headers()["authorization"] });
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    const q = u.searchParams.get("sysparm_query") ?? "";
    const rows =
      table === "cmdb_ci_appl" || (table === "cmdb_ci" && q.startsWith("sys_idIN")) ? Object.entries(cmdb).filter(([id]) => table !== "cmdb_ci" || q.includes(id)).map(([sys_id, r]) => ({ sys_id, ...r }))
      : table === "cmdb_rel_type" ? [{ sys_id: "d".repeat(32) }]
      : [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ result: rows }) });
  });
  await page.goto("/");
  await newWorkspace(page, "m7-wb");
  await page.getByRole("button", { name: "Discover", exact: true }).first().click();
  const p = page.getByTestId("discover-page");
  await p.getByRole("button", { name: "ServiceNow CMDB" }).click();
  await p.getByLabel("Instance").fill("acme");
  await p.getByLabel("Username (for basic authentication)").fill("admin");
  await p.getByLabel("Password").fill("s3cret");
  await p.getByRole("button", { name: "Discover", exact: true }).click();
  await expect(page.getByTestId("review")).toContainText("ServiceNow (acme.service-now.com): 2 configuration item(s)");
  await page.getByRole("button", { name: "Apply", exact: true }).click();

  // Edit the model: rename one CI
  await page.evaluate((id) => {
    const v = (window as any).__vastitecture;
    const e = Object.values(v.model.state.elements).find((x: any) => x.properties.externalId === `servicenow:${id}`) as any;
    v.model.dispatch({ type: "updateElement", id: e.id, patch: { name: "Shop web" } });
  }, A);

  await page.getByRole("button", { name: "Discover", exact: true }).first().click();
  await p.getByRole("button", { name: "ServiceNow CMDB" }).click();
  await p.getByLabel("Instance").fill("acme");
  await p.getByLabel("Username (for basic authentication)").fill("admin");
  const wb = p.getByTestId("write-back");
  await wb.getByRole("button", { name: "Compare with the live system" }).click();
  await expect(wb).toContainText('Rename "shop-web" to "Shop web"');
  expect(writes).toEqual([]);
  await wb.getByRole("button", { name: /Write 1 selected change/ }).click();
  await expect(wb.getByRole("alert")).toContainText("This changes 1 record(s) in the live system");
  expect(writes).toEqual([]);
  await wb.getByRole("button", { name: "Yes, write the changes" }).click();
  await expect(wb.getByTestId("write-back-results")).toContainText('✓ Rename "shop-web" to "Shop web"');
  expect(writes).toEqual([{ method: "PATCH", path: `/api/now/table/cmdb_ci/${A}`, body: { name: "Shop web" }, auth: `Basic ${Buffer.from("admin:s3cret").toString("base64")}` }]);
});
