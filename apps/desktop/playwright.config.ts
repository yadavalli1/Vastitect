import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const chromium = "/opt/pw-browsers/chromium";
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4173",
    viewport: { width: 1440, height: 900 },
    launchOptions: existsSync(chromium) && !process.env.CI ? { executablePath: chromium } : {},
  },
  webServer: { command: "pnpm build && pnpm preview", url: "http://localhost:4173", reuseExistingServer: true, timeout: 180_000 },
});
