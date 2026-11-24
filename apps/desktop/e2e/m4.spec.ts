import { expect, test } from "@playwright/test";
import { appState, downloadText, files, newWorkspace, node, openView, state, exportMenu } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await newWorkspace(page, "m4-" + Math.random().toString(36).slice(2, 8), "sample");
});

test("one system appears in C4, ArchiMate and DDD views, and renaming it in one updates all three", async ({ page }) => {
  const ws = await state(page);
  const shop: any = Object.values(ws.elements).find((e: any) => e.name === "Online Shop");
  const holding = Object.values(ws.views).filter((v: any) => v.nodes.some((n: any) => n.element === shop.id)).map((v: any) => v.viewpoint);
  expect(holding).toEqual(expect.arrayContaining(["c4:container", "archimate:application", "ddd:context-map"]));

  // each notation draws the same element with its own shape
  await openView(page, "Online Shop – containers");
  await expect(node(page, "Online Shop").locator(".vnode")).toHaveAttribute("data-type", "c4:SoftwareSystem");
  await openView(page, "Application landscape (ArchiMate)");
  await expect(node(page, "Online Shop").locator(".vnode")).toHaveAttribute("data-type", "archimate:ApplicationComponent");
  await expect(node(page, "Customer").locator(".vnode")).toHaveAttribute("data-type", "archimate:BusinessActor");
  await openView(page, "Context map");
  await expect(node(page, "Online Shop").locator(".vnode")).toHaveAttribute("data-type", "ddd:BoundedContext");
  await expect(node(page, "Payment Provider").locator(".vnode")).toHaveAttribute("data-type", "ddd:ExternalSystem");

  // rename on the context map…
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  const name = (await appState(page)).fsLabel.replace("browser:", "");
  const before = await files(page, name);
  await node(page, "Online Shop").click();
  await page.keyboard.press("Enter");
  await page.getByLabel("Element name").fill("Web Store");
  await page.keyboard.press("Enter");
  await expect(node(page, "Web Store")).toBeVisible();
  // …and it is renamed in the C4 and ArchiMate views too
  await openView(page, "Online Shop – containers");
  await expect(page.locator('[aria-label="Software System: Web Store"]')).toBeVisible();
  await openView(page, "Application landscape (ArchiMate)");
  await expect(page.locator('[aria-label="Application Component: Web Store"]')).toBeVisible();
  await expect(page.locator('[aria-label$=": Online Shop"]')).toHaveCount(0);
  // one element, one file: the rename is a single-line change on disk
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  const after = await files(page, name);
  const changed = Object.keys(after).filter((p) => after[p] !== before[p]);
  expect(changed).toEqual(["model/elements/c4/software-system/online-shop.yaml"]);

  // "Shown in views" lists every view holding the element and navigates to it
  await node(page, "Web Store").click();
  const props = page.getByTestId("properties");
  await expect(props).toContainText("Shown here as Application Component");
  for (const v of ["Online Shop – containers", "Context map", "System landscape", "Application landscape (ArchiMate)"]) await expect(props.getByRole("button", { name: new RegExp("^" + v.replace(/[()]/g, "\\$&")) })).toBeVisible();
  await props.getByRole("button", { name: /^Context map/ }).click();
  await expect(page.getByTestId("breadcrumbs")).toContainText("Context map");
});

