import { expect, test } from "@playwright/test";
import { applyReview, downloadText, newWorkspace, openView, pasteImport, state } from "./helpers";

const exportAs = (page: import("@playwright/test").Page, label: string) => downloadText(page, () => page.getByLabel("Export", { exact: true }).selectOption({ label }));

test("paste a Mermaid C4 block to create a view, then export it as Mermaid, PlantUML, draw.io and PDF", async ({ page }) => {
  await page.goto("/");
  await newWorkspace(page, "m5-mermaid");
  await pasteImport(page, "```mermaid\nC4Context\n  title Shop context\n  Person(c, \"Customer\")\n  System(s, \"Shop\", \"Sells things\")\n  System_Ext(p, \"Payments\")\n  Rel(c, s, \"Buys from\")\n  Rel(s, p, \"Charges\", \"HTTPS\")\n```");
  await expect(page.getByTestId("review")).toContainText("Mermaid C4: 3 elements, 2 relationships");
  await applyReview(page);
  await openView(page, "Shop context");
  await expect(page.locator(".react-flow__node")).toHaveCount(3);

  const mmd = await exportAs(page, "Mermaid C4 (this view)");
  expect(mmd.text).toContain("C4Context");
  expect(mmd.text).toContain('System_Ext(payments, "Payments")');
  const puml = await exportAs(page, "C4-PlantUML (this view)");
  expect(puml.text).toMatch(/^@startuml/);
  expect(puml.text).toContain('Rel(shop, payments, "Charges", "HTTPS")');
  const drawio = await exportAs(page, "draw.io (this view)");
  expect(drawio.text).toContain("<mxfile");
  const pdf = await exportAs(page, "PDF (this view)");
  expect(pdf.bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.bytes.length).toBeGreaterThan(1500);
  expect(pdf.bytes.toString("latin1")).toMatch(/BaseFont \/Helvetica/); // vector: real text, not an image
});

test("bulk-edit the inventory through CSV", async ({ page }) => {
  await page.goto("/");
  await newWorkspace(page, "m5-csv", "sample");
  const csv = await exportAs(page, "Inventory CSV");
  const lines = csv.text.trim().split("\n");
  expect(lines[0].startsWith("id,name,type,description,parent,owner,lifecycle,tags")).toBe(true);
  const edited = [lines[0], ...lines.slice(1).map((l) => (l.includes(",Warehouse System,") ? l.replace(",Team Fulfilment,", ",Team Logistics,") : l))].join("\n") + "\n";
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Import", exact: true }).click()]);
  await chooser.setFiles({ name: "inventory.csv", mimeType: "text/csv", buffer: Buffer.from(edited) });
  const review = page.getByTestId("review");
  await expect(review).toContainText("~1 changed");
  await expect(review).toContainText("owner: Team Fulfilment → Team Logistics");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  expect((Object.values((await state(page)).elements).find((e: any) => e.name === "Warehouse System") as any).owner).toBe("Team Logistics");
});

test("export the workspace as a static HTML site and as Markdown docs", async ({ page }) => {
  await page.goto("/");
  await newWorkspace(page, "m5-site", "sample");
  const zipNames = (bytes: Buffer) => {
    const names: string[] = [];
    for (let i = 0; i < bytes.length - 4; i++) if (bytes.readUInt32LE(i) === 0x02014b50) names.push(bytes.subarray(i + 46, i + 46 + bytes.readUInt16LE(i + 28)).toString());
    return names;
  };
  const site = await exportAs(page, "Static HTML site");
  expect(site.name).toMatch(/\.zip$/);
  const names = zipNames(site.bytes);
  expect(names).toEqual(expect.arrayContaining(["index.html", "elements.html", "decisions.html", "views/context-map.html", "views/context-map.svg"]));
  expect(site.bytes.toString("utf8")).toContain("<h2>0001 Use an event bus between ordering and fulfilment</h2>");
  const md = await exportAs(page, "Markdown documentation");
  expect(zipNames(md.bytes)).toEqual(expect.arrayContaining(["README.md", "views/context-map.svg", "decisions/0001-use-an-event-bus-between-ordering-and-fulfilment.md"]));
  const pdf = await exportAs(page, "PDF (all views)");
  expect((pdf.bytes.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(5);
});
