import { describe, expect, it } from "vitest";
import { validateRouteOutput } from "@/domain/action-card";
import type { RouteKey, RouteOutput } from "@/domain/types";

const routeCases: Array<{ routeKey: RouteKey; actionType: RouteOutput["todayAction"]["actionType"] }> = [
  { routeKey: "direction_to_jobs", actionType: "job_sample" },
  { routeKey: "experience_to_resume", actionType: "experience_fact" },
  { routeKey: "jd_to_revision", actionType: "jd_revision" },
  { routeKey: "applications_to_review", actionType: "application_record" },
];

describe("AI output quality gate", () => {
  it("rejects report-style fallback outputs for every route", () => {
    for (const route of routeCases) {
      const result = validateRouteOutput(
        makeOutput(route.routeKey, route.actionType, {
          shortAssessment: "这里先生成一份基础版报告兜底，帮助你全面判断方向。",
          routeResult: {
            reportTitle: "基础版求职分析报告",
            sections: ["方向判断", "简历建议", "投递策略"],
          },
        }),
      );

      expect(result.passed).toBe(false);
      expect(result.issues).toContain("第一版 MVP 不生成基础版报告或完整报告");
    }
  });

  it("rejects vague actions that cannot be done as one concrete 15-30 minute step", () => {
    const result = validateRouteOutput(
      makeOutput("experience_to_resume", "experience_fact", {
        todayAction: {
          actionTitle: "全面提升简历竞争力",
          actionReason: "这样可以增强你的求职优势。",
          actionSteps: ["完善简历", "提升表达", "继续优化"],
          estimatedTime: "15-30 分钟",
          recordAfterDone: "记录优化情况。",
          actionType: "experience_fact",
        },
      }),
    );

    expect(result.passed).toBe(false);
    expect(result.issues).toContain("今日行动过于空泛，必须能被用户直接执行和记录");
  });
});

function makeOutput(
  routeKey: RouteKey,
  actionType: RouteOutput["todayAction"]["actionType"],
  overrides: Partial<RouteOutput>,
): RouteOutput {
  const base: RouteOutput = {
    routeKey,
    outputType: "route_result",
    shortAssessment: "先把当前信息整理成一个今天能做的小行动。",
    routeResult: {
      basis: ["用户已提供真实材料"],
    },
    missingInfo: null,
    todayAction: {
      actionTitle: "今天先保存 1 条真实记录",
      actionReason: "有真实记录后，后续复盘才可靠。",
      actionSteps: ["打开当前材料", "复制 1 条真实信息", "保存到记录里"],
      estimatedTime: "15-30 分钟",
      recordAfterDone: "记录这条真实信息。",
      actionType,
    },
    recordGuide: {
      recordType: actionType === "jd_revision" ? "jd_compare" : actionType,
      fieldsToRecord: ["note"],
      requiresUserConfirmation: true,
    },
  };

  return {
    ...base,
    ...overrides,
    todayAction: {
      ...base.todayAction,
      ...overrides.todayAction,
    },
  };
}
