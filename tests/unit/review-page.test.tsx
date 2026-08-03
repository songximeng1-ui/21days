import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReviewPage from "@/app/review/page";
import { withTestProvenance } from "../helpers/test-provenance";
import {
  deleteRecord,
  loadLatestReview,
  saveRecord,
  saveReview,
  updateRecord,
} from "@/lib/local-store";

describe("ReviewPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("does not generate light review from fill-info records", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    saveRecord({
      routeKey: "jd_to_revision",
      recordType: "fill_info",
      actionTitle: "今天先补 JD 原文",
      actualDone: "补了岗位职责和任职要求。",
      payload: { jdTextOrRequirements: "负责内容整理和沟通协作" },
      userConfirmed: true,
    });

    render(<ReviewPage />);

    expect(await screen.findByText("这条补充信息已经保存。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "继续补信息" })).toHaveAttribute(
      "href",
      "/routes/jd_to_revision/input",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows only user-facing record fields and never exposes source ids", async () => {
    const source = saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "整理真实经历",
      actualDone: "核对了真实动作。",
      payload: {
        confirmedFacts: "参与活动宣传",
        actualActions: "整理报名信息",
      },
      userConfirmed: true,
    });
    saveRecord({
      routeKey: "experience_to_resume",
      recordType: "resume_snippet",
      actionTitle: "简历片段版本",
      actualDone: "确认了简历片段。",
      payload: {
        sourceExperienceId: source.id,
        resumeSnippet: "参与活动宣传并整理报名信息。",
        internalDebugField: "should-never-be-visible",
      },
      userConfirmed: true,
    });

    render(<ReviewPage />);

    expect(
      await screen.findByText("克制简历片段：参与活动宣传并整理报名信息。"),
    ).toBeInTheDocument();
    expect(screen.queryByText(source.id, { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByText(/should-never-be-visible|sourceExperienceId/)).not.toBeInTheDocument();
  });

  it("shows a long-wait state and aborts a hanging review after 30 seconds", async () => {
    vi.useFakeTimers();
    saveRecord({
      routeKey: "jd_to_revision",
      recordType: "jd_compare",
      actionTitle: "完成投递前最小修改",
      actualDone: "核对并修改了一条真实表达。",
      payload: {
        beforeSnippet: "协助活动",
        afterSnippet: "整理活动报名表",
        jdRequirement: "数据记录",
      },
      userConfirmed: true,
    });
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        requestSignal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      });
    }));

    render(<ReviewPage />);
    await act(async () => {
      await vi.runAllTicks();
    });
    const generate = screen.getByRole("button", { name: "同意并生成这次回看" });
    fireEvent.click(generate);
    expect(generate).toBeDisabled();
    expect(generate).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent(
      "正在根据已保存的记录整理这次回看。",
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_999);
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "正在根据已保存的记录整理这次回看。",
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "还在整理。你的记录已经保存，可以稍后回来继续。",
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(22_000);
      await Promise.resolve();
    });
    expect(requestSignal?.aborted).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent(
      "这次暂时没整理出来。你的记录已经保存，可以稍后再看。",
    );
    expect(generate).not.toBeDisabled();
  });

  it("distinguishes a local review-save failure from an AI failure", async () => {
    saveRecord({
      routeKey: "jd_to_revision",
      recordType: "jd_compare",
      actionTitle: "完成投递前最小修改",
      actualDone: "核对并修改了一条真实表达。",
      payload: {
        beforeSnippet: "协助活动",
        afterSnippet: "整理活动报名表",
        jdRequirement: "数据记录",
      },
      userConfirmed: true,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => withTestProvenance({
        routeKey: "jd_to_revision",
        outputType: "light_review",
        shortAssessment: "可以继续回看。",
        routeResult: {
          reviewBasis: ["核对并修改了一条真实表达。"],
          clues: ["已经留下修改前后版本"],
          missingInfo: ["还缺投递后的真实反馈"],
          nextAction: "再核对一条岗位要求。",
        },
        missingInfo: null,
        todayAction: {
          actionTitle: "再核对一条岗位要求",
          actionReason: "继续积累真实证据。",
          actionSteps: ["打开岗位要求", "核对一条材料表达"],
          estimatedTime: "15-30 分钟",
          recordAfterDone: "记录修改前后片段。",
          actionType: "jd_revision",
        },
        recordGuide: {
          recordType: "jd_compare",
          fieldsToRecord: ["beforeSnippet", "afterSnippet", "jdRequirement"],
          requiresUserConfirmation: true,
        },
      }),
    }));
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === "mvp-reviews") throw new Error("quota");
      return originalSetItem.call(this, key, value);
    });
    render(<ReviewPage />);

    fireEvent.click(await screen.findByRole("button", { name: "同意并生成这次回看" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "回看已经整理好，但这次没有保存成功。你的原记录仍然保留，请稍后重试。",
    );
    expect(screen.getByRole("button", { name: "同意并生成这次回看" })).not.toBeDisabled();
  });

  it("does not navigate away or claim success when saving the next action fails", async () => {
    const record = saveRecord({
      routeKey: "jd_to_revision",
      recordType: "jd_compare",
      actionTitle: "完成投递前最小修改",
      actualDone: "核对并修改了一条真实表达。",
      payload: {
        beforeSnippet: "协助活动",
        afterSnippet: "整理活动报名表",
        jdRequirement: "数据记录",
      },
      userConfirmed: true,
    });
    saveReview({
      basedOnRecordIds: [record.id],
      routeKey: record.routeKey,
      reviewBasis: [record.actualDone],
      clues: ["已经留下修改前后版本"],
      missingInfo: ["还缺投递后的真实反馈"],
      nextAction: "再核对一条岗位要求。",
      userSaved: false,
    });
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === "mvp-reviews") throw new Error("quota");
      return originalSetItem.call(this, key, value);
    });

    render(<ReviewPage />);
    const nextActionLink = await screen.findByRole("link", { name: "设为下一次行动" });
    fireEvent.click(nextActionLink);

    expect(screen.getByRole("status")).toHaveTextContent(
      "下一次行动没有保存成功，请留在本页稍后重试。",
    );
    expect(loadLatestReview()).toMatchObject({ userSaved: false });
  });

  it("shows loading and then an honest empty state without review claims", async () => {
    render(<ReviewPage />);

    expect(screen.getByRole("status")).toHaveTextContent("正在读取最近的记录");
    expect(await screen.findByText("还没有可以回头看的记录")).toBeInTheDocument();
    expect(screen.queryByText("这一步已经留下记录，可以用于判断下一步。")).not.toBeInTheDocument();
    expect(screen.queryByText("看到的线索")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("stores the generated next action type and record guide with the review", async () => {
    const first = saveRecord({
      routeKey: "applications_to_review",
      recordType: "application",
      actionTitle: "确认投递记录",
      actualDone: "确认了内容运营实习投递记录。",
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
    const second = saveRecord({
      routeKey: "applications_to_review",
      recordType: "application",
      actionTitle: "确认投递记录",
      actualDone: "确认了新媒体运营实习投递记录。",
      payload: {
        jobTitle: "新媒体运营实习",
        companyOrPlatform: "B 公司",
        submittedAt: "7 月 3 日",
        feedbackStatus: "已查看",
        jdSummary: "负责选题和数据记录",
        materialVersion: "项目经历版",
      },
      userConfirmed: true,
    });
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => withTestProvenance({
        routeKey: "applications_to_review",
        outputType: "light_review",
        shortAssessment: "可以继续回头看这一轮。",
        routeResult: {
          reviewBasis: ["内容运营实习", "新媒体运营实习"],
          clues: ["两条记录可以对照"],
          missingInfo: ["还缺这次投递用的简历/材料"],
          nextAction: "下一步先补一条最低字段投递记录",
        },
        missingInfo: null,
        todayAction: {
          actionTitle: "下一步先补一条最低字段投递记录",
          actionReason: "让后面回头看这一轮时继续有依据。",
          actionSteps: ["补岗位、公司、时间和反馈"],
          estimatedTime: "15-30 分钟",
          recordAfterDone: "保存这条投递记录。",
          actionType: "application_record",
        },
        recordGuide: {
          recordType: "application",
          fieldsToRecord: ["jobTitle", "companyOrPlatform", "submittedAt", "feedbackStatus"],
          requiresUserConfirmation: true,
        },
        provenance: {
          shortAssessment: {
            kind: "fact",
            sources: [{ sourceType: "confirmed_record", path: "actualDone", quote: "test" }],
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ReviewPage />);
    const notice = await screen.findByLabelText("外部 AI 数据说明");
    expect(notice).toHaveTextContent(/第三方 AI 瞬时处理/);
    expect(notice).toHaveTextContent(/应用服务端不持久化原文/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "同意并生成这次回看" }));

    expect(await screen.findByText("已根据这条记录整理出下一步。")).toBeInTheDocument();
    expect(screen.queryByText(/轻复盘/)).not.toBeInTheDocument();
    expect(screen.queryByText(/复盘/)).not.toBeInTheDocument();
    expect(loadLatestReview()).toMatchObject({
      basedOnRecordIds: [second.id, first.id],
      nextActionType: "application_record",
      nextRecordType: "application",
      nextFieldsToRecord: ["jobTitle", "companyOrPlatform", "submittedAt", "feedbackStatus"],
    });
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.input.records).toHaveLength(2);
  });

  it("keeps one application record in the add-second-record path without calling AI", async () => {
    saveRecord({
      routeKey: "applications_to_review",
      recordType: "application",
      actionTitle: "确认投递记录",
      actualDone: "确认了内容运营实习投递记录。",
      payload: { jobTitle: "内容运营实习" },
      userConfirmed: true,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<ReviewPage />);

    expect(await screen.findByText("还需要第 2 条完整投递记录，才能生成这次回看。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "补第 2 条投递记录" })).toHaveAttribute(
      "href",
      "/routes/applications_to_review/input",
    );
    expect(screen.queryByRole("button", { name: /生成这次回看/ })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not count an edited incomplete application toward the two-record review gate", async () => {
    const completePayload = {
      jobTitle: "内容运营实习",
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
      actualDone: "确认了第一条投递记录。",
      payload: completePayload,
      userConfirmed: true,
    });
    saveRecord({
      routeKey: "applications_to_review",
      recordType: "application",
      actionTitle: "确认投递记录",
      actualDone: "确认了第二条投递记录。",
      payload: { ...completePayload, jobTitle: "新媒体运营实习", materialVersion: "" },
      userConfirmed: true,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<ReviewPage />);

    expect(
      await screen.findByText("还需要第 2 条完整投递记录，才能生成这次回看。"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /生成这次回看/ })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("echoes the exact structured fields that were saved", async () => {
    saveRecord({
      routeKey: "jd_to_revision",
      recordType: "jd_compare",
      actionTitle: "完成一条最小修改",
      actualDone: "改完了一句话。",
      payload: {
        beforeSnippet: "原片段",
        afterSnippet: "加入真实动作后的片段",
      },
      userConfirmed: true,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => withTestProvenance({
        routeKey: "jd_to_revision",
        outputType: "light_review",
        shortAssessment: "已根据真实记录整理。",
        routeResult: {
          reviewBasis: ["改完了一句话。"],
          clues: ["留下修改前后片段"],
          missingInfo: ["还缺投递反馈"],
          nextAction: "记录投递反馈",
        },
        missingInfo: null,
        todayAction: {
          actionTitle: "记录投递反馈",
          actionReason: "继续验证。",
          actionSteps: ["记录反馈"],
          estimatedTime: "15-30 分钟",
          recordAfterDone: "保存反馈。",
          actionType: "feedback_record",
        },
        recordGuide: {
          recordType: "feedback",
          fieldsToRecord: ["note"],
          requiresUserConfirmation: true,
        },
        provenance: {
          shortAssessment: {
            kind: "fact",
            sources: [{ sourceType: "confirmed_record", path: "actualDone", quote: "test" }],
          },
        },
      }),
    }));

    render(<ReviewPage />);
    fireEvent.click(await screen.findByRole("button", { name: "同意并生成这次回看" }));

    expect(await screen.findByText("刚保存的结构化记录")).toBeInTheDocument();
    expect(screen.getByText("修改前片段：原片段")).toBeInTheDocument();
    expect(screen.getByText("修改后片段：加入真实动作后的片段")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("。；");
  });

  it("recomputes instead of reusing a review after its source record changes", async () => {
    const record = saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "整理经历",
      actualDone: "整理了报名表。",
      payload: { actualActions: "整理报名表" },
      userConfirmed: true,
    });
    saveReview({
      basedOnRecordIds: [record.id],
      routeKey: record.routeKey,
      reviewBasis: [record.actualDone],
      clues: ["旧线索"],
      missingInfo: [],
      nextAction: "旧下一步",
      userSaved: true,
    });
    updateRecord(record.id, {
      actualDone: "整理并核对了报名表。",
      payload: { actualActions: "整理并核对报名表" },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => withTestProvenance({
        routeKey: "experience_to_resume",
        outputType: "light_review",
        shortAssessment: "已重新整理。",
        routeResult: {
          reviewBasis: ["整理并核对了报名表。"],
          clues: ["新线索"],
          missingInfo: [],
          nextAction: "新下一步",
        },
        missingInfo: null,
        todayAction: {
          actionTitle: "新下一步",
          actionReason: "记录已修改。",
          actionSteps: ["继续"],
          estimatedTime: "15-30 分钟",
          recordAfterDone: "保存结果。",
          actionType: "experience_fact",
        },
        recordGuide: {
          recordType: "experience_fact",
          fieldsToRecord: ["actualActions"],
          requiresUserConfirmation: true,
        },
        provenance: {
          shortAssessment: {
            kind: "fact",
            sources: [{ sourceType: "confirmed_record", path: "actualDone", quote: "test" }],
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ReviewPage />);
    fireEvent.click(await screen.findByRole("button", { name: "同意并重新生成这次回看" }));

    expect(await screen.findByText("新线索")).toBeInTheDocument();
    expect(screen.queryByText("旧线索")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not review a stale resume snippet after its source experience changes", async () => {
    const experience = saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "整理经历",
      actualDone: "整理了来源经历。",
      payload: { confirmedFacts: "参与招新" },
      userConfirmed: true,
    });
    saveRecord({
      routeKey: "experience_to_resume",
      recordType: "resume_snippet",
      actionTitle: "确认片段",
      actualDone: "确认了旧片段。",
      payload: {
        sourceExperienceId: experience.id,
        resumeSnippet: "参与招新。",
      },
      userConfirmed: true,
    });
    updateRecord(experience.id, {
      actualDone: "修正了来源经历。",
      payload: { confirmedFacts: "参与并核对招新" },
    });

    render(<ReviewPage />);

    expect(
      await screen.findByText("你今天记录了：修正了来源经历。"),
    ).toBeInTheDocument();
    expect(screen.queryByText("你今天记录了：确认了旧片段。")).not.toBeInTheDocument();
  });

  it("does not review a retained snippet after its source experience is deleted", async () => {
    const experience = saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "整理经历",
      actualDone: "整理了来源经历。",
      payload: { confirmedFacts: "参与招新" },
      userConfirmed: true,
    });
    saveRecord({
      routeKey: "experience_to_resume",
      recordType: "resume_snippet",
      actionTitle: "确认片段",
      actualDone: "确认了旧片段。",
      payload: {
        sourceExperienceId: experience.id,
        resumeSnippet: "参与招新。",
      },
      userConfirmed: true,
    });
    deleteRecord(experience.id, { reviewPolicy: "retain" });

    render(<ReviewPage />);

    expect(
      await screen.findByRole("heading", { name: "还没有可以回头看的记录" }),
    ).toBeInTheDocument();
  });

  it("aborts a pending review request when the page unmounts", async () => {
    saveRecord({
      routeKey: "jd_to_revision",
      recordType: "jd_compare",
      actionTitle: "完成一条最小修改",
      actualDone: "改完了一句话。",
      payload: { beforeSnippet: "原片段", afterSnippet: "加入真实动作后的片段" },
      userConfirmed: true,
    });
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise(() => undefined);
    }));

    const view = render(<ReviewPage />);
    fireEvent.click(await screen.findByRole("button", { name: "同意并生成这次回看" }));
    expect(requestSignal?.aborted).toBe(false);

    view.unmount();

    expect(requestSignal?.aborted).toBe(true);
  });

  it("does not save a review when the API returns another route's output", async () => {
    saveRecord({
      routeKey: "jd_to_revision",
      recordType: "jd_compare",
      actionTitle: "Compare one JD requirement",
      actualDone: "Compared the JD with one real experience.",
      payload: {
        beforeSnippet: "Helped with an event.",
        afterSnippet: "Organized the event registration sheet.",
      },
      userConfirmed: true,
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => withTestProvenance({
        routeKey: "applications_to_review",
        outputType: "light_review",
        shortAssessment: "Wrong route response.",
        routeResult: {
          reviewBasis: ["Compared the JD with one real experience."],
          clues: ["A clue"],
          missingInfo: ["A gap"],
          nextAction: "Next action",
        },
        missingInfo: null,
        todayAction: {
          actionTitle: "Record another application",
          actionReason: "Wrong route",
          actionSteps: ["Save it"],
          estimatedTime: "15-30 分钟",
          recordAfterDone: "Save the application record.",
          actionType: "application_record",
        },
        recordGuide: {
          recordType: "application",
          fieldsToRecord: ["jobTitle"],
          requiresUserConfirmation: true,
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ReviewPage />);
    fireEvent.click(await screen.findByRole("button"));

    await screen.findByText(/暂时没整理出来/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(loadLatestReview()).toBeNull();
  });
});
