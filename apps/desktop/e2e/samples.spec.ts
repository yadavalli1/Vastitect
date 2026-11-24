import { expect, test } from "@playwright/test";
import { newWorkspace, node, openView, state } from "./helpers";

const SAMPLES: [id: string, label: string, view: string, element: string][] = [
  ["banking", "Banking: Northbridge Bank", "Bank landscape", "Core Banking (mainframe)"],
  ["insurance", "Insurance: Harbour Mutual", "Claims Platform – containers", "FNOL Service"],
  ["healthcare", "Healthcare: Riverside Health", "Hospital landscape", "Electronic Health Record"],
  ["manufacturing", "Manufacturing: Atlas Pumps", "MES – containers", "OPC UA Gateway"],
  ["telecom", "Telecommunications: Meridian Telecom", "BSS / OSS landscape", "Convergent Charging"],
];

test("every industry sample is offered when creating a workspace, with a description", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Workspace:/ }).click();
  const template = page.getByRole("dialog", { name: "Workspace" }).getByLabel("Template");
  for (const [id, label] of SAMPLES) await expect(template.locator(`option[value="${id}"]`)).toHaveText(label);
  await template.selectOption("healthcare");
  await expect(page.getByTestId("sample-description")).toContainText("HL7 v2 to FHIR");
});

for (const [id, , view, element] of SAMPLES)
  test(`the ${id} sample opens with its views in every notation`, async ({ page }) => {
    await page.goto("/");
    await newWorkspace(page, `sample-${id}`, id);
    const ws = await state(page);
    expect(new Set(Object.values(ws.views).map((v: any) => v.notation))).toEqual(new Set(["c4", "archimate", "ddd", "togaf"]));
    await openView(page, view);
    await expect(node(page, element)).toBeVisible();
  });
