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

  it("asks for user material instead of JD when the real JD is already present", async () => {
    const result = await generateRouteOutput({
      routeKey: "jd_to_revision",
      input: {
        targetJobTitle: "内容运营实习生",
        jdTextOrRequirements: "负责选题、发布和数据记录",
      },
      provider: new MockAiProvider("success"),
    });

    expect(result.outputType).toBe("missing_info");
    expect(result.missingInfo?.missingFields).toEqual(["准备使用的相关经历或简历片段"]);
    expect(result.todayAction.actionTitle).toContain("材料");
    expect(result.todayAction.actionTitle).not.toContain("补这份岗位的真实 JD");
    expect(result.recordGuide.fieldsToRecord).toEqual(["userMaterial"]);
  });

  it("builds one missing-info action from the first real gap without treating placeholders as known facts", async () => {
    const result = await generateRouteOutput({
      routeKey: "experience_to_resume",
      input: {
        targetDirection: "运营",
        rawExperience: "社团推文发布",
        actualActions: "还没整理",
        deliverableOrResult: "无",
      },
      provider: new MockAiProvider("success"),
    });

    expect(result.outputType).toBe("missing_info");
    expect(result.missingInfo?.missingFields).toEqual(["实际动作"]);
    expect(result.todayAction.actionTitle).toBe("今天先补这段经历里实际做过的 3 个动作");
    expect(result.recordGuide.fieldsToRecord).toEqual(["actualActions"]);
    expect(result.missingInfo?.alreadyKnown.join(" ")).not.toMatch(/还没整理|无/);
  });

  it("asks for one concrete first application record while preserving review evidence requirements", async () => {
    const result = await generateRouteOutput({
      routeKey: "applications_to_review",
      input: { applications: {} },
      provider: new MockAiProvider("success"),
    });

    expect(result.outputType).toBe("missing_info");
    expect(result.todayAction.actionTitle).toContain("1 条");
    expect(result.todayAction.actionSteps.join("\n")).toContain("岗位");
    expect(result.todayAction.actionSteps.join("\n")).toContain("公司或平台");
    expect(result.todayAction.actionSteps.join("\n")).not.toContain("JD 摘要");
    expect(result.todayAction.actionSteps.join("\n")).not.toContain("材料版本");
    expect(result.missingInfo?.missingFields).toEqual(["第 1 条最低字段投递记录"]);
    expect(result.recordGuide.fieldsToRecord).toEqual([
      "jobTitle",
      "companyOrPlatform",
      "submittedAt",
      "feedbackStatus",
    ]);
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

  it("rejects provider-authored friendly failure output and replaces it with product copy", async () => {
    const result = await generateRouteOutput({
      routeKey: "experience_to_resume",
      input: {
        targetDirection: "operations",
        rawExperience: "student club event",
        actualActions: "organized sign-up sheet",
        deliverableOrResult: "signup list",
      },
      provider: {
        async generate() {
          return {
            routeKey: "experience_to_resume",
            outputType: "friendly_failure",
            shortAssessment: "model controlled failure",
            routeResult: null,
            missingInfo: null,
            todayAction: {
              actionTitle: "model controlled failure action",
              actionReason: "model should not choose this state",
              actionSteps: ["stop"],
              estimatedTime: "later",
              recordAfterDone: "nothing",
              actionType: "fill_info",
            },
            recordGuide: {
              recordType: "fill_info",
              fieldsToRecord: ["note"],
              requiresUserConfirmation: true,
            },
          };
        },
      },
    });

    expect(result.outputType).toBe("friendly_failure");
    expect(JSON.stringify(result)).not.toContain("model controlled failure");
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
                applications: [
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
                    jdSummary: "负责选题和数据记录",
                    materialVersion: "项目经历版",
                  },
                ],
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

      if (routeKey === "applications_to_review") {
        expect(result.recordGuide.fieldsToRecord).toEqual([
          "jobTitle",
          "companyOrPlatform",
          "submittedAt",
          "feedbackStatus",
          "jdSummary",
          "materialVersion",
        ]);
        expect(result.todayAction.actionSteps.join("\n")).toContain("JD 摘要");
        expect(result.todayAction.actionSteps.join("\n")).toContain("材料版本");
        expect(result.todayAction.actionSteps.join("\n")).not.toContain("不确定");
      }
    }
  });

  it("keeps mock evidence grounded in the current user input", async () => {
    const result = await generateRouteOutput({
      routeKey: "experience_to_resume",
      input: {
        targetDirection: "实验室助理",
        rawExperience: "在材料实验室整理样品记录",
        actualActions: "给样品编号并录入温度数据",
        deliverableOrResult: "形成一份样品登记表",
      },
      provider: new MockAiProvider("success"),
    });

    expect(result.outputType).toBe("route_result");
    expect(result.routeResult?.confirmedFacts).toEqual(
      expect.arrayContaining(["在材料实验室整理样品记录", "给样品编号并录入温度数据"]),
    );
    expect(result.routeResult?.supportingFacts).toEqual(
      expect.arrayContaining(["给样品编号并录入温度数据", "形成一份样品登记表"]),
    );
    expect(JSON.stringify(result)).not.toContain("报名表");
  });

  it("rejects model evidence that cannot be traced to the current input", async () => {
    const provider = new MockAiProvider("success");
    const generated = await provider.generate({
      routeKey: "experience_to_resume",
      input: {
        targetDirection: "实验室助理",
        rawExperience: "在材料实验室整理样品记录",
        actualActions: "给样品编号并录入温度数据",
        deliverableOrResult: "形成一份样品登记表",
      },
    });

    const result = await generateRouteOutput({
      routeKey: "experience_to_resume",
      input: {
        targetDirection: "实验室助理",
        rawExperience: "在材料实验室整理样品记录",
        actualActions: "给样品编号并录入温度数据",
        deliverableOrResult: "形成一份样品登记表",
      },
      provider: {
        async generate() {
          return {
            ...generated,
            routeResult: {
              ...generated.routeResult,
              supportingFacts: ["独立运营公众号并增长 5000 名粉丝"],
            },
          };
        },
      },
    });

    expect(result.outputType).toBe("friendly_failure");
    expect(JSON.stringify(result)).not.toContain("5000");
  });

  it("retries once when the first structured output violates safety boundaries", async () => {
    const safeProvider = new MockAiProvider("success");
    const safeOutput = await safeProvider.generate({
      routeKey: "experience_to_resume",
      input: {
        targetDirection: "运营",
        rawExperience: "社团推文发布",
        actualActions: "整理信息并排版",
        deliverableOrResult: "发布 2 篇推文",
      },
    });
    let calls = 0;
    const result = await generateRouteOutput({
      routeKey: "experience_to_resume",
      input: {
        targetDirection: "运营",
        rawExperience: "社团推文发布",
        actualActions: "整理信息并排版",
        deliverableOrResult: "发布 2 篇推文",
      },
      provider: {
        async generate() {
          calls += 1;
          return calls === 1 ? { ...safeOutput, shortAssessment: "匹配度 90%" } : safeOutput;
        },
      },
    });

    expect(calls).toBe(2);
    expect(result.outputType).toBe("route_result");
  });
});
