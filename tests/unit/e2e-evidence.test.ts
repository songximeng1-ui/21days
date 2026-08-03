import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  appendJsonLine,
  buildEvidenceRunName,
  finalizeManifest,
  formatTimestampPair,
  hashImplementationSnapshot,
  implementationSnapshotsMatch,
  productionE2eEnvironment,
  reserveEvidenceDirectory,
  validationEvidenceRoot,
  writeInitialManifest,
} from "../../scripts/production-e2e-evidence.mjs";
import {
  buildHttpEvidenceEvent,
  evidenceScreenshotPath,
  redactEvidenceValue,
} from "../e2e/evidence";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("production E2E evidence", () => {
  it("uses one explicit mock-only environment for production build and next start", () => {
    expect(productionE2eEnvironment({
      PATH: "tool-path",
      DEEPSEEK_API_KEY: "must-not-reach-e2e",
      QWEN_API_KEY: "must-not-reach-e2e",
    })).toMatchObject({
      PATH: "tool-path",
      DEEPSEEK_API_KEY: "",
      QWEN_API_KEY: "",
      MVP_PRODUCTION_E2E_ALLOW_MOCK: "1",
    });
  });

  it("binds every directory name to the requested run, HEAD and dirty patch hash", () => {
    expect(buildEvidenceRunName(
      "20260731-prod-193500",
      "a8283fa12345",
      "deadbeef987654321",
    )).toBe("20260731-prod-193500--a8283fa12345--deadbeef9876");
  });

  it("records both UTC and offset-qualified local timestamps", () => {
    const timestamp = formatTimestampPair(new Date("2026-07-31T10:00:00.000Z"));

    expect(timestamp.utc).toBe("2026-07-31T10:00:00.000Z");
    expect(timestamp.local).toMatch(
      /^2026-07-31T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/,
    );
  });

  it("keeps config-only Playwright output outside the production evidence tree", () => {
    const outputRoot = validationEvidenceRoot("4242");

    expect(outputRoot).toContain("mvp-e2e-config-validation-4242");
    expect(outputRoot).not.toContain(path.join("qa", "private-beta-production"));
  });

  it("reserves a unique run directory and refuses to overwrite it", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "mvp-e2e-"));
    temporaryRoots.push(projectRoot);

    const evidenceRoot = reserveEvidenceDirectory({
      projectRoot,
      runId: "20260731-prod-a8283fa-deadbeef",
    });

    expect(evidenceRoot).toBe(path.join(
      projectRoot,
      "qa",
      "private-beta-production",
      "20260731-prod-a8283fa-deadbeef",
    ));
    expect(() => reserveEvidenceDirectory({
      projectRoot,
      runId: "20260731-prod-a8283fa-deadbeef",
    })).toThrow(/already exists/i);
  });

  it("records immutable source identity, environment, commands and final exit codes", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "mvp-e2e-"));
    temporaryRoots.push(projectRoot);
    const evidenceRoot = reserveEvidenceDirectory({
      projectRoot,
      runId: "20260731-prod-a8283fa-deadbeef",
    });
    writeInitialManifest(evidenceRoot, {
      runId: "20260731-prod-a8283fa-deadbeef",
      head: "a8283fa",
      patchHash: "deadbeef",
      lockHash: "lock123",
      startedAt: "2026-07-31T10:00:00.000Z",
      environment: { node: "v24.18.0", npm: "11.6.2", platform: "win32" },
      commands: [
        { command: "npm.cmd run build", status: "pending" },
        {
          command: "npx.cmd playwright test --config=playwright.production.config.ts",
          status: "pending",
        },
      ],
      tracePolicy: { success: "not-retained", failure: "retained" },
    });
    finalizeManifest(evidenceRoot, {
      endedAt: "2026-07-31T10:04:00.000Z",
      exitCode: 1,
      commands: [
        { command: "npm.cmd run build", status: "passed", exitCode: 0 },
        {
          command: "npx.cmd playwright test --config=playwright.production.config.ts",
          status: "failed",
          exitCode: 1,
        },
      ],
    });

    const manifest = JSON.parse(readFileSync(
      path.join(evidenceRoot, "manifest.json"),
      "utf8",
    ));
    expect(manifest).toMatchObject({
      head: "a8283fa",
      patchHash: "deadbeef",
      lockHash: "lock123",
      startedAt: "2026-07-31T10:00:00.000Z",
      endedAt: "2026-07-31T10:04:00.000Z",
      exitCode: 1,
      tracePolicy: { success: "not-retained", failure: "retained" },
    });
    expect(manifest.commands.map((item: { exitCode: number }) => item.exitCode))
      .toEqual([0, 1]);
  });

  it("redacts sensitive console values and creates collision-free screenshot names", () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "mvp-e2e-"));
    temporaryRoots.push(projectRoot);
    const evidenceRoot = reserveEvidenceDirectory({
      projectRoot,
      runId: "20260731-prod-a8283fa-deadbeef",
    });
    appendJsonLine(path.join(evidenceRoot, "events.jsonl"), {
      kind: "console",
      text: redactEvidenceValue(
        "email student@example.com phone 13800138000 Authorization: Bearer secret-token",
      ),
    });
    const eventText = readFileSync(path.join(evidenceRoot, "events.jsonl"), "utf8");

    expect(eventText).not.toMatch(/student@example\.com|13800138000|secret-token/);
    expect(evidenceScreenshotPath(
      evidenceRoot,
      "mobile-edge",
      "direction_to_jobs",
      "complete-action",
    )).toBe(path.join(
      evidenceRoot,
      "screenshots",
      "mobile-edge--direction_to_jobs--complete-action.png",
    ));
  });

  it("records a successful POST /api/ai response as redacted metadata only", () => {
    expect(buildHttpEvidenceEvent({
      method: "POST",
      status: 200,
      url: "http://127.0.0.1:3100/api/ai?token=secret#response",
    })).toEqual({
      kind: "http",
      method: "POST",
      status: 200,
      url: "http://127.0.0.1:3100/api/ai",
    });
  });

  it("fingerprints untracked implementation content, not just Git status names", () => {
    const first = hashImplementationSnapshot([
      { path: "src/new-file.ts", content: Buffer.from("first") },
      { path: "tests/new-file.test.ts", content: Buffer.from("test") },
    ]);
    const reordered = hashImplementationSnapshot([
      { path: "tests/new-file.test.ts", content: Buffer.from("test") },
      { path: "src/new-file.ts", content: Buffer.from("first") },
    ]);
    const changed = hashImplementationSnapshot([
      { path: "src/new-file.ts", content: Buffer.from("second") },
      { path: "tests/new-file.test.ts", content: Buffer.from("test") },
    ]);

    expect(first).toBe(reordered);
    expect(changed).not.toBe(first);
  });

  it("rejects evidence when the implementation snapshot changes during the run", () => {
    expect(implementationSnapshotsMatch(
      { hash: "same", files: ["src/a.ts", "tests/a.test.ts"] },
      { hash: "same", files: ["src/a.ts", "tests/a.test.ts"] },
    )).toBe(true);
    expect(implementationSnapshotsMatch(
      { hash: "before", files: ["src/a.ts"] },
      { hash: "after", files: ["src/a.ts"] },
    )).toBe(false);
    expect(implementationSnapshotsMatch(
      { hash: "same", files: ["src/a.ts"] },
      { hash: "same", files: ["src/a.ts", "src/new.ts"] },
    )).toBe(false);
  });
});
