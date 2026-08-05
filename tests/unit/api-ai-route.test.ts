import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createAiRouteHandler,
  isReservedProductionE2eRun,
  productionE2eGuardOptions,
} from "@/app/api/ai/route";
import { AiRequestGuard } from "@/ai/request-guard";
import { AiProviderError, type AiProvider } from "@/ai/provider";
import { MockAiProvider } from "@/ai/mock-provider";

const originalNodeEnv = process.env.NODE_ENV;
const originalDeepseekKey = process.env.DEEPSEEK_API_KEY;
const originalProductionE2eMock = process.env.MVP_PRODUCTION_E2E_ALLOW_MOCK;
const originalEvidenceReserved = process.env.E2E_EVIDENCE_RESERVED;
const originalEvidenceRunId = process.env.E2E_RUN_ID;
const originalEvidenceDirectory = process.env.E2E_EVIDENCE_DIR;
const temporaryEvidenceRoots: string[] = [];

describe("POST /api/ai", () => {
  afterEach(() => {
    setEnv("NODE_ENV", originalNodeEnv);
    setEnv("DEEPSEEK_API_KEY", originalDeepseekKey);
    setEnv("MVP_PRODUCTION_E2E_ALLOW_MOCK", originalProductionE2eMock);
    setEnv("E2E_EVIDENCE_RESERVED", originalEvidenceReserved);
    setEnv("E2E_RUN_ID", originalEvidenceRunId);
    setEnv("E2E_EVIDENCE_DIR", originalEvidenceDirectory);
    for (const root of temporaryEvidenceRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not let production requests choose a successful mock scenario when no provider key exists", async () => {
    setEnv("NODE_ENV", "production");
    delete process.env.DEEPSEEK_API_KEY;

    const response = await createAiRouteHandler()(
      new Request("http://localhost/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routeKey: "jd_to_revision",
          scenario: "success",
          requestMetadata: {
            clientRequestId: "11111111-1111-4111-8111-111111111111",
            draftRevision: 4,
            idempotencyKey: "22222222-2222-4222-8222-222222222222",
          },
          input: {
            targetJobTitle: "产品运营实习",
            jdTextOrRequirements: "负责用户调研、数据整理、活动复盘",
            userMaterial: "社团活动经历",
          },
        }),
      }),
    );
    const output = await response.json();

    expect(response.status).toBe(503);
    expect(output).toMatchObject({
      error: "ai_processing_failure",
      category: "transport",
    });
    expect(output).not.toHaveProperty("todayAction");
    expect(JSON.stringify(output)).not.toMatch(/DeepSeek|Qwen|fallback|prompt|token|API/i);
  });

  it("does not allow the production mock marker without a reserved E2E identity", async () => {
    expect(isReservedProductionE2eRun({
      MVP_PRODUCTION_E2E_ALLOW_MOCK: "1",
    })).toBe(false);
    expect(isReservedProductionE2eRun({
      MVP_PRODUCTION_E2E_ALLOW_MOCK: "1",
      E2E_EVIDENCE_RESERVED: "1",
      E2E_RUN_ID: "short",
      E2E_EVIDENCE_DIR: "D:\\evidence\\reserved-run",
    })).toBe(false);
    expect(isReservedProductionE2eRun({
      MVP_PRODUCTION_E2E_ALLOW_MOCK: "1",
      E2E_EVIDENCE_RESERVED: "1",
      E2E_RUN_ID: "20260731-prod-final",
    })).toBe(false);
    const projectRoot = makeTemporaryProjectRoot();
    expect(isReservedProductionE2eRun({
      MVP_PRODUCTION_E2E_ALLOW_MOCK: "1",
      E2E_EVIDENCE_RESERVED: "1",
      E2E_RUN_ID: "20260731-prod-final",
      E2E_EVIDENCE_DIR: path.join(
        projectRoot,
        "qa",
        "private-beta-production",
        "nonexistent-run",
      ),
    }, projectRoot)).toBe(false);
  });

  it("allows the deterministic mock only for a reserved production E2E run", async () => {
    const reserved = reserveTestEvidenceDirectory(
      process.cwd(),
      "20260731-prod-final",
      true,
    );
    setEnv("NODE_ENV", "production");
    delete process.env.DEEPSEEK_API_KEY;
    setEnv("MVP_PRODUCTION_E2E_ALLOW_MOCK", "1");
    setEnv("E2E_EVIDENCE_RESERVED", "1");
    setEnv("E2E_RUN_ID", "20260731-prod-final");
    setEnv("E2E_EVIDENCE_DIR", reserved);
    expect(isReservedProductionE2eRun(process.env)).toBe(true);

    const response = await createAiRouteHandler()(
      new Request("http://localhost/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routeKey: "jd_to_revision",
          scenario: "success",
          requestMetadata: {
            clientRequestId: "11111111-1111-4111-8111-111111111111",
            draftRevision: 4,
            idempotencyKey: "22222222-2222-4222-8222-222222222222",
          },
          input: {
            targetJobTitle: "内容运营实习",
            jdTextOrRequirements: "负责内容整理、数据记录与活动复盘",
            userMaterial: "整理报名表并核对名单",
          },
        }),
      }),
    );
    const output = await response.json();

    expect(response.status).toBe(200);
    expect(output).toMatchObject({ outputType: "route_result" });
    expect(response.headers.get("X-Client-Request-Id")).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(response.headers.get("X-Draft-Revision")).toBe("4");
    expect(response.headers.get("X-Idempotency-Key")).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
  });

  it("relaxes in-memory quotas only for a fully reserved production E2E run", () => {
    const projectRoot = makeTemporaryProjectRoot();
    const reserved = reserveTestEvidenceDirectory(projectRoot, "20260731-prod-final");
    expect(productionE2eGuardOptions({
      MVP_PRODUCTION_E2E_ALLOW_MOCK: "1",
    })).toEqual({});
    expect(productionE2eGuardOptions({
      MVP_PRODUCTION_E2E_ALLOW_MOCK: "1",
      E2E_EVIDENCE_RESERVED: "1",
      E2E_RUN_ID: "20260731-prod-final",
      E2E_EVIDENCE_DIR: reserved,
    }, projectRoot)).toMatchObject({
      sessionRateLimit: 100,
      sessionDailyLimit: 1_000,
      globalRateLimit: 10_000,
      globalDailyLimit: 100_000,
    });
  });

  it("rejects reserved evidence when either manifest identity differs from the environment", () => {
    const projectRoot = makeTemporaryProjectRoot();
    const runId = "20260731-prod-final";
    const environment = {
      MVP_PRODUCTION_E2E_ALLOW_MOCK: "1",
      E2E_EVIDENCE_RESERVED: "1",
      E2E_RUN_ID: runId,
    };
    const mismatchedManifestRunId = reserveTestEvidenceDirectory(projectRoot, runId);
    writeFileSync(
      path.join(mismatchedManifestRunId, "manifest.json"),
      JSON.stringify({
        runId: "20260731-prod-different--a8283fa72ab3--0123456789ab",
        requestedRunId: runId,
      }),
      "utf8",
    );
    const mismatchedManifestRequestedRunId = reserveTestEvidenceDirectory(
      projectRoot,
      "20260731-prod-second",
    );
    writeFileSync(
      path.join(mismatchedManifestRequestedRunId, "manifest.json"),
      JSON.stringify({
        runId: path.basename(mismatchedManifestRequestedRunId),
        requestedRunId: "20260731-prod-different",
      }),
      "utf8",
    );

    expect(isReservedProductionE2eRun({
      ...environment,
      E2E_EVIDENCE_DIR: mismatchedManifestRunId,
    }, projectRoot)).toBe(false);
    expect(productionE2eGuardOptions({
      ...environment,
      E2E_EVIDENCE_DIR: mismatchedManifestRunId,
    }, projectRoot)).toEqual({});
    expect(isReservedProductionE2eRun({
      ...environment,
      E2E_EVIDENCE_DIR: mismatchedManifestRequestedRunId,
    }, projectRoot)).toBe(false);
    expect(productionE2eGuardOptions({
      ...environment,
      E2E_EVIDENCE_DIR: mismatchedManifestRequestedRunId,
    }, projectRoot)).toEqual({});
  });

  it("rejects an oversized request body with 413 before constructing a provider", async () => {
    const providerFactory = vi.fn(() => new MockAiProvider("success"));
    const handler = createAiRouteHandler({
      providerFactory,
      guard: new AiRequestGuard({ maxRequestBytes: 256 }),
    });

    const response = await handler(new Request("http://localhost/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "ai_session=test-oversized" },
      body: JSON.stringify({
        routeKey: "experience_to_resume",
        input: {
          targetDirection: "运营",
          rawExperience: "很长".repeat(200),
          actualActions: "整理报名表",
          deliverableOrResult: "报名名单",
        },
      }),
    }));

    expect(response.status).toBe(413);
    expect(providerFactory).not.toHaveBeenCalled();
  });

  it("returns 400 for fields outside the strict route request contract", async () => {
    const providerFactory = vi.fn(() => new MockAiProvider("success"));
    const handler = createAiRouteHandler({
      providerFactory,
      guard: new AiRequestGuard(),
    });

    const response = await handler(new Request("http://localhost/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "ai_session=test-strict" },
      body: JSON.stringify({
        routeKey: "experience_to_resume",
        input: {
          targetDirection: "运营",
          rawExperience: "社团活动",
          actualActions: "整理报名表",
          deliverableOrResult: "报名名单",
          privateNotes: "must-not-enter-provider",
        },
      }),
    }));

    expect(response.status).toBe(400);
    expect(providerFactory).not.toHaveBeenCalled();
  });

  it("accepts current record metadata while projecting only route-specific AI fields", async () => {
    let providerRecord: unknown;
    const mock = new MockAiProvider("success");
    const provider: AiProvider = {
      generate: vi.fn(async (input) => {
        providerRecord = input.input.record;
        return mock.generate(input);
      }),
    };
    const handler = createAiRouteHandler({
      providerFactory: () => provider as AiProvider,
      guard: new AiRequestGuard(),
    });

    const response = await handler(new Request("http://localhost/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "ai_session=test-light-review" },
      body: JSON.stringify({
        mode: "light_review",
        routeKey: "direction_to_jobs",
        input: {
          record: {
            id: "record-1",
            actionId: "action-1",
            routeKey: "direction_to_jobs",
            recordType: "job_sample",
            actionTitle: "确认岗位样本",
            actualDone: "保存了一个内容运营岗位样本",
            payload: {
              jobTitle: "内容运营",
              companyOrPlatform: "A 公司",
              jdSummary: "负责社媒内容",
              interestPoint: "内容策划",
              concernPoint: "缺少行业经验",
              sourceExperienceId: "must-not-enter-provider",
              privateNotes: "must-not-enter-provider",
            },
            userConfirmed: true,
            status: "confirmed",
            version: 2,
            createdAt: "2026-07-30T00:00:00.000Z",
            updatedAt: "2026-07-31T00:00:00.000Z",
            completedAt: "2026-07-31T00:00:00.000Z",
            confirmedAt: "2026-07-31T00:00:00.000Z",
            supersedesRecordId: "record-previous",
            sourceState: "current",
          },
        },
      }),
    }));

    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.outputType).toBe("light_review");
    expect(providerRecord).toEqual({
      routeKey: "direction_to_jobs",
      actualDone: "保存了一个内容运营岗位样本",
      payload: {
        jobTitle: "内容运营",
        companyOrPlatform: "A 公司",
        jdSummary: "负责社媒内容",
        interestPoint: "内容策划",
        concernPoint: "缺少行业经验",
      },
      userConfirmed: true,
    });
  });

  it("keeps the target job title when projecting a JD all-keep record for light review", async () => {
    let providerRecord: unknown;
    const mock = new MockAiProvider("success");
    const provider: AiProvider = {
      generate: vi.fn(async (input) => {
        providerRecord = input.input.record;
        return mock.generate(input);
      }),
    };
    const handler = createAiRouteHandler({
      providerFactory: () => provider,
      guard: new AiRequestGuard(),
    });

    const response = await handler(new Request("http://localhost/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "light_review",
        routeKey: "jd_to_revision",
        input: {
          record: {
            id: "jd-all-keep-record",
            routeKey: "jd_to_revision",
            recordType: "jd_compare",
            actionTitle: "确认并保存当前版本",
            actualDone: "确认并保存了当前版本和后续观察点。",
            payload: {
              targetJobTitle: "AI 产品运营实习",
              materialVersion: "AI 产品运营版 V1",
              submitted: "已投递",
              observationPoint: "记录是否进入面试",
              privateNotes: "must-not-enter-provider",
            },
            userConfirmed: true,
            status: "confirmed",
            version: 1,
            createdAt: "2026-08-05T00:00:00.000Z",
          },
        },
      }),
    }));
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(providerRecord).toEqual({
      routeKey: "jd_to_revision",
      actualDone: "确认并保存了当前版本和后续观察点。",
      payload: {
        targetJobTitle: "AI 产品运营实习",
        materialVersion: "AI 产品运营版 V1",
        submitted: "已投递",
        observationPoint: "记录是否进入面试",
      },
      userConfirmed: true,
    });
  });

  it.each([
    ["unconfirmed", { userConfirmed: false, status: "draft", version: 1 }],
    ["draft", { userConfirmed: true, status: "draft", version: 1 }],
    ["versionless", { userConfirmed: true, status: "confirmed" }],
  ])("rejects a %s record before light-review provider use", async (_name, state) => {
    const providerFactory = vi.fn(() => new MockAiProvider("success"));
    const handler = createAiRouteHandler({
      providerFactory,
      guard: new AiRequestGuard(),
    });
    const response = await handler(new Request("http://localhost/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "light_review",
        routeKey: "direction_to_jobs",
        input: {
          record: {
            id: "record-untrusted",
            routeKey: "direction_to_jobs",
            recordType: "job_sample",
            actionTitle: "保存岗位样本",
            actualDone: "保存了一个岗位样本",
            payload: { jobTitle: "内容运营" },
            createdAt: "2026-07-30T00:00:00.000Z",
            ...state,
          },
        },
      }),
    }));

    expect(response.status).toBe(400);
    expect(providerFactory).not.toHaveBeenCalled();
  });

  it.each([
    [
      "experience_to_resume",
      "experience_fact",
      "整理并核对了社团报名表",
      {
        actualActions: "整理并核对报名表",
        deliverable: "报名名单",
        confirmedFacts: "整理并核对报名表",
        supportingFacts: "报名名单",
        missingFacts: "暂无明确结果",
      },
    ],
    [
      "jd_to_revision",
      "jd_compare",
      "对照 JD 修改了一处真实表述",
      {
        beforeSnippet: "协助活动",
        afterSnippet: "整理活动报名表",
        jdRequirement: "内容整理",
        submitted: "否",
      },
    ],
  ] as const)("returns a valid light review for %s", async (
    routeKey,
    recordType,
    actualDone,
    payload,
  ) => {
    const handler = createAiRouteHandler({
      providerFactory: () => new MockAiProvider("success"),
      guard: new AiRequestGuard(),
    });
    const response = await handler(new Request("http://localhost/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "light_review",
        routeKey,
        input: {
          record: {
            id: `${routeKey}-record`,
            routeKey,
            recordType,
            actionTitle: "完成一条真实记录",
            actualDone,
            payload,
            userConfirmed: true,
            status: "confirmed",
            version: 1,
            createdAt: "2026-07-30T00:00:00.000Z",
          },
        },
      }),
    }));
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.outputType).toBe("light_review");
  });

  it("returns a provenance-bearing light review for two separately persisted application records", async () => {
    const handler = createAiRouteHandler({
      providerFactory: () => new MockAiProvider("success"),
      guard: new AiRequestGuard(),
    });
    const makeRecord = (
      id: string,
      jobTitle: string,
      companyOrPlatform: string,
      submittedAt: string,
      feedbackStatus: string,
    ) => ({
      id,
      routeKey: "applications_to_review",
      recordType: "application",
      actionTitle: "核对两条真实投递记录",
      actualDone: "核对并保存了两条真实投递记录。",
      payload: {
        jobTitle,
        companyOrPlatform,
        submittedAt,
        feedbackStatus,
        jdSummary: "负责内容整理",
        materialVersion: "社团经历版",
      },
      userConfirmed: true,
      status: "confirmed",
      version: 1,
      createdAt: "2026-07-30T00:00:00.000Z",
    });

    const response = await handler(new Request("http://localhost/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "light_review",
        routeKey: "applications_to_review",
        input: {
          records: [
            makeRecord("application-1", "内容运营实习", "A 公司", "7 月 1 日", "暂无反馈"),
            makeRecord("application-2", "新媒体运营实习", "B 公司", "7 月 3 日", "已查看"),
          ],
        },
      }),
    }));
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.outputType).toBe("light_review");
    expect(Object.keys(body.provenance ?? {}).length).toBeGreaterThan(0);
    const confirmedSources = Object.values(body.provenance as Record<string, {
      sources: Array<{ sourceType: string; recordId?: string; recordVersion?: number }>;
    }>).flatMap((claim) => claim.sources)
      .filter((source) => source.sourceType === "confirmed_record");
    expect(confirmedSources.length).toBeGreaterThan(0);
    expect(confirmedSources.every((source) =>
      ["application-1", "application-2"].includes(source.recordId ?? "") &&
      source.recordVersion === 1
    )).toBe(true);
  });

  it.each([
    [
      "second minimum",
      [{
        jobTitle: "内容运营实习",
        companyOrPlatform: "A 公司",
        submittedAt: "7 月 1 日",
        feedbackStatus: "暂无反馈",
        jdSummary: "负责内容整理",
        materialVersion: "社团经历版",
      }],
      "applications.1.jobTitle",
    ],
    [
      "second review details",
      [
        {
          jobTitle: "内容运营实习",
          companyOrPlatform: "A 公司",
          submittedAt: "7 月 1 日",
          feedbackStatus: "暂无反馈",
          jdSummary: "负责内容整理",
          materialVersion: "社团经历版",
        },
        {
          jobTitle: "新媒体运营实习",
          companyOrPlatform: "B 公司",
          submittedAt: "7 月 3 日",
          feedbackStatus: "已查看",
        },
      ],
      "applications.1.jdSummary",
    ],
  ])("returns grounded missing-info for %s", async (_name, applications, expectedPath) => {
    const handler = createAiRouteHandler({
      providerFactory: () => new MockAiProvider("success"),
      guard: new AiRequestGuard(),
    });
    const response = await handler(new Request("http://localhost/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routeKey: "applications_to_review",
        input: { applications },
      }),
    }));
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.outputType).toBe("missing_info");
    const missingSources = Object.entries(body.provenance as Record<string, {
      sources: Array<{ path: string }>;
    }>)
      .filter(([path]) => path.startsWith("missingInfo.missingFields."))
      .flatMap(([, claim]) => claim.sources);
    expect(missingSources.some((source) => source.path === expectedPath)).toBe(true);
  });

  it("returns a safe non-200 response when the final light review has strict-schema extras", async () => {
    const mock = new MockAiProvider("success");
    const provider: AiProvider = {
      generate: vi.fn(async (input) => {
        const output = await mock.generate(input);
        return {
          ...output,
          routeResult: {
            ...output.routeResult,
            rawProviderExtra: "must-not-leave-api",
          },
        };
      }),
    };
    const handler = createAiRouteHandler({
      providerFactory: () => provider,
      guard: new AiRequestGuard(),
    });

    const response = await handler(new Request("http://localhost/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "light_review",
        routeKey: "experience_to_resume",
        input: {
          record: {
            id: "record-extra",
            routeKey: "experience_to_resume",
            recordType: "experience_fact",
            actionTitle: "整理经历事实",
            actualDone: "整理了社团报名表",
            payload: { deliverable: "报名名单" },
            userConfirmed: true,
            status: "confirmed",
            version: 1,
            createdAt: "2026-07-30T00:00:00.000Z",
          },
        },
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      error: "ai_processing_failure",
      category: "invalid_output",
    });
    expect(body).not.toHaveProperty("todayAction");
    expect(JSON.stringify(body)).not.toContain("rawProviderExtra");
  });

  it("rejects a light-review record whose route does not match the request discriminator", async () => {
    const providerFactory = vi.fn(() => new MockAiProvider("success"));
    const handler = createAiRouteHandler({
      providerFactory,
      guard: new AiRequestGuard(),
    });

    const response = await handler(new Request("http://localhost/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "ai_session=test-route-mismatch" },
      body: JSON.stringify({
        mode: "light_review",
        routeKey: "direction_to_jobs",
        input: {
          record: {
            id: "record-1",
            routeKey: "experience_to_resume",
            recordType: "experience_fact",
            actionTitle: "整理经历事实",
            actualDone: "整理了社团报名表",
            payload: { deliverable: "报名名单" },
            userConfirmed: true,
            version: 2,
            createdAt: "2026-07-30T00:00:00.000Z",
          },
        },
      }),
    }));

    expect(response.status).toBe(400);
    expect(providerFactory).not.toHaveBeenCalled();
  });

  it("maps an upstream Retry-After failure to a safe non-200 response", async () => {
    const provider: AiProvider = {
      generate: vi.fn().mockRejectedValue(
        new AiProviderError("retryable_http", "4xx", "SENSITIVE_UPSTREAM_CODE", 7_000),
      ),
    };
    const handler = createAiRouteHandler({
      providerFactory: () => provider as AiProvider,
      guard: new AiRequestGuard(),
    });

    const response = await handler(makeExperienceRequest("test-upstream-retry-after"));
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("7");
    expect(body).not.toMatch(/SENSITIVE_UPSTREAM_CODE|retryable_http|provider|api.key/i);
  });

  it("keeps a provider circuit open across API requests that construct replacement provider objects", async () => {
    const providers: Array<AiProvider & { generate: ReturnType<typeof vi.fn> }> = [];
    const handler = createAiRouteHandler({
      providerFactory: () => {
        const provider = {
          circuitKey: "api-cross-request-deepseek",
          generate: vi.fn().mockRejectedValue(
            new AiProviderError("retryable_http", "4xx", "rate_limit", 30_000),
          ),
        };
        providers.push(provider);
        return provider;
      },
      guard: new AiRequestGuard({ sessionRateLimit: 10 }),
    });

    const first = await handler(makeExperienceRequest("test-circuit-a"));
    const second = await handler(makeExperienceRequest("test-circuit-b"));

    expect(first.status).toBe(503);
    expect(second.status).toBe(503);
    expect(providers).toHaveLength(2);
    expect(providers[0]?.generate).toHaveBeenCalledTimes(1);
    expect(providers[1]?.generate).not.toHaveBeenCalled();
  });

  it("enforces the per-session daily budget with a bounded Retry-After response", async () => {
    const provider = new MockAiProvider("success");
    const providerFactory = vi.fn(() => provider);
    const handler = createAiRouteHandler({
      providerFactory,
      guard: new AiRequestGuard({
        sessionDailyLimit: 1,
        sessionRateLimit: 10,
        globalDailyLimit: 10,
      }),
    });
    const makeRequest = () => new Request("http://localhost/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "ai_session=test-daily" },
      body: JSON.stringify({
        routeKey: "experience_to_resume",
        input: {
          targetDirection: "运营",
          rawExperience: "社团活动",
          actualActions: "整理报名表",
          deliverableOrResult: "报名名单",
        },
      }),
    });

    const first = await handler(makeRequest());
    const second = await handler(makeRequest());

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(Number(second.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(providerFactory).toHaveBeenCalledTimes(1);
  });

  it("limits discarded-cookie requests while a browser can continue with the issued cookie", async () => {
    const providerFactory = vi.fn(() => new MockAiProvider("success"));
    const handler = createAiRouteHandler({
      providerFactory,
      guard: new AiRequestGuard({
        sessionDailyLimit: 1,
        sessionRateLimit: 10,
        globalDailyLimit: 10,
      }),
    });
    const makeRequest = (cookie?: string) => new Request("http://localhost/api/ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify({
        routeKey: "experience_to_resume",
        input: {
          targetDirection: "运营",
          rawExperience: "社团活动",
          actualActions: "整理报名表",
          deliverableOrResult: "报名名单",
        },
      }),
    });

    const first = await handler(makeRequest());
    const issuedCookie = first.headers.get("Set-Cookie")?.split(";", 1)[0];
    const discardedCookie = await handler(makeRequest());
    const returningBrowser = await handler(makeRequest(issuedCookie));

    expect(first.status).toBe(200);
    expect(issuedCookie).toMatch(/^ai_session=[a-zA-Z0-9_-]{8,80}$/);
    expect(discardedCookie.status).toBe(429);
    expect(discardedCookie.headers.get("Set-Cookie")).toBeNull();
    expect(returningBrowser.status).toBe(200);
    expect(providerFactory).toHaveBeenCalledTimes(2);
  });

  it("passes browser cancellation through the route and stops the active upstream provider", async () => {
    const controller = new AbortController();
    let upstreamSignal: AbortSignal | undefined;
    let notifyStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const provider = {
      generate: vi.fn((input) => {
        upstreamSignal = input.signal;
        notifyStarted?.();
        return new Promise((_resolve, reject) => {
          input.signal?.addEventListener(
            "abort",
            () => reject(new AiProviderError("cancelled")),
            { once: true },
          );
        });
      }),
    };
    const handler = createAiRouteHandler({
      providerFactory: () => provider as AiProvider,
      guard: new AiRequestGuard(),
    });
    const pending = handler(new Request("http://localhost/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "ai_session=test-cancel" },
      body: JSON.stringify({
        routeKey: "experience_to_resume",
        input: {
          targetDirection: "运营",
          rawExperience: "社团活动",
          actualActions: "整理报名表",
          deliverableOrResult: "报名名单",
        },
      }),
      signal: controller.signal,
    }));

    await started;
    controller.abort();
    const response = await pending;

    expect(response.status).toBe(499);
    expect(upstreamSignal?.aborted).toBe(true);
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  it("rejects a second in-flight request for the same session and releases the slot afterward", async () => {
    const validOutput = await new MockAiProvider("success").generate({
      routeKey: "experience_to_resume",
      input: {
        targetDirection: "运营",
        rawExperience: "社团活动",
        actualActions: "整理报名表",
        deliverableOrResult: "报名名单",
      },
    });
    let finishFirst: ((value: typeof validOutput) => void) | undefined;
    let notifyStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const provider = {
      generate: vi.fn()
        .mockImplementationOnce(() => {
          notifyStarted?.();
          return new Promise<typeof validOutput>((resolve) => {
            finishFirst = resolve;
          });
        })
        .mockResolvedValue(validOutput),
    };
    const handler = createAiRouteHandler({
      providerFactory: () => provider,
      guard: new AiRequestGuard({
        sessionConcurrentLimit: 1,
        globalConcurrentLimit: 4,
        sessionRateLimit: 10,
      }),
    });
    const makeRequest = () => new Request("http://localhost/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "ai_session=test-concurrent" },
      body: JSON.stringify({
        routeKey: "experience_to_resume",
        input: {
          targetDirection: "运营",
          rawExperience: "社团活动",
          actualActions: "整理报名表",
          deliverableOrResult: "报名名单",
        },
      }),
    });

    const firstPending = handler(makeRequest());
    await started;
    const blocked = await handler(makeRequest());
    finishFirst?.(validOutput);
    const first = await firstPending;
    const afterRelease = await handler(makeRequest());

    expect(blocked.status).toBe(503);
    expect(blocked.headers.get("Retry-After")).toBe("1");
    expect(first.status).toBe(200);
    expect(afterRelease.status).toBe(200);
  });

  it("enforces the global daily budget across different anonymous sessions", async () => {
    const providerFactory = vi.fn(() => new MockAiProvider("success"));
    const handler = createAiRouteHandler({
      providerFactory,
      guard: new AiRequestGuard({
        globalDailyLimit: 1,
        sessionDailyLimit: 10,
        sessionRateLimit: 10,
      }),
    });
    const makeRequest = (sessionId: string) => new Request("http://localhost/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `ai_session=${sessionId}` },
      body: JSON.stringify({
        routeKey: "experience_to_resume",
        input: {
          targetDirection: "运营",
          rawExperience: "社团活动",
          actualActions: "整理报名表",
          deliverableOrResult: "报名名单",
        },
      }),
    });

    const first = await handler(makeRequest("global-session-a"));
    const second = await handler(makeRequest("global-session-b"));

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(providerFactory).toHaveBeenCalledTimes(1);
  });

  it("enforces the short-window session rate independently from the daily budget", async () => {
    const providerFactory = vi.fn(() => new MockAiProvider("success"));
    const handler = createAiRouteHandler({
      providerFactory,
      guard: new AiRequestGuard({
        sessionRateLimit: 1,
        sessionDailyLimit: 10,
        globalDailyLimit: 10,
      }),
    });
    const makeRequest = () => new Request("http://localhost/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "ai_session=test-rate-limit" },
      body: JSON.stringify({
        routeKey: "experience_to_resume",
        input: {
          targetDirection: "运营",
          rawExperience: "社团活动",
          actualActions: "整理报名表",
          deliverableOrResult: "报名名单",
        },
      }),
    });

    expect((await handler(makeRequest())).status).toBe(200);
    const limited = await handler(makeRequest());
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(providerFactory).toHaveBeenCalledTimes(1);
  });

  it("rejects non-JSON and cross-site requests before constructing a provider", async () => {
    const providerFactory = vi.fn(() => new MockAiProvider("success"));
    const handler = createAiRouteHandler({ providerFactory, guard: new AiRequestGuard() });
    const body = JSON.stringify({
      routeKey: "experience_to_resume",
      input: {
        targetDirection: "运营",
        rawExperience: "社团活动",
        actualActions: "整理报名表",
        deliverableOrResult: "报名名单",
      },
    });

    const nonJson = await handler(new Request("http://localhost/api/ai", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body,
    }));
    const badOrigin = await handler(new Request("http://localhost/api/ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
      },
      body,
    }));
    const crossSite = await handler(new Request("http://localhost/api/ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Sec-Fetch-Site": "cross-site",
      },
      body,
    }));
    const forgedHostAndOrigin = await handler(new Request("http://localhost/api/ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "evil.example",
        Origin: "https://evil.example",
        "Sec-Fetch-Site": "same-origin",
      },
      body,
    }));
    const mismatchedServerHost = await handler(new Request("http://localhost/api/ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "evil.example",
      },
      body,
    }));
    const mismatchedOriginScheme = await handler(new Request("http://localhost/api/ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "localhost",
        Origin: "https://localhost",
        "Sec-Fetch-Site": "same-origin",
      },
      body,
    }));

    expect(nonJson.status).toBe(415);
    expect(badOrigin.status).toBe(403);
    expect(crossSite.status).toBe(403);
    expect(forgedHostAndOrigin.status).toBe(403);
    expect(mismatchedServerHost.status).toBe(403);
    expect(mismatchedOriginScheme.status).toBe(403);
    expect(providerFactory).not.toHaveBeenCalled();
  });

  it("accepts a server-side client without Origin when Host is absent or matches the request URL", async () => {
    const providerFactory = vi.fn(() => new MockAiProvider("success"));
    const makeHandler = () =>
      createAiRouteHandler({ providerFactory, guard: new AiRequestGuard() });
    const body = JSON.stringify({
      routeKey: "experience_to_resume",
      input: {
        targetDirection: "运营",
        rawExperience: "社团活动",
        actualActions: "整理报名表",
        deliverableOrResult: "报名名单",
      },
    });

    const withoutOriginOrHost = await makeHandler()(new Request("http://localhost/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }));
    const matchingHost = await makeHandler()(new Request("http://localhost/api/ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "localhost",
      },
      body,
    }));

    expect(withoutOriginOrHost.status).toBe(200);
    expect(matchingHost.status).toBe(200);
    expect(providerFactory).toHaveBeenCalledTimes(2);
  });

  it("accepts a browser origin that matches the public Host when the framework uses an internal URL", async () => {
    const providerFactory = vi.fn(() => new MockAiProvider("success"));
    const handler = createAiRouteHandler({ providerFactory, guard: new AiRequestGuard() });

    const response = await handler(new Request("http://localhost:3100/api/ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "127.0.0.1:3100",
        Origin: "http://127.0.0.1:3100",
        "Sec-Fetch-Site": "same-origin",
      },
      body: JSON.stringify({
        routeKey: "experience_to_resume",
        input: {
          targetDirection: "运营",
          rawExperience: "社团活动",
          actualActions: "整理报名表",
          deliverableOrResult: "报名名单",
        },
      }),
    }));

    expect(response.status).toBe(200);
    expect(providerFactory).toHaveBeenCalledTimes(1);
  });

  it.each([
    "手机号 13800138000",
    "手机号 138-0013-8000",
    "+86 138 0013 8000",
    "身份证号 110101199001011234",
    "联系邮箱 student@example.com",
    "婚育情况：已婚",
    "本人未婚",
    "我有抑郁症",
    "medical condition: depression",
    "marital status: married",
    "phone: +1 (202) 555-0123",
    "请把婚育情况写入简历",
    "建议在求职记录中保存病情",
  ])("rejects sensitive input before it reaches the provider: %s", async (rawExperience) => {
    const provider = new MockAiProvider("success");
    const providerFactory = vi.fn(() => provider);
    const generateSpy = vi.spyOn(provider, "generate");
    const handler = createAiRouteHandler({ providerFactory, guard: new AiRequestGuard() });

    const response = await handler(new Request("http://localhost/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routeKey: "experience_to_resume",
        input: {
          targetDirection: "运营",
          rawExperience,
          actualActions: "整理报名表",
          deliverableOrResult: "报名名单",
        },
      }),
    }));

    expect(response.status).toBe(422);
    expect(JSON.stringify(await response.json())).toMatch(
      /删除.*敏感个人信息|敏感个人信息.*删除/,
    );
    expect(providerFactory).not.toHaveBeenCalled();
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it("returns a 5xx status with a friendly body for unknown server errors", async () => {
    const handler = createAiRouteHandler({
      providerFactory: () => {
        throw new Error("sensitive internal detail");
      },
      guard: new AiRequestGuard(),
    });

    const response = await handler(makeExperienceRequest("unknown-error"));
    const parsedBody = await response.json();
    const body = JSON.stringify(parsedBody);

    expect(response.status).toBe(500);
    expect(parsedBody).toMatchObject({
      error: "ai_processing_failure",
      category: "invalid_output",
    });
    expect(parsedBody).not.toHaveProperty("todayAction");
    expect(body).not.toContain("sensitive internal detail");
    expect(body).not.toMatch(/stack|exception|providerFactory/i);
  });
});

