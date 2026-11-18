import { expect, test } from "@playwright/test";
import { newWorkspace, node, openView, state } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await newWorkspace(page, "m6-" + Math.random().toString(36).slice(2, 8), "sample");
});

const go = (page: import("@playwright/test").Page, section: string) => page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: section, exact: true }).click();

test("the sample workspace answers “what breaks if we retire the Warehouse System”", async ({ page }) => {
  await go(page, "Impact analysis");
  const p = page.getByTestId("impact-page");
  await p.getByLabel("Element").selectOption({ label: "Warehouse System (Software System)" });
  const result = page.getByTestId("impact-result");
  await expect(result.getByRole("heading")).toHaveText("What breaks if Warehouse System is retired");
  for (const n of ["Warehousing", "Shipping", "Fulfilment"]) await expect(result.getByRole("button", { name: n, exact: true })).toBeVisible();
  await expect(result).toContainText("directly: Warehouse System → Warehousing");
  // and the same question lights up a diagram
  await result.getByRole("button", { name: "Highlight on a diagram" }).click();
  await expect(page.getByRole("button", { name: "Used by" })).toHaveAttribute("aria-pressed", "true");

  // other questions
  await go(page, "Impact analysis");
  await p.getByLabel("Question").selectOption({ label: "What uses…" });
  await p.getByLabel("Element").selectOption({ label: "Order (Data Object)" });
  await expect(result).toContainText("Access (ReadWrite)");
  await expect(result.getByRole("button", { name: "Online Shop" })).toBeVisible();
  await p.getByLabel("Question").selectOption({ label: "Which elements have no owner?" });
  await expect(result.getByRole("button", { name: "CRM" })).toBeVisible();
});

test("fact sheets: inline edit, filter, saved filters and bulk edit", async ({ page }) => {
  await go(page, "Fact sheets");
  const p = page.getByTestId("factsheets-page");
  await p.getByLabel("Filter fact sheets").fill("type:c4:softwaresystem");
  await expect(page.getByTestId("factsheets").locator("tbody tr")).toHaveCount(6);
  // inline edit
  await p.getByLabel("Owner of CRM").fill("Team Care");
  await p.getByLabel("Owner of CRM").press("Enter");
  await p.getByLabel("Business criticality of CRM").selectOption("Business critical");
  let crm: any = Object.values((await state(page)).elements).find((e: any) => e.name === "CRM");
  expect(crm).toMatchObject({ owner: "Team Care", properties: { criticality: "Business critical" } });
  // saved filter from the sample
  await p.getByLabel("Saved filters").selectOption("Phasing out");
  await expect(page.getByTestId("factsheets").locator("tbody tr")).toHaveCount(1);
  await expect(p.getByLabel("Name of Warehouse System")).toHaveValue("Warehouse System");
  // bulk edit two rows, one undo step
  await p.getByLabel("Filter fact sheets").fill("type:c4:softwaresystem");
  await p.getByLabel("Select CRM").check();
  await p.getByLabel("Select Email Service").check();
  await p.getByLabel("Bulk field").selectOption({ label: "Technical fit" });
  await p.getByLabel("Bulk value").selectOption("Excellent");
  await p.getByRole("button", { name: "Apply to selected" }).click();
  const fits = () => state(page).then((ws) => Object.values(ws.elements).filter((e: any) => ["CRM", "Email Service"].includes(e.name)).map((e: any) => e.properties.technicalFit));
  expect(await fits()).toEqual(["Excellent", "Excellent"]);
  await page.getByRole("button", { name: "Undo" }).click();
  expect(await fits()).toEqual(["Adequate", "Adequate"]);
  crm = Object.values((await state(page)).elements).find((e: any) => e.name === "CRM");
  expect(crm.owner).toBe("Team Care");
});

test("capability heat map, lifecycle roadmap and decisions", async ({ page }) => {
  await go(page, "Capability map");
  const cap = page.getByTestId("capabilities-page");
  await expect(cap.locator('[data-capability="Warehousing"]').getByTestId("heat-value").first()).toHaveText("Insufficient");
  await cap.getByLabel("Heat map metric").selectOption({ label: "Application count" });
  await expect(cap.locator('[data-capability="Warehousing"]').getByTestId("heat-value").first()).toHaveText("2");
  await cap.getByLabel("Heat map metric").selectOption({ label: "Lifecycle risk (worst application phase)" });
  await expect(cap.locator('[data-capability="Warehousing"]').getByTestId("heat-value").first()).toHaveText("Phase out");

  await go(page, "Lifecycle roadmap");
  const road = page.getByTestId("roadmap-page");
  const wms = road.getByRole("row").filter({ hasText: "Warehouse System" });
  await expect(wms.locator('[data-phase="phaseOut"]')).toBeVisible();
  await expect(wms.locator('[data-phase="endOfLife"]')).toBeVisible();
  await expect(road.getByRole("row").filter({ hasText: "Fulfilment Platform" }).locator('[data-phase="plan"]')).toBeVisible();

  // decisions: open one linked from an element, then write a new one linked to the selection
  await go(page, "Diagrams");
  await openView(page, "Online Shop – containers");
  await node(page, "Warehouse System").click();
  await page.getByTestId("properties").getByRole("button", { name: /0002 Replace the Warehouse System/ }).click();
  await expect(page.getByTestId("adr-preview")).toContainText("out of vendor support");
  await page.getByRole("button", { name: "+ New" }).click();
  await page.getByLabel("Title").fill("Adopt OpenTelemetry");
  await page.getByLabel("Title").press("Enter");
  await page.getByLabel("Markdown").fill("## Decision\n\nUse **OpenTelemetry** everywhere.");
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByTestId("adr-preview").locator("strong")).toHaveText("OpenTelemetry");
  const ws = await state(page);
  const adr: any = Object.values(ws.adrs).find((a: any) => a.title === "Adopt OpenTelemetry");
  expect(adr).toMatchObject({ id: "0003", status: "proposed" });
  expect(adr.elements.map((id: string) => ws.elements[id].name)).toEqual(["Warehouse System"]);
});

test("search everything, and move around a diagram with the keyboard", async ({ page }) => {
  await page.keyboard.press("Control+p");
  await page.getByRole("dialog", { name: "Search" }).getByLabel("Search").fill("warehouse");
  const results = page.getByTestId("search-results");
  await expect(results.getByRole("option", { name: /^Warehouse System/ })).toBeVisible();
  await expect(results.getByRole("option", { name: /0002 Replace the Warehouse System/ })).toBeVisible();
  await results.getByRole("option", { name: /^Warehouse System/ }).click();
  await expect(page.getByTestId("properties").getByLabel("Name")).toHaveValue("Warehouse System");

  // arrow keys walk the diagram, Shift+arrows nudge
  await page.getByTestId("canvas").focus();
  const sel = () => page.evaluate(() => (window as any).__vastitecture.app.getState().selection.elements);
  const start = await sel();
  await page.keyboard.press("ArrowUp");
  await expect.poll(sel).not.toEqual(start);
  const moved = (await sel())[0];
  const pos = () => page.evaluate((id) => { const s = (window as any).__vastitecture; const v = s.model.state.views[s.app.getState().activeView]; return v.nodes.find((n: any) => n.element === id).x; }, moved);
  const x0 = await pos();
  await page.keyboard.press("Shift+ArrowRight");
  expect(await pos()).toBe(x0 + 10);
});
