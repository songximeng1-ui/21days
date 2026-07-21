import { beforeEach, describe, expect, it } from "vitest";
import { generateLightReviewOutput } from "@/ai/orchestrator";
import { MockAiProvider } from "@/ai/mock-provider";
import { validateRouteOutput } from "@/domain/action-card";
import { loadLatestReview, saveReview, type LocalRecord } from "@/lib/local-store";

const record: LocalRecord = {
  id: "record-1",
  routeKey: "applications_to_review",
  recordType: "application",
  actionTitle: "今天先选择 1 条投递记录补齐材料版本",
  actualDone: "补了内容运营实习、A 公司、7 月 1 日投递、暂无反馈。",
  payload: {
    jobTitle: "内容运营实习",
    companyOrPlatform: "A 公司",
    submittedAt: "7 月 1 日",
    feedbackStatus: "暂无反馈",
  },
  userConfirmed: true,
  createdAt: "2026-07-21T00:00:00.000Z",
};

describe("light review workflow", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("rejects light review outputs without the four review blocks", () => {
    const result = validateRouteOutput({
      routeKey: "applications_to_review",
      outputType: "light_review",
      shortAssessment: "这条记录可以复盘。",
      routeResult: {
        clue: "缺少固定结构",
      },
      missingInfo: null,
      todayAction: {
        actionTitle: "下次先补材料版本",
        actionReason: "补完材料版本后更容易复盘。",
        actionSteps: ["打开记录", "补材料版本", "保存修改"],
        estimatedTime: "15-30 分钟",
        recordAfterDone: "记录材料版本。",
        actionType: "fill_info",
      },
      recordGuide: {
        recordType: "fill_info",
        fieldsToRecord: ["materialVersion"],
        requiresUserConfirmation: true,
      },
    });

    expect(result.passed).toBe(false);
    expect(result.issues).toContain("轻复盘必须包含复盘依据、线索、信息缺口和下一步行动");
  });

  it("generates a light review from a confirmed local record", async () => {
    const output = await generateLightReviewOutput({
      record,
      provider: new MockAiProvider("success"),
    });

    expect(output.outputType).toBe("light_review");
    expect(output.routeResult?.reviewBasis).toEqual(expect.arrayContaining([record.actualDone]));
    expect(output.todayAction.actionSteps.length).toBeGreaterThan(0);
    expect(JSON.stringify(output)).not.toMatch(/You moved|Next time|基础版报告|匹配度/);
  });

  it("saves and loads the latest light review locally", () => {
    const review = saveReview({
      basedOnRecordIds: [record.id],
      routeKey: record.routeKey,
      reviewBasis: [record.actualDone],
      clues: ["这条记录已经包含岗位、公司和投递时间。"],
      missingInfo: ["还缺材料版本。"],
      nextAction: "下次先补这条投递使用的材料版本。",
      aiGenerated: true,
      userSaved: false,
    });

    expect(loadLatestReview()?.id).toBe(review.id);
    expect(loadLatestReview()?.basedOnRecordIds).toEqual([record.id]);
    expect(loadLatestReview()?.aiGenerated).toBe(true);
    expect(loadLatestReview()?.userSaved).toBe(false);
  });
});
