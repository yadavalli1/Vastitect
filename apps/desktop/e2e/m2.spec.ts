import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { applyReview, downloadText, newWorkspace, node, openView, pasteImport, state } from "./helpers";

/** The published "advanced" DSL template from the create-structurizr npm package. */
function publishedDsl() {
  const src = readFileSync(new URL("../../../packages/io/structurizr/node_modules/create-structurizr/index.js", import.meta.url), "utf8");
  const m = /templateType === 'advanced'\) \{\s*dslContent = `([\s\S]*?)`;/.exec(src)!;
  return m[1].replace(/\$\{workspaceName\}/g, "Sample").trim();
}

test("a published Structurizr DSL sample imports, lays itself out and exports back", async ({ page }) => {
  await page.goto("/");
  await newWorkspace(page, "m2-dsl");
  await pasteImport(page, publishedDsl());
  await expect(page.getByTestId("review")).toContainText("+12 added"); // 6 elements, 4 relationships, 2 views
  await applyReview(page);

  let ws = await state(page);
  expect(Object.keys(ws.elements)).toHaveLength(6);
  expect(Object.keys(ws.relationships)).toHaveLength(4);
  expect(Object.keys(ws.views)).toHaveLength(2);

  // auto-layout ran: nothing overlaps at the top level and the system boundary encloses its containers
  await openView(page, "Container");
  await expect(page.locator(".react-flow__node")).toHaveCount(6);
  await expect.poll(async () => Object.values((await state(page)).views).every((v: any) => v.nodes.some((n: any) => n.x !== 0 || n.y !== 0))).toBe(true);
  ws = await state(page);
  const container: any = Object.values(ws.views).find((v: any) => v.viewpoint === "c4:container");
  const sys = container.nodes.find((n: any) => ws.elements[n.element].type === "c4:SoftwareSystem");
  const kids = container.nodes.filter((n: any) => n.parent === sys.element);
  expect(kids).toHaveLength(3);
  for (const k of kids) {
    expect(k.x).toBeGreaterThanOrEqual(0);
    expect(k.x + k.w).toBeLessThanOrEqual(sys.w);
    expect(k.y + k.h).toBeLessThanOrEqual(sys.h);
  }
  for (let i = 0; i < kids.length; i++)
    for (let j = i + 1; j < kids.length; j++) {
      const a = kids[i], b = kids[j];
      expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
    }
  // the database container is drawn as a cylinder (shape variant from the "Database" tag)
  await expect(node(page, "Database")).toBeVisible();

  // export back to DSL: every element and relationship is still there
  const out = await downloadText(page, () => page.getByLabel("Export", { exact: true }).selectOption({ label: "Structurizr DSL" }));
  expect(out.name).toMatch(/\.dsl$/);
  for (const s of ['person "Customer"', 'person "Employee"', 'softwareSystem "My Software System"', 'container "Web App"', 'container "API"', 'container "Database"', '-> mySoftwareSystem.api "Calls"', '"Reads from and writes to"', '"Uses"', '"Manages"'])
    expect(out.text).toContain(s);
});

test("drill down from a system into its containers and back with breadcrumbs", async ({ page }) => {
  await page.goto("/");
  await newWorkspace(page, "m2-drill");
  await pasteImport(page, publishedDsl().replace(/container system "Container" \{[\s\S]*?\}\n/, ""));
  await applyReview(page);
  expect(Object.keys((await state(page)).views)).toHaveLength(1);
  await openView(page, "SystemContext");
  await node(page, "My Software System").dblclick();
  // a container view is created on demand, populated with the system's containers and its neighbours
  await expect(page.getByTestId("breadcrumbs")).toContainText("My Software System – Container");
  await expect(node(page, "Web App")).toBeVisible();
  await expect(node(page, "Customer")).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(6);
  await page.getByTestId("breadcrumbs").getByRole("button", { name: "SystemContext" }).click();
  await expect(node(page, "Web App")).toHaveCount(0);
  // double-clicking again reuses the same child view
  await node(page, "My Software System").dblclick();
  await expect(node(page, "Web App")).toBeVisible();
  expect(Object.keys((await state(page)).views)).toHaveLength(2);
});

