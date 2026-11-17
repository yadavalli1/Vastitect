import { expect, test } from "@playwright/test";
import { newWorkspace, openView, state } from "./helpers";

const go = (page: import("@playwright/test").Page, section: string) => page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: section, exact: true }).click();

test("the assistant is off by default and makes no network calls", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => !r.url().startsWith("http://localhost:4173") && !r.url().startsWith("blob:") && !r.url().startsWith("data:") && external.push(r.url()));
  await page.goto("/");
  await newWorkspace(page, "m6-ai-off", "sample");
  await go(page, "Assistant");
  await expect(page.getByTestId("assistant-page")).toContainText("The AI assistant is off.");
  await expect(page.getByRole("button", { name: "Draft" })).toBeDisabled();
  // translation works without the assistant, through the mapping table
  await page.getByLabel("View", { exact: true }).selectOption({ label: "Online Shop – context (C4 model)" });
  await page.getByRole("button", { name: "Translate into an ArchiMate view" }).click();
  await expect(page.getByTestId("review")).toContainText("+ view: Online Shop – context (ArchiMate 4)");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator('.vnode[data-type="archimate:ApplicationComponent"]').first()).toBeVisible();
  expect(external).toEqual([]);
});

test("with an endpoint configured, drafts arrive as a reviewable diff and explanations as text", async ({ page }) => {
  const requests: any[] = [];
  await page.route("http://localhost:9911/v1/chat/completions", async (route) => {
    const body = route.request().postDataJSON();
    requests.push({ body, auth: route.request().headers()["authorization"] });
    const prompt: string = body.messages[1].content;
    const content = prompt.startsWith("Explain")
      ? "This view shows **the shop** and its neighbours."
      : JSON.stringify({ elements: [{ name: "Loyalty Service", type: "c4:SoftwareSystem", description: "Points for repeat customers" }], relationships: [{ source: "Online Shop", target: "Loyalty Service", type: "c4:Uses", label: "Awards points via" }] });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content } }] }) });
  });
  await page.goto("/");
  await newWorkspace(page, "m6-ai-on", "sample");
  await go(page, "Settings");
  await page.getByLabel("Enable the assistant").check();
  await page.getByLabel("OpenAI-compatible base URL").fill("http://localhost:9911/v1");
  await page.getByLabel("Model").fill("test-model");
  await page.getByLabel("API key").fill("sk-test");
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByLabel("API key")).toHaveAttribute("placeholder", "A key is stored");
  // the key is not written anywhere in browser storage
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain("sk-test");

  await go(page, "Assistant");
  await page.getByLabel("Description or document").fill("Add a loyalty programme that the shop calls when an order is paid.");
  await page.getByRole("button", { name: "Draft" }).click();
  const review = page.getByTestId("review");
  await expect(review).toContainText("+ element: Loyalty Service (c4:SoftwareSystem)");
  await expect(review).toContainText("+ relationship: Online Shop → Loyalty Service (Awards points via)");
  expect(Object.values((await state(page)).elements).some((e: any) => e.name === "Loyalty Service")).toBe(false);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  expect(Object.values((await state(page)).elements).some((e: any) => e.name === "Loyalty Service")).toBe(true);
  expect(requests[0].auth).toBe("Bearer sk-test");
  expect(requests[0].body.model).toBe("test-model");

  await go(page, "Assistant");
  await page.getByLabel("View", { exact: true }).selectOption({ label: "Context map (Domain-Driven Design)" });
  await page.getByRole("button", { name: "Explain this view" }).click();
  await expect(page.getByTestId("assistant-answer").locator("strong")).toHaveText("the shop");
});
