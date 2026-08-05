import { describe, expect, it, vi } from "vitest";
import { AiProviderError } from "@/ai/provider";
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
    })).rejects.toMatchObject({ category: "timeout" });

    expect(primaryCalls).toBe(2);
    expect(fallbackCalls).toBe(1);
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
      durationBucket: "100_499ms",
    };

    await reporter.report({
      ...event,
      userMaterial: "PRIVATE MATERIAL",
      prompt: "PRIVATE PROMPT",
      rawOutput: "PRIVATE RAW OUTPUT",
      apiKey: "PRIVATE KEY",
    } as AiFailureEvent);

    expect(logged).toEqual([event]);
    expect(JSON.stringify(logged)).not.toMatch(
      /PRIVATE MATERIAL|PRIVATE PROMPT|PRIVATE RAW OUTPUT|PRIVATE KEY/,
    );
  });
});
