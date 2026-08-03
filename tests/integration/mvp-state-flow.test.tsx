import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import ReviewPage from "@/app/review/page";
import RouteInputPage from "@/app/routes/[routeKey]/input/page";
import RecordPage from "@/app/routes/[routeKey]/record/page";
import TrackPage from "@/app/track/page";
import type { RouteKey, RouteOutput } from "@/domain/types";
import { withTestProvenance } from "../helpers/test-provenance";
import {
  loadCurrentAction,
  loadDraft,
  loadRecords,
  saveCurrentAction,
  saveDraft,
  saveRecord,
  saveReview,
} from "@/lib/local-store";

const push = vi.fn();
let routeKeyParam: RouteKey = "jd_to_revision";

vi.mock("next/navigation", () => ({
  useParams: () => ({ routeKey: routeKeyParam }),
  useRouter: () => ({ push }),
}));

const jdActionOutput: RouteOutput = withTestProvenance({
  routeKey: "jd_to_revision",
  outputType: "route_result",
  shortAssessment: "这份材料可以先做一处投递前最小修改。",
  routeResult: {
    jdKeyRequirements: ["内容整理"],
    supportedByMaterial: ["材料里能看到内容整理经历"],
    unclearFromMaterial: ["还看不出具体交付物"],
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
    fieldsToRecord: ["targetJobTitle", "beforeSnippet", "afterSnippet", "jdRequirement", "submitted"],
    requiresUserConfirmation: true,
  },
  provenance: {
    shortAssessment: {
      kind: "fact",
      sources: [{ sourceType: "user_input", path: "testFixture", quote: "test" }],
    },
  },
});

const missingInfoOutput: RouteOutput = withTestProvenance({
  ...jdActionOutput,
  outputType: "missing_info",
  shortAssessment: "现在还不能可靠判断这份岗位和你的材料，因为还缺真实 JD。",
  routeResult: null,
  missingInfo: {
    cannotJudge: "这份 JD 现在能被哪些经历支撑",
    alreadyKnown: ["目标岗位名称", "准备使用的材料"],
    missingFields: ["真实 JD 或 3-5 条岗位要求"],
  },
  todayAction: {
    actionTitle: "今天先补这份岗位的真实 JD 或 3-5 条岗位要求",
    actionReason: "补完这一项后，下一步会更具体。",
    actionSteps: ["找到目标岗位页面", "复制 JD 或写下 3-5 条岗位要求", "保存后回来继续"],
    estimatedTime: "15-30 分钟",
    recordAfterDone: "记录岗位名称和真实 JD。",
    actionType: "fill_info",
  },
  recordGuide: {
    recordType: "fill_info",
    fieldsToRecord: ["targetJobTitle", "jdTextOrRequirements"],
    requiresUserConfirmation: true,
  },
});

const friendlyFailureOutput: RouteOutput = {
  ...jdActionOutput,
  outputType: "friendly_failure",
  shortAssessment: "这次暂时没整理出来。你可以先保存当前填写内容，稍后继续。",
  routeResult: null,
  missingInfo: null,
  todayAction: {
    actionTitle: "当前内容已保存，稍后继续",
    actionReason: "这次暂时没有整理出可执行的小行动，先保留当前填写内容。",
    actionSteps: ["稍后从当前内容继续"],
    estimatedTime: "已保存，稍后继续",
    recordAfterDone: "保留当前草稿，稍后继续。",
    actionType: "fill_info",
  },
  recordGuide: {
    recordType: "fill_info",
    fieldsToRecord: ["draft"],
    requiresUserConfirmation: true,
  },
};

