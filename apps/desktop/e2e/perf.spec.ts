import { expect, test } from "@playwright/test";
import { makeView, toFiles } from "../../../packages/core/src/index";
import { bigWorkspace } from "../../../packages/core/src/generate";

test.setTimeout(180_000);

test("performance budget: open 5,000 elements / 200 views, lay out and pan a 300-node view", async ({ page }) => {
  const ws = bigWorkspace(5000, 200);
  // one extra 300-node view
  const ids = Object.keys(ws.elements).slice(0, 300);
  const present = new Set(ids);
  const big = makeView("c4", "Big view", {
    nodes: ids.map((element, i) => ({ element, x: (i % 20) * 210, y: Math.floor(i / 20) * 130, w: 180, h: 90 })),
    edges: Object.values(ws.relationships).filter((r) => present.has(r.source) && present.has(r.target)).map((r) => ({ relationship: r.id })),
  });
  // keep the view flat: no nesting, so every node is drawn
  for (const id of ids) delete ws.elements[id].parent;
  ws.views[big.id] = big;
  const { files } = toFiles(ws);

  await page.goto("/");
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await page.evaluate((files) => {
    for (const [p, c] of Object.entries(files)) localStorage.setItem(`vastitecture/ws/perf/${p}`, c);
    localStorage.setItem("vastitecture/last", "perf");
  }, files);
  await page.reload();
  await expect(page.getByRole("button", { name: /Vastitecture · Big/ })).toBeVisible({ timeout: 30_000 });
  const open = await page.evaluate(() => performance.getEntriesByName("vastitecture:open").at(-1)!.duration);

  await page.evaluate((id) => (window as any).__vastitecture.app.setState({ activeView: id, page: "diagram" }), big.id);
  await expect(page.locator(".react-flow__node")).toHaveCount(300, { timeout: 30_000 });
  await page.getByLabel("Auto-layout").selectOption({ label: "Layered" });
  await expect.poll(() => page.evaluate(() => performance.getEntriesByName("vastitecture:layout").length), { timeout: 30_000 }).toBeGreaterThan(0);
  const layout = await page.evaluate(() => performance.getEntriesByName("vastitecture:layout").at(-1)!.duration);

  // pan for one second and record frame times
  const box = (await page.getByTestId("canvas").boundingBox())!;
  await page.evaluate(() => {
    const w = window as any;
    w.__frames = [];
    let last = performance.now();
    const tick = (t: number) => {
      w.__frames.push(t - last);
      last = t;
      if (w.__frames.length < 600) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 0; i < 60; i++) await page.mouse.move(box.x + box.width / 2 - i * 8, box.y + box.height / 2 - i * 3);
  await page.mouse.up();
  const frames: number[] = await page.evaluate(() => (window as any).__frames.slice(2));
  const sorted = [...frames].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const fps = 1000 / median;
  console.log(`open: ${open.toFixed(0)} ms · layout of 300 nodes: ${layout.toFixed(0)} ms · pan: median frame ${median.toFixed(1)} ms (~${fps.toFixed(0)} fps), p95 ${sorted[Math.floor(sorted.length * 0.95)].toFixed(1)} ms`);
  expect(open).toBeLessThan(2000);
  expect(layout).toBeLessThan(1000);
});
