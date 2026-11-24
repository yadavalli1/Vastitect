import { expect, test } from "@playwright/test";
import { applyReview, downloadText, newWorkspace, openView, state, exportMenu, importMenu } from "./helpers";

const SAMPLE = new URL("../../../packages/io/archimate/node_modules/mcp-archimate/data/", import.meta.url).pathname;

test("an Archi sample model imports, migrates to ArchiMate 4, renders and round-trips through the exchange format", async ({ page }) => {
  await page.goto("/");
  await newWorkspace(page, "m3-archi");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), importMenu(page, "Import files…")]);
  await chooser.setFiles(SAMPLE + "archisurance.archimate");
  const review = page.getByTestId("review");
  await expect(review).toBeVisible();
  // the migration report lists every change
  await expect(review).toContainText("migrated to ArchiMate 4");
  await expect(review).toContainText("Merged into the Common Domain: BusinessProcess → Process");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(review).toBeHidden();

  const ws = await state(page);
  expect(Object.keys(ws.elements).length).toBeGreaterThan(200);
  expect(Object.keys(ws.views)).toHaveLength(40);
  expect(Object.values(ws.elements).every((e: any) => e.type.startsWith("archimate:"))).toBe(true);
  expect(Object.values(ws.elements).some((e: any) => /archimate:(Business|Application|Technology)(Process|Function|Service|Event)$/.test(e.type))).toBe(false);

  // a diagram renders with its original layout (no auto-layout for files that carry positions)
  const big: any = Object.values(ws.views).sort((a: any, b: any) => b.edges.length - a.edges.length)[0];
  await openView(page, big.name);
  await expect(page.locator(".react-flow__node-shape")).toHaveCount(big.nodes.length);
  await expect.poll(() => page.locator(".react-flow__edge").count()).toBeGreaterThan(5);
  await expect(page.locator('.vnode[data-type^="archimate:"]').first()).toBeVisible();

  // exchange-format export uses ArchiMate 3.x names again and re-imports with nothing changed
  const out = await downloadText(page, () => exportMenu(page, "ArchiMate Model Exchange File Format (3.x)"));
  expect(out.name).toMatch(/\.xml$/);
  expect(out.text).toContain("http://www.opengroup.org/xsd/archimate/3.0/");
  expect(out.text).toContain('xsi:type="BusinessProcess"');
  const [again] = await Promise.all([page.waitForEvent("filechooser"), importMenu(page, "Import files…")]);
  await again.setFiles({ name: "roundtrip.xml", mimeType: "application/xml", buffer: out.bytes });
  await expect(review).toContainText("+0 added");
  await expect(review).toContainText("−0 removed");
});

test("viewpoints restrict the palette, and the About box carries the trademark notice", async ({ page }) => {
  await page.goto("/");
  await newWorkspace(page, "m3-vp");
  await page.getByRole("button", { name: "New view" }).click();
  await page.getByLabel("Notation", { exact: true }).selectOption({ label: "ArchiMate 4" });
  await page.getByLabel("Viewpoint").selectOption({ label: "Motivation" });
  await page.getByRole("button", { name: "Create view" }).click();
  const palette = page.getByTestId("palette");
  await expect(palette.getByRole("button", { name: /Stakeholder/ })).toBeVisible();
  await expect(palette.getByRole("button", { name: /Node/ })).toHaveCount(0);
  await page.getByTestId("properties").getByLabel("Viewpoint").selectOption({ label: "Layered" });
  await expect(palette.getByRole("button", { name: /Node/ })).toBeVisible();
  // permissive validity mode is announced, not hidden
  await page.getByRole("button", { name: /^Problems/ }).click();
  await expect(page.getByTestId("problems")).toContainText("permissive");
  await page.getByRole("button", { name: "Help" }).click();
  await page.getByRole("menuitem", { name: "About Vastitecture" }).click();
  await expect(page.getByTestId("trademarks")).toHaveText("ArchiMate® and TOGAF® are registered trademarks of The Open Group.");
});