describe("MVP page state flow", () => {
  beforeEach(() => {
    window.localStorage.clear();
    push.mockReset();
    routeKeyParam = "jd_to_revision";
    vi.restoreAllMocks();
  });

  it("continues from action to record, light review, and returning home", async () => {
    saveDraft("jd_to_revision", {
      targetJobTitle: "内容运营实习生",
      jdTextOrRequirements: "负责内容整理",
      userMaterial: "原片段",
    });
    saveCurrentAction(jdActionOutput);
    render(<RecordPage />);

    fireEvent.change(await screen.findByLabelText("实际完成了什么？"), {
      target: { value: "改完 JD 相关的一句话。" },
    });
    fireEvent.change(screen.getByLabelText("修改后片段"), {
      target: { value: "加入真实动作后的片段" },
    });
    fireEvent.change(screen.getByLabelText("是否已经投递"), {
      target: { value: "尚未投递" },
    });
    fireEvent.click(screen.getByLabelText(/我确认这条记录反映了我实际做过的事/));
    fireEvent.click(screen.getByRole("button", { name: "保存并看看下一步" }));

    expect(push).toHaveBeenCalledWith("/review");
    expect(loadRecords()).toHaveLength(1);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => withTestProvenance({
          routeKey: "jd_to_revision",
          outputType: "light_review",
          shortAssessment: "这条记录可以先回头看一眼。",
          routeResult: {
            reviewBasis: ["改完 JD 相关的一句话。"],
            clues: ["这次已经留下修改前后片段"],
            missingInfo: ["还缺投递后的反馈"],
            nextAction: "下一步先记录这次投递用的简历/材料。",
          },
          missingInfo: null,
          todayAction: {
            actionTitle: "下一步先记录这次投递用的简历/材料",
            actionReason: "这次投递用的简历/材料清楚后，后续反馈才有依据。",
            actionSteps: ["打开这条记录", "补这次投递用的简历/材料", "保存修改"],
            estimatedTime: "15-30 分钟",
            recordAfterDone: "记录这次投递用的简历/材料。",
            actionType: "jd_revision",
          },
          recordGuide: {
            recordType: "jd_compare",
            fieldsToRecord: ["materialVersion"],
            requiresUserConfirmation: true,
          },
          provenance: {
            shortAssessment: {
              kind: "fact",
              sources: [{ sourceType: "confirmed_record", path: "actualDone", quote: "test" }],
            },
          },
        }),
      }),
    );

    cleanup();
    render(<ReviewPage />);
    fireEvent.click(await screen.findByRole("button", { name: "同意并生成这次回看" }));
    expect(await screen.findByText("已根据这条记录整理出下一步。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "设为下一次行动" }));

    cleanup();
    render(<Home />);
    expect(await screen.findByText("最近推进：改完 JD 相关的一句话。")).toBeInTheDocument();
    expect(screen.getByText("下一步先记录这次投递用的简历/材料。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "继续：下一步先记录这次投递用的简历/材料。" })).toHaveAttribute(
      "href",
      "/routes/jd_to_revision/action",
    );
    expect(screen.queryByText("我不知道能投哪些岗位")).not.toBeInTheDocument();
  });

  it("merges missing-info records into the route input draft", async () => {
    saveDraft("jd_to_revision", {
      targetJobTitle: "产品运营实习生",
      userMaterial: "社团活动经历",
    });
    saveCurrentAction(missingInfoOutput);

    render(<RecordPage />);
    fireEvent.change(await screen.findByLabelText("实际完成了什么？"), {
      target: { value: "补了真实 JD 和岗位要求。" },
    });
    fireEvent.change(screen.getByLabelText("目标岗位名称"), {
      target: { value: "产品运营实习生" },
    });
    fireEvent.change(screen.getByLabelText("岗位要求或 3-5 条你看到的要求"), {
      target: { value: "负责用户调研、数据整理、活动复盘" },
    });
    fireEvent.click(screen.getByLabelText(/我确认这条记录反映了我实际做过的事/));
    fireEvent.click(screen.getByRole("button", { name: "保存补充信息，继续判断" }));

    expect(push).toHaveBeenCalledWith("/routes/jd_to_revision/input");
    expect(loadRecords()).toEqual([
      expect.objectContaining({
        routeKey: "jd_to_revision",
        recordType: "fill_info",
        actualDone: "补了真实 JD 和岗位要求。",
      }),
    ]);

    cleanup();
    render(<RouteInputPage />);
    expect(await screen.findByDisplayValue("产品运营实习生")).toBeInTheDocument();
    expect(screen.getByDisplayValue("社团活动经历")).toBeInTheDocument();
    expect(screen.getByDisplayValue("负责用户调研、数据整理、活动复盘")).toBeInTheDocument();
  });

  it("requires and merges the exact application review details before continuing judgment", async () => {
    routeKeyParam = "applications_to_review";
    saveDraft("applications_to_review", {
      jobTitle: "内容运营实习",
      companyOrPlatform: "A 公司",
      submittedAt: "7 月 1 日",
      feedbackStatus: "暂无反馈",
      userSuspicion: "经历写得太泛",
    });
    saveCurrentAction(withTestProvenance({
      routeKey: "applications_to_review",
      outputType: "missing_info",
      shortAssessment: "第 1 条投递已经有最低记录，再补两项就能用于对照复盘。",
      routeResult: null,
      missingInfo: {
        cannotJudge: "这条投递使用的材料是否支撑岗位要求",
        alreadyKnown: ["第 1 条最低字段投递记录"],
        missingFields: ["第 1 条投递的 JD 摘要", "第 1 条投递的材料版本"],
      },
      todayAction: {
        actionTitle: "今天先补第 1 条投递的 JD 摘要和材料版本",
        actionReason: "这两项能让下一次判断基于真实岗位要求和真实材料版本。",
        actionSteps: ["写下岗位要求", "写下材料版本"],
        estimatedTime: "15-30 分钟",
        recordAfterDone: "记录 JD 摘要和材料版本。",
        actionType: "fill_info",
      },
      recordGuide: {
        recordType: "application",
        fieldsToRecord: ["jdSummary", "materialVersion"],
        requiresUserConfirmation: true,
      },
      provenance: {
        shortAssessment: {
          kind: "fact",
          sources: [{ sourceType: "user_input", path: "testFixture", quote: "test" }],
        },
      },
    }));

    render(<RecordPage />);
    const saveButton = await screen.findByRole("button", { name: "保存补充信息，继续判断" });
    fireEvent.click(screen.getByLabelText(/我确认这条记录反映了我实际做过的事/));
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);
    expect(screen.getByLabelText("这份岗位主要要求")).toHaveFocus();

    fireEvent.change(screen.getByLabelText("这份岗位主要要求"), {
      target: { value: "负责内容整理和数据记录" },
    });
    fireEvent.click(saveButton);
    expect(screen.getByLabelText("这次投递用的简历/材料")).toHaveFocus();

    fireEvent.change(screen.getByLabelText("这次投递用的简历/材料"), {
      target: { value: "社团经历版 V1" },
    });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    expect(loadDraft("applications_to_review")).toEqual({
      jobTitle: "内容运营实习",
      companyOrPlatform: "A 公司",
      submittedAt: "7 月 1 日",
      feedbackStatus: "暂无反馈",
      userSuspicion: "经历写得太泛",
      jdSummary: "负责内容整理和数据记录",
      materialVersion: "社团经历版 V1",
    });

    const completedOutput = withTestProvenance({
      ...jdActionOutput,
      routeKey: "applications_to_review" as const,
      routeResult: {
        reviewBasis: ["两条真实投递记录"],
        recordSufficiency: "两条记录足够做一次轻复盘",
        possibleClues: ["两条岗位都要求内容整理"],
        informationGaps: ["还缺后续反馈"],
        nextValidationAction: "继续记录下一次真实反馈",
      },
      todayAction: {
        ...jdActionOutput.todayAction,
        actionTitle: "今天先对照两条投递记录看一个线索",
        actionType: "application_record" as const,
      },
      recordGuide: {
        recordType: "application" as const,
        fieldsToRecord: ["jobTitle", "companyOrPlatform", "submittedAt", "feedbackStatus"],
        requiresUserConfirmation: true,
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => completedOutput,
    });
    vi.stubGlobal("fetch", fetchMock);

    cleanup();
    render(<RouteInputPage />);
    fireEvent.click(await screen.findByRole("button", { name: "生成今天先做的一步" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/routes/applications_to_review/action"));

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.input.applications[0]).toEqual({
      jobTitle: "内容运营实习",
      companyOrPlatform: "A 公司",
      submittedAt: "7 月 1 日",
      feedbackStatus: "暂无反馈",
      jdSummary: "负责内容整理和数据记录",
      materialVersion: "社团经历版 V1",
      userSuspicion: "经历写得太泛",
    });
    await expect((await fetchMock.mock.results[0].value).json()).resolves.toMatchObject({
      outputType: "route_result",
      todayAction: { actionTitle: "今天先对照两条投递记录看一个线索" },
    });
  });

  it("keeps friendly failure out of records while preserving the input draft", async () => {
    saveDraft("jd_to_revision", {
      targetJobTitle: "产品运营实习生",
      jdTextOrRequirements: "负责用户调研",
      userMaterial: "社团活动经历",
    });
    saveCurrentAction(friendlyFailureOutput);

    render(<RecordPage />);
    expect(await screen.findByText("这一步先不保存成完成记录")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存并看看下一步" })).not.toBeInTheDocument();
    expect(loadRecords()).toEqual([]);

    cleanup();
    render(<RouteInputPage />);
    expect(await screen.findByDisplayValue("产品运营实习生")).toBeInTheDocument();
    expect(screen.getByDisplayValue("负责用户调研")).toBeInTheDocument();
    expect(screen.getByDisplayValue("社团活动经历")).toBeInTheDocument();
  });

  it("submits two concrete application records for review judgment", async () => {
    routeKeyParam = "applications_to_review";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => withTestProvenance({
        ...missingInfoOutput,
        routeKey: "applications_to_review",
        recordGuide: {
          recordType: "application",
          fieldsToRecord: ["jobTitle", "companyOrPlatform", "submittedAt", "feedbackStatus"],
          requiresUserConfirmation: true,
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RouteInputPage />);

    expect(await screen.findByText("第 1 条（1/2）")).toBeInTheDocument();
    expect(screen.getByText(/至少需要两条可对照的投递记录/)).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText("第 1 条投递：岗位名称"), {
      target: { value: "内容运营实习" },
    });
    fireEvent.change(screen.getByLabelText("第 1 条投递：公司或平台"), {
      target: { value: "A 公司" },
    });
    fireEvent.change(screen.getByLabelText("第 1 条投递：投递时间"), {
      target: { value: "2026-07-01" },
    });
    fireEvent.change(screen.getByLabelText("第 1 条投递：当前反馈状态"), {
      target: { value: "暂无反馈" },
    });
    expect(screen.getByText(/至少需要两条可对照的投递记录/)).toBeInTheDocument();
    expect(screen.getByText(/不确定或暂时没有的内容可以直接这样写/)).toBeInTheDocument();
    expect(screen.getByText(/这份岗位主要要求示例：负责内容整理、活动执行和数据记录/)).toBeInTheDocument();
    expect(screen.getByText(/这次投递用的简历\/材料示例：社团经历版 V1/)).toBeInTheDocument();
    expect(screen.getByText(/示例：经历写得太泛/)).toBeInTheDocument();
    expect(screen.queryByText(/^JD$/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("第 2 条投递：岗位名称")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("第 1 条投递：这份岗位主要要求"), {
      target: { value: "负责内容整理" },
    });
    fireEvent.change(screen.getByLabelText("第 1 条投递：这次投递用的简历/材料"), {
      target: { value: "社团经历版" },
    });
    fireEvent.click(screen.getByRole("button", { name: "再补第 2 条投递记录" }));
    expect(screen.getByText("第 2 条（2/2）")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("第 2 条投递：岗位名称"), {
      target: { value: "新媒体运营实习" },
    });
    fireEvent.change(screen.getByLabelText("第 2 条投递：公司或平台"), {
      target: { value: "B 公司" },
    });
    fireEvent.change(screen.getByLabelText("第 2 条投递：投递时间"), {
      target: { value: "2026-07-03" },
    });
    fireEvent.change(screen.getByLabelText("第 2 条投递：当前反馈状态"), {
      target: { value: "已查看" },
    });
    fireEvent.change(screen.getByLabelText("第 2 条投递：这份岗位主要要求"), {
      target: { value: "负责选题和数据记录" },
    });
    fireEvent.change(screen.getByLabelText("第 2 条投递：这次投递用的简历/材料"), {
      target: { value: "项目经历版" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成今天先做的一步" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/routes/applications_to_review/action"));

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.input.applications).toEqual([
      {
        jobTitle: "内容运营实习",
        companyOrPlatform: "A 公司",
        submittedAt: "2026-07-01",
        feedbackStatus: "暂无反馈",
        jdSummary: "负责内容整理",
        materialVersion: "社团经历版",
        userSuspicion: "",
      },
      {
        jobTitle: "新媒体运营实习",
        companyOrPlatform: "B 公司",
        submittedAt: "2026-07-03",
        feedbackStatus: "已查看",
        jdSummary: "负责选题和数据记录",
        materialVersion: "项目经历版",
        userSuspicion: "",
      },
    ]);
  });

  it("keeps clear my records accessible when only a sensitive draft exists", async () => {
    saveDraft("jd_to_revision", { userMaterial: "仅草稿中的敏感简历片段" });
    expect(loadRecords()).toEqual([]);

    render(<TrackPage />);
    fireEvent.click(await screen.findByRole("button", { name: "清空我的记录" }));
    fireEvent.click(screen.getByRole("button", { name: "确认清空全部内容" }));

    expect(loadDraft("jd_to_revision")).toEqual({});

    cleanup();
    render(<Home />);
    expect(await screen.findByText("你现在最想先解决哪件事？")).toBeInTheDocument();
    expect(screen.queryByText(/仅草稿中的敏感简历片段/)).not.toBeInTheDocument();
  });

  it("keeps clear my records accessible when only a current action exists", async () => {
    saveCurrentAction(withTestProvenance({
      ...jdActionOutput,
      todayAction: { ...jdActionOutput.todayAction, actionTitle: "仅当前行动中的敏感内容" },
    }));
    expect(loadRecords()).toEqual([]);

    render(<TrackPage />);
    fireEvent.click(await screen.findByRole("button", { name: "清空我的记录" }));
    fireEvent.click(screen.getByRole("button", { name: "确认清空全部内容" }));

    expect(loadCurrentAction()).toBeNull();

    cleanup();
    render(<Home />);
    expect(await screen.findByText("你现在最想先解决哪件事？")).toBeInTheDocument();
    expect(screen.queryByText(/仅当前行动中的敏感内容/)).not.toBeInTheDocument();
  });

  it("returns home without restoring sensitive state after clicking clear my records", async () => {
    saveDraft("jd_to_revision", { userMaterial: "敏感旧简历片段" });
    saveCurrentAction(withTestProvenance({
      ...jdActionOutput,
      todayAction: { ...jdActionOutput.todayAction, actionTitle: "敏感旧行动" },
    }));
    const record = saveRecord({
      routeKey: "jd_to_revision",
      recordType: "jd_compare",
      actionTitle: "敏感旧行动",
      actualDone: "敏感旧完成内容",
      payload: { afterSnippet: "敏感旧简历片段" },
      userConfirmed: true,
    });
    saveReview({
      basedOnRecordIds: [record.id],
      routeKey: "jd_to_revision",
      reviewBasis: ["敏感旧复盘依据"],
      clues: ["敏感旧线索"],
      missingInfo: ["敏感旧缺口"],
      nextAction: "敏感旧下一步",
    });

    render(<TrackPage />);
    fireEvent.click(await screen.findByRole("button", { name: "清空我的记录" }));
    fireEvent.click(screen.getByRole("button", { name: "确认清空全部内容" }));

    cleanup();
    render(<Home />);

    expect(await screen.findByText("你现在最想先解决哪件事？")).toBeInTheDocument();
    expect(screen.queryByText(/敏感旧/)).not.toBeInTheDocument();
  });
});
