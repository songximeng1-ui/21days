import type { Page, TestInfo } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { appendJsonLine } from "../../scripts/production-e2e-evidence.mjs";

export type EvidenceCapture = {
  finish(): void;
};

type HttpResponseMetadata = {
  method: string;
  status: number;
  url: string;
};

export function installEvidenceCapture(
  page: Page,
  testInfo: TestInfo,
  evidenceRoot: string,
): EvidenceCapture {
  const testSlug = slug(`${testInfo.project.name}--${testInfo.title}`);
  const eventPath = path.join(evidenceRoot, "events", `${testSlug}.jsonl`);
  let eventCount = 0;
  const record = (event: Record<string, unknown>) => {
    eventCount += 1;
    appendJsonLine(eventPath, {
      at: new Date().toISOString(),
      project: testInfo.project.name,
      test: testInfo.title,
      ...event,
    });
  };
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") {
      record({
        kind: "console",
        level: message.type(),
        text: redactEvidenceValue(message.text()),
      });
    }
  });
  page.on("pageerror", (error) => {
    record({ kind: "pageerror", text: redactEvidenceValue(error.message) });
  });
  page.on("requestfailed", (request) => {
    record({
      kind: "requestfailed",
      method: request.method(),
      resourceType: request.resourceType(),
      url: redactUrl(request.url()),
      failure: redactEvidenceValue(request.failure()?.errorText ?? "unknown"),
    });
  });
  page.on("response", (response) => {
    const event = buildHttpEvidenceEvent({
      method: response.request().method(),
      status: response.status(),
      url: response.url(),
    });
    if (event) record(event);
  });
  return {
    finish() {
      const summaryRoot = path.join(evidenceRoot, "events");
      mkdirSync(summaryRoot, { recursive: true });
      writeFileSync(
        path.join(summaryRoot, `${testSlug}.summary.json`),
        `${JSON.stringify({
          project: testInfo.project.name,
          test: testInfo.title,
          status: testInfo.status,
          eventCount,
        }, null, 2)}\n`,
        "utf8",
      );
    },
  };
}

export function buildHttpEvidenceEvent(
  response: HttpResponseMetadata,
): Record<string, unknown> | null {
  let pathname = response.url.split(/[?#]/, 1)[0];
  try {
    pathname = new URL(response.url).pathname;
  } catch {
    // Relative or malformed URLs are still safe to classify by their path text.
  }
  const isSuccessfulAiPost =
    response.method.toUpperCase() === "POST" &&
    response.status >= 200 &&
    response.status < 300 &&
    pathname === "/api/ai";
  if (response.status < 400 && !isSuccessfulAiPost) return null;

  return {
    kind: "http",
    method: response.method,
    status: response.status,
    url: redactUrl(response.url),
  };
}

export function evidenceScreenshotPath(
  evidenceRoot: string,
  project: string,
  route: string,
  state: string,
): string {
  const screenshotRoot = path.join(evidenceRoot, "screenshots");
  mkdirSync(screenshotRoot, { recursive: true });
  return path.join(
    screenshotRoot,
    `${slug(project)}--${slug(route)}--${slug(state)}.png`,
  );
}

export function redactEvidenceValue(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/(?<!\d)1[3-9](?:[\s-]?\d){9}(?!\d)/g, "[REDACTED_PHONE]")
    .replace(
      /(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,;]+/gi,
      "$1[REDACTED_TOKEN]",
    )
    .replace(/((?:api[_-]?key|token|secret)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]");
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return redactEvidenceValue(value.split("?")[0]);
  }
}

function slug(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
}
