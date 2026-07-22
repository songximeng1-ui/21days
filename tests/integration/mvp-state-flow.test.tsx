import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import ReviewPage from "@/app/review/page";
import RouteInputPage from "@/app/routes/[routeKey]/input/page";
import RecordPage from "@/app/routes/[routeKey]/record/page";
import type { RouteKey, RouteOutput } from "@/domain/types";
import { loadRecords, saveCurrentAction, saveDraft } from "@/lib/local-store";

const push = vi.fn();
let routeKeyParam: RouteKey = "jd_to_revision";

vi.mock("next/navigation", () => ({
  useParams: () => ({ routeKey: routeKeyParam }),
  useRouter: () => ({ push }),
}));

const jdActionOutput: RouteOutput = {
  routeKey: "jd_to_revision",
  outputType: "route_result",
  shortAssessment: "这份材料可以先做一处投递前最小修改。",
  routeResult: {
    supportedByMaterial: ["材料里能看到内容整理经历"],
    unclearFromMaterial: ["还看不出具体交付物"],
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
};

const missingInfoOutput: RouteOutput = {
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
};

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
    saveCurrentAction(jdActionOutput);
    render(<RecordPage />);

    fireEvent.change(await screen.findByLabelText("实际完成了什么？"), {
      target: { value: "改完 JD 相关的一句话。" },
    });
    fireEvent.change(screen.getByLabelText("修改前片段"), {
      target: { value: "原片段" },
    });
    fireEvent.change(screen.getByLabelText("修改后片段"), {
      target: { value: "加入真实动作后的片段" },
    });
    fireEvent.click(screen.getByLabelText(/我确认这条记录反映了我实际做过的事/));
    fireEvent.click(screen.getByRole("button", { name: "保存并轻复盘" }));

    expect(push).toHaveBeenCalledWith("/review");
    expect(loadRecords()).toHaveLength(1);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({
          routeKey: "jd_to_revision",
          outputType: "light_review",
          shortAssessment: "这条记录可以先做一次轻复盘。",
          routeResult: {
            reviewBasis: ["改完 JD 相关的一句话。"],
            clues: ["这次已经留下修改前后片段"],
            missingInfo: ["还缺投递后的反馈"],
            nextAction: "下一步先记录这次投递使用的材料版本。",
          },
          missingInfo: null,
          todayAction: {
            actionTitle: "下一步先记录这次投递使用的材料版本",
            actionReason: "材料版本清楚后，后续反馈才有依据。",
            actionSteps: ["打开这条记录", "补材料版本", "保存修改"],
            estimatedTime: "15-30 分钟",
            recordAfterDone: "记录材料版本。",
            actionType: "fill_info",
          },
          recordGuide: {
            recordType: "fill_info",
            fieldsToRecord: ["materialVersion"],
            requiresUserConfirmation: true,
          },
        }),
      }),
    );

    cleanup();
    render(<ReviewPage />);
    expect(await screen.findByText("已根据这条记录生成轻复盘。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "设为下一次行动" }));

    cleanup();
    render(<Home />);
    expect(await screen.findByText("最近推进：改完 JD 相关的一句话。")).toBeInTheDocument();
    expect(screen.getByText("下一步先记录这次投递使用的材料版本。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "继续：下一步先记录这次投递使用的材料版本。" })).toHaveAttribute(
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
    fireEvent.change(screen.getByLabelText("真实 JD 或 3-5 条岗位要求"), {
      target: { value: "负责用户调研、数据整理、活动复盘" },
    });
    fireEvent.click(screen.getByLabelText(/我确认这条记录反映了我实际做过的事/));
    fireEvent.click(screen.getByRole("button", { name: "保存补充信息，继续判断" }));

    expect(push).toHaveBeenCalledWith("/routes/jd_to_revision/input");
    expect(loadRecords()).toEqual([
      expect.objectContaining({
        routeKey: "jd_to_revision",
        recordType: "fill_info",
        actualDone: "补充了 2 项信息",
      }),
    ]);

    cleanup();
    render(<RouteInputPage />);
    expect(await screen.findByDisplayValue("产品运营实习生")).toBeInTheDocument();
    expect(screen.getByDisplayValue("社团活动经历")).toBeInTheDocument();
    expect(screen.getByDisplayValue("负责用户调研、数据整理、活动复盘")).toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: "保存并轻复盘" })).not.toBeInTheDocument();
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
      json: async () => missingInfoOutput,
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RouteInputPage />);

    fireEvent.change(await screen.findByLabelText("第 1 条投递：岗位名称"), {
      target: { value: "内容运营实习" },
    });
    fireEvent.change(screen.getByLabelText("第 1 条投递：公司或平台"), {
      target: { value: "A 公司" },
    });
    fireEvent.change(screen.getByLabelText("第 1 条投递：投递时间"), {
      target: { value: "7 月 1 日" },
    });
    fireEvent.change(screen.getByLabelText("第 1 条投递：当前反馈状态"), {
      target: { value: "暂无反馈" },
    });
    expect(screen.queryByLabelText(/可先写“不确定”/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/可先不填/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("第 2 条投递：岗位名称")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("第 1 条投递：岗位要求摘要"), {
      target: { value: "负责内容整理" },
    });
    fireEvent.change(screen.getByLabelText("第 1 条投递：使用的材料版本"), {
      target: { value: "社团经历版" },
    });
    fireEvent.click(screen.getByRole("button", { name: "再补第 2 条投递记录" }));
    fireEvent.change(screen.getByLabelText("第 2 条投递：岗位名称"), {
      target: { value: "新媒体运营实习" },
    });
    fireEvent.change(screen.getByLabelText("第 2 条投递：公司或平台"), {
      target: { value: "B 公司" },
    });
    fireEvent.change(screen.getByLabelText("第 2 条投递：投递时间"), {
      target: { value: "7 月 3 日" },
    });
    fireEvent.change(screen.getByLabelText("第 2 条投递：当前反馈状态"), {
      target: { value: "已查看" },
    });
    fireEvent.change(screen.getByLabelText("第 2 条投递：岗位要求摘要"), {
      target: { value: "负责选题和数据记录" },
    });
    fireEvent.change(screen.getByLabelText("第 2 条投递：使用的材料版本"), {
      target: { value: "项目经历版" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成今天先做的一步" }));

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.input.applications).toEqual([
      {
        jobTitle: "内容运营实习",
        companyOrPlatform: "A 公司",
        submittedAt: "7 月 1 日",
        feedbackStatus: "暂无反馈",
        jdSummary: "负责内容整理",
        materialVersion: "社团经历版",
        userSuspicion: "",
      },
      {
        jobTitle: "新媒体运营实习",
        companyOrPlatform: "B 公司",
        submittedAt: "7 月 3 日",
        feedbackStatus: "已查看",
        jdSummary: "负责选题和数据记录",
        materialVersion: "项目经历版",
        userSuspicion: "",
      },
    ]);
  });
});
