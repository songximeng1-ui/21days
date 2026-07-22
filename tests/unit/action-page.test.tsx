import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ActionPage from "@/app/routes/[routeKey]/action/page";
import RecordPage from "@/app/routes/[routeKey]/record/page";
import { generateRouteOutput } from "@/ai/orchestrator";
import { MockAiProvider } from "@/ai/mock-provider";
import { loadCurrentAction, loadDraft, mergeDraft, saveRecord, type CurrentAction } from "@/lib/local-store";

const push = vi.fn();
let routeKeyParam = "jd_to_revision";

vi.mock("next/navigation", () => ({
  useParams: () => ({ routeKey: routeKeyParam }),
  useRouter: () => ({ push }),
}));

vi.mock("@/lib/local-store", () => ({
  loadCurrentAction: vi.fn(),
  loadDraft: vi.fn(() => ({})),
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
      "按这个格式补：岗位 / 公司或平台 / 投递时间 / 反馈状态 / JD 摘要 / 材料版本",
      "只写能确认的真实信息，先把这条记录补到可以复盘",
    ],
    estimatedTime: "15-30 分钟",
    recordAfterDone: "记录岗位、公司或平台、投递时间、反馈状态、JD 摘要和材料版本。",
    actionType: "application_record",
  },
  recordGuide: {
    recordType: "application",
    fieldsToRecord: ["jobTitle", "companyOrPlatform", "submittedAt", "feedbackStatus", "jdSummary", "materialVersion"],
    requiresUserConfirmation: true,
  },
};

