import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";

const baseURL = "http://127.0.0.1:3100";
const generatedRunId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
const evidenceRoot = process.env.PLAYWRIGHT_EVIDENCE_DIR ??
  path.join("qa/private-beta-readiness-e2e", generatedRunId);
if (
  process.env.PLAYWRIGHT_EVIDENCE_DIR_VALIDATED !== "1" &&
  existsSync(evidenceRoot)
) {
  throw new Error(
    `Playwright evidence directory already exists: ${evidenceRoot}. Use a new run id.`,
  );
}
process.env.PLAYWRIGHT_EVIDENCE_DIR = evidenceRoot;
process.env.PLAYWRIGHT_EVIDENCE_DIR_VALIDATED = "1";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  outputDir: path.join(evidenceRoot, "test-results"),
  reporter: [["list"], ["html", { outputFolder: path.join(evidenceRoot, "report"), open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    launchOptions: {
      executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    },
  },
  projects: [
    {
      name: "desktop-edge",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "mobile-edge",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: "npm.cmd run dev -- --hostname 127.0.0.1 --port 3100",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DEEPSEEK_API_KEY: "",
      QWEN_API_KEY: "",
    },
  },
});
