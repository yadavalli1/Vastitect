import { expect, test } from "@playwright/test";
import { newWorkspace, openView, state } from "./helpers";

const go = (page: import("@playwright/test").Page, section: string) => page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: section, exact: true }).click();

test("assistant chat answers from the model, proposes reviewable changes and drafts a decision record", async ({ page }) => {
  const prompts: string[] = [];
  await page.route("http://localhost:9912/v1/chat/completions", async (route) => {
    const body = route.request().postDataJSON();
    const last: string = body.messages[body.messages.length - 1].content;
    prompts.push(body.messages[1].content);
    const content = last.startsWith("Draft an Architecture Decision Record")
      ? { title: "Cache order lookups", body: "## Context\nOrder API reads are slow (assumption)." }
      : last.includes("cache")
        ? { answer: "Added **Order cache**.", changes: { elements: [{ name: "Order cache", type: "c4:Container", parent: "Online Shop" }], relationships: [{ source: "Order API", target: "Order cache", type: "c4:Uses", label: "Caches orders in" }] } }
        : { answer: "The **Order API** is part of Online Shop.", changes: null };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }) });
  });
  await page.goto("/");
  await newWorkspace(page, "m7-chat", "sample");
  await page.getByRole("button", { name: "✦ Chat" }).click();
  await expect(page.getByTestId("chat")).toContainText("The AI assistant is off.");

  await go(page, "Settings");
  await page.getByLabel("Enable the assistant").check();
  await page.getByLabel("OpenAI-compatible base URL").fill("http://localhost:9912/v1");
  await go(page, "Diagrams");
  await openView(page, "Online Shop – containers");
  const chat = page.getByTestId("chat");

  await chat.getByLabel("Message").fill("What is the Order API?");
  await chat.getByLabel("Message").press("Enter");
  await expect(chat.getByTestId("chat-assistant").last()).toContainText("The Order API is part of Online Shop.");
  expect(prompts[0]).toContain('looking at view "Online Shop – containers"');

  const before = Object.keys((await state(page)).elements).length;
  await chat.getByLabel("Message").fill("Add a cache in front of it");
  await chat.getByRole("button", { name: "Send" }).click();
  const review = page.getByTestId("review");
  await expect(review).toContainText("+ element: Order cache (c4:Container)");
  expect(Object.keys((await state(page)).elements)).toHaveLength(before);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  expect(Object.keys((await state(page)).elements)).toHaveLength(before + 1);

  await chat.getByLabel("Message").fill("cache order lookups");
  await chat.getByRole("button", { name: "Draft a decision record" }).click();
  await expect(review.getByTestId("review-adr")).toContainText("Cache order lookups");
  await expect(review.getByTestId("review-adr")).toContainText("Order API reads are slow (assumption)");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  expect(Object.values((await state(page)).adrs).map((a: any) => a.title)).toContain("Cache order lookups");
});