test("implied relationships roll up between systems, and expand in place reveals the containers", async ({ page }) => {
  await page.goto("/");
  await newWorkspace(page, "m2-implied");
  await pasteImport(
    page,
    `workspace "Shops" {
  !identifiers hierarchical
  model {
    shop = softwareSystem "Shop" {
      web = container "Web"
    }
    pay = softwareSystem "Payments" {
      api = container "Pay API"
    }
    shop.web -> pay.api "Charges cards via"
  }
  views {
    systemLandscape "Landscape" {
      include *
      autoLayout
    }
  }
}`,
  );
  await applyReview(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  // only a container-to-container relationship exists, yet the systems are linked by an implied edge
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect(page.locator('.react-flow__edge [aria-label="implied relationship"]')).toHaveCount(1);
  // expand both systems in place: the real relationship replaces the implied one
  await node(page, "Shop").getByRole("button", { name: "Expand" }).click();
  await node(page, "Payments").getByRole("button", { name: "Expand" }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
  await expect(page.locator('.react-flow__edge [aria-label="implied relationship"]')).toHaveCount(0);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  // collapse one again: back to an implied edge to the collapsed system
  await node(page, "Payments").getByRole("button", { name: "Collapse" }).click();
  await expect(page.locator('.react-flow__edge [aria-label="implied relationship"]')).toHaveCount(1);
});

test("diagram as code: YAML and Structurizr DSL stay in sync with the canvas both ways", async ({ page }) => {
  await page.goto("/");
  await newWorkspace(page, "m2-code");
  await pasteImport(page, publishedDsl());
  await applyReview(page);
  await openView(page, "SystemContext");
  await page.getByRole("button", { name: "Code", exact: true }).click();
  const editor = page.getByTestId("code-pane").locator(".monaco-editor").first();
  await expect(editor).toContainText("name: Customer");

  // text -> canvas
  const setText = (fn: (t: string) => string) =>
    page.evaluate((src) => {
      const code = (window as any).__vastitecture.code;
      code.set(new Function("t", `return (${src})(t)`)(code.get()));
    }, fn.toString());
  await setText((t) => t.replace("name: Customer", "name: Shopper"));
  await expect(node(page, "Shopper")).toBeVisible();
  expect(Object.values((await state(page)).elements).some((e: any) => e.name === "Shopper")).toBe(true);

  // invalid text is reported and leaves the model alone
  await setText((t) => t.replace("view:", "view: [oops"));
  await expect(page.getByTestId("code-error")).toBeVisible();
  await expect(node(page, "Shopper")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).focus(); // blur: the text snaps back to the model
  await expect(page.getByTestId("code-error")).toBeHidden();

  // canvas -> text
  await node(page, "Employee").click();
  await page.getByTestId("properties").getByLabel("Name").fill("Staff member");
  await page.keyboard.press("Enter");
  await expect(editor).toContainText("name: Staff member");

  // the same view as Structurizr DSL
  await page.getByLabel("Language").selectOption({ label: "Structurizr DSL" });
  await expect(editor).toContainText('softwareSystem "My Software System"');
  await expect(editor).toContainText('person "Shopper"');
  await setText((t) => t.replace('person "Shopper" "A user of the system"', 'person "Shopper" "Buys things"'));
  await expect.poll(async () => Object.values((await state(page)).elements).find((e: any) => e.name === "Shopper")).toMatchObject({ description: "Buys things" });
  // positions survive a DSL edit: identities are re-keyed by name
  const ws = await state(page);
  const ctx: any = Object.values(ws.views).find((v: any) => v.viewpoint === "c4:context");
  expect(ctx.nodes).toHaveLength(3);
});
