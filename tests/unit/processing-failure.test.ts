import { describe, expect, it, vi } from "vitest";
import { AiProviderError } from "@/ai/provider";
import { MockAiProvider } from "@/ai/mock-provider";
import {
  createSafeAiFailureReporter,
  type AiFailureEvent,
} from "@/ai/failure-diagnostics";
import { generateRouteOutput } from "@/ai/orchestrator";

const completeExperienceInput = {
  targetDirection: "内容运营",
  rawExperience: "参与社团公众号推文发布",
  actualActions: "整理活动信息、排版、发布并记录阅读量",
  deliverableOrResult: "保存了 5 篇推文链接，无明确增长数据",
};

describe("AI processing failures", () => {
  it("emits exactly one business terminal event when input is incomplete", async () => {
    const events: AiFailureEvent[] = [];

    const output = await generateRouteOutput({
      routeKey: "experience_to_resume",
      input: { targetDirection: "内容运营" },
      primary: { generate: vi.fn() },
      reporter: { report: (event) => { events.push(event); } },
      requestId: "018f12ab-1234-7abc-8def-1234567890ab",
    });

    expect(output.outputType).toBe("missing_info");
    expect(events).toEqual([
      expect.objectContaining({
        stage: "terminal",
        code: "business_missing_info",
        failureClass: "business_missing_info",
        terminalCategory: "business_missing_info",
      }),
    ]);
  });

  it("throws a processing error instead of returning a fake route action", async () => {
    const primary = {
      generate: vi.fn().mockRejectedValue(new AiProviderError("transport")),
    };

    await expect(generateRouteOutput({
      routeKey: "experience_to_resume",
      input: completeExperienceInput,
      primary,
      failureMode: "throw",
    })).rejects.toMatchObject({
      name: "AiProcessingError",
      category: "transport",
    });
  });

  it("retries a primary timeout once before invoking fallback", async () => {
    let primaryCalls = 0;
    let fallbackCalls = 0;
    await expect(generateRouteOutput({
      routeKey: "experience_to_resume",
      input: completeExperienceInput,
      requestId: "018f12ab-1234-7abc-8def-1234567890ab",
      primary: {
        generate: async () => {
          primaryCalls += 1;
          throw new AiProviderError("timeout");
        },
      },
      fallback: {
        generate: async () => {
          fallbackCalls += 1;
          throw new AiProviderError("timeout");
        },
      },
      failureMode: "throw",
    })).rejects.toMatchObject({ category: "machine_unavailable" });

    expect(primaryCalls).toBe(2);
    expect(fallbackCalls).toBe(1);
  });

  it("repairs semantic output once on primary and never lets fallback bypass the gates", async () => {
    const events: AiFailureEvent[] = [];
    const valid = await new MockAiProvider("success").generate({
      routeKey: "experience_to_resume",
      input: completeExperienceInput,
    });
    const semanticallyInvalid = {
      ...valid,
      todayAction: { ...valid.todayAction, actionType: "jd_revision" },
    };
    const primary = { generate: vi.fn().mockResolvedValue(semanticallyInvalid as never) };
    const fallback = {
      generate: vi.fn().mockResolvedValue(
        await new MockAiProvider("success").generate({
          routeKey: "experience_to_resume",
          input: completeExperienceInput,
        }),
      ),
    };

    await expect(generateRouteOutput({
      routeKey: "experience_to_resume",
      input: completeExperienceInput,
      primary,
      fallback,
      reporter: { report: (event) => { events.push(event); } },
      failureMode: "throw",
    })).rejects.toMatchObject({ category: "invalid_output" });

    expect(primary.generate).toHaveBeenCalledTimes(2);
    expect(fallback.generate).not.toHaveBeenCalled();
    expect(events).toContainEqual(expect.objectContaining({
      providerRole: "fallback",
      stage: "orchestration",
      code: "fallback_skipped_policy",
    }));
  });

  it("keeps the deadline effective when the diagnostic reporter never resolves", async () => {
    const settled = generateRouteOutput({
      routeKey: "experience_to_resume",
      input: completeExperienceInput,
      primary: {
        generate: vi.fn().mockRejectedValue(new AiProviderError("timeout")),
      },
      reporter: { report: () => new Promise<void>(() => undefined) },
      deadlineMs: 20,
      failureMode: "throw",
    }).then(
      () => "resolved",
      (error: unknown) =>
        error && typeof error === "object" && "category" in error
          ? String(error.category)
          : "unknown_error",
    );

    await expect(Promise.race([
      settled,
      new Promise<string>((resolve) => setTimeout(() => resolve("reporter_hung"), 250)),
    ])).resolves.toBe("machine_unavailable");
  });

  it("does not open the provider circuit for semantic contract failures", async () => {
    const valid = await new MockAiProvider("success").generate({
      routeKey: "experience_to_resume",
      input: completeExperienceInput,
    });
    const primary = {
      generate: vi.fn()
        .mockResolvedValueOnce({
          ...valid,
          todayAction: { ...valid.todayAction, actionType: "jd_revision" },
        } as never)
        .mockResolvedValueOnce({
          ...valid,
          todayAction: { ...valid.todayAction, actionType: "jd_revision" },
        } as never)
        .mockResolvedValueOnce(valid),
    };

    await expect(generateRouteOutput({
      routeKey: "experience_to_resume",
      input: completeExperienceInput,
      primary,
      failureMode: "throw",
    })).rejects.toMatchObject({ category: "invalid_output" });

    await expect(generateRouteOutput({
      routeKey: "experience_to_resume",
      input: completeExperienceInput,
      primary,
      failureMode: "throw",
    })).resolves.toMatchObject({ outputType: "route_result" });
    expect(primary.generate).toHaveBeenCalledTimes(3);
  });

  it("reports only the diagnostic allowlist even when an unsafe extra is supplied", async () => {
    const logged: unknown[] = [];
    const reporter = createSafeAiFailureReporter((event) => {
      logged.push(event);
    });
    const event: AiFailureEvent = {
      requestId: "018f12ab-1234-7abc-8def-1234567890ab",
      routeKey: "jd_to_revision",
      mode: "route",
      providerRole: "primary",
      attempt: 1,
      stage: "provider_transport",
      code: "transport",
      failureClass: "machine_unavailable",
      recoveryDecision: "retry_primary",
      durationBucket: "100_499ms",
      remainingBudgetBucket: "5_9s",
      finishReason: "length",
      choiceCountBucket: "one",
      contentShape: "string",
      contentLengthBucket: "empty",
    };

    await reporter.report({
      ...event,
      userMaterial: "PRIVATE MATERIAL",
      prompt: "PRIVATE PROMPT",
      rawOutput: "PRIVATE RAW OUTPUT",
      apiKey: "PRIVATE KEY",
      schemaPaths: ["PRIVATE SCHEMA PATH"],
      httpStatusClass: "5xx",
      providerErrorCode: "PRIVATE PROVIDER CODE",
    } as AiFailureEvent);

    expect(logged).toEqual([event]);
    expect(JSON.stringify(logged)).not.toMatch(
      /PRIVATE MATERIAL|PRIVATE PROMPT|PRIVATE RAW OUTPUT|PRIVATE KEY|PRIVATE SCHEMA PATH|PRIVATE PROVIDER CODE/,
    );
  });

  it("drops runtime observation values outside the diagnostic enum allowlists", async () => {
    const logged: unknown[] = [];
    const reporter = createSafeAiFailureReporter((event) => {
      logged.push(event);
    });

    await reporter.report({
      requestId: "018f12ab-1234-7abc-8def-1234567890ab",
      routeKey: "jd_to_revision",
      mode: "route",
      providerRole: "primary",
      attempt: 1,
      stage: "provider_content",
      code: "empty_content",
      failureClass: "machine_unavailable",
      recoveryDecision: "stop",
      durationBucket: "100_499ms",
      finishReason: "raw-secret-finish-reason",
      choiceCountBucket: "raw-secret-choice-count",
      contentShape: "raw-secret-content-shape",
      contentLengthBucket: "raw-secret-content-length",
    } as unknown as AiFailureEvent);

    expect(logged).toEqual([expect.not.objectContaining({
      finishReason: expect.anything(),
      choiceCountBucket: expect.anything(),
      contentShape: expect.anything(),
      contentLengthBucket: expect.anything(),
    })]);
    expect(JSON.stringify(logged)).not.toContain("raw-secret");
  });
});
