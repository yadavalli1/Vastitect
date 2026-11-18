import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { newView, newWorkspace, node, state } from "./helpers";

const CREATE = new URL("../../../packages/create-vastitecture-plugin/bin/create.js", import.meta.url).pathname;

async function install(page: import("@playwright/test").Page, dir: string) {
  await page.getByRole("button", { name: "Plugins" }).click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Install from files…" }).click()]);
  await chooser.setFiles([join(dir, "plugin.json"), join(dir, "index.js")]);
}

test("a plugin made with the scaffolder adds a new notation without any change to core code", async ({ page }) => {
  const dir = join(mkdtempSync(join(tmpdir(), "scaffold-")), "service-map");
  const out = execFileSync("node", [CREATE, dir, "--template", "notation", "--id", "acme.service-map", "--name", "Service Map"], { encoding: "utf8" });
  expect(out).toContain('Created notation plugin "Service Map"');

  await page.goto("/");
  await newWorkspace(page, "m5-plugin");
  await install(page, dir);
  // the user sees what the plugin wants before any of its code runs
  const approval = page.getByTestId("plugin-approval");
  await expect(approval).toContainText("Adds: notation");
  await expect(approval).toContainText("No network access");
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  const row = page.locator('[data-plugin="acme.service-map"]');
  await expect(row).toContainText("Active");
  await expect(row).toContainText("notation: servicemap");

  // the new notation is usable like any built-in one
  await page.getByRole("button", { name: "Diagrams" }).click();
  await newView(page, "Service Map", "Services");
  const palette = page.getByTestId("palette");
  await expect(palette.getByRole("button", { name: "Thing" })).toBeVisible();
  await palette.getByRole("button", { name: "Thing" }).click();
  await palette.getByRole("button", { name: "Store" }).click();
  await expect(node(page, "Thing").locator(".vnode")).toHaveAttribute("data-type", "servicemap:Thing");
  await expect(node(page, "Store").locator(".vnode")).toHaveAttribute("data-type", "servicemap:Store");
  const valid = await page.evaluate(() => (window as any).__vastitecture.registry.validRelationships("servicemap", "servicemap:Store", "servicemap:Thing"));
  expect(valid).toEqual({ types: ["servicemap:Feeds"], strict: true });

  // it survives a reload: installed plugins are loaded again at start-up, without asking twice
  await page.reload();
  await expect(node(page, "Thing").locator(".vnode")).toHaveAttribute("data-type", "servicemap:Thing");
  await expect(page.getByTestId("plugin-approval")).toHaveCount(0);
  expect(Object.values((await state(page)).elements).map((e: any) => e.type).sort()).toEqual(["servicemap:Store", "servicemap:Thing"]);
});

test("a plugin is refused when not approved, and sandboxed code cannot reach the network itself", async ({ page }) => {
  const dir = join(mkdtempSync(join(tmpdir(), "scaffold-")), "sneaky");
  execFileSync("node", [CREATE, dir, "--template", "validator", "--id", "acme.sneaky"]);
  await page.goto("/");
  await newWorkspace(page, "m5-refuse");
  await install(page, dir);
  await page.getByRole("button", { name: "Don’t allow" }).click();
  await expect(page.locator('[data-plugin="acme.sneaky"]')).toHaveCount(0);

  // inside a plugin worker, fetch and XMLHttpRequest are gone before plugin code runs
  const globals = await page.evaluate(async () => {
    const code = `export default { activate(ctx) { ctx.validators.register({ id: "probe", run: () => [{ code: "probe", severity: "info", message: [typeof fetch, typeof XMLHttpRequest, typeof WebSocket, typeof importScripts].join(","), target: { kind: "workspace" } }] }); } };`;
    const manifest = JSON.stringify({ id: "acme.probe", name: "Probe", version: "1.0.0", apiVersion: "1.0.0", capabilities: ["validator"] });
    localStorage.setItem("vastitecture/plugins/approved", JSON.stringify([`acme.probe|validator|{}`]));
    const h = (window as any).__vastitecture;
    await h.installPlugin(manifest, code);
    const v = h.registry.validators.get("probe");
    return (await v.run(h.model.state))[0].message;
  });
  expect(globals).toBe("undefined,undefined,undefined,undefined");
});

test("the example Wardley plugin adds a notation, a validator and a side panel", async ({ page }) => {
  await page.goto("/");
  await newWorkspace(page, "m5-wardley");
  await install(page, new URL("../../../examples/plugins/wardley", import.meta.url).pathname);
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  await expect(page.locator('[data-plugin="example.wardley"]')).toContainText("Active");
  await page.getByRole("button", { name: "Diagrams" }).click();
  await newView(page, "Wardley map", "Tea shop");
  await page.getByTestId("palette").getByRole("button", { name: "Component" }).click();
  await page.getByTestId("properties").getByLabel("Evolution").selectOption("Commodity");
  await expect(page.locator('details[data-panel="wardley-summary"] iframe')).toBeVisible();
  const frame = page.frameLocator('details[data-panel="wardley-summary"] iframe');
  await expect(frame.locator("tr", { hasText: "Commodity" })).toContainText("1");
});
