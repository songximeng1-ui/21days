import { describe, expect, it } from "vitest";
import { MockAiProvider } from "@/ai/mock-provider";
import { generateLightReviewOutput, generateRouteOutput } from "@/ai/orchestrator";

describe("generateRouteOutput", () => {
  it("returns missing info action for incomplete JD route input", async () => {
    const result = await generateRouteOutput({
      routeKey: "jd_to_revision",
      input: { targetJobTitle: "operations intern" },
      provider: new MockAiProvider("success"),
    });

    expect(result.outputType).toBe("missing_info");
    expect(result.todayAction.actionType).toBe("fill_info");
    expect(result.todayAction.actionTitle).toContain("JD");
  });

  it("hides provider failures behind friendly failure copy", async () => {
    const result = await generateRouteOutput({
      routeKey: "experience_to_resume",
      input: {
        targetDirection: "operations",
        rawExperience: "student club event",
        actualActions: "organized sign-up sheet",
        deliverableOrResult: "no clear result",
      },
      provider: new MockAiProvider("provider_failure"),
    });

    expect(result.outputType).toBe("friendly_failure");
    expect(JSON.stringify(result)).not.toMatch(/DeepSeek|Qwen|fallback|token|prompt|API/i);
    expect(result.shortAssessment).toContain("暂时没整理出来");
  });

  it("keeps friendly failure outside the 15-30 minute action contract", async () => {
    const result = await generateRouteOutput({
      routeKey: "experience_to_resume",
      input: {
        targetDirection: "operations",
        rawExperience: "student club event",
        actualActions: "organized sign-up sheet",
        deliverableOrResult: "no clear result",
      },
      provider: new MockAiProvider("provider_failure"),
    });

    expect(result.outputType).toBe("friendly_failure");
    expect(result.todayAction.estimatedTime).not.toBe("15-30 分钟");
  });

  it("presents friendly failure as a saved-for-later state instead of a timed today action", async () => {
    const result = await generateRouteOutput({
      routeKey: "experience_to_resume",
      input: {
        targetDirection: "operations",
        rawExperience: "student club event",
        actualActions: "organized sign-up sheet",
        deliverableOrResult: "no clear result",
      },
      provider: new MockAiProvider("provider_failure"),
    });

    const visibleCopy = JSON.stringify(result.todayAction);

    expect(result.outputType).toBe("friendly_failure");
    expect(result.todayAction.actionTitle).toContain("保存");
    expect(result.todayAction.actionTitle).toContain("稍后继续");
    expect(result.todayAction.estimatedTime).toBe("已保存，稍后继续");
    expect(visibleCopy).not.toMatch(/15\s*-\s*30|15-30|\d+\s*分钟/);
    expect(JSON.stringify(result)).not.toMatch(/DeepSeek|Qwen|fallback|token|prompt|API/i);
  });

  it("keeps ordinary route, missing info, and light review outputs on the 15-30 minute action contract", async () => {
    const routeResult = await generateRouteOutput({
      routeKey: "experience_to_resume",
      input: {
        targetDirection: "operations",
        rawExperience: "student club event",
        actualActions: "organized sign-up sheet",
        deliverableOrResult: "no clear result",
      },
      provider: new MockAiProvider("success"),
    });
    const missingInfo = await generateRouteOutput({
      routeKey: "jd_to_revision",
      input: { targetJobTitle: "operations intern" },
      provider: new MockAiProvider("success"),
    });
    const lightReview = await generateLightReviewOutput({
      record: {
        id: "record-1",
        routeKey: "experience_to_resume",
        recordType: "experience_fact",
        actionTitle: "补一条真实经历",
        actualDone: "整理了社团招新报名表，并记录了自己负责的动作。",
        payload: {},
        userConfirmed: true,
        createdAt: "2026-07-21T00:00:00.000Z",
      },
      provider: new MockAiProvider("success"),
    });

    expect(routeResult.outputType).toBe("route_result");
    expect(missingInfo.outputType).toBe("missing_info");
    expect(lightReview.outputType).toBe("light_review");

    for (const output of [routeResult, missingInfo, lightReview]) {
      expect(output.todayAction.estimatedTime).toMatch(/15\s*-\s*30|15-30/);
    }
  });

  it("keeps route-specific mock outputs for every route", async () => {
    const cases = [
      ["direction_to_jobs", "job_sample"],
      ["experience_to_resume", "experience_fact"],
      ["jd_to_revision", "jd_revision"],
      ["applications_to_review", "application_record"],
    ] as const;

    for (const [routeKey, actionType] of cases) {
      const result = await generateRouteOutput({
        routeKey,
        input:
          routeKey === "applications_to_review"
            ? {
                applications: {
                  jobTitle: "内容运营实习",
                  companyOrPlatform: "A 公司",
                  submittedAt: "7 月 1 日",
                  feedbackStatus: "暂无反馈",
                },
              }
            : {
                educationBackground: "major",
                realExperiences: "project",
                interestsOrAcceptables: "content",
                targetDirection: "operations",
                rawExperience: "club",
                actualActions: "organized",
                deliverableOrResult: "no clear result",
                targetJobTitle: "intern",
                jdTextOrRequirements: "content work",
                userMaterial: "club content",
              },
        provider: new MockAiProvider("success"),
      });

      expect(result.outputType).toBe("route_result");
      expect(result.todayAction.actionType).toBe(actionType);
    }
  });
});