test("dropping an element with no mapping offers to create one; Formalise turns a whiteboard box into a typed element", async ({ page }) => {
  await openView(page, "System landscape");
  await page.getByRole("tab", { name: "Model" }).click();
  await page.getByLabel("Search the model").fill("Basket submitted");
  const row = page.locator(".row", { hasText: "Basket submitted" });
  await row.dragTo(page.getByTestId("canvas"), { targetPosition: { x: 420, y: 120 } });
  const chooser = page.getByRole("dialog", { name: /No mapping from Start \/ End to C4 model/ });
  await expect(chooser).toBeVisible();
  await chooser.getByRole("option", { name: /Software System\s*This element only/ }).click();
  await expect(node(page, "Basket submitted").locator(".vnode")).toHaveAttribute("data-type", "c4:SoftwareSystem");
  let ws = await state(page);
  const el: any = Object.values(ws.elements).find((e: any) => e.name === "Basket submitted");
  expect(el.type).toBe("generic:StartEnd"); // identity and primary type are unchanged
  expect(el.facets.c4.type).toBe("c4:SoftwareSystem");

  // Formalise: retype the whiteboard shape itself
  await node(page, "Basket submitted").click();
  await page.getByTestId("properties").getByLabel("Type").selectOption("c4:Person");
  await expect(node(page, "Basket submitted").locator(".vnode")).toHaveAttribute("data-type", "c4:Person");
  ws = await state(page);
  expect((Object.values(ws.elements).find((e: any) => e.name === "Basket submitted") as any).type).toBe("c4:Person");
  // it still sits in the whiteboard view it came from
  expect(Object.values(ws.views).filter((v: any) => v.nodes.some((n: any) => n.element === el.id))).toHaveLength(2);
});

test("context map with patterns, Bounded Context Canvas, Event Storming and CML export", async ({ page }) => {
  await openView(page, "Context map");
  await expect(page.locator(".vedge-label", { hasText: "D·ACL" })).toBeVisible();
  await expect(page.locator(".vedge-label", { hasText: "U·S" })).toBeVisible();

  // smart connector: only the strategic patterns are offered between two contexts
  const present = await page.evaluate(() => {
    const { registry } = (window as any).__vastitecture;
    return registry.validRelationships("ddd", "ddd:BoundedContext", "ddd:BoundedContext", "ddd:context-map").types.map((t: string) => registry.relationshipType(t).name);
  });
  expect(present).toEqual(["Partnership", "Shared Kernel", "Customer/Supplier", "Upstream/Downstream", "Conformist", "Anticorruption Layer", "Open Host Service", "Published Language", "Separate Ways", "Big Ball of Mud"]);

  // the canvas is a form-backed card over the same element
  await node(page, "Online Shop").click();
  await page.getByTestId("properties").getByRole("button", { name: "Open Bounded Context Canvas" }).click();
  const card = page.getByTestId("form-view");
  await expect(card.getByLabel("Name")).toHaveValue("Online Shop");
  await expect(card.getByRole("region", { name: "Ubiquitous language" })).toContainText("Basket");
  await card.getByRole("textbox", { name: "Purpose" }).fill("Turn a basket into a paid order.");
  await card.getByLabel("Name").focus();
  await card.getByLabel("Domain", { exact: true }).selectOption("Supporting");
  await expect(card).toContainText("Payment Provider"); // inbound relationship from the model
  const shop: any = Object.values((await state(page)).elements).find((e: any) => e.name === "Online Shop");
  expect(shop.properties).toMatchObject({ purpose: "Turn a basket into a paid order.", domainClassification: "Supporting" });

  // event storming: coloured stickies along a timeline
  await openView(page, "Order to shipment (event storm)");
  await expect(page.getByTestId("timeline")).toBeVisible();
  await expect(page.locator(".react-flow__node-shape")).toHaveCount(10);
  await expect(node(page, "Order placed").locator(".vnode")).toHaveAttribute("data-type", "ddd:DomainEvent");
  await expect(page.getByTestId("palette").getByRole("button", { name: "Read Model" })).toBeVisible();

  // CML export: the C4 system is written as a bounded context
  const out = await downloadText(page, () => exportMenu(page, "Context Mapper CML"));
  expect(out.text).toContain("ContextMap ContextMap {");
  expect(out.text).toContain("BoundedContext OnlineShop implements Ordering {");
  expect(out.text).toContain("PaymentProvider [U]->[D,ACL] OnlineShop");
  expect(out.text).toContain("OnlineShop [U,S]->[D,C] WarehouseSystem");

  // and the context map can be edited as CML in the split view
  await openView(page, "Context map");
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await page.getByLabel("Language").selectOption({ label: "Context Mapper CML" });
  await expect(page.getByTestId("code-pane").locator(".monaco-editor").first()).toContainText("contains");
});

