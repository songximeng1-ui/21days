import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteOutput } from "@/domain/types";
import { withTestProvenance } from "../helpers/test-provenance";
import {
  getConfirmedResumeSnippetTextForCopy,
  deleteRecord,
  getPastSevenDayRecords,
  loadConfirmedResumeSnippets,
  loadHomeProgress,
  loadJourneyState,
  loadRecords,
  loadReviews,
  saveCurrentAction,
  savePastSevenDayReview,
  saveRecord,
  saveReview,
  shrinkUnfinishedAction,
  updateRecord,
} from "@/lib/local-store";

const routeOutput: RouteOutput = withTestProvenance({
  routeKey: "direction_to_jobs",
  outputType: "route_result",
  shortAssessment: "先用真实岗位样本验证。",
  routeResult: {
    explorableDirections: [
      {
        directionName: "内容运营",
        searchKeywords: ["内容运营实习", "新媒体运营助理", "内容助理校招"],
        basisFromUserMaterial: ["整理过报名表"],
        riskOrGap: "还没有真实岗位样本",
        validationFocus: "岗位是否要求内容整理",
      },
      {
        directionName: "活动执行",
        searchKeywords: ["活动执行实习", "会展助理实习", "活动运营助理"],
        basisFromUserMaterial: ["协助过校园活动"],
        riskOrGap: "还没有真实岗位样本",
        validationFocus: "岗位是否要求现场执行",
      },
    ],
  },
  missingInfo: null,
  todayAction: {
    actionTitle: "今天先保存 1-3 个真实岗位样本",
    actionReason: "先验证岗位内容。",
    actionSteps: ["搜索 3 个岗位关键词", "保存 1-3 个看得懂的岗位"],
    estimatedTime: "15-30 分钟",
    recordAfterDone: "记录岗位名称和 3 条岗位要求。",
    actionType: "job_sample",
  },
  recordGuide: {
    recordType: "job_sample",
    fieldsToRecord: ["jobTitle", "companyOrPlatform", "jdSummary", "interestPoint", "concernPoint"],
    requiresUserConfirmation: true,
  },
  provenance: {
    shortAssessment: {
      kind: "fact",
      sources: [{ sourceType: "user_input", path: "testFixture", quote: "test" }],
    },
  },
});

