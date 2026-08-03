import { MockAiProvider } from "@/ai/mock-provider";
import { createAiProviderFromEnv } from "@/ai/chat-completion-provider";
import type { AiProvider } from "@/ai/provider";
import {
  AiRequestGuard,
  AiRequestGuardError,
  type AiSession,
} from "@/ai/request-guard";
import {
  AiUpstreamUnavailableError,
  generateLightReviewOutput,
  generateRouteOutput,
  makeFriendlyFailureOutput,
} from "@/ai/orchestrator";
import type { RouteKey } from "@/domain/types";
import { ROUTE_KEYS } from "@/domain/types";
import type { LocalRecord } from "@/lib/local-store";
import { attachOutputProvenance } from "@/domain/provenance";
import { routeOutputWithProvenanceSchema } from "@/schemas/route-output";
import { routeRequestSchema, type ParsedRouteRequest } from "@/schemas/route-request";
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
      "beforeSnippet",
      "afterSnippet",
      "jdRequirement",
      "submitted",
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
};

const defaultGuard = new AiRequestGuard(
  productionE2eGuardOptions(process.env),
);

export function createAiRouteHandler(dependencies: AiRouteHandlerDependencies = {}) {
  const guard = dependencies.guard ?? defaultGuard;
  const providerFactory = dependencies.providerFactory ?? defaultProviderFactory;
  const reusableProviders = new Map<string, AiProvider>();
  return async function handleAiRequest(request: Request): Promise<Response> {
    let routeKey: RouteKey = "experience_to_resume";
    let session = guard.readSession(request);
    let release: (() => void) | undefined;

    try {
      guard.assertTrustedJsonRequest(request);
      const body = routeRequestSchema.parse(await guard.readJson(request));
      routeKey = body.routeKey;
      if (containsSensitivePersonalInfo(body.input)) {
        return withSessionCookie(
          NextResponse.json(makeSensitiveInfoFailureOutput(routeKey), {
            status: 422,
          }),
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
        return withSessionCookie(
          NextResponse.json(makeFriendlyFailureOutput(routeKey), { status: 400 }),
          session,
        );
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
              signal: request.signal,
              surfaceUpstreamUnavailable: true,
            })
          : await generateRouteOutput({
              routeKey,
              input: body.input,
              provider,
              signal: request.signal,
              surfaceUpstreamUnavailable: true,
            });
      if (request.signal.aborted) return withSessionCookie(new Response(null, { status: 499 }), session);
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
        return withSessionCookie(
          NextResponse.json(makeFriendlyFailureOutput(routeKey), { status: 502 }),
          session,
        );
      }
      return withSessionCookie(NextResponse.json(validatedOutput.data), session);
    } catch (error) {
      if (request.signal.aborted) return withSessionCookie(new Response(null, { status: 499 }), session);
      if (error instanceof AiUpstreamUnavailableError) {
        const retryAfterSeconds = Math.max(
          1,
          Math.min(30, Math.ceil(error.retryAfterMs / 1_000)),
        );
        return withSessionCookie(
          NextResponse.json(makeFriendlyFailureOutput(routeKey), {
            status: 503,
            headers: { "Retry-After": String(retryAfterSeconds) },
          }),
          session,
        );
      }
      if (error instanceof AiRequestGuardError) {
        return withSessionCookie(
          NextResponse.json(
            makeFriendlyFailureOutput(routeKey),
            {
              status: error.status,
              headers: error.retryAfterSeconds
                ? { "Retry-After": String(Math.min(error.retryAfterSeconds, 86_400)) }
                : undefined,
            },
          ),
          session,
        );
      }
      if (error instanceof z.ZodError || error instanceof SyntaxError) {
        return withSessionCookie(NextResponse.json(makeFriendlyFailureOutput(routeKey), { status: 400 }), session);
      }
      return withSessionCookie(
        NextResponse.json(makeFriendlyFailureOutput(routeKey), { status: 500 }),
        session,
      );
    } finally {
      release?.();
    }
  };
}

function makeSensitiveInfoFailureOutput(routeKey: RouteKey) {
  const output = makeFriendlyFailureOutput(routeKey);
  return {
    ...output,
    shortAssessment:
      "请先删除手机号、证件号、邮箱、明确病情或婚育等敏感个人信息，再重新提交。",
    todayAction: {
      ...output.todayAction,
      actionTitle: "先删除敏感个人信息",
      actionReason: "这些信息不是完成当前求职判断所必需的，不应发送给外部 AI。",
      actionSteps: ["删除敏感个人信息后重新提交"],
      recordAfterDone: "只保留完成当前任务所需的非敏感内容。",
    },
  };
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