function setEnv(
  key:
    | "NODE_ENV"
    | "DEEPSEEK_API_KEY"
    | "MVP_PRODUCTION_E2E_ALLOW_MOCK"
    | "E2E_EVIDENCE_RESERVED"
    | "E2E_RUN_ID"
    | "E2E_EVIDENCE_DIR",
  value: string | undefined,
) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  Reflect.set(process.env, key, value);
}

function makeTemporaryProjectRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "mvp-e2e-route-test-"));
  temporaryEvidenceRoots.push(root);
  return root;
}

function reserveTestEvidenceDirectory(
  projectRoot: string,
  requestedRunId: string,
  useUniqueRunDirectory = false,
): string {
  const evidenceRoot = path.join(
    projectRoot,
    "qa",
    "private-beta-production",
  );
  mkdirSync(evidenceRoot, { recursive: true });
  const evidenceDirectory = useUniqueRunDirectory
    ? mkdtempSync(path.join(evidenceRoot, "unit-route-"))
    : path.join(
        evidenceRoot,
        `${requestedRunId}--a8283fa72ab3--0123456789ab`,
      );
  if (!useUniqueRunDirectory) mkdirSync(evidenceDirectory);
  if (useUniqueRunDirectory) temporaryEvidenceRoots.push(evidenceDirectory);
  const runId = path.basename(evidenceDirectory);
  writeFileSync(
    path.join(evidenceDirectory, "manifest.json"),
    JSON.stringify({ runId, requestedRunId }),
    "utf8",
  );
  return evidenceDirectory;
}

function makeExperienceRequest(sessionId: string): Request {
  return new Request("http://localhost/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `ai_session=${sessionId}` },
    body: JSON.stringify({
      routeKey: "experience_to_resume",
      input: {
        targetDirection: "运营",
        rawExperience: "社团活动",
        actualActions: "整理报名表",
        deliverableOrResult: "报名名单",
      },
    }),
  });
}