describe("versioned records and journey state", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useRealTimers();
  });

  it("starts one 21-day journey and derives day, phase, and real progress separately", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T02:00:00.000Z"));
    const action = saveCurrentAction(routeOutput);

    const experience = saveRecord({
      actionId: action.actionId,
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "整理一段经历",
      actualDone: "整理了真实动作。",
      payload: { actualActions: "整理报名表" },
      userConfirmed: true,
    });
    saveRecord({
      actionId: action.actionId,
      routeKey: "experience_to_resume",
      recordType: "resume_snippet",
      actionTitle: "保存简历片段",
      actualDone: "保存了片段版本。",
      payload: { sourceExperienceId: experience.id, resumeSnippet: "整理报名信息。" },
      userConfirmed: true,
    });
    saveRecord({
      routeKey: "jd_to_revision",
      recordType: "fill_info",
      actionTitle: "补岗位要求",
      actualDone: "补充了岗位要求。",
      payload: { jdTextOrRequirements: "负责数据整理" },
      userConfirmed: true,
    });

    expect(loadJourneyState()).toMatchObject({
      journeyStartedAt: "2026-07-01T02:00:00.000Z",
      dayIndex: 1,
      phase: 1,
      progressCount: 1,
    });

    vi.setSystemTime(new Date("2026-07-08T02:00:00.000Z"));
    expect(loadJourneyState()).toMatchObject({
      journeyStartedAt: "2026-07-01T02:00:00.000Z",
      dayIndex: 8,
      phase: 2,
      progressCount: 1,
    });
  });

  it("stores completion, update time, status, and increments record version on edit", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T02:00:00.000Z"));
    const record = saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "整理一段经历",
      actualDone: "整理了真实动作。",
      payload: { actualActions: "整理报名表" },
      userConfirmed: true,
    });

    expect(record).toMatchObject({
      version: 1,
      status: "confirmed",
      completedAt: "2026-07-01T02:00:00.000Z",
      updatedAt: "2026-07-01T02:00:00.000Z",
    });

    vi.setSystemTime(new Date("2026-07-02T02:00:00.000Z"));
    updateRecord(record.id, {
      actualDone: "整理并核对了真实动作。",
      payload: { actualActions: "整理并核对报名表" },
    });

    expect(loadRecords()[0]).toMatchObject({
      version: 2,
      status: "confirmed",
      completedAt: "2026-07-01T02:00:00.000Z",
      updatedAt: "2026-07-02T02:00:00.000Z",
    });
  });

  it("rejects confirmed progress without actualDone and derives it for fill-info", () => {
    expect(() =>
      saveRecord({
        routeKey: "direction_to_jobs",
        recordType: "job_sample",
        actionTitle: "保存岗位样本",
        actualDone: "   ",
        payload: { jobTitle: "内容运营实习" },
        userConfirmed: true,
      }),
    ).toThrow("Confirmed progress record requires actualDone");

    const fillInfo = saveRecord({
      routeKey: "jd_to_revision",
      recordType: "fill_info",
      actionTitle: "补岗位要求",
      actualDone: "",
      payload: { jdTextOrRequirements: "负责内容整理" },
      userConfirmed: true,
    });

    expect(fillInfo.actualDone).toBe("补充了 1 项信息。");
  });

  it("creates immutable confirmed resume-snippet versions instead of overwriting history", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T02:00:00.000Z"));
    const experience = saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "整理一段经历",
      actualDone: "整理了真实动作。",
      payload: {
        confirmedFacts: "参与社团招新",
        supportingFacts: "整理报名表；形成名单",
      },
      userConfirmed: true,
    });
    const first = saveRecord({
      routeKey: "experience_to_resume",
      recordType: "resume_snippet",
      actionTitle: "简历片段版本",
      actualDone: "确认第一版。",
      payload: {
        sourceExperienceId: experience.id,
        resumeSnippet: "参与社团招新，整理报名表。",
        supportingFacts: "整理报名表",
        stillMissing: "还缺报名人数",
      },
      userConfirmed: true,
    });

    vi.setSystemTime(new Date("2026-07-02T02:00:00.000Z"));
    updateRecord(first.id, {
      actualDone: "确认第二版。",
      payload: {
        ...first.payload,
        resumeSnippet: "参与社团招新，整理报名表并形成名单。",
      },
    });

    const versions = loadConfirmedResumeSnippets();
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({
      version: 2,
      confirmedAt: "2026-07-02T02:00:00.000Z",
      supersedesRecordId: first.id,
      payload: { resumeSnippet: "参与社团招新，整理报名表并形成名单。" },
    });
    expect(versions[1]).toMatchObject({
      id: first.id,
      version: 1,
      confirmedAt: "2026-07-01T02:00:00.000Z",
      payload: { resumeSnippet: "参与社团招新，整理报名表。" },
    });
  });

  it("returns copy text only for a confirmed current resume-snippet version", () => {
    const experience = saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "整理经历",
      actualDone: "整理了事实。",
      payload: { confirmedFacts: "参与招新" },
      userConfirmed: true,
    });
    const draft = saveRecord({
      routeKey: "experience_to_resume",
      recordType: "resume_snippet",
      actionTitle: "片段草稿",
      actualDone: "尚未确认。",
      payload: {
        sourceExperienceId: experience.id,
        resumeSnippet: "参与招新。",
        supportingFacts: "参与招新",
        stillMissing: "",
      },
      userConfirmed: false,
    });
    const confirmed = saveRecord({
      ...draft,
      actionTitle: "确认片段",
      actualDone: "确认了片段。",
      userConfirmed: true,
    });

    expect(getConfirmedResumeSnippetTextForCopy(draft.id)).toBeNull();
    expect(getConfirmedResumeSnippetTextForCopy(confirmed.id)).toBe("参与招新。");
  });

  it("does not copy a confirmed snippet unless its current source still exists and grounds it", () => {
    const missingSource = saveRecord({
      routeKey: "experience_to_resume",
      recordType: "resume_snippet",
      actionTitle: "确认片段",
      actualDone: "确认了片段。",
      payload: {
        sourceExperienceId: "missing-experience",
        resumeSnippet: "分析报名名单。",
        supportingFacts: "报名名单",
      },
      userConfirmed: true,
    });

    expect(getConfirmedResumeSnippetTextForCopy(missingSource.id)).toBeNull();
  });

  it("invalidates dependent snippets when their source experience changes", () => {
    const experience = saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "整理经历",
      actualDone: "整理了事实。",
      payload: { confirmedFacts: "参与招新" },
      userConfirmed: true,
    });
    const snippet = saveRecord({
      routeKey: "experience_to_resume",
      recordType: "resume_snippet",
      actionTitle: "确认片段",
      actualDone: "确认了片段。",
      payload: {
        sourceExperienceId: experience.id,
        resumeSnippet: "参与招新。",
        supportingFacts: "参与招新",
        stillMissing: "",
      },
      userConfirmed: true,
    });

    updateRecord(experience.id, { payload: { confirmedFacts: "参与并核对招新" } });

    expect(loadConfirmedResumeSnippets()).toEqual([]);
    expect(loadRecords().find((record) => record.id === snippet.id)).toMatchObject({
      sourceState: "stale",
    });
    expect(loadHomeProgress().latestRecord).toMatchObject({ id: experience.id });
  });

  it("cascades dependent snippets by default and marks retained ones deleted_source", () => {
    const makePair = () => {
      const experience = saveRecord({
        routeKey: "experience_to_resume",
        recordType: "experience_fact",
        actionTitle: "整理经历",
        actualDone: "整理了事实。",
        payload: { confirmedFacts: "参与招新" },
        userConfirmed: true,
      });
      const snippet = saveRecord({
        routeKey: "experience_to_resume",
        recordType: "resume_snippet",
        actionTitle: "确认片段",
        actualDone: "确认了片段。",
        payload: {
          sourceExperienceId: experience.id,
          resumeSnippet: "参与招新。",
          supportingFacts: "参与招新",
          stillMissing: "",
        },
        userConfirmed: true,
      });
      return { experience, snippet };
    };

    const cascaded = makePair();
    deleteRecord(cascaded.experience.id);
    expect(loadRecords().some((record) => record.id === cascaded.snippet.id)).toBe(false);

    const retained = makePair();
    deleteRecord(retained.experience.id, { reviewPolicy: "retain" });
    expect(loadRecords().find((record) => record.id === retained.snippet.id)).toMatchObject({
      sourceState: "deleted_source",
    });
    expect(loadConfirmedResumeSnippets()).toEqual([]);
  });

  it("rejects an edited confirmed snippet when the new text is not supported by its source", () => {
    const experience = saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "整理真实经历",
      actualDone: "整理了报名信息。",
      payload: {
        confirmedFacts: "参与社团招新；整理报名信息",
        supportingFacts: "形成报名名单",
      },
      userConfirmed: true,
    });
    const snippet = saveRecord({
      routeKey: "experience_to_resume",
      recordType: "resume_snippet",
      actionTitle: "确认片段",
      actualDone: "确认了片段。",
      payload: {
        sourceExperienceId: experience.id,
        resumeSnippet: "参与社团招新，整理报名信息并形成报名名单。",
        supportingFacts: "形成报名名单",
      },
      userConfirmed: true,
    });

    expect(updateRecord(snippet.id, {
      payload: {
        ...snippet.payload,
        resumeSnippet: "使用 Python 整理 1000 条信息，推动报名增长 30%。",
      },
      userConfirmed: true,
    })).toBeNull();
    expect(loadRecords()).toHaveLength(2);
    expect(loadRecords()[0].payload.resumeSnippet).toBe(
      "参与社团招新，整理报名信息并形成报名名单。",
    );
  });

  it("keeps a confirmed snippet bound to its original source when edited", () => {
    const experience = saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "整理真实经历",
      actualDone: "核对了招新经历。",
      payload: {
        confirmedFacts: "参与社团招新",
        supportingFacts: "整理报名表",
      },
      userConfirmed: true,
    });
    const snippet = saveRecord({
      routeKey: "experience_to_resume",
      recordType: "resume_snippet",
      actionTitle: "确认片段",
      actualDone: "确认了片段。",
      payload: {
        sourceExperienceId: experience.id,
        resumeSnippet: "参与社团招新，整理报名表。",
        supportingFacts: "整理报名表",
      },
      userConfirmed: true,
    });

    const revised = updateRecord(snippet.id, {
      payload: {
        ...snippet.payload,
        sourceExperienceId: "unrelated-experience",
        resumeSnippet: "参与社团招新，整理报名表。",
      },
      userConfirmed: true,
    });

    expect(revised?.payload.sourceExperienceId).toBe(experience.id);
    expect(getConfirmedResumeSnippetTextForCopy(revised?.id ?? "")).toBe(
      "参与社团招新，整理报名表。",
    );
  });

  it("marks linked reviews stale when a source record changes", () => {
    const record = saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "整理一段经历",
      actualDone: "整理了真实动作。",
      payload: { actualActions: "整理报名表" },
      userConfirmed: true,
    });
    saveReview({
      basedOnRecordIds: [record.id],
      routeKey: record.routeKey,
      reviewBasis: [record.actualDone],
      clues: ["动作已经明确。"],
      missingInfo: ["还缺对象。"],
      nextAction: "补充面向对象。",
      userSaved: true,
    });

    updateRecord(record.id, { payload: { actualActions: "核对报名表" } });

    expect(loadReviews()[0]).toMatchObject({
      status: "stale",
      userSaved: false,
    });
  });

  it("cascades linked reviews by default and can explicitly retain them as stale", () => {
    const cascaded = saveRecord({
      routeKey: "jd_to_revision",
      recordType: "jd_compare",
      actionTitle: "修改材料",
      actualDone: "修改了一句话。",
      payload: { afterSnippet: "补充真实动作" },
      userConfirmed: true,
    });
    saveReview({
      basedOnRecordIds: [cascaded.id],
      routeKey: cascaded.routeKey,
      reviewBasis: [cascaded.actualDone],
      clues: ["留下修改版本。"],
      missingInfo: [],
      nextAction: "记录投递反馈。",
    });

    deleteRecord(cascaded.id);
    expect(loadReviews()).toEqual([]);

    const retained = saveRecord({
      routeKey: "jd_to_revision",
      recordType: "jd_compare",
      actionTitle: "修改材料",
      actualDone: "再次修改了一句话。",
      payload: { afterSnippet: "补充交付物" },
      userConfirmed: true,
    });
    saveReview({
      basedOnRecordIds: [retained.id],
      routeKey: retained.routeKey,
      reviewBasis: [retained.actualDone],
      clues: ["留下修改版本。"],
      missingInfo: [],
      nextAction: "记录投递反馈。",
    });

    deleteRecord(retained.id, { reviewPolicy: "retain" });
    expect(loadReviews()[0]).toMatchObject({
      status: "deleted_source",
      retainedAfterSourceDeletion: true,
    });
  });

  it("applies source deletion review policy to reviews linked through dependent snippets", () => {
    const makeReviewedPair = () => {
      const experience = saveRecord({
        routeKey: "experience_to_resume",
        recordType: "experience_fact",
        actionTitle: "整理经历",
        actualDone: "整理了真实经历。",
        payload: { confirmedFacts: "参与招新" },
        userConfirmed: true,
      });
      const snippet = saveRecord({
        routeKey: "experience_to_resume",
        recordType: "resume_snippet",
        actionTitle: "确认片段",
        actualDone: "确认了片段。",
        payload: {
          sourceExperienceId: experience.id,
          resumeSnippet: "参与招新。",
        },
        userConfirmed: true,
      });
      saveReview({
        basedOnRecordIds: [snippet.id],
        routeKey: snippet.routeKey,
        reviewBasis: [snippet.actualDone],
        clues: ["片段已经确认。"],
        missingInfo: [],
        nextAction: "核对一个岗位要求。",
        userSaved: true,
      });
      return { experience };
    };

    const cascaded = makeReviewedPair();
    deleteRecord(cascaded.experience.id);
    expect(loadReviews()).toEqual([]);

    const retained = makeReviewedPair();
    deleteRecord(retained.experience.id, { reviewPolicy: "retain" });
    expect(loadReviews()[0]).toMatchObject({
      status: "deleted_source",
      retainedAfterSourceDeletion: true,
    });
  });

  it("persists a seven-day review from only confirmed real progress in the time window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T02:00:00.000Z"));
    saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "窗口内行动",
      actualDone: "整理了一段经历。",
      payload: { actualActions: "整理报名表" },
      userConfirmed: true,
    });

    vi.setSystemTime(new Date("2026-07-11T02:00:00.000Z"));
    saveRecord({
      routeKey: "jd_to_revision",
      recordType: "fill_info",
      actionTitle: "补信息",
      actualDone: "补充了岗位要求。",
      payload: { jdTextOrRequirements: "负责数据整理" },
      userConfirmed: true,
    });

    vi.setSystemTime(new Date("2026-07-18T02:00:00.000Z"));
    saveRecord({
      routeKey: "applications_to_review",
      recordType: "application",
      actionTitle: "窗口内投递",
      actualDone: "保存了一条投递。",
      payload: { jobTitle: "内容运营" },
      userConfirmed: true,
    });

    expect(getPastSevenDayRecords()).toHaveLength(1);
    const review = savePastSevenDayReview("下一轮先核对 1 个岗位要求。");
    expect(review).toMatchObject({
      reviewKind: "weekly",
      basedOnRecordIds: [loadRecords()[0].id],
      nextAction: "下一轮先核对 1 个岗位要求。",
      status: "saved",
      userSaved: true,
    });
    expect(loadReviews()[0].id).toBe(review?.id);
  });

  it("uses seven local calendar dates rather than a rolling 168-hour window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 11, 23, 30));
    saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "七天前夜间记录",
      actualDone: "整理了一段经历。",
      payload: { actualActions: "整理报名表" },
      userConfirmed: true,
    });

    vi.setSystemTime(new Date(2026, 6, 18, 1, 0));
    const current = saveRecord({
      routeKey: "applications_to_review",
      recordType: "application",
      actionTitle: "今天的投递",
      actualDone: "保存了一条真实投递。",
      payload: { jobTitle: "内容运营" },
      userConfirmed: true,
    });

    expect(getPastSevenDayRecords().map((record) => record.id)).toEqual([current.id]);
  });

  it("does not save an empty seven-day review", () => {
    expect(savePastSevenDayReview()).toBeNull();
    expect(loadReviews()).toEqual([]);
  });

  it("excludes a retained snippet whose source was deleted from seven-day evidence", () => {
    const experience = saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "整理经历",
      actualDone: "整理了真实经历。",
      payload: { confirmedFacts: "参与招新" },
      userConfirmed: true,
    });
    saveRecord({
      routeKey: "experience_to_resume",
      recordType: "resume_snippet",
      actionTitle: "确认片段",
      actualDone: "确认了片段。",
      payload: {
        sourceExperienceId: experience.id,
        resumeSnippet: "参与招新。",
        supportingFacts: "参与招新",
      },
      userConfirmed: true,
    });

    deleteRecord(experience.id, { reviewPolicy: "retain" });

    expect(getPastSevenDayRecords()).toEqual([]);
    expect(savePastSevenDayReview()).toBeNull();
  });

  it("grounds a sparse seven-day review in exact actions and record types", () => {
    const record = saveRecord({
      routeKey: "jd_to_revision",
      recordType: "jd_compare",
      actionTitle: "按 JD 修改材料",
      actualDone: "把一条岗位要求对应到材料。",
      payload: { jdRequirement: "整理数据", afterSnippet: "整理并核对报名数据" },
      userConfirmed: true,
    });

    const review = savePastSevenDayReview();

    expect(review).toMatchObject({
      basedOnRecordIds: [record.id],
      reviewBasis: ["把一条岗位要求对应到材料。"],
      actionTitles: ["按 JD 修改材料"],
      recordTypeCounts: { jd_compare: 1 },
      nextAction: "再核对 1 条岗位要求与材料表述。",
    });
    expect(review?.clues.length).toBeGreaterThanOrEqual(1);
    expect(review?.clues.length).toBeLessThanOrEqual(3);
  });
});

