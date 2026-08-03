import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  productionE2eEnvironment,
  validationEvidenceRoot,
} from "./scripts/production-e2e-evidence.mjs";

const baseURL = "http://127.0.0.1:3100";
const evidenceRoot = process.env.E2E_EVIDENCE_DIR;
if (!evidenceRoot && process.env.E2E_CONFIG_VALIDATE_ONLY !== "1") {
  throw new Error(
    "Production E2E must be started with npm run test:e2e:production and a new E2E_RUN_ID.",
  );
}
if (
  process.env.E2E_CONFIG_VALIDATE_ONLY !== "1" &&
  (process.env.E2E_EVIDENCE_RESERVED !== "1" || !existsSync(evidenceRoot!))
) {
  throw new Error("The production E2E evidence directory was not reserved safely.");
}

const outputRoot = evidenceRoot ??
  validationEvidenceRoot();
process.env.PLAYWRIGHT_EVIDENCE_DIR = outputRoot;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  outputDir: path.join(outputRoot, "test-results"),
  reporter: [
    ["list"],
    ["html", { outputFolder: path.join(outputRoot, "report"), open: "never" }],
  ],
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
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "pixel-7",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: "npm.cmd run start -- --hostname 127.0.0.1 --port 3100",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: productionE2eEnvironment(process.env),
  },
});
