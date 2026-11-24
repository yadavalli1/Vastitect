import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { newWorkspace, openView, go } from "./helpers";

test.use({ bypassCSP: true }); // the app's CSP (rightly) refuses injected scripts; this lets the checker in for the test only

const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

async function scan(page: Page, where: string) {
  await page.addScriptTag({ content: axeSource });
  const result = await page.evaluate(async () =>
    (window as any).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] }, resultTypes: ["violations"] }),
  );
  return (result.violations as any[]).map((v) => ({
    where,
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.slice(0, 4).map((n: any) => `${n.target.join(" ")} :: ${(n.failureSummary ?? "").split("\n").slice(1, 2).join("").trim()}`),
    count: v.nodes.length,
  }));
}

for (const theme of ["light", "dark"] as const) {
  test(`WCAG 2.1 AA checks on the main screens (${theme} theme)`, async ({ page }) => {
    await page.goto("/");
    await newWorkspace(page, `a11y-${theme}`, "sample");
    if (theme === "dark") await page.getByRole("button", { name: "Toggle theme" }).click();
    const found = [];
    await openView(page, "Online Shop – containers");
    found.push(...(await scan(page, "diagram")));
    for (const section of ["Fact sheets", "Capability map", "Lifecycle roadmap", "Architecture rules", "Insights", "Discover", "Assistant", "Settings"]) {
      await go(page, section);
      found.push(...(await scan(page, section)));
    }
    if (found.length) console.log(JSON.stringify(found, null, 1));
    expect(found.map((f) => `${f.where}: ${f.id} (${f.count})`)).toEqual([]);
  });
}