test("TOGAF: ADM tagging, catalogs and matrices from the model, and the repository view", async ({ page }) => {
  await page.getByRole("button", { name: "Catalogs and matrices" }).click();
  const reports = page.getByTestId("reports-page");
  await expect(reports.getByRole("heading", { name: "Application Portfolio Catalog" })).toBeVisible();
  const table = page.getByTestId("report-table");
  // systems drawn in C4 are listed as applications through the mapping table
  for (const n of ["Online Shop", "Payment Provider", "Warehouse System", "CRM"]) await expect(table.getByRole("rowheader", { name: n, exact: true })).toBeVisible();
  await expect(table.getByRole("row", { name: /Online Shop/ })).toContainText("Mission critical");
  await expect(table.getByRole("rowheader", { name: "Web App" })).toHaveCount(0); // containers are not applications

  await reports.getByRole("button", { name: /Application Interaction Matrix/ }).click();
  // Online Shop -> Payment Provider exists only between a component and the provider: it is rolled up
  const cell = await page.evaluate(() => {
    const t = document.querySelector('[data-testid="report-table"]')!;
    const heads = [...t.querySelectorAll("thead th")].map((h) => h.textContent);
    const row = [...t.querySelectorAll("tbody tr")].find((r) => r.querySelector("th")!.textContent === "Online Shop")!;
    return row.children[heads.indexOf("Payment Provider")].textContent;
  });
  expect(cell).toBe("×");
  await reports.getByRole("button", { name: /Application\/Function Matrix/ }).click();
  await expect(table.getByRole("columnheader", { name: "Order Management" })).toBeVisible();

  const csv = await downloadText(page, () => reports.getByRole("button", { name: "CSV" }).click());
  expect(csv.text.split("\n")[0]).toContain("Order Management");
  const xlsx = await downloadText(page, () => reports.getByRole("button", { name: "Excel" }).click());
  expect(xlsx.bytes.subarray(0, 2).toString()).toBe("PK");
  const md = await downloadText(page, () => reports.getByRole("button", { name: "Markdown" }).click());
  expect(md.text).toContain("| --- |");

  // repository: views grouped by ADM phase and domain
  await page.getByRole("button", { name: "Architecture repository" }).click();
  const repo = page.getByTestId("repository-page");
  const rowB = repo.getByRole("row", { name: /^B: Business Architecture/ });
  await expect(rowB).toContainText("Capability map (ArchiMate)");
  await expect(rowB).toContainText("Context map");
  await repo.getByLabel("ADM phase for Online Shop – context").selectOption("A: Architecture Vision");
  await expect(repo.getByRole("row", { name: /^A: Architecture Vision/ })).toContainText("Online Shop – context");

  // any element can be tagged with an ADM phase from its properties
  await repo.getByRole("button", { name: "Context map" }).click();
  await node(page, "Warehouse System").click();
  await expect(page.getByTestId("properties").getByLabel("ADM phase")).toHaveValue("F: Migration Planning");
});

test("the mapping table is editable and drives how elements are drawn", async ({ page }) => {
  await page.getByRole("button", { name: "Cross-notation mapping" }).click();
  const pageEl = page.getByTestId("mappings-page");
  await expect(pageEl.getByRole("row", { name: /A business system/ })).toContainText("Application Component");
  // make "a business system" appear as a Node in ArchiMate instead
  await pageEl.getByRole("button", { name: "Remove archimate:ApplicationComponent" }).first().click();
  await pageEl.getByLabel("Add ArchiMate 4 type to A business system").selectOption("archimate:Node");
  await page.getByRole("button", { name: "Diagrams" }).click();
  await openView(page, "Application landscape (ArchiMate)");
  await expect(node(page, "Online Shop").locator(".vnode")).toHaveAttribute("data-type", "archimate:Node");
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  // undo takes you back to where the change was made
  await expect(page.getByTestId("mappings-page").getByRole("row", { name: /A business system/ })).toContainText("Application Component");
  await page.getByRole("button", { name: "Diagrams" }).click();
  await expect(node(page, "Online Shop").locator(".vnode")).toHaveAttribute("data-type", "archimate:ApplicationComponent");
});
