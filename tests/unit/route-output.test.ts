import { describe, expect, it } from "vitest";
import {
  ROUTE_OUTPUT_LIMITS,
  routeOutputSchema,
} from "@/schemas/route-output";

function validDirectionOutput() {
  return {
    routeKey: "direction_to_jobs" as const,
    outputType: "route_result" as const,
    shortAssessment: "先用真实岗位样本验证方向。",
    routeResult: {
      explorableDirections: [
        {
          directionName: "内容运营实习",
          searchKeywords: ["内容运营 实习生"],
          basisFromUserMaterial: ["整理过社团活动素材"],
          riskOrGap: "还缺真实 JD 样本。",
          validationFocus: "先查看岗位的实际交付物。",
        },
        {
          directionName: "用户运营实习",
          searchKeywords: ["用户运营 实习生"],
          basisFromUserMaterial: ["整理过社团报名信息"],
          riskOrGap: "还缺用户沟通场景。",
          validationFocus: "先查看岗位的沟通职责。",
        },
      ],
    },
    missingInfo: null,
    todayAction: {
      actionTitle: "保存一个真实岗位样本",
      actionReason: "用真实 JD 验证方向。",
      actionSteps: ["搜索并打开一个岗位"],
      estimatedTime: "15-30 分钟",
      recordAfterDone: "记录岗位和 JD 摘要。",
      actionType: "job_sample" as const,
    },
    recordGuide: {
      recordType: "job_sample" as const,
      fieldsToRecord: ["jobTitle"],
      requiresUserConfirmation: true,
    },
  };
}

describe("route output size limits", () => {
  it.each([
    [1, false],
    [2, true],
    [3, true],
    [4, false],
  ])(
    "accepts only two or three explorable job families (received %i)",
    (count, expected) => {
      const output = validDirectionOutput();
      const directions = Array.from({ length: count }, (_, index) => ({
        ...output.routeResult.explorableDirections[index % 2],
        directionName: `岗位族${index + 1}`,
      }));

      expect(routeOutputSchema.safeParse({
        ...output,
        routeResult: { explorableDirections: directions },
      }).success).toBe(expected);
    },
  );

  it("accepts a short field exactly at its boundary and rejects one extra character", () => {
    const output = validDirectionOutput();
    expect(routeOutputSchema.safeParse({
      ...output,
      todayAction: {
        ...output.todayAction,
        actionTitle: "岗".repeat(ROUTE_OUTPUT_LIMITS.shortText),
      },
    }).success).toBe(true);
    expect(routeOutputSchema.safeParse({
      ...output,
      todayAction: {
        ...output.todayAction,
        actionTitle: "岗".repeat(ROUTE_OUTPUT_LIMITS.shortText + 1),
      },
    }).success).toBe(false);
  });

  it("rejects an aggregate route result over the visible-character budget without truncating facts", () => {
    const output = validDirectionOutput();
    const fact = "真实事实".repeat(450);
    const factsPerDirection = 4;
    const directionCount = 3;
    const basisFromUserMaterial = Array.from({ length: factsPerDirection }, () => fact);
    const parsed = routeOutputSchema.safeParse({
      ...output,
      routeResult: {
        explorableDirections: Array.from({ length: directionCount }, (_, index) => ({
          ...output.routeResult.explorableDirections[0],
          directionName: `内容运营${index + 1}`,
          basisFromUserMaterial,
        })),
      },
    });

    expect(parsed.success).toBe(false);
    expect(fact).toHaveLength(1_800);
    expect(basisFromUserMaterial).toHaveLength(4);
    expect(directionCount * factsPerDirection * fact.length)
      .toBeGreaterThan(ROUTE_OUTPUT_LIMITS.routeResultTotalCharacters);
  });
});
