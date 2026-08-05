import { MockAiProvider } from "@/ai/mock-provider";
import { createAiProviderFromEnv } from "@/ai/chat-completion-provider";
import type { AiProvider } from "@/ai/provider";
import {
  AiRequestGuard,
  AiRequestGuardError,
  type AiSession,
} from "@/ai/request-guard";
import {
  createSafeAiFailureReporter,
  noopAiFailureReporter,
  type AiFailureReporter,
} from "@/ai/failure-diagnostics";
import {
  AiProcessingError,
  toAiProcessingFailure,
  type AiProcessingFailure,
} from "@/ai/processing-failure";
import {
  AiUpstreamUnavailableError,
  generateLightReviewOutput,
  generateRouteOutput,
} from "@/ai/orchestrator";
import type { RouteKey } from "@/domain/types";
import { ROUTE_KEYS } from "@/domain/types";
import type { LocalRecord } from "@/lib/local-store";
import { attachOutputProvenance } from "@/domain/provenance";
import { REQUEST_METADATA_HEADERS } from "@/domain/route-contracts";
import { routeOutputWithProvenanceSchema } from "@/schemas/route-output";
import {
  routeRequestSchema,
  type ParsedRouteRequest,
  type RequestMetadata,
} from "@/schemas/route-request";
import { containsSensitivePersonalInfo } from "@/domain/safety";
import { NextResponse } from "next/server";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const localRecordSchema = z.object({
  id: z.string().max(120),
  actionId: z.string().max(120).optional(),
  routeKey: z.enum(ROUTE_KEYS),
  recordType: z.string().max(80),
  actionTitle: z.string().max(500),
  actualDone: z.string().max(12_000),
  payload: z.record(z.string().max(80), z.string().max(12_000)).default({}),
  userConfirmed: z.literal(true),
  status: z.literal("confirmed"),
  version: z.number().int().positive(),
  createdAt: z.string().max(80),
  updatedAt: z.string().max(80).optional(),
  completedAt: z.string().max(80).optional(),
  confirmedAt: z.string().max(80).optional(),
  supersedesRecordId: z.string().max(120).optional(),
  sourceState: z.enum(["current", "stale", "deleted_source"]).optional(),
}).strict();

const RECORD_PAYLOAD_FIELDS: Record<RouteKey, Record<string, readonly string[]>> = {
  direction_to_jobs: {
    job_sample: [
      "jobTitle",
      "companyOrPlatform",
      "jdSummary",
      "interestPoint",
      "concernPoint",
    ],
  },
  experience_to_resume: {
    experience_fact: [
      "actualActions",
      "deliverable",
      "confirmedFacts",
      "supportingFacts",
      "missingFacts",
    ],
    resume_snippet: [
      "resumeSnippet",
      "supportingFacts",
      "stillMissing",
    ],
  },
  jd_to_revision: {
    jd_compare: [
      "targetJobTitle",
      "beforeSnippet",
      "afterSnippet",
      "jdRequirement",
      "submitted",
      "evidenceLocation",
      "evidenceResult",
      "materialVersion",
      "observationPoint",
    ],
  },
  applications_to_review: {
    application: [
      "jobTitle",
      "companyOrPlatform",
      "submittedAt",
      "feedbackStatus",
      "jdSummary",
      "materialVersion",
      "userSuspicion",
    ],
  },
};

type AiRouteHandlerDependencies = {
  guard?: AiRequestGuard;
  providerFactory?: (body: ParsedRouteRequest) => AiProvider;
  reporter?: AiFailureReporter;
  deadlineMs?: number;
};

const defaultGuard = new AiRequestGuard(
  productionE2eGuardOptions(process.env),
);

