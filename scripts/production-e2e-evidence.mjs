import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";

export function reserveEvidenceDirectory({
  projectRoot,
  runId,
  baseDirectory = path.join("qa", "private-beta-production"),
}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,119}$/.test(runId)) {
    throw new Error("E2E_RUN_ID must be a safe, descriptive identifier.");
  }
  const baseRoot = path.resolve(projectRoot, baseDirectory);
  const evidenceRoot = path.resolve(baseRoot, runId);
  if (!evidenceRoot.startsWith(`${baseRoot}${path.sep}`)) {
    throw new Error("E2E_RUN_ID resolves outside the evidence root.");
  }
  mkdirSync(baseRoot, { recursive: true });
  if (existsSync(evidenceRoot)) {
    throw new Error(`Evidence directory already exists: ${evidenceRoot}`);
  }
  mkdirSync(evidenceRoot);
  return evidenceRoot;
}

export function buildEvidenceRunName(runId, head, patchHash) {
  return `${runId}--${head.slice(0, 12)}--${patchHash.slice(0, 12)}`;
}

export function formatTimestampPair(date = new Date()) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  const local = [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
    `.${String(date.getMilliseconds()).padStart(3, "0")}`,
    `${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`,
  ].join("");
  return { utc: date.toISOString(), local };
}

export function validationEvidenceRoot(processId = String(process.pid)) {
  return path.join(tmpdir(), `mvp-e2e-config-validation-${processId}`);
}

/**
 * @param {Record<string, string | undefined>} baseEnvironment
 * @returns {Record<string, string>}
 */
export function productionE2eEnvironment(baseEnvironment = process.env) {
  return {
    ...Object.fromEntries(
      Object.entries(baseEnvironment).filter((entry) => entry[1] !== undefined),
    ),
    DEEPSEEK_API_KEY: "",
    QWEN_API_KEY: "",
    MVP_PRODUCTION_E2E_ALLOW_MOCK: "1",
  };
}

export function hashImplementationSnapshot(entries) {
  const hash = createHash("sha256");
  for (const entry of [...entries].sort((left, right) =>
    left.path.localeCompare(right.path)
  )) {
    hash.update(entry.path.replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(entry.content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function implementationSnapshotsMatch(initial, final) {
  return (
    initial.hash === final.hash &&
    initial.files.length === final.files.length &&
    initial.files.every((file, index) => file === final.files[index])
  );
}

export function writeInitialManifest(evidenceRoot, manifest) {
  writeFileSync(
    path.join(evidenceRoot, "manifest.json"),
    `${JSON.stringify({ schemaVersion: 1, ...manifest }, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
}

export function finalizeManifest(evidenceRoot, finalState) {
  const manifestPath = path.join(evidenceRoot, "manifest.json");
  const current = JSON.parse(readFileSync(manifestPath, "utf8"));
  writeFileSync(
    manifestPath,
    `${JSON.stringify({ ...current, ...finalState }, null, 2)}\n`,
    "utf8",
  );
}

export function appendJsonLine(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function pad(value) {
  return String(value).padStart(2, "0");
}
