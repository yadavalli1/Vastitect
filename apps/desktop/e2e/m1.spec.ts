import { expect, test } from "@playwright/test";
import { connectNodes, files, newView, newWorkspace, state } from "./helpers";

test("first launch opens the sample workspace with no configuration", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".react-flow__node")).not.toHaveCount(0);
  expect(Object.keys((await state(page)).views).length).toBeGreaterThan(0);
});

test("create a workspace, draw, connect, rename, delete, undo, and reopen", async ({ page }) => {
  await page.goto("/");
  await newWorkspace(page, "m1-test");
  await newView(page, "Generic", "Sketch");

  await page.locator('[data-palette="generic:Box"]').click();
  await page.locator('[data-palette="generic:Box"]').click();
  await expect(page.locator(".react-flow__node")).toHaveCount(2);

  // connect: only valid relationship types are offered, likeliest preselected, Enter confirms
  await connectNodes(page, "Box", "Box 2");
  await expect(page.getByRole("dialog", { name: "Relationship type" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Relationship type" }).getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);

  // rename with the keyboard
  await page.locator('.react-flow__node:has([aria-label$=": Box"])').click();
  await page.keyboard.press("Enter");
  await page.getByLabel("Element name").fill("Web shop");
  await page.keyboard.press("Enter");
  await expect(page.locator('[aria-label="Box: Web shop"]')).toBeVisible();

  // Tab creates a connected element ready to rename
  await page.keyboard.press("Tab");
  await page.getByLabel("Element name").fill("Warehouse");
  await page.keyboard.press("Enter");
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);

  // delete and undo/redo
  await page.locator('.react-flow__node:has([aria-label$=": Box 2"])').click();
  await page.keyboard.press("Delete");
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);

  // autosave writes one readable file per element
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  const before = await files(page, "m1-test");
  const elementFiles = Object.keys(before).filter((p) => p.startsWith("model/elements/generic/box/"));
  expect(elementFiles.sort()).toEqual(["model/elements/generic/box/box-2.yaml", "model/elements/generic/box/warehouse.yaml", "model/elements/generic/box/web-shop.yaml"]);
  expect(before["model/elements/generic/box/web-shop.yaml"]).toMatch(/^id: \w+\ntype: generic:Box\nname: Web shop\n$/);

  // a rename through the properties panel is a one-line change in exactly one file
  await page.locator('.react-flow__node:has([aria-label$=": Web shop"])').click();
  await page.getByTestId("properties").getByLabel("Name").fill("Storefront");
  await page.keyboard.press("Enter");
  await expect(page.locator('[aria-label="Box: Storefront"]')).toBeVisible();
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  const after = await files(page, "m1-test");
  const changed = Object.keys(after).filter((p) => after[p] !== before[p]);
  // the file keeps its name: renames do not move files
  expect(changed).toEqual(["model/elements/generic/box/web-shop.yaml"]);
  expect(after[changed[0]]).toContain("name: Storefront");

  // close and reopen
  await page.reload();
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await expect(page.locator('[aria-label="Box: Storefront"]')).toBeVisible();
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
});

test("exports a view as SVG and PNG", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".react-flow__node")).not.toHaveCount(0);
  const [svg] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "SVG", exact: true }).click()]);
  expect(svg.suggestedFilename()).toMatch(/\.svg$/);
  const text = (await (await svg.createReadStream()).toArray()).join("");
  expect(text).toContain("<svg");
  expect(text).toContain("<title>");
  const [png] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "PNG", exact: true }).click()]);
  const bytes = Buffer.concat(await (await png.createReadStream()).toArray());
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  expect(bytes.length).toBeGreaterThan(2000);
});

test("outside edits to the workspace files reload into the open canvas", async ({ page }) => {
  await page.goto("/");
  await newWorkspace(page, "m1-watch");
  await newView(page, "Generic", "Watch");
  await page.locator('[data-palette="generic:Box"]').click();
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  // simulate `git pull` changing a file: another tab writes storage, which fires the watcher
  const other = await page.context().newPage();
  await other.goto("/");
  await other.evaluate(() => {
    const k = "vastitecture/ws/m1-watch/model/elements/generic/box/box.yaml";
    localStorage.setItem(k, localStorage.getItem(k)!.replace("name: Box", "name: Pulled from Git"));
  });
  await expect(page.locator('[aria-label="Box: Pulled from Git"]')).toBeVisible();
  await other.close();
});
