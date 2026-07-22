import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ActionPage from "@/app/routes/[routeKey]/action/page";
import RecordPage from "@/app/routes/[routeKey]/record/page";
import { generateRouteOutput } from "@/ai/orchestrator";
import { MockAiProvider } from "@/ai/mock-provider";
import { loadCurrentAction, mergeDraft, saveRecord, type CurrentAction } from "@/lib/local-store";

const push = vi.fn();
let routeKeyParam = "jd_to_revision";

vi.mock("next/navigation", () => ({
  useParams: () => ({ routeKey: routeKeyParam }),
  useRouter: () => ({ push }),
}));

vi.mock("@/lib/local-store", () => ({
  loadCurrentAction: vi.fn(),
  saveRecord: vi.fn(),
  mergeDraft: vi.fn(),
}));

const missingInfoOutput: CurrentAction = {
  routeKey: "jd_to_revision",
  outputType: "missing_info",
  actionId: "action-fill-jd",
  actionCreatedAt: "2026-07-21T04:00:00.000Z",
  shortAssessment: "现在还不能可靠判断这份岗位和你的材料支撑关系，因为还缺真实 JD。",
  routeResult: null,
  missingInfo: {
    cannotJudge: "材料与 JD 的支撑关系",
    alreadyKnown: ["目标岗位名称"],
    missingFields: ["真实 JD 或 3-5 条岗位要求"],
  },
  todayAction: {
    actionTitle: "今天先补这份岗位的真实 JD 或 3-5 条岗位要求",
    actionReason: "补完这一项后，系统才能继续整理今天先做的一步。",
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

const routeResultOutput: CurrentAction = {
  ...missingInfoOutput,
  outputType: "route_result",
  actionId: "action-jd-revision",
  actionCreatedAt: "2026-07-21T05:00:00.000Z",
  shortAssessment: "这份材料可以先做一处投递前最小修改。",
  missingInfo: null,
  routeResult: {
    supportedByMaterial: ["材料里能看到内容整理经历"],
    unclearFromMaterial: ["还看不出具体交付物"],
  },
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

const applicationOutput: CurrentAction = {
  ...routeResultOutput,
  routeKey: "applications_to_review",
  actionId: "action-application-record",
  shortAssessment: "先基于真实投递记录看一个可能线索。",
  routeResult: {
    reviewBasis: ["最近补充的投递记录"],
    possibleClues: ["部分记录还缺材料版本，后续不好判断修改是否有效"],
  },
  todayAction: {
    actionTitle: "今天先选择 1 条投递记录补齐材料版本",
    actionReason: "先让这条记录可复盘，再判断下一轮怎么调整。",
    actionSteps: [
      "选最近一条投递",
      "按这个格式补：岗位 / 公司或平台 / 投递时间 / 反馈状态",
      "JD 摘要和这次用的简历或材料版本不确定也可以先写“不确定”",
    ],
    estimatedTime: "15-30 分钟",
    recordAfterDone: "先记录岗位、公司或平台、投递时间和反馈状态；其他不确定的字段之后再补。",
    actionType: "application_record",
  },
  recordGuide: {
    recordType: "application",
    fieldsToRecord: ["jobTitle", "companyOrPlatform", "submittedAt", "materialVersion", "feedbackStatus"],
    requiresUserConfirmation: true,
  },
};

describe("ActionPage", () => {
  beforeEach(() => {
    push.mockReset();
    routeKeyParam = "jd_to_revision";
    vi.mocked(saveRecord).mockReset();
    vi.mocked(mergeDraft).mockReset();
    vi.mocked(loadCurrentAction).mockReturnValue(missingInfoOutput);
  });

  it("lets users record a completed missing-info action", async () => {
    render(<ActionPage />);

    const recordLink = await screen.findByRole("link", { name: "我补完了，去记录" });

    expect(recordLink).toHaveAttribute("href", "/routes/jd_to_revision/record");
  });

  it("shows concrete evidence behind the current action", async () => {
    vi.mocked(loadCurrentAction).mockReturnValue(routeResultOutput);

    render(<ActionPage />);

    expect(await screen.findByText("这一步基于：")).toBeInTheDocument();
    expect(screen.getByText("你提供的材料里有：材料里能看到内容整理经历")).toBeInTheDocument();
  });

  it("limits long evidence snippets before showing them", async () => {
    vi.mocked(loadCurrentAction).mockReturnValue({
      ...routeResultOutput,
      routeResult: {
        supportedByMaterial: [
          "这是一段很长很长的用户材料，包含学校项目细节、岗位要求原文、很多不适合直接铺满行动页的信息",
        ],
      },
    });

    render(<ActionPage />);

    expect(await screen.findByText(/^你提供的材料里有：这是一段很长很长的用户材料/)).toBeInTheDocument();
    expect(screen.queryByText(/很多不适合直接铺满行动页的信息/)).not.toBeInTheDocument();
  });

  it("blocks action pages when the saved action belongs to another route", async () => {
    vi.mocked(loadCurrentAction).mockReturnValue({
      ...routeResultOutput,
      routeKey: "experience_to_resume",
    });

    render(<ActionPage />);

    expect(await screen.findByText("这不是当前问题的行动")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "回到输入页" })).toHaveAttribute(
      "href",
      "/routes/jd_to_revision/input",
    );
    expect(screen.queryByText("今天先对照 JD 做 1 条投递前最小修改")).not.toBeInTheDocument();
  });
});

describe("RecordPage", () => {
  beforeEach(() => {
    push.mockReset();
    routeKeyParam = "jd_to_revision";
    vi.mocked(saveRecord).mockReset();
    vi.mocked(mergeDraft).mockReset();
    vi.mocked(loadCurrentAction).mockReturnValue(missingInfoOutput);
  });

  it("saves a fill-info record and merges the payload into the draft", async () => {
    render(<RecordPage />);

    await waitFor(() => expect(screen.getAllByRole("textbox")).toHaveLength(3));
    const textboxes = screen.getAllByRole("textbox");
    fireEvent.change(textboxes[1], { target: { value: "product operations intern" } });
    fireEvent.change(textboxes[2], { target: { value: "research, data整理, activity review" } });
    fireEvent.click(screen.getByRole("checkbox"));

    fireEvent.click(screen.getByRole("button"));

    expect(saveRecord).toHaveBeenCalledWith({
      actionId: "action-fill-jd",
      routeKey: "jd_to_revision",
      recordType: "fill_info",
      actionTitle: "今天先补这份岗位的真实 JD 或 3-5 条岗位要求",
      actualDone: "补充了 2 项信息",
      payload: {
        targetJobTitle: "product operations intern",
        jdTextOrRequirements: "research, data整理, activity review",
      },
      userConfirmed: true,
    });
    expect(mergeDraft).toHaveBeenCalledWith("jd_to_revision", {
      targetJobTitle: "product operations intern",
      jdTextOrRequirements: "research, data整理, activity review",
    });
    expect(push).toHaveBeenCalledWith("/routes/jd_to_revision/input");
  });

  it("saves completed route actions with their action id and continues to review", async () => {
    vi.mocked(loadCurrentAction).mockReturnValue(routeResultOutput);

    render(<RecordPage />);

    fireEvent.change(await screen.findByLabelText("实际完成了什么？"), {
      target: { value: "改完 JD 相关的一句话" },
    });
    fireEvent.change(screen.getByLabelText("修改前片段"), {
      target: { value: "原片段" },
    });
    fireEvent.change(screen.getByLabelText("修改后片段"), {
      target: { value: "加入了真实动作后的片段" },
    });
    fireEvent.click(screen.getByLabelText(/我确认这条记录反映了我实际做过的事/));

    fireEvent.click(screen.getByRole("button", { name: "保存并轻复盘" }));

    expect(saveRecord).toHaveBeenCalledWith({
      actionId: "action-jd-revision",
      routeKey: "jd_to_revision",
      recordType: "jd_compare",
      actionTitle: "今天先对照 JD 做 1 条投递前最小修改",
      actualDone: "改完 JD 相关的一句话",
      payload: {
        beforeSnippet: "原片段",
        afterSnippet: "加入了真实动作后的片段",
      },
      userConfirmed: true,
    });
    expect(push).toHaveBeenCalledWith("/review");
  });

  it("requires application records to include concrete review fields before saving", async () => {
    routeKeyParam = "applications_to_review";
    vi.mocked(loadCurrentAction).mockReturnValue({
      ...applicationOutput,
      recordGuide: {
        ...applicationOutput.recordGuide,
        fieldsToRecord: [
          "jobTitle",
          "companyOrPlatform",
          "submittedAt",
          "feedbackStatus",
          "jdSummary",
          "materialVersion",
        ],
      },
    });

    render(<RecordPage />);

    fireEvent.change(await screen.findByLabelText("实际完成了什么？"), {
      target: { value: "补了一条投递记录" },
    });
    fireEvent.change(screen.getByLabelText("岗位名称"), {
      target: { value: "内容运营实习" },
    });
    fireEvent.change(screen.getByLabelText("公司或平台"), {
      target: { value: "A 公司" },
    });
    fireEvent.change(screen.getByLabelText("投递时间"), {
      target: { value: "7 月 1 日" },
    });
    fireEvent.change(screen.getByLabelText("反馈状态"), {
      target: { value: "暂无反馈" },
    });
    fireEvent.click(screen.getByLabelText(/我确认这条记录反映了我实际做过的事/));

    expect(screen.getByRole("button", { name: "保存并轻复盘" })).toBeDisabled();
    expect(saveRecord).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("JD 摘要"), {
      target: { value: "负责内容整理和活动复盘" },
    });
    fireEvent.change(screen.getByLabelText("使用的材料版本"), {
      target: { value: "社团经历版" },
    });

    fireEvent.click(screen.getByRole("button", { name: "保存并轻复盘" }));

    expect(saveRecord).toHaveBeenCalledWith({
      actionId: "action-application-record",
      routeKey: "applications_to_review",
      recordType: "application",
      actionTitle: "今天先选择 1 条投递记录补齐材料版本",
      actualDone: "补了一条投递记录",
      payload: {
        jobTitle: "内容运营实习",
        companyOrPlatform: "A 公司",
        submittedAt: "7 月 1 日",
        feedbackStatus: "暂无反馈",
        jdSummary: "负责内容整理和活动复盘",
        materialVersion: "社团经历版",
      },
      userConfirmed: true,
    });
    expect(screen.getByLabelText("JD 摘要")).toBeInTheDocument();
  });

  it("saves an application fill-info record and merges the payload into the draft", async () => {
    routeKeyParam = "applications_to_review";
    const output = await generateRouteOutput({
      routeKey: "applications_to_review",
      input: { applications: {} },
      provider: new MockAiProvider("success"),
    });
    vi.mocked(loadCurrentAction).mockReturnValue({
      ...output,
      actionId: "action-application-missing",
      actionCreatedAt: "2026-07-21T05:30:00.000Z",
    });

    render(<RecordPage />);

    await waitFor(() => expect(screen.getAllByRole("textbox")).toHaveLength(7));
    const textboxes = screen.getAllByRole("textbox");
    fireEvent.change(textboxes[1], { target: { value: "content operations intern" } });
    fireEvent.change(textboxes[2], { target: { value: "A company" } });
    fireEvent.change(textboxes[3], { target: { value: "July 21" } });
    fireEvent.change(textboxes[4], { target: { value: "no feedback yet" } });
    fireEvent.change(textboxes[5], { target: { value: "content editing and campaign recap" } });
    fireEvent.change(textboxes[6], { target: { value: "resume version for campus club work" } });
    fireEvent.click(screen.getByRole("checkbox"));

    fireEvent.click(screen.getByRole("button"));

    expect(saveRecord).toHaveBeenCalledWith({
      actionId: "action-application-missing",
      routeKey: "applications_to_review",
      recordType: "application",
      actionTitle: "今天先补齐 2 条真实投递记录",
      actualDone: "补充了 6 项信息",
      payload: {
        jobTitle: "content operations intern",
        companyOrPlatform: "A company",
        submittedAt: "July 21",
        feedbackStatus: "no feedback yet",
        jdSummary: "content editing and campaign recap",
        materialVersion: "resume version for campus club work",
      },
      userConfirmed: true,
    });
    expect(mergeDraft).toHaveBeenCalledWith("applications_to_review", {
      jobTitle: "content operations intern",
      companyOrPlatform: "A company",
      submittedAt: "July 21",
      feedbackStatus: "no feedback yet",
      jdSummary: "content editing and campaign recap",
      materialVersion: "resume version for campus club work",
    });
    expect(push).toHaveBeenCalledWith("/routes/applications_to_review/input");
  });

  it("does not save friendly failure as a completed record", async () => {
    vi.mocked(loadCurrentAction).mockReturnValue({
      ...missingInfoOutput,
      outputType: "friendly_failure",
      recordGuide: {
        recordType: "draft",
        fieldsToRecord: ["draft"],
        requiresUserConfirmation: false,
      },
    });

    render(<RecordPage />);

    expect(await screen.findByText("这一步先不保存成完成记录")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存补充信息，继续判断" })).not.toBeInTheDocument();
    expect(saveRecord).not.toHaveBeenCalled();
  });
});
