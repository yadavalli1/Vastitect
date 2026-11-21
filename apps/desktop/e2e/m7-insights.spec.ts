import { expect, test, type Page } from "@playwright/test";
import { files, newWorkspace, node, openView } from "./helpers";

const go = (page: Page, section: string) => page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: section, exact: true }).click();
const update = (page: Page, name: string, patch: object) =>
  page.evaluate(([n, p]) => {
    const v = (window as any).__vastitecture;
    const e = Object.values(v.model.state.elements).find((x: any) => x.name === n) as any;
    v.model.dispatch({ type: "updateElement", id: e.id, patch: typeof p === "function" ? p : { ...p, properties: { ...e.properties, ...((p as any).properties ?? {}) } } });
  }, [name, patch] as const);

test("insights: plateaus, structure, data exposure and costs, drawn over the diagrams", async ({ page }) => {
  await page.goto("/");
  await newWorkspace(page, "m7-insights", "sample");
  await update(page, "Orders DB", { lifecycle: { phase: "phaseOut", dates: { active: "2020-01-01", endOfLife: "2030-01-01" } }, properties: { dataClassification: "restricted", monthlyCost: 400, costCurrency: "EUR" } });
  await update(page, "Order API", { properties: { dataClassification: "internal", monthlyCost: 100, costCurrency: "EUR" } });

  await go(page, "Insights");
  const p = page.getByTestId("insights-page");
  await p.getByRole("tab", { name: "As-is / to-be" }).click();
  await p.getByLabel("As-is date").fill("2029-01-01");
  await p.getByLabel("To-be date").fill("2031-01-01");
  const plateaus = p.getByTestId("plateaus");
  await expect(plateaus).toContainText("Retired (1)");
  await expect(plateaus).toContainText("Orders DB");
  await expect(plateaus).toContainText("Dependencies the migration breaks");
  await expect(plateaus.locator("section").last()).toContainText("Order API");
  await p.getByRole("button", { name: "Show on the diagrams" }).click();
  await expect(page.getByTestId("overlay-banner")).toContainText("Migration 2029-01-01 → 2031-01-01");
  await expect(node(page, "Orders DB").locator(".vnode")).toHaveClass(/tone-remove/);
  await expect(node(page, "Order API").locator(".vnode")).toHaveClass(/tone-warn/);
  await page.getByTestId("overlay-banner").getByRole("button", { name: "Clear" }).click();
  await expect(node(page, "Orders DB").locator(".vnode")).not.toHaveClass(/tone-/);

  await go(page, "Insights");
  await p.getByRole("tab", { name: "Structure" }).click();
  await expect(p.getByTestId("structure")).toContainText("Hotspots");
  await p.getByRole("tab", { name: "Data" }).click();
  await expect(p.getByTestId("data")).toContainText("is cleared for internal but receives restricted data");
  await p.getByRole("tab", { name: "Costs" }).click();
  await expect(p.getByTestId("costs")).toContainText("500 EUR"); // Online Shop includes both containers
});

test("comments are kept in the workspace, one file each, and can be resolved", async ({ page }) => {
  await page.goto("/");
  await newWorkspace(page, "m7-comments", "sample");
  await openView(page, "Online Shop – containers");
  await node(page, "Order API").click();
  const c = page.getByTestId("comments");
  await c.getByLabel("Comment author").fill("Ana");
  await c.getByLabel("New comment").fill("Should this be split?");
  await c.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(c).toContainText("Ana");
  await expect(c).toContainText("Should this be split?");
  await expect.poll(async () => Object.keys(await files(page, "m7-comments")).filter((k) => k.startsWith("comments/")).length).toBe(1);
  await c.getByRole("button", { name: "Resolve" }).click();
  await expect(c).not.toContainText("Should this be split?");
  await expect(c.getByRole("button", { name: "Show 1 resolved" })).toBeVisible();
});
