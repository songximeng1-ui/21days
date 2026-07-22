import { describe, expect, it, vi } from "vitest";
import { ChatCompletionProvider } from "@/ai/chat-completion-provider";
import { MockAiProvider } from "@/ai/mock-provider";
import { AiProviderError } from "@/ai/provider";
import { generateLightReviewOutput, generateRouteOutput } from "@/ai/orchestrator";
import type { RouteOutput } from "@/domain/types";

const sufficientExperienceInput = {
  targetDirection: "运营",
  rawExperience: "社团推文发布",
  actualActions: "整理信息并排版",
  deliverableOrResult: "发布 2 篇推文",
};

async function makeValidExperienceOutput(): Promise<RouteOutput> {
  return new MockAiProvider("success").generate({
    routeKey: "experience_to_resume",
    input: sufficientExperienceInput,
  });
}

const sufficientDirectionInput = {
  educationBackground: "信息管理专业",
  realExperiences: "整理社团报名信息",
  interestsOrAcceptables: "不排斥信息整理",
};

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

  it.each([
    {
      name: "non-null missingInfo",
      routeKey: "experience_to_resume" as const,
      input: sufficientExperienceInput,
      mutate: (output: RouteOutput) => ({
        ...output,
        missingInfo: { cannotJudge: "x", alreadyKnown: [], missingFields: ["x"] },
      }),
    },
    {
      name: "wrong actionType",
      routeKey: "experience_to_resume" as const,
      input: sufficientExperienceInput,
      mutate: (output: RouteOutput) => ({
        ...output,
        todayAction: { ...output.todayAction, actionType: "jd_revision" as const },
      }),
    },
    {
      name: "wrong recordType",
      routeKey: "experience_to_resume" as const,
      input: sufficientExperienceInput,
      mutate: (output: RouteOutput) => ({
        ...output,
        recordGuide: { ...output.recordGuide, recordType: "jd_compare" as const },
      }),
    },
    {
      name: "non-literal estimatedTime",
      routeKey: "experience_to_resume" as const,
      input: sufficientExperienceInput,
      mutate: (output: RouteOutput) => ({
        ...output,
        todayAction: { ...output.todayAction, estimatedTime: "15 - 30 分钟" },
      }),
    },
    {
      name: "requiresUserConfirmation false",
      routeKey: "experience_to_resume" as const,
      input: sufficientExperienceInput,
      mutate: (output: RouteOutput) => ({
        ...output,
        recordGuide: { ...output.recordGuide, requiresUserConfirmation: false },
      }),
    },
    {
      name: "non-canonical fieldsToRecord",
      routeKey: "experience_to_resume" as const,
      input: sufficientExperienceInput,
      mutate: (output: RouteOutput) => ({
        ...output,
        recordGuide: { ...output.recordGuide, fieldsToRecord: ["actualActions", "missingFacts", "deliverable"] },
      }),
    },
    {
      name: "missing direction validationFocus",
      routeKey: "direction_to_jobs" as const,
      input: sufficientDirectionInput,
      mutate: (output: RouteOutput) => ({
        ...output,
        routeResult: {
          explorableDirections: (output.routeResult?.explorableDirections as Array<Record<string, unknown>>).map(
            ({ validationFocus: _removed, ...direction }) => {
              void _removed;
              return direction;
            },
          ),
        },
      }),
    },
    {
      name: "unexpected routeResult key",
      routeKey: "experience_to_resume" as const,
      input: sufficientExperienceInput,
      mutate: (output: RouteOutput) => ({
        ...output,
        routeResult: { ...output.routeResult, unexpectedRouteField: "not allowed" },
      }),
    },
    {
      name: "unexpected nested direction key",
      routeKey: "direction_to_jobs" as const,
      input: sufficientDirectionInput,
      mutate: (output: RouteOutput) => ({
        ...output,
        routeResult: {
          explorableDirections: (output.routeResult?.explorableDirections as Array<Record<string, unknown>>).map(
            (direction) => ({ ...direction, unexpectedDirectionField: "not allowed" }),
          ),
        },
      }),
    },
  ])("rejects route_result candidates with $name", async ({ routeKey, input, mutate }) => {
    const validOutput = await new MockAiProvider("success").generate({ routeKey, input });
    const primary = { generate: vi.fn().mockResolvedValue(mutate(validOutput)) };

    const result = await generateRouteOutput({ routeKey, input, primary });

    expect(result.outputType).toBe("friendly_failure");
    expect(primary.generate).toHaveBeenCalledTimes(2);
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

  it("adds the same sanitized retry section to the second light-review primary request", async () => {
    const record = {
      id: "record-light-retry",
      routeKey: "experience_to_resume" as const,
      recordType: "experience_fact" as const,
      actionTitle: "补一条真实经历",
      actualDone: "整理了社团报名表",
      payload: { actualActions: "整理报名信息" },
      userConfirmed: true,
      createdAt: "2026-07-21T00:00:00.000Z",
      privateNotes: "COMPLETE_LIGHT_INPUT_SECRET",
    };
    const validOutput = await new MockAiProvider("success").generate({
      routeKey: record.routeKey,
      input: { mode: "light_review", record },
    });
    let call = 0;
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      void _url;
      void _init;
      call += 1;
      const content = call === 1
        ? JSON.stringify({
            broken: "FIRST_LIGHT_CANDIDATE DeepSeek Qwen fallback prompt token API key stack trace 内部错误",
            providerName: "PROVIDER_SECRET",
          })
        : JSON.stringify(validOutput);
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    });
    const primary = new ChatCompletionProvider({
      apiKey: "secret-test-key",
      baseUrl: "https://api.example.com",
      model: "test-model",
      fetchFn: fetchMock,
    });

    const result = await generateLightReviewOutput({ record, primary });

    expect(result.outputType).toBe("light_review");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string) as {
      messages: Array<{ content: string }>;
    };
    const secondPrompt = secondBody.messages.map((message) => message.content).join("\n");
    const retrySection = secondPrompt.split("RETRY_CORRECTION_BEGIN")[1]?.split("RETRY_CORRECTION_END")[0] ?? "";
    expect(retrySection).toContain('\"stage\": \"candidate_schema\"');
    expect(retrySection).toContain('\"code\": \"candidate_zod\"');
    expect(retrySection).toContain("routeKey");
    expect(retrySection).not.toMatch(
      /FIRST_LIGHT_CANDIDATE|PROVIDER_SECRET|secret-test-key|COMPLETE_LIGHT_INPUT_SECRET|DeepSeek|Qwen|fallback|prompt|token|API key|stack trace|内部错误/i,
    );
  });

  it.each([
    {
      name: "wrong source routeKey",
      mutate: (output: RouteOutput) => ({ ...output, routeKey: "jd_to_revision" as const }),
    },
    {
      name: "wrong source actionType",
      mutate: (output: RouteOutput) => ({
        ...output,
        todayAction: { ...output.todayAction, actionType: "jd_revision" as const },
      }),
    },
    {
      name: "wrong source recordType",
      mutate: (output: RouteOutput) => ({
        ...output,
        recordGuide: { ...output.recordGuide, recordType: "jd_compare" as const },
      }),
    },
    {
      name: "non-literal estimatedTime",
      mutate: (output: RouteOutput) => ({
        ...output,
        todayAction: { ...output.todayAction, estimatedTime: "15 - 30 分钟" },
      }),
    },
    {
      name: "requiresUserConfirmation false",
      mutate: (output: RouteOutput) => ({
        ...output,
        recordGuide: { ...output.recordGuide, requiresUserConfirmation: false },
      }),
    },
    {
      name: "non-canonical fieldsToRecord",
      mutate: (output: RouteOutput) => ({
        ...output,
        recordGuide: { ...output.recordGuide, fieldsToRecord: ["missingFacts", "actualActions", "deliverable"] },
      }),
    },
  ])("rejects light_review candidates with $name", async ({ mutate }) => {
    const record = {
      id: "record-light-contract",
      routeKey: "experience_to_resume" as const,
      recordType: "experience_fact" as const,
      actionTitle: "补一条真实经历",
      actualDone: "整理了社团报名表",
      payload: { actualActions: "整理报名信息" },
      userConfirmed: true,
      createdAt: "2026-07-21T00:00:00.000Z",
    };
    const validOutput = await new MockAiProvider("success").generate({
      routeKey: record.routeKey,
      input: { mode: "light_review", record },
    });
    const primary = { generate: vi.fn().mockResolvedValue(mutate(validOutput)) };

    const result = await generateLightReviewOutput({ record, primary });

    expect(result.outputType).toBe("friendly_failure");
    expect(primary.generate).toHaveBeenCalledTimes(2);
  });

  it("keeps route-specific mock outputs for every route", async () => {
    const cases = [
      ["direction_to_jobs", "job_sample", ["jobTitle", "companyOrPlatform", "jdSummary", "interestPoint", "concernPoint"]],
      ["experience_to_resume", "experience_fact", ["actualActions", "deliverable", "missingFacts"]],
      ["jd_to_revision", "jd_revision", ["beforeSnippet", "afterSnippet", "jdRequirement", "submitted"]],
      ["applications_to_review", "application_record", ["jobTitle", "companyOrPlatform", "submittedAt", "feedbackStatus", "jdSummary", "materialVersion"]],
    ] as const;

    for (const [routeKey, actionType, fieldsToRecord] of cases) {
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
      expect(result.recordGuide.fieldsToRecord).toEqual(fieldsToRecord);

      if (routeKey === "direction_to_jobs") {
        const directions = result.routeResult?.explorableDirections as Array<{ searchKeywords: string[] }>;
        expect(directions).toHaveLength(2);
        for (const direction of directions) expect(direction.searchKeywords).toHaveLength(3);
      }

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

  it("keeps exact source-route canonical fields for every mock light review", async () => {
    const cases = [
      ["direction_to_jobs", "job_sample", "job_sample", ["jobTitle", "companyOrPlatform", "jdSummary", "interestPoint", "concernPoint"]],
      ["experience_to_resume", "experience_fact", "experience_fact", ["actualActions", "deliverable", "missingFacts"]],
      ["jd_to_revision", "jd_revision", "jd_compare", ["beforeSnippet", "afterSnippet", "jdRequirement", "submitted"]],
      ["applications_to_review", "application_record", "application", ["jobTitle", "companyOrPlatform", "submittedAt", "feedbackStatus", "jdSummary", "materialVersion"]],
    ] as const;

    for (const [routeKey, actionType, recordType, fieldsToRecord] of cases) {
      const output = await generateLightReviewOutput({
        record: {
          id: `record-${routeKey}`,
          routeKey,
          recordType,
          actionTitle: "保存真实行动",
          actualDone: "保存了一个真实行动",
          payload: {},
          userConfirmed: true,
          createdAt: "2026-07-21T00:00:00.000Z",
        },
        provider: new MockAiProvider("success"),
      });

      expect(output.outputType).toBe("light_review");
      expect(output.routeKey).toBe(routeKey);
      expect(output.todayAction.actionType).toBe(actionType);
      expect(output.todayAction.estimatedTime).toBe("15-30 分钟");
      expect(output.recordGuide).toEqual({ recordType, fieldsToRecord, requiresUserConfirmation: true });
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

  it.each([
    {
      routeKey: "direction_to_jobs" as const,
      input: {
        educationBackground: "信息管理专业",
        realExperiences: "整理社团报名信息",
        interestsOrAcceptables: "不排斥信息整理",
        privateNotes: "PRIVATE_NOT_ALLOWLISTED",
      },
      replaceEvidence: (output: RouteOutput) => ({
        ...output,
        routeResult: {
          ...output.routeResult,
          explorableDirections: (output.routeResult?.explorableDirections as Array<Record<string, unknown>>).map(
            (direction) => ({ ...direction, basisFromUserMaterial: ["PRIVATE_NOT_ALLOWLISTED"] }),
          ),
        },
      }),
    },
    {
      routeKey: "experience_to_resume" as const,
      input: { ...sufficientExperienceInput, privateNotes: "PRIVATE_NOT_ALLOWLISTED" },
      replaceEvidence: (output: RouteOutput) => ({
        ...output,
        routeResult: {
          ...output.routeResult,
          confirmedFacts: ["PRIVATE_NOT_ALLOWLISTED"],
          supportingFacts: ["PRIVATE_NOT_ALLOWLISTED"],
        },
      }),
    },
  ])("rejects $routeKey evidence from fields outside its route allowlist", async ({ routeKey, input, replaceEvidence }) => {
    const generated = await new MockAiProvider("success").generate({ routeKey, input });
    const provider = { generate: vi.fn().mockResolvedValue(replaceEvidence(generated)) };

    const result = await generateRouteOutput({ routeKey, input, provider });

    expect(result.outputType).toBe("friendly_failure");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_NOT_ALLOWLISTED");
  });

  it("rejects application evidence from undocumented nested fields while allowing userSuspicion", async () => {
    const input = {
      applications: [
        {
          jobTitle: "内容运营实习",
          companyOrPlatform: "A 公司",
          submittedAt: "7 月 1 日",
          feedbackStatus: "暂无反馈",
          jdSummary: "负责内容整理",
          materialVersion: "社团经历版",
          userSuspicion: "可能需要核对材料版本",
          privateNotes: "PRIVATE_APPLICATION_NOTE",
        },
        {
          jobTitle: "新媒体运营实习",
          companyOrPlatform: "B 公司",
          submittedAt: "7 月 3 日",
          feedbackStatus: "已查看",
          jdSummary: "负责选题和数据记录",
          materialVersion: "项目经历版",
          userSuspicion: "可能需要核对投递时间",
          privateNotes: "SECOND_PRIVATE_APPLICATION_NOTE",
        },
      ],
    };
    const generated = await new MockAiProvider("success").generate({
      routeKey: "applications_to_review",
      input,
    });
    const privateEvidence = {
      ...generated,
      routeResult: { ...generated.routeResult, reviewBasis: ["PRIVATE_APPLICATION_NOTE"] },
    };
    const suspicionEvidence = {
      ...generated,
      routeResult: { ...generated.routeResult, reviewBasis: ["可能需要核对材料版本"] },
    };

    const rejected = await generateRouteOutput({
      routeKey: "applications_to_review",
      input,
      provider: { generate: vi.fn().mockResolvedValue(privateEvidence) },
    });
    const accepted = await generateRouteOutput({
      routeKey: "applications_to_review",
      input,
      provider: { generate: vi.fn().mockResolvedValue(suspicionEvidence) },
    });

    expect(rejected.outputType).toBe("friendly_failure");
    expect(JSON.stringify(rejected)).not.toContain("PRIVATE_APPLICATION_NOTE");
    expect(accepted.outputType).toBe("route_result");
    expect(accepted.routeResult?.reviewBasis).toEqual(["可能需要核对材料版本"]);
  });

  it.each([
    {
      name: "case changes",
      rawExperience: "真实经历",
      actualActions: "CaseSensitiveFact",
      claim: "casesensitivefact",
    },
    {
      name: "whitespace removal",
      rawExperience: "真实经历",
      actualActions: "整理 报名 表",
      claim: "整理报名表",
    },
    {
      name: "whitespace addition",
      rawExperience: "真实经历",
      actualActions: "整理报名表",
      claim: "整理 报名 表",
    },
    {
      name: "a prefix",
      rawExperience: "真实经历",
      actualActions: "整理报名表",
      claim: "前缀整理报名表",
    },
    {
      name: "a suffix",
      rawExperience: "真实经历",
      actualActions: "整理报名表",
      claim: "整理报名表后缀",
    },
    {
      name: "cross-field construction",
      rawExperience: "LEFT_PART",
      actualActions: "RIGHT_PART",
      claim: "LEFT_PARTRIGHT_PART",
    },
  ])("rejects evidence changed by $name instead of using one literal source substring", async ({ rawExperience, actualActions, claim }) => {
    const input = {
      targetDirection: "运营",
      rawExperience,
      actualActions,
      deliverableOrResult: "形成一份记录",
    };
    const generated = await new MockAiProvider("success").generate({
      routeKey: "experience_to_resume",
      input,
    });
    const invalidOutput = {
      ...generated,
      routeResult: {
        ...generated.routeResult,
        confirmedFacts: [claim],
        supportingFacts: [claim],
      },
    };
    const provider = { generate: vi.fn().mockResolvedValue(invalidOutput) };

    const result = await generateRouteOutput({ routeKey: "experience_to_resume", input, provider });

    expect(result.outputType).toBe("friendly_failure");
    expect(provider.generate).toHaveBeenCalledTimes(2);
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

  it("retries primary once when candidate Zod parsing fails and can recover", async () => {
    const validOutput = await makeValidExperienceOutput();
    const primary = {
      generate: vi.fn()
        .mockResolvedValueOnce({ broken: true })
        .mockResolvedValueOnce(validOutput),
    };

    const result = await generateRouteOutput({
      routeKey: "experience_to_resume",
      input: sufficientExperienceInput,
      primary,
    });

    expect(result.outputType).toBe("route_result");
    expect(primary.generate).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["route mismatch", (output: RouteOutput) => ({ ...output, routeKey: "jd_to_revision" }) as RouteOutput],
    ["route shape", (output: RouteOutput) => ({ ...output, routeResult: null })],
    [
      "action",
      (output: RouteOutput) => ({
        ...output,
        todayAction: { ...output.todayAction, estimatedTime: "later" },
      }),
    ],
    ["safety", (output: RouteOutput) => ({ ...output, shortAssessment: "匹配度 90%" })],
    [
      "grounding",
      (output: RouteOutput) => ({
        ...output,
        routeResult: { ...output.routeResult, supportingFacts: ["从未提供的敏感虚构事实"] },
      }),
    ],
  ])("retries primary once after a %s failure and can recover", async (_name, makeInvalid) => {
    const validOutput = await makeValidExperienceOutput();
    const primary = {
      generate: vi.fn()
        .mockResolvedValueOnce(makeInvalid(validOutput))
        .mockResolvedValueOnce(validOutput),
    };

    const result = await generateRouteOutput({
      routeKey: "experience_to_resume",
      input: sufficientExperienceInput,
      primary,
    });

    expect(result.outputType).toBe("route_result");
    expect(primary.generate).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      name: "candidate Zod",
      makeInvalid: () => ({ broken: "FIRST_FULL_CANDIDATE_SECRET" }) as unknown as RouteOutput,
      feedback: {
        stage: "candidate_schema",
        code: "candidate_zod",
        schemaPaths: expect.any(Array),
      },
    },
    {
      name: "route mismatch",
      makeInvalid: (output: RouteOutput) => ({
        ...output,
        routeKey: "jd_to_revision",
        candidateMarker: "FIRST_FULL_CANDIDATE_SECRET",
      }) as unknown as RouteOutput,
      feedback: { stage: "route_mismatch", code: "route_mismatch" },
    },
    {
      name: "unexpected route output type",
      makeInvalid: (output: RouteOutput) => ({
        ...output,
        outputType: "missing_info",
        candidateMarker: "FIRST_FULL_CANDIDATE_SECRET",
      }) as unknown as RouteOutput,
      feedback: { stage: "route_shape", code: "unexpected_output_type" },
    },
    {
      name: "route result shape",
      makeInvalid: (output: RouteOutput) => ({
        ...output,
        routeResult: null,
        candidateMarker: "FIRST_FULL_CANDIDATE_SECRET",
      }),
      feedback: { stage: "route_shape", code: "route_shape" },
    },
    {
      name: "action",
      makeInvalid: (output: RouteOutput) => ({
        ...output,
        candidateMarker: "FIRST_FULL_CANDIDATE_SECRET",
        todayAction: { ...output.todayAction, estimatedTime: "later" },
      }),
      feedback: { stage: "action", code: "action_contract" },
    },
    {
      name: "safety",
      makeInvalid: (output: RouteOutput) => ({
        ...output,
        candidateMarker: "FIRST_FULL_CANDIDATE_SECRET",
        shortAssessment: "匹配度 90%",
      }),
      feedback: { stage: "safety", code: "safety_boundary" },
    },
    {
      name: "grounding",
      makeInvalid: (output: RouteOutput) => ({
        ...output,
        candidateMarker: "FIRST_FULL_CANDIDATE_SECRET",
        routeResult: { ...output.routeResult, supportingFacts: ["发布 999 篇文章"] },
      }),
      feedback: { stage: "grounding", code: "grounding_failure" },
    },
  ])("sends sanitized $name feedback only on the second primary call", async ({ makeInvalid, feedback }) => {
    const validOutput = await makeValidExperienceOutput();
    const primary = {
      generate: vi.fn()
        .mockResolvedValueOnce(makeInvalid(validOutput))
        .mockResolvedValueOnce(validOutput),
    };

    const result = await generateRouteOutput({
      routeKey: "experience_to_resume",
      input: sufficientExperienceInput,
      primary,
    });

    expect(result.outputType).toBe("route_result");
    expect(primary.generate).toHaveBeenCalledTimes(2);
    expect(primary.generate.mock.calls[0]?.[0]).toEqual({
      routeKey: "experience_to_resume",
      input: sufficientExperienceInput,
    });
    expect(primary.generate.mock.calls[1]?.[0]).toEqual({
      routeKey: "experience_to_resume",
      input: sufficientExperienceInput,
      retryFeedback: feedback,
    });
    expect(JSON.stringify(primary.generate.mock.calls[1]?.[0])).not.toMatch(
      /FIRST_FULL_CANDIDATE_SECRET|candidateMarker|previousOutput|providerName|apiKey/i,
    );
  });

  it.each(["transport", "retryable_http", "envelope_json", "empty_content", "model_json"] as const)(
    "uses only one generic retry code after a %s provider-machine failure",
    async (kind) => {
      const validOutput = await makeValidExperienceOutput();
      const primary = {
        generate: vi.fn()
          .mockRejectedValueOnce(new AiProviderError(kind))
          .mockResolvedValueOnce(validOutput),
      };

      const result = await generateRouteOutput({
        routeKey: "experience_to_resume",
        input: sufficientExperienceInput,
        primary,
      });

      expect(result.outputType).toBe("route_result");
      expect(primary.generate.mock.calls[1]?.[0]).toEqual({
        routeKey: "experience_to_resume",
        input: sufficientExperienceInput,
        retryFeedback: { code: "provider_retryable" },
      });
      expect(JSON.stringify(primary.generate.mock.calls[1]?.[0])).not.toMatch(
        /transport|retryable_http|envelope_json|empty_content|model_json|provider_http|provider_content/i,
      );
    },
  );

  it.each(["transport", "retryable_http", "envelope_json", "empty_content", "model_json"] as const)(
    "calls fallback once after two primary %s failures",
    async (kind) => {
      const validOutput = await makeValidExperienceOutput();
      const primary = { generate: vi.fn().mockRejectedValue(new AiProviderError(kind)) };
      const fallback = { generate: vi.fn().mockResolvedValue(validOutput) };

      const result = await generateRouteOutput({
        routeKey: "experience_to_resume",
        input: sufficientExperienceInput,
        primary,
        fallback,
      });

      expect(result.outputType).toBe("route_result");
      expect(primary.generate).toHaveBeenCalledTimes(2);
      expect(fallback.generate).toHaveBeenCalledTimes(1);
    },
  );

  it("calls fallback once when candidate Zod parsing is exhausted on primary", async () => {
    const validOutput = await makeValidExperienceOutput();
    const primary = { generate: vi.fn().mockResolvedValue({ broken: true }) };
    const fallback = { generate: vi.fn().mockResolvedValue(validOutput) };

    const result = await generateRouteOutput({
      routeKey: "experience_to_resume",
      input: sufficientExperienceInput,
      primary,
      fallback,
    });

    expect(result.outputType).toBe("route_result");
    expect(primary.generate).toHaveBeenCalledTimes(2);
    expect(fallback.generate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["route mismatch", (output: RouteOutput) => ({ ...output, routeKey: "jd_to_revision" }) as RouteOutput],
    ["route shape", (output: RouteOutput) => ({ ...output, routeResult: null })],
    [
      "action",
      (output: RouteOutput) => ({
        ...output,
        todayAction: { ...output.todayAction, estimatedTime: "later" },
      }),
    ],
    ["safety", (output: RouteOutput) => ({ ...output, shortAssessment: "录取概率 90%" })],
    [
      "grounding",
      (output: RouteOutput) => ({
        ...output,
        routeResult: { ...output.routeResult, confirmedFacts: ["虚构事实"] },
      }),
    ],
  ])("never calls fallback for exhausted %s failures", async (_name, makeInvalid) => {
    const validOutput = await makeValidExperienceOutput();
    const primary = { generate: vi.fn().mockResolvedValue(makeInvalid(validOutput)) };
    const fallback = { generate: vi.fn().mockResolvedValue(validOutput) };

    const result = await generateRouteOutput({
      routeKey: "experience_to_resume",
      input: sufficientExperienceInput,
      primary,
      fallback,
    });

    expect(result.outputType).toBe("friendly_failure");
    expect(primary.generate).toHaveBeenCalledTimes(2);
    expect(fallback.generate).not.toHaveBeenCalled();
  });

  it.each([
    [
      "safety then model JSON",
      (output: RouteOutput) => ({ ...output, shortAssessment: "match rate 90%" }),
      "model_json" as const,
    ],
    [
      "model JSON then safety",
      (output: RouteOutput) => ({ ...output, shortAssessment: "match rate 90%" }),
      "model_json" as const,
    ],
  ])(
    "does not call fallback after mixed primary failures: %s",
    async (_name, makeSafetyFailure, machineFailure) => {
      const validOutput = await makeValidExperienceOutput();
      const primary = {
        generate:
          _name === "safety then model JSON"
            ? vi.fn().mockResolvedValueOnce(makeSafetyFailure(validOutput)).mockRejectedValueOnce(new AiProviderError(machineFailure))
            : vi.fn().mockRejectedValueOnce(new AiProviderError(machineFailure)).mockResolvedValueOnce(makeSafetyFailure(validOutput)),
      };
      const fallback = { generate: vi.fn().mockResolvedValue(validOutput) };

      const result = await generateRouteOutput({
        routeKey: "experience_to_resume",
        input: sufficientExperienceInput,
        primary,
        fallback,
      });

      expect(result.outputType).toBe("friendly_failure");
      expect(primary.generate).toHaveBeenCalledTimes(2);
      expect(fallback.generate).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["Zod", () => ({ broken: true }) as unknown as RouteOutput],
    ["route", (output: RouteOutput) => ({ ...output, routeKey: "jd_to_revision" }) as RouteOutput],
    [
      "action",
      (output: RouteOutput) => ({
        ...output,
        todayAction: { ...output.todayAction, estimatedTime: "later" },
      }),
    ],
    ["safety", (output: RouteOutput) => ({ ...output, shortAssessment: "适合你，匹配度 90%" })],
    [
      "grounding",
      (output: RouteOutput) => ({
        ...output,
        routeResult: { ...output.routeResult, supportingFacts: ["fallback 虚构事实"] },
      }),
    ],
  ])("validates fallback output through %s checks", async (_name, makeInvalidFallback) => {
    const validOutput = await makeValidExperienceOutput();
    const primary = { generate: vi.fn().mockRejectedValue(new AiProviderError("transport")) };
    const fallback = { generate: vi.fn().mockResolvedValue(makeInvalidFallback(validOutput)) };

    const result = await generateRouteOutput({
      routeKey: "experience_to_resume",
      input: sufficientExperienceInput,
      primary,
      fallback,
    });

    expect(result.outputType).toBe("friendly_failure");
    expect(primary.generate).toHaveBeenCalledTimes(2);
    expect(fallback.generate).toHaveBeenCalledTimes(1);
  });

  it("never exceeds two primary calls plus one fallback call", async () => {
    const primary = { generate: vi.fn().mockRejectedValue(new AiProviderError("transport")) };
    const fallback = { generate: vi.fn().mockRejectedValue(new AiProviderError("retryable_http", "5xx")) };

    const result = await generateRouteOutput({
      routeKey: "experience_to_resume",
      input: sufficientExperienceInput,
      primary,
      fallback,
    });

    expect(result.outputType).toBe("friendly_failure");
    expect(primary.generate).toHaveBeenCalledTimes(2);
    expect(fallback.generate).toHaveBeenCalledTimes(1);
  });

  it("does not call any model for missing or placeholder input", async () => {
    const primary = { generate: vi.fn() };
    const fallback = { generate: vi.fn() };

    const result = await generateRouteOutput({
      routeKey: "experience_to_resume",
      input: {
        targetDirection: "运营",
        rawExperience: "社团经历",
        actualActions: "还没整理",
        deliverableOrResult: "暂无",
      },
      primary,
      fallback,
    });

    expect(result.outputType).toBe("missing_info");
    expect(primary.generate).not.toHaveBeenCalled();
    expect(fallback.generate).not.toHaveBeenCalled();
  });

  it("reports only allowlisted diagnostics and keeps internal stages and codes out of user output", async () => {
    const events: Array<Record<string, unknown>> = [];
    const sensitiveValue = "secret input and prompt value";
    const primary = {
      generate: vi.fn()
        .mockRejectedValueOnce(new AiProviderError("retryable_http", "5xx"))
        .mockRejectedValueOnce(new AiProviderError("retryable_http", "5xx")),
    };
    const fallback = { generate: vi.fn().mockResolvedValue({ broken: sensitiveValue }) };

    const result = await generateRouteOutput({
      routeKey: "experience_to_resume",
      input: { ...sufficientExperienceInput, rawExperience: sensitiveValue },
      primary,
      fallback,
      requestId: "request-123",
      reporter: {
        report: (event) => {
          events.push(event);
        },
      },
    });

    const allowedKeys = new Set([
      "requestId",
      "routeKey",
      "mode",
      "providerRole",
      "attempt",
      "stage",
      "code",
      "durationBucket",
      "schemaPaths",
      "httpStatusClass",
    ]);
    expect(events.length).toBe(3);
    for (const event of events) {
      expect(Object.keys(event).every((key) => allowedKeys.has(key))).toBe(true);
    }
    expect(JSON.stringify(events)).not.toMatch(/secret input|prompt value|Authorization|Bearer|api\.example|stack/i);
    expect(JSON.stringify(result)).not.toMatch(
      /provider_http|retryable_http|candidate_schema|schema|fallback|transport|stage|code/i,
    );
  });

  it("replaces an external requestId containing sensitive material with one safe internal id", async () => {
    const events: Array<Record<string, unknown>> = [];
    const externalRequestId = "request?token=secret-test-key Authorization=Bearer-sensitive-value";
    const primary = { generate: vi.fn().mockRejectedValue(new AiProviderError("retryable_http", "5xx")) };

    await generateRouteOutput({
      routeKey: "experience_to_resume",
      input: sufficientExperienceInput,
      primary,
      requestId: externalRequestId,
      reporter: {
        report: (event) => {
          events.push(event);
        },
      },
    });

    expect(events).toHaveLength(2);
    const diagnosticRequestIds = events.map((event) => event.requestId);
    expect(new Set(diagnosticRequestIds).size).toBe(1);
    expect(diagnosticRequestIds[0]).toMatch(/^[a-zA-Z0-9-]{1,64}$/);
    expect(JSON.stringify(events)).not.toMatch(/secret-test-key|Bearer-sensitive-value|Authorization|\?token=/i);
    expect(diagnosticRequestIds).not.toContain(externalRequestId);
  });
});
