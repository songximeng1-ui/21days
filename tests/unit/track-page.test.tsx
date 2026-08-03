import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TrackPage from "@/app/track/page";
import { withTestProvenance } from "../helpers/test-provenance";
import {
  loadCurrentAction,
  loadDraft,
  loadRecords,
  loadReviews,
  saveCurrentAction,
  saveDraft,
  saveRecord,
  saveReview,
} from "@/lib/local-store";

describe("TrackPage destructive-action protection", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps a record when deletion is cancelled and exposes keyboard-focusable controls", async () => {
    saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "整理一段真实经历",
      actualDone: "整理了报名表。",
      payload: { actualActions: "整理报名表" },
      userConfirmed: true,
    });
    render(<TrackPage />);

    const deleteTrigger = await screen.findByRole("button", { name: "删除这条记录" });
    fireEvent.click(deleteTrigger);
    expect(loadRecords()).toHaveLength(1);

    const confirm = screen.getByRole("button", { name: "确认删除这条记录" });
    const cancel = screen.getByRole("button", { name: "取消删除" });
    await waitFor(() => expect(confirm).toHaveFocus());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    fireEvent.click(cancel);

    expect(loadRecords()).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "确认删除这条记录" })).not.toBeInTheDocument();
    await waitFor(() => expect(deleteTrigger).toHaveFocus());
  });

  it("deletes a record only after explicit confirmation", async () => {
    saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "整理一段真实经历",
      actualDone: "整理了报名表。",
      payload: {},
      userConfirmed: true,
    });
    render(<TrackPage />);

    fireEvent.click(await screen.findByRole("button", { name: "删除这条记录" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除这条记录" }));

    expect(loadRecords()).toEqual([]);
  });

  it("shows structured payload and edits it as a new version while invalidating its review", async () => {
    const record = saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "整理一段真实经历",
      actualDone: "整理了报名表。",
      payload: {
        actualActions: "整理报名表",
        deliverable: "报名名单",
      },
      userConfirmed: true,
    });
    saveReview({
      basedOnRecordIds: [record.id],
      routeKey: record.routeKey,
      reviewBasis: [record.actualDone],
      clues: ["已经留下动作和交付物。"],
      missingInfo: [],
      nextAction: "补充面向对象。",
      userSaved: true,
    });
    render(<TrackPage />);

    expect(await screen.findByText("实际做过的动作：整理报名表")).toBeInTheDocument();
    expect(screen.getByText("交付物或结果：报名名单")).toBeInTheDocument();
    expect(screen.getByText(/版本 1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑这条记录" }));
    fireEvent.change(screen.getByLabelText("编辑实际完成"), {
      target: { value: "整理并核对了报名表。" },
    });
    fireEvent.change(screen.getByLabelText("编辑：实际做过的动作"), {
      target: { value: "整理并核对报名表" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    expect(loadRecords()[0]).toMatchObject({
      actualDone: "整理并核对了报名表。",
      payload: {
        actualActions: "整理并核对报名表",
        deliverable: "报名名单",
      },
      version: 2,
    });
    expect(loadReviews()[0]).toMatchObject({
      status: "stale",
      userSaved: false,
    });
    expect(await screen.findByText(/版本 2/)).toBeInTheDocument();
  });

  it("keeps an unconfirmed resume snippet out of the formal trajectory", async () => {
    saveRecord({
      routeKey: "experience_to_resume",
      recordType: "resume_snippet",
      actionTitle: "整理一段简历片段",
      actualDone: "生成了一段还未确认的片段。",
      payload: { resumeSnippet: "这段内容还需要本人核对。" },
      userConfirmed: false,
    });

    render(<TrackPage />);

    expect(
      await screen.findByText("还没有记录。今天先完成一个小行动就可以开始。"),
    ).toBeInTheDocument();
    expect(screen.queryByText("这段内容还需要本人核对。")).not.toBeInTheDocument();
    expect(screen.getByText("已记录行动：0 次")).toBeInTheDocument();
  });

  it("offers retaining a dependent review explicitly when deleting its source record", async () => {
    const record = saveRecord({
      routeKey: "jd_to_revision",
      recordType: "jd_compare",
      actionTitle: "修改材料",
      actualDone: "修改了一句话。",
      payload: { afterSnippet: "补充真实动作" },
      userConfirmed: true,
    });
    saveReview({
      basedOnRecordIds: [record.id],
      routeKey: record.routeKey,
      reviewBasis: [record.actualDone],
      clues: ["留下修改版本。"],
      missingInfo: [],
      nextAction: "记录投递反馈。",
    });
    render(<TrackPage />);

    fireEvent.click(await screen.findByRole("button", { name: "删除这条记录" }));
    fireEvent.click(screen.getByRole("button", { name: "仅删除记录，保留回看" }));

    expect(loadRecords()).toEqual([]);
    expect(loadReviews()[0]).toMatchObject({
      status: "deleted_source",
      retainedAfterSourceDeletion: true,
    });
    expect(await screen.findByText("来源记录已删除，此回看仅作为历史快照保留。")).toBeInTheDocument();
  });

  it("copies only a confirmed resume snippet whose source is still current", async () => {
    const experience = saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "整理真实经历",
      actualDone: "核对了社团招新的真实动作。",
      payload: {
        confirmedFacts: "参与社团招新",
        actualActions: "整理报名信息",
        deliverable: "报名名单",
        supportingFacts: "形成报名名单",
      },
      userConfirmed: true,
    });
    saveRecord({
      routeKey: "experience_to_resume",
      recordType: "resume_snippet",
      actionTitle: "确认简历片段",
      actualDone: "确认了片段。",
      payload: {
        sourceExperienceId: experience.id,
        resumeSnippet: "参与社团招新，整理报名信息并形成报名名单。",
      },
      userConfirmed: true,
    });
    saveRecord({
      routeKey: "experience_to_resume",
      recordType: "resume_snippet",
      actionTitle: "未确认简历片段",
      actualDone: "尚未确认。",
      payload: {
        sourceExperienceId: experience.id,
        resumeSnippet: "这段内容不能复制。",
      },
      userConfirmed: false,
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<TrackPage />);

    const copyButton = await screen.findByRole("button", { name: "复制已确认片段" });
    expect(screen.getAllByRole("button", { name: "复制已确认片段" })).toHaveLength(1);
    fireEvent.click(copyButton);
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("参与社团招新，整理报名信息并形成报名名单。"),
    );
    expect(screen.getByRole("status")).toHaveTextContent("已复制简历片段。");
  });

  it("reports a clipboard failure without exposing the browser error", async () => {
    const experience = saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "整理真实经历",
      actualDone: "核对了来源经历。",
      payload: { confirmedFacts: "参与社团招新" },
      userConfirmed: true,
    });
    saveRecord({
      routeKey: "experience_to_resume",
      recordType: "resume_snippet",
      actionTitle: "确认简历片段",
      actualDone: "确认了片段。",
      payload: {
        sourceExperienceId: experience.id,
        resumeSnippet: "参与社团招新。",
      },
      userConfirmed: true,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    render(<TrackPage />);

    fireEvent.click(await screen.findByRole("button", { name: "复制已确认片段" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "这次没有复制成功，请手动选择片段。",
    );
    expect(document.body).not.toHaveTextContent("denied");
  });

  it("keeps a resume snippet source reference read-only while editing", async () => {
    const experience = saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "整理真实经历",
      actualDone: "核对了来源经历。",
      payload: {
        confirmedFacts: "参与社团招新",
        supportingFacts: "整理报名表",
      },
      userConfirmed: true,
    });
    saveRecord({
      routeKey: "experience_to_resume",
      recordType: "resume_snippet",
      actionTitle: "确认简历片段",
      actualDone: "确认了片段。",
      payload: {
        sourceExperienceId: experience.id,
        resumeSnippet: "参与社团招新，整理报名表。",
      },
      userConfirmed: true,
    });

    render(<TrackPage />);

    fireEvent.click((await screen.findAllByRole("button", { name: "编辑这条记录" }))[0]);
    expect(screen.queryByLabelText("编辑：来源经历记录")).not.toBeInTheDocument();
    expect(screen.queryByText(experience.id, { exact: false })).not.toBeInTheDocument();
  });

  it("counts records from the same action as one recorded action", async () => {
    const actionId = "experience-action";
    const experience = saveRecord({
      actionId,
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "整理真实经历",
      actualDone: "核对了来源经历。",
      payload: { confirmedFacts: "参与社团招新" },
      userConfirmed: true,
    });
    saveRecord({
      actionId,
      routeKey: "experience_to_resume",
      recordType: "resume_snippet",
      actionTitle: "确认简历片段",
      actualDone: "确认了片段。",
      payload: {
        sourceExperienceId: experience.id,
        resumeSnippet: "参与社团招新。",
      },
      userConfirmed: true,
    });

    render(<TrackPage />);

    expect(await screen.findByText("已记录行动：1 次")).toBeInTheDocument();
    expect(screen.getByText("真实推进：1 次")).toBeInTheDocument();
  });

  it("keeps an unsupported resume edit unsaved and explains why", async () => {
    const experience = saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "整理真实经历",
      actualDone: "核对了招新经历。",
      payload: {
        confirmedFacts: "参与社团招新；整理报名信息",
        supportingFacts: "形成报名名单",
      },
      userConfirmed: true,
    });
    saveRecord({
      routeKey: "experience_to_resume",
      recordType: "resume_snippet",
      actionTitle: "确认简历片段",
      actualDone: "确认了片段。",
      payload: {
        sourceExperienceId: experience.id,
        resumeSnippet: "参与社团招新，整理报名信息并形成报名名单。",
        supportingFacts: "形成报名名单",
      },
      userConfirmed: true,
    });
    render(<TrackPage />);

    fireEvent.click((await screen.findAllByRole("button", { name: "编辑这条记录" }))[0]);
    fireEvent.change(screen.getByLabelText("编辑：克制简历片段"), {
      target: { value: "使用 Python 整理 1000 条信息，推动报名增长 30%。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "修改后的片段含有来源经历无法支撑的事实，未保存。",
    );
    expect(loadRecords()).toHaveLength(2);
  });

  it("shows journey day and phase and persists a seven-day review from the trajectory", async () => {
    saveRecord({
      routeKey: "applications_to_review",
      recordType: "application",
      actionTitle: "保存投递记录",
      actualDone: "保存了一条真实投递。",
      payload: { jobTitle: "内容运营" },
      userConfirmed: true,
    });
    render(<TrackPage />);

    expect(await screen.findByText(/21 天陪跑 · 第 1 天 · 第 1 阶段/)).toBeInTheDocument();
    expect(screen.getByText("真实推进：1 次")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "生成过去 7 天回看" }));

    expect(await screen.findByText("过去 7 天回看")).toBeInTheDocument();
    expect(screen.getByText(/过去 7 天完成了 1 次真实推进/)).toBeInTheDocument();
    expect(screen.getByText("行动：保存投递记录")).toBeInTheDocument();
    expect(screen.getByText("回看依据：保存了一条真实投递。")).toBeInTheDocument();
    expect(screen.getByText("留下的记录：投递记录 × 1")).toBeInTheDocument();
    expect(screen.queryByText(/application/)).not.toBeInTheDocument();
    expect(screen.getByText("还缺的信息：还需要第 2 条完整投递记录。")).toBeInTheDocument();
    expect(screen.getByText("下一轮先做：补齐第 2 条真实投递记录后再回看。")).toBeInTheDocument();
    expect(loadReviews()[0]).toMatchObject({
      reviewKind: "weekly",
      status: "saved",
      userSaved: true,
    });
  });

  it("never exposes internal linkage ids, unknown payload fields, or raw record enums", async () => {
    const source = saveRecord({
      actionId: "action-resume-1",
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "整理真实经历",
      actualDone: "核对了报名经历。",
      payload: {
        confirmedFacts: "参与社团招新；整理报名信息",
        internalDebugField: "should-never-be-visible",
      },
      userConfirmed: true,
    });
    saveRecord({
      actionId: "action-resume-1",
      routeKey: "experience_to_resume",
      recordType: "resume_snippet",
      actionTitle: "简历片段版本",
      actualDone: "确认了片段。",
      payload: {
        sourceExperienceId: source.id,
        resumeSnippet: "参与社团招新，整理报名信息。",
        supportingFacts: "整理报名信息",
      },
      userConfirmed: true,
    });

    render(<TrackPage />);

    await screen.findByText("克制简历片段：参与社团招新，整理报名信息。");
    expect(screen.queryByText(source.id, { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByText(/sourceExperienceId|experience_fact|resume_snippet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/should-never-be-visible/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "生成过去 7 天回看" }));
    expect(await screen.findByText("留下的记录：简历片段 × 1")).toBeInTheDocument();
    expect(screen.queryByText(/resume_snippet/)).not.toBeInTheDocument();
  });

  it("does not create a seven-day review when there are no confirmed records", async () => {
    render(<TrackPage />);

    fireEvent.click(await screen.findByRole("button", { name: "生成过去 7 天回看" }));

    expect(await screen.findByText("过去 7 天还没有可回看的确认记录。")).toBeInTheDocument();
    expect(loadReviews()).toEqual([]);
  });

  it("explains everything cleared and changes nothing when clear-all is cancelled", async () => {
    saveDraft("jd_to_revision", { userMaterial: "真实材料" });
    saveCurrentAction(withTestProvenance({
      routeKey: "jd_to_revision",
      outputType: "missing_info",
      shortAssessment: "还缺岗位要求。",
      routeResult: null,
      missingInfo: {
        cannotJudge: "材料支撑关系",
        alreadyKnown: ["目标岗位"],
        missingFields: ["岗位要求"],
      },
      todayAction: {
        actionTitle: "补岗位要求",
        actionReason: "有真实要求后再判断。",
        actionSteps: ["找到岗位页面"],
        estimatedTime: "15-30 分钟",
        recordAfterDone: "保存岗位要求。",
        actionType: "fill_info",
      },
      recordGuide: {
        recordType: "fill_info",
        fieldsToRecord: ["jdTextOrRequirements"],
        requiresUserConfirmation: true,
      },
      provenance: {
        shortAssessment: {
          kind: "fact",
          sources: [{ sourceType: "user_input", path: "testFixture", quote: "test" }],
        },
      },
    }));
    const record = saveRecord({
      routeKey: "jd_to_revision",
      recordType: "fill_info",
      actionTitle: "补岗位要求",
      actualDone: "补了岗位要求。",
      payload: {},
      userConfirmed: true,
    });
    saveReview({
      basedOnRecordIds: [record.id],
      routeKey: "jd_to_revision",
      reviewBasis: ["补了岗位要求"],
      clues: [],
      missingInfo: [],
      nextAction: "继续判断",
    });
    render(<TrackPage />);

    const clearTrigger = await screen.findByRole("button", { name: "清空我的记录" });
    fireEvent.click(clearTrigger);
    expect(screen.getByText(/当前行动、所有草稿、求职记录和查看结果/)).toBeInTheDocument();
    const clearConfirm = screen.getByRole("button", { name: "确认清空全部内容" });
    await waitFor(() => expect(clearConfirm).toHaveFocus());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消清空" }));

    expect(loadDraft("jd_to_revision")).toEqual({ userMaterial: "真实材料" });
    expect(loadCurrentAction()).not.toBeNull();
    expect(loadRecords()).toHaveLength(1);
    await waitFor(() => expect(clearTrigger).toHaveFocus());
  });

  it("keeps edit data and offers retry when persisting an edit fails", async () => {
    saveRecord({
      routeKey: "jd_to_revision",
      recordType: "jd_compare",
      actionTitle: "修改材料",
      actualDone: "改了一句话。",
      payload: { afterSnippet: "原修改" },
      userConfirmed: true,
    });
    render(<TrackPage />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑这条记录" }));
    const editField = screen.getByLabelText("编辑实际完成");
    fireEvent.change(editField, { target: { value: "保留这次编辑" } });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });

    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "这次修改没有保存成功，当前编辑内容仍保留，请稍后重试。",
    );
    expect(editField).toHaveValue("保留这次编辑");

    setItem.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    expect(await screen.findByText("保留这次编辑")).toBeInTheDocument();
  });

  it("keeps delete confirmation available when deletion persistence fails", async () => {
    saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "整理经历",
      actualDone: "整理了报名表。",
      payload: { actualActions: "整理报名表" },
      userConfirmed: true,
    });
    render(<TrackPage />);
    fireEvent.click(await screen.findByRole("button", { name: "删除这条记录" }));
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });

    fireEvent.click(screen.getByRole("button", { name: "确认删除这条记录" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "这条记录没有删除成功，请保留当前页面并稍后重试。",
    );
    expect(screen.getByRole("button", { name: "确认删除这条记录" })).toBeInTheDocument();

    setItem.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "确认删除这条记录" }));
    expect(loadRecords()).toEqual([]);
  });

  it("keeps clear confirmation available when clearing persistence fails", async () => {
    saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "整理经历",
      actualDone: "整理了报名表。",
      payload: {},
      userConfirmed: true,
    });
    render(<TrackPage />);
    fireEvent.click(await screen.findByRole("button", { name: "清空我的记录" }));
    const originalRemoveItem = Storage.prototype.removeItem;
    let removeCalls = 0;
    const removeItem = vi
      .spyOn(Storage.prototype, "removeItem")
      .mockImplementation(function (this: Storage, key: string) {
        removeCalls += 1;
        if (removeCalls === 3) throw new Error("quota");
        return originalRemoveItem.call(this, key);
      });

    fireEvent.click(screen.getByRole("button", { name: "确认清空全部内容" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "记录没有清空成功，请保留当前页面并稍后重试。",
    );
    expect(screen.getByRole("button", { name: "确认清空全部内容" })).toBeInTheDocument();
    expect(loadRecords()).toHaveLength(1);

    removeItem.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "确认清空全部内容" }));
    expect(loadRecords()).toEqual([]);
  });

  it("keeps confirmed records and offers retry when weekly review persistence fails", async () => {
    saveRecord({
      routeKey: "direction_to_jobs",
      recordType: "job_sample",
      actionTitle: "保存岗位样本",
      actualDone: "保存了一个岗位样本。",
      payload: { jobTitle: "内容运营实习" },
      userConfirmed: true,
    });
    render(<TrackPage />);
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });

    fireEvent.click(await screen.findByRole("button", { name: "生成过去 7 天回看" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "过去 7 天回看没有保存成功，请稍后重试。",
    );
    expect(loadRecords()).toHaveLength(1);

    setItem.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "生成过去 7 天回看" }));
    expect(
      await screen.findByText(
        "下一轮先做：再保存 1 个真实岗位样本，核对重复出现的岗位要求。",
      ),
    ).toBeInTheDocument();
  });
});
