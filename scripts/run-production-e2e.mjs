import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildEvidenceRunName,
  finalizeManifest,
  formatTimestampPair,
  hashImplementationSnapshot,
  implementationSnapshotsMatch,
  productionE2eEnvironment,
  reserveEvidenceDirectory,
  writeInitialManifest,
} from "./production-e2e-evidence.mjs";

const projectRoot = process.cwd();
const requestedRunId = process.env.E2E_RUN_ID;
if (!requestedRunId) throw new Error("Set a new E2E_RUN_ID before running production E2E.");

const head = capture("git", ["rev-parse", "--short=12", "HEAD"]).trim();
const status = capture("git", ["status", "--short"]);
const patch = capture("git", ["diff", "--binary", "HEAD"]);
const patchHash = sha256(`${status}\0${patch}`);
const initialImplementation = captureImplementationSnapshot();
const implementationPaths = initialImplementation.files;
const implementationHash = initialImplementation.hash;
const runId = buildEvidenceRunName(requestedRunId, head, implementationHash);
const evidenceRoot = reserveEvidenceDirectory({ projectRoot, runId });
const startedAt = formatTimestampPair();
const lockHash = sha256(readFileSync(path.join(projectRoot, "package-lock.json")));
const commands = [
  { command: "npm.cmd run build", status: "pending" },
  {
    command: "npx.cmd playwright test --config=playwright.production.config.ts",
    status: "pending",
  },
];

writeInitialManifest(evidenceRoot, {
  runId,
  requestedRunId,
  head,
  dirty: status.trim().length > 0,
  gitStatus: status.trim().split(/\r?\n/).filter(Boolean),
  patchHash,
  patchHashAlgorithm: "sha256(git status --short + NUL + git diff --binary HEAD)",
  implementationHash,
  initialImplementationHash: implementationHash,
  implementationHashAlgorithm:
    "sha256(sorted relative implementation path + NUL + file content + NUL)",
  implementationFiles: implementationPaths,
  lockHash,
  lockHashAlgorithm: "sha256(package-lock.json)",
  startedAtUtc: startedAt.utc,
  startedAtLocal: startedAt.local,
  environment: {
    node: process.version,
    npm: capture(command("npm"), ["--version"]).trim(),
    playwright: capture(command("npx"), ["playwright", "--version"]).trim(),
    platform: `${process.platform}-${process.arch}`,
    ci: process.env.CI ?? "",
    browserTargets: [
      "Microsoft Edge desktop (Desktop Chrome viewport)",
      "Microsoft Edge mobile emulation (Pixel 7)",
    ],
  },
  commands,
  providerMode:
    "deterministic mock enabled only by MVP_PRODUCTION_E2E_ALLOW_MOCK=1; real provider keys disabled",
  requestGuardMode:
    "reserved production E2E identity uses expanded in-memory quotas; ordinary production defaults remain unchanged",
  tracePolicy: { success: "not-retained", failure: "retained" },
  screenshotPolicy: {
    success: "named route/state/project screenshots",
    failure: "Playwright only-on-failure screenshot",
  },
});

const completedCommands = [];
let exitCode = 1;
const e2eEnvironment = productionE2eEnvironment(process.env);
try {
  const build = run(command("npm"), ["run", "build"], e2eEnvironment);
  completedCommands.push(build);
  if (build.exitCode === 0) {
    const test = run(command("npx"), [
      "playwright",
      "test",
      "--config=playwright.production.config.ts",
    ], {
      ...e2eEnvironment,
      E2E_EVIDENCE_DIR: evidenceRoot,
      E2E_EVIDENCE_RESERVED: "1",
    });
    completedCommands.push(test);
    exitCode = test.exitCode;
  } else {
    completedCommands.push({
      ...commands[1],
      status: "skipped",
      exitCode: null,
      startedAt: null,
      endedAt: null,
    });
    exitCode = build.exitCode;
  }
} finally {
  const finalImplementation = captureImplementationSnapshot();
  const implementationStable = implementationSnapshotsMatch(
    initialImplementation,
    finalImplementation,
  );
  if (!implementationStable) exitCode = 1;
  finalizeManifest(evidenceRoot, {
    endedAtUtc: formatTimestampPair().utc,
    endedAtLocal: formatTimestampPair().local,
    exitCode,
    commands: completedCommands,
    finalImplementationHash: finalImplementation.hash,
    finalImplementationFiles: finalImplementation.files,
    implementationStable,
  });
}
process.exitCode = exitCode;

function captureImplementationSnapshot() {
  const files = capture("git", [
    "ls-files",
    "--modified",
    "--others",
    "--exclude-standard",
    "--",
    "src",
    "tests",
    "scripts",
    "package.json",
    "package-lock.json",
    "playwright.config.ts",
    "playwright.production.config.ts",
    "vitest.config.ts",
    "eslint.config.mjs",
    "next.config.ts",
    "tsconfig.json",
  ]).trim().split(/\r?\n/).filter(Boolean).sort();
  const hash = hashImplementationSnapshot(
    files.map((filePath) => ({
      path: filePath,
      content: readFileSync(path.join(projectRoot, filePath)),
    })),
  );
  return { files, hash };
}

function run(executable, args, env = process.env) {
  const commandText = [executable, ...args].join(" ");
  const commandStartedAt = new Date().toISOString();
  const result = spawnSync(executable, args, {
    cwd: projectRoot,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const commandExitCode = result.status ?? 1;
  return {
    command: commandText,
    status: commandExitCode === 0 ? "passed" : "failed",
    exitCode: commandExitCode,
    startedAt: commandStartedAt,
    endedAt: new Date().toISOString(),
  };
}

function capture(executable, args) {
  const result = spawnSync(executable, args, {
    cwd: projectRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`${executable} ${args.join(" ")} failed.`);
  }
  return result.stdout;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function command(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}