export function createAiRouteHandler(dependencies: AiRouteHandlerDependencies = {}) {
  const guard = dependencies.guard ?? defaultGuard;
  const providerFactory = dependencies.providerFactory ?? defaultProviderFactory;
  const reporter = dependencies.reporter ?? defaultFailureReporter();
  const deadlineMs = dependencies.deadlineMs ?? 28_000;
  const reusableProviders = new Map<string, AiProvider>();
  return async function handleAiRequest(request: Request): Promise<Response> {
    const deadlineAtMs = Date.now() + deadlineMs;
    const deadlineController = new AbortController();
    const deadlineTimer = setTimeout(
      () => deadlineController.abort(new Error("whole_request_deadline")),
      deadlineMs,
    );
    const operationSignal = AbortSignal.any([request.signal, deadlineController.signal]);
    let routeKey: RouteKey = "experience_to_resume";
    const requestId = createRequestId();
    let requestMetadata: RequestMetadata | undefined;
    let session = guard.readSession(request);
    let release: (() => void) | undefined;

    try {
      guard.assertTrustedJsonRequest(request);
      const body = routeRequestSchema.parse(await guard.readJson(request, operationSignal));
      requestMetadata = body.requestMetadata;
      routeKey = body.routeKey;
      if (containsSensitivePersonalInfo(body.input)) {
        return withSessionCookie(
          withRequestId(NextResponse.json(makeSensitiveInfoFailure(requestId), {
            status: 422,
          }), requestId, requestMetadata),
          session,
        );
      }
      release = guard.acquire(session.sessionId);
      session = guard.establishSession(session);
      const lightReviewRecords =
        body.mode === "light_review"
          ? ("records" in body.input
              ? body.input.records.map((record) =>
                  projectLocalRecord(localRecordSchema.parse(record), body.routeKey)
                )
              : [projectLocalRecord(localRecordSchema.parse(body.input.record), body.routeKey)])
          : [];
      if (lightReviewRecords.some((record) => record.routeKey !== body.routeKey)) {
        throw new AiRequestGuardError(400);
      }
      const provider = reuseProvider(providerFactory(body), reusableProviders);
      const providerReviewRecords = lightReviewRecords.map(projectProviderRecord);
      const output =
        body.mode === "light_review"
          ? await generateLightReviewOutput({
              ...(body.routeKey === "applications_to_review"
                ? {
                    records: providerReviewRecords,
                    provenanceRecords: lightReviewRecords,
                  }
                : {
                    record: providerReviewRecords[0],
                    provenanceRecord: lightReviewRecords[0],
                  }),
              provider,
              reporter,
              requestId,
              signal: operationSignal,
              deadlineMs: Math.max(1, deadlineAtMs - Date.now()),
              failureMode: "throw",
              surfaceUpstreamUnavailable: true,
            })
          : await generateRouteOutput({
              routeKey,
              input: body.input,
              provider,
              reporter,
              requestId,
              signal: operationSignal,
              deadlineMs: Math.max(1, deadlineAtMs - Date.now()),
              failureMode: "throw",
              surfaceUpstreamUnavailable: true,
            });
      if (request.signal.aborted) {
        return withSessionCookie(withRequestId(new Response(null, { status: 499 }), requestId, requestMetadata), session);
      }
      const verifiedProvenance = attachOutputProvenance(
        output,
        body.mode === "light_review"
          ? (body.routeKey === "applications_to_review"
              ? { records: lightReviewRecords }
              : lightReviewRecords[0] as unknown as Record<string, unknown>)
          : body.input,
        body.mode === "light_review" ? "confirmed_record" : "user_input",
      );
      const validatedOutput = routeOutputWithProvenanceSchema.safeParse(
        verifiedProvenance.ok ? verifiedProvenance.output : null,
      );
      if (
        !validatedOutput.success ||
        validatedOutput.data.routeKey !== routeKey ||
        (body.mode === "light_review" &&
          validatedOutput.data.outputType !== "light_review")
      ) {
        throw new AiProcessingError("invalid_output", requestId);
      }
      return withSessionCookie(
        withRequestId(NextResponse.json(validatedOutput.data), requestId, requestMetadata),
        session,
      );
    } catch (error) {
      if (request.signal.aborted) {
        return withSessionCookie(withRequestId(new Response(null, { status: 499 }), requestId, requestMetadata), session);
      }
      if (deadlineController.signal.aborted) {
        const deadlineError = new AiProcessingError("deadline", requestId);
        return withSessionCookie(
          withRequestId(NextResponse.json(toAiProcessingFailure(deadlineError), { status: 504 }), requestId, requestMetadata),
          session,
        );
      }
      if (error instanceof AiProcessingError) {
        return withSessionCookie(
          withRequestId(
            NextResponse.json(toAiProcessingFailure(error), {
              status: processingFailureStatus(error),
              headers: error.retryAfterMs
                ? { "Retry-After": String(Math.max(1, Math.ceil(error.retryAfterMs / 1_000))) }
                : undefined,
            }),
            requestId,
            requestMetadata,
          ),
          session,
        );
      }
      if (error instanceof AiUpstreamUnavailableError) {
        const retryAfterSeconds = Math.max(
          1,
          Math.min(30, Math.ceil(error.retryAfterMs / 1_000)),
        );
        return withSessionCookie(
          withRequestId(NextResponse.json({
            error: "ai_processing_failure",
            category: "rate_limit",
            message: "这次暂时没整理出来。你填写的内容还保留在本页，可以再整理一次。",
            requestId,
            retryable: true,
          } satisfies AiProcessingFailure, {
            status: 503,
            headers: { "Retry-After": String(retryAfterSeconds) },
          }), requestId, requestMetadata),
          session,
        );
      }
      if (error instanceof AiRequestGuardError) {
        return withSessionCookie(
          withRequestId(NextResponse.json(
            makeRequestFailure(requestId),
            {
              status: error.status,
              headers: error.retryAfterSeconds
                ? { "Retry-After": String(Math.min(error.retryAfterSeconds, 86_400)) }
                : undefined,
            }), requestId, requestMetadata),
          session,
        );
      }
      if (error instanceof z.ZodError || error instanceof SyntaxError) {
        return withSessionCookie(
          withRequestId(NextResponse.json(makeRequestFailure(requestId), { status: 400 }), requestId, requestMetadata),
          session,
        );
      }
      return withSessionCookie(
        withRequestId(NextResponse.json({
          error: "ai_processing_failure",
          category: "invalid_output",
          message: "这次暂时没整理出来。你填写的内容还保留在本页，可以再整理一次。",
          requestId,
          retryable: true,
        } satisfies AiProcessingFailure, { status: 500 }), requestId, requestMetadata),
        session,
      );
    } finally {
      clearTimeout(deadlineTimer);
      release?.();
    }
  };
}