describe("unfinished action shrinking", () => {
  it("shrinks title, quantity, time, steps, and completion standard together", () => {
    const smaller = shrinkUnfinishedAction(routeOutput);

    expect(smaller.todayAction).toMatchObject({
      actionTitle: "今天先保存 1 个真实岗位样本",
      actionSteps: ["搜索 1 个岗位关键词"],
      estimatedTime: "5-10 分钟",
      completionStandard: "完成并保存 1 个可核对结果。",
    });
    expect(smaller.todayAction.recordAfterDone).toContain("1 条岗位要求");
  });

  it("shrinks the persisted application record guide to one record", () => {
    const smaller = shrinkUnfinishedAction({
      ...routeOutput,
      routeKey: "applications_to_review",
      recordGuide: {
        recordType: "application",
        fieldsToRecord: [
          "jobTitle",
          "companyOrPlatform",
          "submittedAt",
          "feedbackStatus",
          "jdSummary",
          "materialVersion",
          "jobTitle2",
          "companyOrPlatform2",
          "submittedAt2",
          "feedbackStatus2",
          "jdSummary2",
          "materialVersion2",
        ],
        requiresUserConfirmation: true,
      },
    });

    expect(smaller.reducedContinuation).toBe(true);
    expect(smaller.recordGuide.fieldsToRecord).toEqual([
      "jobTitle",
      "companyOrPlatform",
      "submittedAt",
      "feedbackStatus",
      "jdSummary",
      "materialVersion",
    ]);
  });
});
