import { beforeEach, describe, expect, it } from "vitest";
import {
  clearRecords,
  deleteRecord,
  loadHomeProgress,
  loadLatestReview,
  loadCurrentAction,
  loadDraft,
  loadRecords,
  markReviewSaved,
  mergeDraft,
  saveCurrentAction,
  saveDraft,
  saveRecord,
  saveReview,
  updateRecord,
} from "@/lib/local-store";
import type { RouteOutput } from "@/domain/types";

const routeOutput: RouteOutput = {
  routeKey: "jd_to_revision",
  outputType: "route_result",
  shortAssessment: "先看 JD 和材料的支撑关系。",
  routeResult: {},
  missingInfo: null,
  todayAction: {
    actionTitle: "今天先对照 JD 做 1 条投递前最小修改",
    actionReason: "先改最能支撑 JD 的一处表达。",
    actionSteps: ["圈出 JD 的 1 条关键要求", "找到材料里对应经历", "补 1 个真实动作"],
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

describe("local record storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("saves records locally and removes one record by id", () => {
    const first = saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "Confirm real actions",
      actualDone: "Listed three real actions.",
      payload: { actualActions: "planned topics", deliverable: "posts" },
      userConfirmed: true,
    });
    saveRecord({
      routeKey: "jd_to_revision",
      recordType: "jd_compare",
      actionTitle: "Save a JD",
      actualDone: "Saved one JD.",
      payload: { targetJobTitle: "operations intern" },
      userConfirmed: true,
    });

    deleteRecord(first.id);

    expect(loadRecords()).toHaveLength(1);
    expect(loadRecords()[0].actionTitle).toBe("Save a JD");
  });

  it("clears all local records", () => {
    saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "Confirm real actions",
      actualDone: "Listed three real actions.",
      payload: {},
      userConfirmed: true,
    });

    clearRecords();

    expect(loadRecords()).toEqual([]);
  });

  it("updates one local record", () => {
    const record = saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "Confirm real actions",
      actualDone: "Draft content.",
      payload: { actualActions: "draft" },
      userConfirmed: true,
    });

    updateRecord(record.id, { actualDone: "Edited content.", payload: { actualActions: "edited" } });

    expect(loadRecords()[0].actualDone).toBe("Edited content.");
    expect(loadRecords()[0].payload.actualActions).toBe("edited");
  });

  it("merges completed missing-info payloads back into the route draft", () => {
    saveDraft("jd_to_revision", {
      targetJobTitle: "产品运营实习",
      userMaterial: "社团活动经历",
    });

    mergeDraft("jd_to_revision", {
      jdTextOrRequirements: "负责用户调研、数据整理、活动复盘",
    });

    expect(loadDraft("jd_to_revision")).toEqual({
      targetJobTitle: "产品运营实习",
      userMaterial: "社团活动经历",
      jdTextOrRequirements: "负责用户调研、数据整理、活动复盘",
    });
  });

  it("tracks the return-home loop from current action to record and linked review", () => {
    const action = saveCurrentAction(routeOutput);

    expect(loadHomeProgress()).toMatchObject({
      hasUnfinishedAction: true,
      progressLabel: "第 1 次推进",
    });

    const record = saveRecord({
      actionId: action.actionId,
      routeKey: action.routeKey,
      recordType: "jd_compare",
      actionTitle: action.todayAction.actionTitle,
      actualDone: "改完 JD 相关的一句话。",
      payload: { afterSnippet: "补了一个真实动作" },
      userConfirmed: true,
    });

    expect(loadHomeProgress()).toMatchObject({
      hasUnfinishedAction: false,
      latestRecord: expect.objectContaining({ id: record.id }),
      latestReview: null,
      progressLabel: "已保存 1 次推进",
    });

    const review = saveReview({
      basedOnRecordIds: [record.id],
      routeKey: record.routeKey,
      reviewBasis: [record.actualDone],
      clues: ["这条修改可以继续用在投递前材料版本里。"],
      missingInfo: ["还缺投递后的反馈。"],
      nextAction: "下一步先记录这次投递使用的材料版本。",
    });

    expect(loadLatestReview()).toMatchObject({ id: review.id });
    markReviewSaved(review.id);
    expect(loadHomeProgress()).toMatchObject({
      latestRecord: expect.objectContaining({ id: record.id }),
      latestReview: expect.objectContaining({ id: review.id }),
    });
  });

  it("migrates older saved current actions and still links later records by action id", () => {
    window.localStorage.setItem("mvp-current-action", JSON.stringify(routeOutput));

    const migrated = loadCurrentAction();

    expect(migrated).toMatchObject({
      actionId: expect.any(String),
      actionCreatedAt: expect.any(String),
      todayAction: expect.objectContaining({ actionTitle: routeOutput.todayAction.actionTitle }),
    });

    saveRecord({
      actionId: migrated?.actionId,
      routeKey: "jd_to_revision",
      recordType: "jd_compare",
      actionTitle: routeOutput.todayAction.actionTitle,
      actualDone: "补完了一处投递前修改。",
      payload: { afterSnippet: "修改后片段" },
      userConfirmed: true,
    });

    expect(loadHomeProgress().hasUnfinishedAction).toBe(false);
  });
});