function makeSensitiveInfoFailure(requestId: string): AiProcessingFailure {
  return {
    error: "ai_processing_failure",
    category: "sensitive_input",
    message: "请先删除手机号、证件号、邮箱或婚育健康等敏感个人信息，再重新提交。",
    requestId,
    retryable: true,
  };
}

function makeRequestFailure(requestId: string) {
  return {
    error: "invalid_request",
    message: "这次提交没有识别出来，请检查填写内容后再试。",
    requestId,
  } as const;
}

function processingFailureStatus(error: AiProcessingError): number {
  if (error.category === "cancelled") return 499;
  if (error.category === "timeout" || error.category === "deadline") return 504;
  if (
    error.category === "transport" ||
    error.category === "rate_limit" ||
    error.category === "circuit_open"
  ) {
    return 503;
  }
  if (error.category === "sensitive_input") return 422;
  return 502;
}

function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? "untracked-request";
}

function withRequestId(
  response: Response,
  requestId: string,
  requestMetadata?: RequestMetadata,
): Response {
  response.headers.set("X-Request-Id", requestId);
  if (requestMetadata) {
    response.headers.set(
      REQUEST_METADATA_HEADERS.clientRequestId,
      requestMetadata.clientRequestId,
    );
    response.headers.set(
      REQUEST_METADATA_HEADERS.draftRevision,
      String(requestMetadata.draftRevision),
    );
    response.headers.set(
      REQUEST_METADATA_HEADERS.idempotencyKey,
      requestMetadata.idempotencyKey,
    );
  }
  return response;
}

