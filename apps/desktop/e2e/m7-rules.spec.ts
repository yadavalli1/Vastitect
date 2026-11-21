import { expect, test } from "@playwright/test";
import { files, newWorkspace } from "./helpers";

const go = (page: import("@playwright/test").Page, name: string) => page.getByRole("button", { name, exact: true }).first().click();

test("architecture rules: add starters, see violations, edit as YAML, and store them in vastitecture.yaml", async ({ page }) => {
  await page.goto("/");
  await newWorkspace(page, "m7-rules", "sample");
  await go(page, "Architecture rules");
  const p = page.getByTestId("rules-page");
  await p.getByRole("button", { name: "Add starter rules" }).click();
  await expect(p.getByTestId("rules-summary")).toContainText("5 rule(s)");
  await expect.poll(async () => (await files(page, "m7-rules"))["vastitecture.yaml"]).toContain("id: systems-have-owners");

  // Replace the rules with one that every container fails, and see it in the page and the Problems panel
  await p.getByRole("button", { name: "Edit as YAML" }).click();
  await p.getByLabel("Rules (YAML)").fill("- id: containers-tagged\n  description: Containers carry a team tag\n  severity: error\n  match: { type: c4:Container }\n  require: [\"tag:team\"]\n");
  await p.getByRole("button", { name: "Save rules" }).click();
  await expect(p.getByTestId("rules-summary")).toContainText("1 rule(s), 1 with violations");
  await p.getByTestId("rule-containers-tagged").getByRole("button", { name: /violation/ }).click();
  await expect(p.getByTestId("rule-containers-tagged")).toContainText('has no tag "team"');

  // A malformed list is refused with a message; nothing is saved
  await p.getByRole("button", { name: "Edit as YAML" }).click();
  await p.getByLabel("Rules (YAML)").fill("id: not-a-list");
  await p.getByRole("button", { name: "Save rules" }).click();
  await expect(p.getByRole("alert")).toContainText("Rules must be a YAML list");
  await p.getByRole("button", { name: "Cancel" }).click();

  // Following a violation opens the diagram with the element selected; the Problems panel lists the rule
  await p.getByTestId("rule-containers-tagged").getByRole("link").first().click();
  await expect(page.getByTestId("breadcrumbs")).toBeVisible();
  await page.getByRole("button", { name: /^Problems \(/ }).click();
  await expect(page.getByTestId("problems")).toContainText("Containers carry a team tag");
});