describe("ActionPage", () => {
  beforeEach(() => {
    push.mockReset();
    routeKeyParam = "jd_to_revision";
    vi.mocked(saveRecord).mockReset();
    vi.mocked(mergeDraft).mockReset();
    vi.mocked(loadDraft).mockReturnValue({});
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

  it("does not label model-inferred review clues as user-provided material", async () => {
    routeKeyParam = "applications_to_review";
    vi.mocked(loadCurrentAction).mockReturnValue(applicationOutput);

    render(<ActionPage />);

    expect(await screen.findByText("基于记录看到的可能线索：部分记录还缺材料版本，后续不好判断修改是否有效")).toBeInTheDocument();
    expect(screen.queryByText("你提供的材料里有：部分记录还缺材料版本，后续不好判断修改是否有效")).not.toBeInTheDocument();
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

    const { container } = render(<ActionPage />);

    expect(await screen.findByText(/^你提供的材料里有：这是一段很长很长的用户材料/)).toBeInTheDocument();
    expect(container.querySelector(".evidence-block")?.textContent).not.toContain("很多不适合直接铺满行动页的信息");
  });

  it.each([
    [
      "direction_to_jobs",
      {
        explorableDirections: [{
          directionName: "用户研究助理",
          searchKeywords: ["用户研究实习", "研究助理"],
          basisFromUserMaterial: ["做过课程访谈"],
          riskOrGap: "还缺真实岗位样本",
          validationFocus: "观察访谈和资料整理要求",
        }],
      },
      ["可以先探索的方向", "用户研究助理", "用户研究实习"],
    ],
    [
      "experience_to_resume",
      {
        confirmedFacts: ["整理实验样品记录"],
        missingFacts: ["还缺持续时间"],
        doNotExaggerate: ["不要把协助写成负责"],
        resumeSnippetDraft: "协助整理实验样品记录。",
        supportingFacts: ["整理实验样品记录"],
      },
      ["已经能确认的事实", "还缺哪些事实", "克制简历片段", "协助整理实验样品记录。"],
    ],
    [
      "jd_to_revision",
      {
        jdKeyRequirements: ["整理用户反馈"],
        supportedByMaterial: ["做过访谈记录整理"],
        unclearFromMaterial: ["还看不出汇报方式"],
        minimalRevisionActions: ["补一条访谈记录整理动作"],
        afterSubmissionRecording: ["记录材料版本"],
      },
      ["这个岗位最看重什么", "你的材料目前能支撑什么", "当前还看不出来什么", "投递前最小修改"],
    ],
    [
      "applications_to_review",
      {
        reviewBasis: ["内容运营实习 / A 公司"],
        recordSufficiency: "enough",
        possibleClues: ["两条记录使用了同一材料版本"],
        informationGaps: ["还缺一条岗位要求摘要"],
        nextValidationAction: "下一轮先改一条材料表达",
      },
      ["本次复盘依据", "能看到的线索", "信息缺口", "下一步行动"],
    ],
  ] as const)("shows the core route result for %s", async (routeKey, routeResult, expectedTexts) => {
    routeKeyParam = routeKey;
    vi.mocked(loadCurrentAction).mockReturnValue({
      ...routeResultOutput,
      routeKey,
      routeResult,
    });

    render(<ActionPage />);

    for (const text of expectedTexts) {
      expect(await screen.findByText(text)).toBeInTheDocument();
    }
  });

  it("places the today action before evidence and route details in the DOM", async () => {
    vi.mocked(loadCurrentAction).mockReturnValue({
      ...routeResultOutput,
      routeResult: {
        jdKeyRequirements: ["整理用户反馈"],
        supportedByMaterial: ["做过访谈记录整理"],
        unclearFromMaterial: ["还看不出汇报方式"],
        minimalRevisionActions: ["补一条访谈记录整理动作"],
      },
    });

    const { container } = render(<ActionPage />);
    await screen.findByText("投递前最小修改");

    const action = container.querySelector(".action-card");
    const evidence = container.querySelector(".evidence-block");
    const details = container.querySelector(".route-result");
    expect(action).not.toBeNull();
    expect(evidence).not.toBeNull();
    expect(details).not.toBeNull();
    expect(action?.compareDocumentPosition(evidence as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(action?.compareDocumentPosition(details as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    vi.mocked(loadDraft).mockReturnValue({});
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

  it("saves the four minimum application fields and keeps review details optional", async () => {
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

    expect(screen.getByLabelText("JD 摘要（第二层补充，可先不填）")).toHaveAttribute(
      "placeholder",
      expect.stringContaining("例如"),
    );
    expect(screen.getByLabelText("使用的材料版本（第二层补充，可先不填）")).toHaveAttribute(
      "placeholder",
      expect.stringContaining("例如"),
    );

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
      },
      userConfirmed: true,
    });
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

    await waitFor(() => expect(screen.getAllByRole("textbox")).toHaveLength(5));
    const textboxes = screen.getAllByRole("textbox");
    fireEvent.change(textboxes[1], { target: { value: "content operations intern" } });
    fireEvent.change(textboxes[2], { target: { value: "A company" } });
    fireEvent.change(textboxes[3], { target: { value: "July 21" } });
    fireEvent.change(textboxes[4], { target: { value: "no feedback yet" } });
    fireEvent.click(screen.getByRole("checkbox"));

    fireEvent.click(screen.getByRole("button"));

    expect(saveRecord).toHaveBeenCalledWith({
      actionId: "action-application-missing",
      routeKey: "applications_to_review",
      recordType: "application",
      actionTitle: "今天先补齐第 1 条最低字段投递记录",
      actualDone: "补充了 4 项信息",
      payload: {
        jobTitle: "content operations intern",
        companyOrPlatform: "A company",
        submittedAt: "July 21",
        feedbackStatus: "no feedback yet",
      },
      userConfirmed: true,
    });
    expect(mergeDraft).toHaveBeenCalledWith("applications_to_review", {
      jobTitle: "content operations intern",
      companyOrPlatform: "A company",
      submittedAt: "July 21",
      feedbackStatus: "no feedback yet",
    });
    expect(push).toHaveBeenCalledWith("/routes/applications_to_review/input");
  });

  it("prefills and preserves two confirmed application records from the input draft", async () => {
    routeKeyParam = "applications_to_review";
    vi.mocked(loadCurrentAction).mockReturnValue(applicationOutput);
    const twoApplications = {
      jobTitle: "内容运营实习",
      companyOrPlatform: "A 公司",
      submittedAt: "7 月 1 日",
      feedbackStatus: "暂无反馈",
      jdSummary: "负责内容整理",
      materialVersion: "社团经历版",
      userSuspicion: "表达可能太泛",
      jobTitle2: "新媒体运营实习",
      companyOrPlatform2: "B 公司",
      submittedAt2: "7 月 3 日",
      feedbackStatus2: "已查看",
      jdSummary2: "负责选题和数据记录",
      materialVersion2: "项目经历版",
      userSuspicion2: "缺少数据记录细节",
    };
    vi.mocked(loadDraft).mockReturnValue(twoApplications);

    render(<RecordPage />);

    expect(await screen.findByDisplayValue("内容运营实习")).toBeInTheDocument();
    expect(screen.getByDisplayValue("新媒体运营实习")).toBeInTheDocument();
    expect(screen.getByDisplayValue("负责选题和数据记录")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("实际完成了什么？"), {
      target: { value: "确认了两条投递记录" },
    });
    fireEvent.click(screen.getByLabelText(/我确认这条记录反映了我实际做过的事/));
    fireEvent.click(screen.getByRole("button", { name: "保存并轻复盘" }));

    expect(saveRecord).toHaveBeenCalledWith(expect.objectContaining({
      routeKey: "applications_to_review",
      recordType: "application",
      actualDone: "确认了两条投递记录",
      payload: twoApplications,
      userConfirmed: true,
    }));
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
