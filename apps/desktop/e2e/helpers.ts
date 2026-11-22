import { expect, type Page } from "@playwright/test";

 
export const state = (page: Page) => page.evaluate(() => (window as any).__vastitecture.model.state);
export const appState = (page: Page) => page.evaluate(() => (window as any).__vastitecture.app.getState());

export const files = (page: Page, ws: string) =>
  page.evaluate((prefix) => {
    const out: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith(prefix)) out[k.slice(prefix.length)] = localStorage.getItem(k)!;
    }
    return out;
  }, `vastitecture/ws/${ws}/`);

export async function newWorkspace(page: Page, name: string, template: "blank" | "sample" = "blank") {
  await page.getByRole("button", { name: /^Workspace:/ }).click();
  const dialog = page.getByRole("dialog", { name: "Workspace" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Template").selectOption(template);
  await page.getByRole("button", { name: "Create in browser storage" }).click();
  await expect(dialog).toBeHidden();
}

export async function newView(page: Page, notation: string, name: string, viewpoint?: string) {
  await page.getByRole("button", { name: "New view" }).click();
  await page.getByLabel("Notation", { exact: true }).selectOption({ label: notation });
  if (viewpoint) await page.getByLabel("Viewpoint").selectOption({ label: viewpoint });
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Create view" }).click();
}

export const node = (page: Page, name: string) => page.locator(`.react-flow__node:has([aria-label$=": ${name}"])`);

export async function connectNodes(page: Page, from: string, to: string) {
  const a = node(page, from);
  const b = node(page, to);
  await a.hover();
  const handle = a.locator(".vnode-handle").nth(1);
  const hb = (await handle.boundingBox())!;
  const tb = (await b.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 8 });
  await page.mouse.up();
}

export async function pasteImport(page: Page, text: string) {
  await importMenu(page, "Paste text…");
  await page.getByLabel("Text to import").fill(text);
  await page.getByRole("dialog", { name: "Import from pasted text" }).getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByTestId("review")).toBeVisible();
}

export async function applyReview(page: Page) {
  const before = (await appState(page)).layoutDone ?? 0;
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByTestId("review")).toBeHidden();
  // imported views are laid out asynchronously in a worker
  await expect.poll(async () => (await appState(page)).layoutDone ?? 0).toBeGreaterThan(before);
}

export async function openView(page: Page, name: string) {
  await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: new RegExp("^" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).click();
}

export async function downloadText(page: Page, action: () => Promise<unknown>): Promise<{ name: string; text: string; bytes: Buffer }> {
  const [d] = await Promise.all([page.waitForEvent("download"), action()]);
  const bytes = Buffer.concat(await (await d.createReadStream()).toArray());
  return { name: d.suggestedFilename(), text: bytes.toString("utf8"), bytes };
}

/** Open a section from the navigation rail. */
export const go = (page: Page, section: string) => page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: section, exact: true }).click();

/** Choose an item from the title bar's Import menu (opening a file chooser for "Import files…"). */
export async function importMenu(page: Page, item: "Import files…" | "Paste text…") {
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

/** Choose an exporter from the title bar's Export menu. */
export async function exportMenu(page: Page, item: string) {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}
