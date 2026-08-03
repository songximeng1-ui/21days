import { describe, expect, it } from "vitest";
import { routeOutputSchema } from "@/schemas/route-output";
import { validateRouteOutput } from "@/domain/action-card";
import type { RouteOutput } from "@/domain/types";

function makeDirectionOutput(directionCount: number, keywordCount: number) {
  const candidate = {
    routeKey: "direction_to_jobs",
    outputType: "route_result",
    shortAssessment: "可以先把方向落到岗位样本。",
    routeResult: {
      explorableDirections: Array.from({ length: directionCount }, (_, directionIndex) => ({
        directionName: `方向 ${directionIndex + 1}`,
        searchKeywords: Array.from({ length: keywordCount }, (_, keywordIndex) =>
          `方向${directionIndex + 1}关键词${keywordIndex + 1}`),
        basisFromUserMaterial: ["整理社团报名信息"],
        riskOrGap: "还缺真实 JD 样本验证",
        validationFocus: "观察岗位要求里的工具和交付物",
      })),
    },
    missingInfo: null,
    todayAction: {
      actionTitle: "今天先保存 1-3 个真实岗位样本",
      actionReason: "先用真实 JD 验证方向。",
      actionSteps: ["搜索一个关键词", "保存岗位要求摘要"],
      estimatedTime: "15-30 分钟",
      recordAfterDone: "记录岗位名称、JD 摘要和担心点。",
      actionType: "job_sample",
    },
    recordGuide: {
      recordType: "job_sample",
      fieldsToRecord: ["jobTitle", "companyOrPlatform", "jdSummary", "interestPoint", "concernPoint"],
      requiresUserConfirmation: true,
    },
  };
  return directionCount >= 2 && directionCount <= 3
    ? routeOutputSchema.parse(candidate)
    : candidate as RouteOutput;
}

describe("route output contract", () => {
  it("rejects an oversized visible model field before it reaches storage", () => {
    const output = makeDirectionOutput(2, 2);

    expect(
      routeOutputSchema.safeParse({
        ...output,
        shortAssessment: "过".repeat(2_001),
      }).success,
    ).toBe(false);
  });

  it("accepts one grounded today action", () => {
    const output = routeOutputSchema.parse({
      routeKey: "experience_to_resume",
      outputType: "route_result",
      shortAssessment: "The experience has enough concrete actions to organize first.",
      routeResult: {
        confirmedFacts: ["planned topics and edited posts"],
        missingFacts: ["audience is still unclear"],
        doNotExaggerate: ["do not claim ownership of the whole account"],
        resumeSnippetDraft: "Supported student club content work by planning topics, editing, and publishing posts.",
        supportingFacts: ["planned topics", "edited posts", "published posts"],
      },
      missingInfo: null,
      todayAction: {
        actionTitle: "Confirm 3 actions you actually did in this experience",
        actionReason: "The facts need clear boundaries before saving a resume snippet.",
        actionSteps: ["Open the original material", "List 3 real actions", "Remove claims you did not do"],
        estimatedTime: "15-30 minutes",
        recordAfterDone: "Record the actions, deliverable, and remaining uncertainty.",
        actionType: "experience_fact",
      },
      recordGuide: {
        recordType: "experience_fact",
        fieldsToRecord: ["actualActions", "deliverable", "missingFacts"],
        requiresUserConfirmation: true,
      },
    });

    expect(validateRouteOutput(output)).toEqual({ passed: true, issues: [] });
  });

  it("rejects an action framed as multiple separate tasks", () => {
    const valid = makeDirectionOutput(2, 3);
    const output: RouteOutput = {
      ...valid,
      todayAction: {
        actionTitle: "Finish three job-search tasks today",
        actionReason: "Direction, resume, and applications all matter.",
        actionSteps: ["Find 3 jobs", "Rewrite the full resume", "Apply to 10 jobs"],
        estimatedTime: "15-30 minutes",
        recordAfterDone: "Record the jobs.",
        actionType: "job_sample",
      },
    };

    expect(validateRouteOutput(output).passed).toBe(false);
  });

  it("rejects JD route output that misses route-specific support fields", () => {
    const candidate = {
      routeKey: "jd_to_revision",
      outputType: "route_result",
      shortAssessment: "这里先看材料和 JD 的支撑关系。",
      routeResult: {
        genericAdvice: ["改一下简历"],
      },
      missingInfo: null,
      todayAction: {
        actionTitle: "今天先对照 JD 做 1 条投递前最小修改",
        actionReason: "先改最能支撑 JD 的一处表达。",
        actionSteps: ["圈出 JD 的 1 条关键要求", "补 1 个真实动作"],
        estimatedTime: "15-30 分钟",
        recordAfterDone: "记录修改前后片段。",
        actionType: "jd_revision",
      },
      recordGuide: {
        recordType: "jd_compare",
        fieldsToRecord: ["beforeSnippet", "afterSnippet"],
        requiresUserConfirmation: true,
      },
    };

    expect(routeOutputSchema.safeParse(candidate).success).toBe(false);
  });

  it("rejects direction route output without explorable directions and search keywords", () => {
    const valid = makeDirectionOutput(2, 3);
    const output: RouteOutput = {
      ...valid,
      routeResult: {
        explorableDirections: [],
      },
    };

    expect(validateRouteOutput(output).passed).toBe(false);
  });

  it.each([1, 4])("rejects direction route output with %i direction items", (directionCount) => {
    expect(validateRouteOutput(makeDirectionOutput(directionCount, 3)).passed).toBe(false);
  });

  it.each([2, 6])("rejects direction route output with %i keywords per direction", (keywordCount) => {
    expect(validateRouteOutput(makeDirectionOutput(2, keywordCount)).passed).toBe(false);
  });

  it.each([
    [2, 3],
    [3, 5],
  ])("accepts direction boundary with %i directions and %i keywords", (directionCount, keywordCount) => {
    expect(validateRouteOutput(makeDirectionOutput(directionCount, keywordCount))).toEqual({
      passed: true,
      issues: [],
    });
  });
});