function defaultFailureReporter(): AiFailureReporter {
  if (process.env.NODE_ENV !== "production") return noopAiFailureReporter;
  return createSafeAiFailureReporter((event) => {
    console.warn("[ai-processing-failure]", event);
  });
}

function projectLocalRecord(
  record: z.infer<typeof localRecordSchema>,
  routeKey: RouteKey,
): LocalRecord {
  const allowedFields = RECORD_PAYLOAD_FIELDS[routeKey][record.recordType];
  if (
    !allowedFields ||
    record.routeKey !== routeKey ||
    (record.recordType === "resume_snippet" &&
      record.sourceState !== undefined &&
      record.sourceState !== "current")
  ) {
    throw new AiRequestGuardError(400);
  }
  const payload = Object.fromEntries(
    allowedFields.flatMap((field) =>
      record.payload[field] === undefined ? [] : [[field, record.payload[field]]],
    ),
  );
  return {
    id: record.id,
    version: record.version,
    routeKey: record.routeKey,
    actualDone: record.actualDone,
    payload,
    userConfirmed: record.userConfirmed,
  } as LocalRecord;
}

function projectProviderRecord(record: LocalRecord) {
  return {
    routeKey: record.routeKey,
    actualDone: record.actualDone,
    payload: record.payload,
    userConfirmed: record.userConfirmed,
  };
}

function reuseProvider(provider: AiProvider, providers: Map<string, AiProvider>): AiProvider {
  const key = (provider as AiProvider & { circuitKey?: unknown }).circuitKey;
  if (typeof key !== "string" || key.length === 0 || key.length > 500) return provider;
  const existing = providers.get(key);
  if (existing) return existing;
  providers.set(key, provider);
  return provider;
}

function defaultProviderFactory(body: ParsedRouteRequest): AiProvider {
  const canUseScenarioMock =
    !process.env.DEEPSEEK_API_KEY &&
    (
      process.env.NODE_ENV !== "production" ||
      isReservedProductionE2eRun(process.env)
    );
  return process.env.DEEPSEEK_API_KEY
    ? createAiProviderFromEnv()
    : new MockAiProvider(canUseScenarioMock ? body.scenario : "provider_failure");
}

export function isReservedProductionE2eRun(
  environment: Readonly<Record<string, string | undefined>>,
  projectRoot = process.cwd(),
): boolean {
  const hasReservedIdentity = (
    environment.MVP_PRODUCTION_E2E_ALLOW_MOCK === "1" &&
    environment.E2E_EVIDENCE_RESERVED === "1" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{7,119}$/.test(environment.E2E_RUN_ID ?? "") &&
    Boolean(environment.E2E_EVIDENCE_DIR?.trim())
  );
  if (!hasReservedIdentity) return false;

  try {
    const expectedRoot = realpathSync(
      path.resolve(projectRoot, "qa", "private-beta-production"),
    );
    const evidenceDirectory = realpathSync(
      path.resolve(environment.E2E_EVIDENCE_DIR!),
    );
    if (!evidenceDirectory.startsWith(`${expectedRoot}${path.sep}`)) return false;

    const manifestPath = path.join(evidenceDirectory, "manifest.json");
    if (!existsSync(manifestPath)) return false;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      runId?: unknown;
      requestedRunId?: unknown;
    };
    return (
      manifest.runId === path.basename(evidenceDirectory) &&
      manifest.requestedRunId === environment.E2E_RUN_ID
    );
  } catch {
    return false;
  }
}

export function productionE2eGuardOptions(
  environment: Readonly<Record<string, string | undefined>>,
  projectRoot = process.cwd(),
) {
  return isReservedProductionE2eRun(environment, projectRoot)
    ? {
        sessionRateLimit: 100,
        sessionDailyLimit: 1_000,
        globalRateLimit: 10_000,
        globalDailyLimit: 100_000,
      }
    : {};
}

function withSessionCookie(
  response: Response,
  session: AiSession,
): Response {
  if (session.shouldSetCookie && session.cookieValue) {
    response.headers.append(
      "Set-Cookie",
      `ai_session=${session.cookieValue}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=86400`,
    );
  }
  return response;
}

export const POST = createAiRouteHandler();
