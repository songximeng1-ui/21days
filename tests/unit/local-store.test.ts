import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAllLocalData,
  clearRecords,
  deleteRecord,
  loadHomeProgress,
  loadLatestReview,
  loadCurrentAction,
  loadDraft,
  loadRecords,
  markReviewSaved,
  mergeDraft,
  runLocalStoreTransaction,
  saveCurrentAction,
  saveDraft,
  saveRecord,
  saveReview,
  savePastSevenDayReview,
  updateRecord,
} from "@/lib/local-store";
import type { RouteOutput } from "@/domain/types";
import { withTestProvenance } from "../helpers/test-provenance";

const routeOutput: RouteOutput = withTestProvenance({
  routeKey: "jd_to_revision",
  outputType: "route_result",
  shortAssessment: "先看 JD 和材料的支撑关系。",
  routeResult: {
    decision: "modify",
    requirementsChecked: ["内容整理"],
    modifications: [{
      requirementQuote: "内容整理",
      materialQuotes: ["整理过报名表"],
      revisionTarget: "社团经历原句",
      candidateRevision: "整理活动报名表。",
      reason: "把已有动作写清楚。",
    }],
    evidenceRequest: null,
    jdKeyRequirements: ["内容整理"],
    supportedByMaterial: ["整理过报名表"],
    unclearFromMaterial: ["没有量化结果"],
    minimalRevisionActions: ["补充整理报名表这一真实动作"],
    afterSubmissionRecording: ["记录岗位、公司、时间和反馈"],
  },
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
  provenance: {
    shortAssessment: {
      kind: "fact",
      sources: [{ sourceType: "user_input", path: "testFixture", quote: "test" }],
    },
  },
});

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

  it("clears records, every route draft, current action, and reviews together", () => {
    saveDraft("jd_to_revision", { userMaterial: "敏感简历片段" });
    saveDraft("applications_to_review", { jobTitle: "敏感投递岗位" });
    saveCurrentAction(routeOutput);
    const record = saveRecord({
      routeKey: "jd_to_revision",
      recordType: "jd_compare",
      actionTitle: "敏感行动",
      actualDone: "敏感完成内容",
      payload: { afterSnippet: "敏感修改后片段" },
      userConfirmed: true,
    });
    saveReview({
      basedOnRecordIds: [record.id],
      routeKey: "jd_to_revision",
      reviewBasis: ["敏感复盘依据"],
      clues: ["敏感线索"],
      missingInfo: ["敏感缺口"],
      nextAction: "敏感下一步",
    });

    clearAllLocalData();

    expect(loadRecords()).toEqual([]);
    expect(loadDraft("jd_to_revision")).toEqual({});
    expect(loadDraft("applications_to_review")).toEqual({});
    expect(loadCurrentAction()).toBeNull();
    expect(loadLatestReview()).toBeNull();
    expect(loadHomeProgress()).toMatchObject({
      currentAction: null,
      latestRecord: null,
      latestReview: null,
      hasUnfinishedAction: false,
      progressLabel: "第 1 天",
    });
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

  it("rejects editing a confirmed application below the shared review sufficiency rule", () => {
    const record = saveRecord({
      routeKey: "applications_to_review",
      recordType: "application",
      actionTitle: "保存投递记录",
      actualDone: "保存了一条完整投递记录。",
      payload: {
        jobTitle: "内容运营实习",
        companyOrPlatform: "A 公司",
        submittedAt: "7 月 1 日",
        feedbackStatus: "暂无反馈",
        jdSummary: "负责内容整理",
        materialVersion: "社团经历版",
      },
      userConfirmed: true,
    });

    expect(updateRecord(record.id, {
      payload: { ...record.payload, materialVersion: "" },
      userConfirmed: true,
    })).toBeNull();
    expect(loadRecords()[0].payload.materialVersion).toBe("社团经历版");
  });

  it("ignores draft and stale records when deriving home progress", () => {
    const action = saveCurrentAction(routeOutput);
    saveRecord({
      actionId: action.actionId,
      routeKey: "jd_to_revision",
      recordType: "jd_compare",
      actionTitle: "未确认行动",
      actualDone: "尚未确认。",
      payload: { afterSnippet: "草稿" },
      userConfirmed: false,
    });

    expect(loadHomeProgress()).toMatchObject({
      latestRecord: null,
      hasUnfinishedAction: true,
    });
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
      progressLabel: "第 1 天",
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
      progressLabel: "第 1 天",
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

  it("rejects a persisted current action whose route and action schemas disagree", () => {
    window.localStorage.setItem(
      "mvp-current-action",
      JSON.stringify({
        ...routeOutput,
        todayAction: {
          ...routeOutput.todayAction,
          actionType: "application_record",
        },
        recordGuide: {
          ...routeOutput.recordGuide,
          recordType: "application",
        },
      }),
    );

    expect(loadCurrentAction()).toBeNull();
  });
});

describe("seven-day review", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it.each([
    [
      "direction_to_jobs",
      "job_sample",
      { jobTitle: "内容运营实习", companyOrPlatform: "A 公司", jdSummary: "内容整理" },
      "再保存 1 个真实岗位样本，核对重复出现的岗位要求。",
      "还缺更多真实岗位样本来验证方向。",
    ],
    [
      "experience_to_resume",
      "experience_fact",
      { actualActions: "整理报名表", deliverable: "报名名单" },
      "再核对 1 段真实经历，补清动作或交付物。",
      "还可补充这段经历的对象、动作或交付物。",
    ],
    [
      "jd_to_revision",
      "jd_compare",
      { beforeSnippet: "协助活动", afterSnippet: "整理报名表", jdRequirement: "数据记录" },
      "再核对 1 条岗位要求与材料表述。",
      "还需记录这次修改后的真实投递或反馈。",
    ],
  ] as const)(
    "keeps the %s weekly next step inside its route",
    (routeKey, recordType, payload, nextAction, missingInfo) => {
      saveRecord({
        routeKey,
        recordType,
        actionTitle: "完成一件真实行动",
        actualDone: "保存了一条可核对记录。",
        payload,
        userConfirmed: true,
      });

      const review = savePastSevenDayReview();

      expect(review).toMatchObject({
        routeKey,
        nextAction,
        missingInfo: [missingInfo],
      });
    },
  );

  it("keeps all five weekly review blocks and chooses one next action from the latest route in mixed records", () => {
    saveRecord({
      actionId: "direction-action",
      routeKey: "direction_to_jobs",
      recordType: "job_sample",
      actionTitle: "保存岗位样本",
      actualDone: "保存了一个真实岗位样本。",
      payload: {
        jobTitle: "内容运营实习",
        companyOrPlatform: "A 公司",
        jdSummary: "负责内容整理",
      },
      userConfirmed: true,
    });
    saveRecord({
      actionId: "jd-action",
      routeKey: "jd_to_revision",
      recordType: "jd_compare",
      actionTitle: "核对岗位要求",
      actualDone: "完成了一处投递前修改。",
      payload: {
        beforeSnippet: "协助活动",
        afterSnippet: "整理活动报名表",
        jdRequirement: "数据记录",
      },
      userConfirmed: true,
    });

    const review = savePastSevenDayReview();

    expect(review).toMatchObject({
      routeKey: "jd_to_revision",
      actionTitles: ["核对岗位要求", "保存岗位样本"],
      reviewBasis: ["完成了一处投递前修改。", "保存了一个真实岗位样本。"],
      missingInfo: ["还需记录这次修改后的真实投递或反馈。"],
      nextAction: "再核对 1 条岗位要求与材料表述。",
    });
    expect(review?.clues).toEqual([
      "过去 7 天完成了 2 次真实推进",
      "留下了 2 条确认记录",
      "这些记录来自 2 条求职路径",
    ]);
    expect(review?.nextAction).toEqual(expect.any(String));
  });

  it("asks for another application only when fewer than two complete records exist", () => {
    const completeApplication = {
      companyOrPlatform: "A 公司",
      submittedAt: "7 月 1 日",
      feedbackStatus: "暂无反馈",
      jdSummary: "负责内容整理",
      materialVersion: "社团经历版",
    };
    saveRecord({
      routeKey: "applications_to_review",
      recordType: "application",
      actionTitle: "确认投递记录",
      actualDone: "确认了内容运营实习投递。",
      payload: { ...completeApplication, jobTitle: "内容运营实习" },
      userConfirmed: true,
    });

    expect(savePastSevenDayReview()).toMatchObject({
      missingInfo: ["还需要第 2 条完整投递记录。"],
      nextAction: "补齐第 2 条真实投递记录后再回看。",
    });

    saveRecord({
      routeKey: "applications_to_review",
      recordType: "application",
      actionTitle: "确认投递记录",
      actualDone: "确认了新媒体运营实习投递。",
      payload: {
        ...completeApplication,
        jobTitle: "新媒体运营实习",
        companyOrPlatform: "B 公司",
      },
      userConfirmed: true,
    });

    expect(savePastSevenDayReview()).toMatchObject({
      missingInfo: ["还缺后续真实反馈来验证目前的线索。"],
      nextAction: "选 1 条投递记录，写下 1 个需要后续反馈验证的问题。",
    });
  });

  it("deduplicates action titles and review basis for records from the same action", () => {
    saveRecord({
      actionId: "same-action",
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "整理真实经历",
      actualDone: "核对了报名经历。",
      payload: { actualActions: "整理报名表" },
      userConfirmed: true,
    });
    saveRecord({
      actionId: "same-action",
      routeKey: "experience_to_resume",
      recordType: "resume_snippet",
      actionTitle: "简历片段版本",
      actualDone: "确认了片段。",
      payload: { resumeSnippet: "整理报名表。" },
      userConfirmed: true,
    });

    const review = savePastSevenDayReview();

    expect(review?.actionTitles).toEqual(["简历片段版本"]);
    expect(review?.reviewBasis).toEqual(["确认了片段。"]);
  });

  it("restores all MVP local data when a multi-step local write fails", () => {
    window.localStorage.setItem("mvp-records", JSON.stringify([{ id: "before" }]));
    window.localStorage.setItem("mvp-draft:jd_to_revision", JSON.stringify({ before: "yes" }));

    expect(() =>
      runLocalStoreTransaction(() => {
        window.localStorage.setItem("mvp-records", JSON.stringify([{ id: "partial" }]));
        window.localStorage.setItem("mvp-draft:jd_to_revision", JSON.stringify({ before: "no" }));
        throw new Error("second write failed");
      }),
    ).toThrow("second write failed");

    expect(window.localStorage.getItem("mvp-records")).toBe(JSON.stringify([{ id: "before" }]));
    expect(window.localStorage.getItem("mvp-draft:jd_to_revision")).toBe(
      JSON.stringify({ before: "yes" }),
    );
  });

  it("saves an action and journey atomically and reuses the same action for one idempotency key", () => {
    const first = saveCurrentAction(routeOutput, {
      clientRequestId: "11111111-1111-4111-8111-111111111111",
      draftRevision: 4,
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
    });
    const second = saveCurrentAction(
      {
        ...routeOutput,
        shortAssessment: "迟到的重复回包不应覆盖第一次保存。",
      },
      {
        clientRequestId: "11111111-1111-4111-8111-111111111111",
        draftRevision: 4,
        idempotencyKey: "22222222-2222-4222-8222-222222222222",
      },
    );

    expect(second.actionId).toBe(first.actionId);
    expect(second.shortAssessment).toBe(routeOutput.shortAssessment);
    expect(loadCurrentAction()).toMatchObject({
      actionId: first.actionId,
      clientRequestId: "11111111-1111-4111-8111-111111111111",
      draftRevision: 4,
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("rolls back the newly started journey when saving its first action fails", () => {
    const originalSetItem = Storage.prototype.setItem;
    let failed = false;
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === "mvp-current-action" && !failed) {
        failed = true;
        throw new Error("quota");
      }
      return originalSetItem.call(this, key, value);
    });

    expect(() => saveCurrentAction(routeOutput, {
      clientRequestId: "11111111-1111-4111-8111-111111111111",
      draftRevision: 0,
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
    })).toThrow("quota");
    spy.mockRestore();

    expect(window.localStorage.getItem("mvp-current-action")).toBeNull();
    expect(window.localStorage.getItem("mvp-journey")).toBeNull();
  });
});
