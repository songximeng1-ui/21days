import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ActionPage from "@/app/routes/[routeKey]/action/page";
import RecordPage from "@/app/routes/[routeKey]/record/page";
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
  runLocalStoreTransaction: vi.fn((operation: () => unknown) => operation()),
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
    jdKeyRequirements: ["负责内容整理"],
    supportedByMaterial: ["材料里能看到内容整理经历"],
    unclearFromMaterial: ["还看不出具体交付物"],
    minimalRevisionActions: ["只改材料里的内容整理原句"],
    revisionTarget: "材料里能看到内容整理经历",
    candidateRevision: "整理活动内容并形成发布清单。",
    evidenceCheck: "核对活动清单或发布记录。",
  },
  todayAction: {
    actionTitle: "今天先对照 JD 做 1 条投递前最小修改",
    actionReason: "先改最能支撑 JD 的一处表达。",
    actionSteps: ["圈出 JD 的 1 条关键要求", "找到材料里对应经历", "补 1 个真实动作"],
    estimatedTime: "15-30 分钟",
    recordAfterDone: "记录修改前后片段。",
    completionStandard: "已保存同一段材料的修改前后版本，候选句只包含能核对的事实。",
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
    possibleClues: ["部分记录还缺这次投递用的简历/材料，后续不好判断修改是否有效"],
  },
  todayAction: {
    actionTitle: "今天先选择 1 条投递记录，补齐这次投递用的简历/材料",
    actionReason: "先让这条记录可回头检查，再判断下一轮怎么调整。",
    actionSteps: [
      "选最近一条投递",
      "按这个格式补：岗位 / 公司或平台 / 投递时间 / 反馈状态 / 这份岗位主要要求 / 这次投递用的简历或材料",
      "只写能确认的真实信息，先把这条记录补到可以回头检查",
    ],
    estimatedTime: "15-30 分钟",
    recordAfterDone: "记录岗位、公司或平台、投递时间、反馈状态、这份岗位主要要求和这次投递用的简历/材料。",
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

  it("keeps the reduced action completion standard visible on the action page", async () => {
    vi.mocked(loadCurrentAction).mockReturnValue({
      ...routeResultOutput,
      reducedContinuation: true,
      todayAction: {
        ...routeResultOutput.todayAction,
        estimatedTime: "5-10 分钟",
        completionStandard: "完成并保存 1 个可核对结果。",
      },
    } as CurrentAction);

    render(<ActionPage />);

    expect(
      await screen.findByText("完成标准：完成并保存 1 个可核对结果。"),
    ).toBeInTheDocument();
  });

  it("shows a real loading state before an empty current-action state", async () => {
    vi.mocked(loadCurrentAction).mockReturnValue(null);

    render(<ActionPage />);

    expect(screen.getByRole("status")).toHaveTextContent("正在读取今天的行动");
    expect(await screen.findByText("还没有当前行动")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("shows one JD action with labeled evidence and completion metadata instead of repeated report cards", async () => {
    vi.mocked(loadCurrentAction).mockReturnValue(routeResultOutput);

    render(<ActionPage />);

    expect(await screen.findByRole("heading", { name: "今天只做这一件事" })).toBeInTheDocument();
    expect(screen.getByText("预计用时：15-30 分钟")).toBeInTheDocument();
    expect(screen.getByText(/完成标准：已保存同一段材料的修改前后版本/)).toBeInTheDocument();
    expect(screen.getByText("完成后记录：记录修改前后片段。" )).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "这次对照的岗位要求" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "当前材料证据" })).not.toBeInTheDocument();
    expect(screen.getAllByText("材料里能看到内容整理经历")).toHaveLength(1);
    expect(screen.queryByText("这一步基于：")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "投递前最小修改" })).not.toBeInTheDocument();
  });

  it("does not label model-inferred review clues as user-provided material", async () => {
    routeKeyParam = "applications_to_review";
    vi.mocked(loadCurrentAction).mockReturnValue(applicationOutput);

    render(<ActionPage />);

    expect(await screen.findByText("基于记录看到的可能线索：部分记录还缺这次投递用的简历/材料，后续不好判断修改是否有效")).toBeInTheDocument();
    expect(screen.queryByText("你提供的材料里有：部分记录还缺这次投递用的简历/材料，后续不好判断修改是否有效")).not.toBeInTheDocument();
  });

  it("limits long evidence snippets before showing them", async () => {
    vi.mocked(loadCurrentAction).mockReturnValue({
      ...routeResultOutput,
      routeResult: {
        ...routeResultOutput.routeResult,
        supportedByMaterial: [
          "这是一段很长很长的用户材料，包含学校项目细节、岗位要求原文、很多不适合直接铺满行动页的信息",
        ],
      },
    });

    const { container } = render(<ActionPage />);

    expect(await screen.findByRole("heading", { name: "当前材料证据" })).toBeInTheDocument();
    expect(screen.getByText(/^这是一段很长很长的用户材料/)).toBeInTheDocument();
    expect(container.querySelector(".route-result")?.textContent).not.toContain("很多不适合直接铺满行动页的信息");
  });

  it("collapses a JD evidence gap and unavailable candidate into one result block", async () => {
    vi.mocked(loadCurrentAction).mockReturnValue({
      ...routeResultOutput,
      routeResult: {
        ...routeResultOutput.routeResult,
        supportedByMaterial: [],
        candidateRevision: null,
        unclearFromMaterial: ["这是一句能力总结，尚不能证明实际做过对应的岗位动作。"],
      },
    });

    render(<ActionPage />);

    expect(await screen.findByRole("heading", { name: "证据与候选文本" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "当前材料证据" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "候选文本" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "当前仍缺的证据" })).not.toBeInTheDocument();
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
        revisionTarget: "做过访谈记录整理",
        candidateRevision: "整理访谈记录并形成问题清单。",
        evidenceCheck: "核对访谈记录或问题清单。",
      },
      ["这次对照的岗位要求", "要核对的原句", "有证据后可使用的候选文本"],
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
      ["这次根据什么判断", "能看到的线索", "信息缺口", "下一步行动"],
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

  it("places the JD action before compact route details without a duplicate evidence block", async () => {
    vi.mocked(loadCurrentAction).mockReturnValue({
      ...routeResultOutput,
      routeResult: {
        jdKeyRequirements: ["整理用户反馈"],
        supportedByMaterial: ["做过访谈记录整理"],
        unclearFromMaterial: ["还看不出汇报方式"],
        minimalRevisionActions: ["补一条访谈记录整理动作"],
        revisionTarget: "做过访谈记录整理",
        candidateRevision: "整理访谈记录并形成问题清单。",
        evidenceCheck: "核对访谈记录或问题清单。",
      },
    });

    const { container } = render(<ActionPage />);
    await screen.findByText("这次对照的岗位要求");

    const action = container.querySelector(".action-card");
    const evidence = container.querySelector(".evidence-block");
    const details = container.querySelector(".route-result");
    expect(action).not.toBeNull();
    expect(evidence).toBeNull();
    expect(details).not.toBeNull();
    expect(action!.compareDocumentPosition(details as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

  it("prefills the exact JD edit target and grounded candidate instead of the whole material", async () => {
    vi.mocked(loadCurrentAction).mockReturnValue(routeResultOutput);
    vi.mocked(loadDraft).mockReturnValue({
      targetJobTitle: "内容运营实习生",
      userMaterial: "这里是一整段包含多项经历的原材料",
      jdTextOrRequirements: "负责内容整理",
    });

    render(<RecordPage />);

    expect(await screen.findByLabelText("修改前片段")).toHaveValue("材料里能看到内容整理经历");
    expect(screen.getByLabelText("修改后片段")).toHaveValue("整理活动内容并形成发布清单。");
  });

  it("saves a fill-info record and merges the payload into the draft", async () => {
    render(<RecordPage />);

    await waitFor(() => expect(screen.getAllByRole("textbox")).toHaveLength(3));
    const textboxes = screen.getAllByRole("textbox");
    fireEvent.change(textboxes[0], { target: { value: "补齐并核对了真实岗位要求" } });
    fireEvent.change(textboxes[1], { target: { value: "product operations intern" } });
    fireEvent.change(textboxes[2], { target: { value: "research, data整理, activity review" } });
    fireEvent.click(screen.getByRole("checkbox"));

    fireEvent.click(screen.getByRole("button"));

    expect(saveRecord).toHaveBeenCalledWith({
      actionId: "action-fill-jd",
      routeKey: "jd_to_revision",
      recordType: "fill_info",
      actionTitle: "今天先补这份岗位的真实 JD 或 3-5 条岗位要求",
      actualDone: "补齐并核对了真实岗位要求",
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

  it("rolls back the fill-info transaction and stays put when draft merge fails", async () => {
    vi.mocked(mergeDraft).mockImplementation(() => {
      throw new Error("quota");
    });
    render(<RecordPage />);

    await waitFor(() => expect(screen.getAllByRole("textbox")).toHaveLength(3));
    const textboxes = screen.getAllByRole("textbox");
    fireEvent.change(textboxes[0], { target: { value: "补齐并核对了真实岗位要求" } });
    fireEvent.change(textboxes[1], { target: { value: "运营实习" } });
    fireEvent.change(textboxes[2], { target: { value: "负责数据整理" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button"));

    expect(saveRecord).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "这次没有保存成功。你填写的内容还在本页，请稍后重试。",
    );
    expect(textboxes[1]).toHaveValue("运营实习");
    expect(push).not.toHaveBeenCalled();

    vi.mocked(mergeDraft).mockReset();
    fireEvent.click(screen.getByRole("button"));
    expect(push).toHaveBeenCalledWith("/routes/jd_to_revision/input");
  });

  it("saves completed route actions with their action id and continues to review", async () => {
    vi.mocked(loadCurrentAction).mockReturnValue(routeResultOutput);
    vi.mocked(loadDraft).mockReturnValue({
      targetJobTitle: "内容运营实习生",
      userMaterial: "原片段",
      jdTextOrRequirements: "负责内容整理",
    });

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
    fireEvent.change(screen.getByLabelText("是否已经投递"), {
      target: { value: "尚未投递" },
    });
    fireEvent.click(screen.getByLabelText(/我确认这条记录反映了我实际做过的事/));

    fireEvent.click(screen.getByRole("button", { name: "保存并看看下一步" }));

    expect(saveRecord).toHaveBeenCalledWith({
      actionId: "action-jd-revision",
      routeKey: "jd_to_revision",
      recordType: "jd_compare",
      actionTitle: "今天先对照 JD 做 1 条投递前最小修改",
      actualDone: "改完 JD 相关的一句话",
      payload: {
        targetJobTitle: "内容运营实习生",
        beforeSnippet: "原片段",
        afterSnippet: "加入了真实动作后的片段",
        jdRequirement: "负责内容整理",
        submitted: "尚未投递",
      },
      userConfirmed: true,
    });
    expect(push).toHaveBeenCalledWith("/review");
  });

  it("uses the current JD action clarity contract with the canonical record fields", async () => {
    vi.mocked(loadCurrentAction).mockReturnValue(routeResultOutput);
    vi.mocked(loadDraft).mockReturnValue({
      targetJobTitle: "内容运营实习生",
      userMaterial: "整理社团推文并记录阅读数据",
      jdTextOrRequirements: "负责内容整理和数据复盘",
    });

    render(<RecordPage />);

    expect(await screen.findByLabelText("目标岗位名称")).toHaveValue("内容运营实习生");
    expect(screen.getByLabelText("修改前片段")).toHaveValue("材料里能看到内容整理经历");
    expect(screen.getByLabelText("对应的岗位要求")).toHaveValue("负责内容整理和数据复盘");
    expect(screen.getByLabelText("修改后片段")).toBeRequired();
    expect(screen.getByLabelText("是否已经投递")).toBeRequired();
    expect(screen.getByRole("status", { name: "保存前还需完成" })).toHaveTextContent(
      "实际完成了什么、是否已经投递、真实性确认",
    );
  });

  it("names the exact missing requirements instead of only disabling save", async () => {
    vi.mocked(loadCurrentAction).mockReturnValue(routeResultOutput);

    render(<RecordPage />);

    expect(await screen.findByRole("status", { name: "保存前还需完成" })).toHaveTextContent(
      "实际完成了什么、目标岗位名称、对应的岗位要求、是否已经投递、真实性确认",
    );
    expect(screen.getByLabelText("实际完成了什么？")).toBeRequired();
    expect(screen.getByLabelText("修改前片段")).toBeRequired();
    expect(screen.getByLabelText("修改后片段")).toBeRequired();

    const actualDone = screen.getByLabelText("实际完成了什么？");
    expect(actualDone).toHaveAttribute("aria-invalid", "true");
    expect(actualDone.getAttribute("aria-describedby")).toContain(
      "record-missing-requirements",
    );

    const saveButton = screen.getByRole("button", { name: "保存并看看下一步" });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);
    expect(actualDone).toHaveFocus();
    expect(saveRecord).not.toHaveBeenCalled();
  });

  it("keeps typed record data on screen and does not navigate when local save fails", async () => {
    vi.mocked(loadCurrentAction).mockReturnValue(routeResultOutput);
    vi.mocked(loadDraft).mockReturnValue({
      targetJobTitle: "内容运营实习生",
      userMaterial: "原片段",
      jdTextOrRequirements: "负责内容整理",
    });
    vi.mocked(saveRecord).mockImplementation(() => {
      throw new Error("quota");
    });
    render(<RecordPage />);
    const actualDoneField = await screen.findByLabelText("实际完成了什么？");
    fireEvent.change(actualDoneField, { target: { value: "改完了一句话" } });
    fireEvent.change(screen.getByLabelText("修改前片段"), {
      target: { value: "原片段" },
    });
    fireEvent.change(screen.getByLabelText("修改后片段"), {
      target: { value: "加入真实动作后的片段" },
    });
    fireEvent.change(screen.getByLabelText("是否已经投递"), {
      target: { value: "尚未投递" },
    });
    fireEvent.click(screen.getByLabelText(/我确认这条记录反映了我实际做过的事/));

    fireEvent.click(screen.getByRole("button", { name: "保存并看看下一步" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "这次没有保存成功。你填写的内容还在本页，请稍后重试。",
    );
    expect(actualDoneField).toHaveValue("改完了一句话");
    expect(push).not.toHaveBeenCalled();
  });

  it("prefills canonical JD record facts and keeps them when the first save fails", async () => {
    vi.mocked(loadCurrentAction).mockReturnValue({
      ...routeResultOutput,
      recordGuide: {
        recordType: "jd_compare",
        fieldsToRecord: [
          "targetJobTitle",
          "beforeSnippet",
          "afterSnippet",
          "jdRequirement",
          "submitted",
        ],
        requiresUserConfirmation: true,
      },
    });
    vi.mocked(loadDraft).mockReturnValue({
      targetJobTitle: "内容运营实习生",
      userMaterial: "整理社团推文并记录阅读数据",
      jdTextOrRequirements: "负责选题和数据记录",
    });
    vi.mocked(saveRecord).mockImplementationOnce(() => {
      throw new Error("quota");
    });

    render(<RecordPage />);

    expect(await screen.findByLabelText("目标岗位名称")).toHaveValue("内容运营实习生");
    expect(screen.getByLabelText("目标岗位名称")).toBeRequired();
    expect(screen.getByLabelText("修改前片段")).toHaveValue("材料里能看到内容整理经历");
    expect(screen.getByLabelText("对应的岗位要求")).toHaveValue("负责选题和数据记录");
    expect(screen.getByLabelText("修改后片段")).toHaveValue("整理活动内容并形成发布清单。");
    expect(screen.getByLabelText("是否已经投递")).toHaveValue("");

    fireEvent.change(screen.getByLabelText("实际完成了什么？"), {
      target: { value: "完成了针对目标岗位的一处修改" },
    });
    fireEvent.change(screen.getByLabelText("修改后片段"), {
      target: { value: "整理社团推文，并记录阅读数据用于复盘" },
    });
    fireEvent.change(screen.getByLabelText("是否已经投递"), {
      target: { value: "尚未投递" },
    });
    fireEvent.click(screen.getByLabelText(/我确认这条记录反映了我实际做过的事/));
    fireEvent.click(screen.getByRole("button", { name: "保存并看看下一步" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("这次没有保存成功");
    expect(screen.getByLabelText("目标岗位名称")).toHaveValue("内容运营实习生");
    expect(screen.getByLabelText("修改后片段")).toHaveValue("整理社团推文，并记录阅读数据用于复盘");
    expect(push).not.toHaveBeenCalled();

    vi.mocked(saveRecord).mockReset();
    fireEvent.click(screen.getByRole("button", { name: "保存并看看下一步" }));
    expect(saveRecord).toHaveBeenCalledWith(expect.objectContaining({
      payload: {
        targetJobTitle: "内容运营实习生",
        beforeSnippet: "材料里能看到内容整理经历",
        afterSnippet: "整理社团推文，并记录阅读数据用于复盘",
        jdRequirement: "负责选题和数据记录",
        submitted: "尚未投递",
      },
    }));
  });

  it("prefills a resume snippet with its facts and saves a confirmed linked version", async () => {
    routeKeyParam = "experience_to_resume";
    vi.mocked(loadCurrentAction).mockReturnValue({
      ...routeResultOutput,
      routeKey: "experience_to_resume",
      actionId: "action-resume-snippet",
      routeResult: {
        confirmedFacts: ["参与社团招新", "整理报名表"],
        supportingFacts: ["整理报名表", "形成报名名单"],
        missingFacts: ["还缺报名人数"],
        resumeSnippetDraft: "参与社团招新，整理报名信息并形成名单。",
      },
      todayAction: {
        ...routeResultOutput.todayAction,
        actionTitle: "确认并保存这一段克制简历片段",
        actionType: "resume_snippet",
      },
      recordGuide: {
        recordType: "experience_fact",
        fieldsToRecord: ["actualActions", "deliverable", "missingFacts"],
        requiresUserConfirmation: true,
      },
    });
    vi.mocked(saveRecord)
      .mockReturnValueOnce({ id: "experience-1" } as never)
      .mockReturnValueOnce({ id: "snippet-1" } as never);

    render(<RecordPage />);

    expect(await screen.findByDisplayValue("参与社团招新；整理报名表")).toBeInTheDocument();
    expect(screen.getByDisplayValue("整理报名表；形成报名名单")).toBeInTheDocument();
    expect(screen.getByDisplayValue("还缺报名人数")).toBeInTheDocument();
    const snippet = screen.getByLabelText("克制简历片段");
    expect(snippet).toHaveValue("参与社团招新，整理报名信息并形成名单。");
    fireEvent.change(snippet, {
      target: { value: "参与社团招新，整理报名信息并形成报名名单。" },
    });
    fireEvent.change(screen.getByLabelText("实际完成了什么？"), {
      target: { value: "核对并保存了这段简历片段" },
    });
    fireEvent.click(screen.getByLabelText(/我确认这条记录反映了我实际做过的事/));
    fireEvent.click(screen.getByRole("button", { name: "保存并看看下一步" }));

    expect(saveRecord).toHaveBeenNthCalledWith(1, expect.objectContaining({
      actionId: "action-resume-snippet",
      recordType: "experience_fact",
      actualDone: "核对并保存了这段简历片段",
      payload: expect.objectContaining({
        confirmedFacts: "参与社团招新；整理报名表",
        supportingFacts: "整理报名表；形成报名名单",
        missingFacts: "还缺报名人数",
      }),
      userConfirmed: true,
    }));
    expect(saveRecord).toHaveBeenNthCalledWith(2, expect.objectContaining({
      actionId: "action-resume-snippet",
      recordType: "resume_snippet",
      payload: {
        sourceExperienceId: "experience-1",
        resumeSnippet: "参与社团招新，整理报名信息并形成报名名单。",
        supportingFacts: "整理报名表；形成报名名单",
        stillMissing: "还缺报名人数",
      },
      userConfirmed: true,
    }));
    expect(push).toHaveBeenCalledWith("/review");
  });

  it("blocks a post-generation resume edit that adds facts absent from its sources", async () => {
    routeKeyParam = "experience_to_resume";
    vi.mocked(loadCurrentAction).mockReturnValue({
      ...routeResultOutput,
      routeKey: "experience_to_resume",
      actionId: "action-unsafe-resume-edit",
      routeResult: {
        confirmedFacts: ["参与社团招新", "整理报名表"],
        supportingFacts: ["整理报名表", "形成报名名单"],
        missingFacts: ["还缺报名人数"],
        resumeSnippetDraft: "参与社团招新，整理报名表并形成报名名单。",
      },
      recordGuide: {
        recordType: "experience_fact",
        fieldsToRecord: ["actualActions", "deliverable", "missingFacts"],
        requiresUserConfirmation: true,
      },
    });

    render(<RecordPage />);

    fireEvent.change(await screen.findByLabelText("克制简历片段"), {
      target: { value: "使用 Python 整理 1000 条数据，推动报名增长 30%。" },
    });
    fireEvent.change(screen.getByLabelText("实际完成了什么？"), {
      target: { value: "核对了片段" },
    });
    fireEvent.click(screen.getByLabelText(/我确认这条记录反映了我实际做过的事/));

    expect(screen.getByText(/片段里仍有无法从来源经历或支撑事实核对的内容/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存并看看下一步" })).toBeDisabled();
    expect(saveRecord).not.toHaveBeenCalled();
  });

  it("requires JD summary and material version before saving an application review record", async () => {
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

    expect(await screen.findByText("这条内容只在这台设备上保存，方便你下次从这里继续。")).toBeInTheDocument();
    expect(screen.queryByText(/浏览器/)).not.toBeInTheDocument();
    expect(screen.getAllByText("这份岗位主要要求会用来对照这次投递的岗位到底在要什么。").length).toBeGreaterThan(0);
    expect(screen.getAllByText("这次投递用的简历/材料会用来判断同一份材料投出去后的反馈变化。").length).toBeGreaterThan(0);
    expect(screen.queryByText(/JD/)).not.toBeInTheDocument();
    expect(screen.queryByText(/材料版本/)).not.toBeInTheDocument();

    expect(screen.getByLabelText("这份岗位主要要求")).toHaveAttribute(
      "placeholder",
      expect.stringContaining("例如"),
    );
    expect(screen.getByLabelText("这次投递用的简历/材料")).toHaveAttribute(
      "placeholder",
      expect.stringContaining("例如"),
    );
    const saveButton = screen.getByRole("button", { name: "保存并看看下一步" });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);
    expect(screen.getByLabelText("这份岗位主要要求")).toHaveFocus();
    expect(saveRecord).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("这份岗位主要要求"), {
      target: { value: "不知道" },
    });
    fireEvent.change(screen.getByLabelText("这次投递用的简历/材料"), {
      target: { value: "无明确结果" },
    });
    expect(screen.getByRole("button", { name: "保存并看看下一步" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("这份岗位主要要求"), {
      target: { value: "负责内容整理和活动执行" },
    });
    fireEvent.change(screen.getByLabelText("这次投递用的简历/材料"), {
      target: { value: "社团经历版 V1" },
    });

    expect(screen.getByRole("button", { name: "保存并看看下一步" })).toBeDisabled();
    expect(screen.getByText("还需要补齐第 2 条真实投递记录，才能进入回看。")).toBeInTheDocument();
    expect(saveRecord).not.toHaveBeenCalled();
  });

  it("lets a reduced continuation save one application only to continue adding the second", async () => {
    routeKeyParam = "applications_to_review";
    vi.mocked(loadCurrentAction).mockReturnValue({
      ...applicationOutput,
      reducedContinuation: true,
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
    vi.mocked(loadDraft).mockReturnValue({
      jobTitle: "内容运营实习",
      companyOrPlatform: "A 公司",
      submittedAt: "7 月 1 日",
      feedbackStatus: "暂无反馈",
      jdSummary: "负责内容整理和活动执行",
      materialVersion: "社团经历版 V1",
    });

    render(<RecordPage />);

    fireEvent.change(await screen.findByLabelText("实际完成了什么？"), {
      target: { value: "确认了第 1 条投递记录" },
    });
    fireEvent.click(screen.getByLabelText(/我确认这条记录反映了我实际做过的事/));
    fireEvent.click(screen.getByRole("button", { name: "保存第 1 条，继续补第 2 条" }));

    expect(saveRecord).toHaveBeenCalledTimes(1);
    expect(saveRecord).toHaveBeenCalledWith(expect.objectContaining({
      routeKey: "applications_to_review",
      recordType: "application",
      payload: expect.objectContaining({ jobTitle: "内容运营实习" }),
    }));
    expect(push).toHaveBeenCalledWith("/routes/applications_to_review/input");
  });

  it("saves an application fill-info record and merges the payload into the draft", async () => {
    routeKeyParam = "applications_to_review";
    const output: CurrentAction = {
      ...missingInfoOutput,
      routeKey: "applications_to_review",
      actionId: "action-application-missing",
      actionCreatedAt: "2026-07-21T05:30:00.000Z",
      todayAction: {
        ...missingInfoOutput.todayAction,
        actionTitle: "今天先补齐第 1 条最低字段投递记录",
      },
      recordGuide: {
        recordType: "application",
        fieldsToRecord: [
          "jobTitle",
          "companyOrPlatform",
          "submittedAt",
          "feedbackStatus",
        ],
        requiresUserConfirmation: true,
      },
    };
    vi.mocked(loadCurrentAction).mockReturnValue({
      ...output,
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
    fireEvent.click(screen.getByRole("button", { name: "保存并看看下一步" }));

    expect(saveRecord).toHaveBeenNthCalledWith(1, expect.objectContaining({
      routeKey: "applications_to_review",
      recordType: "application",
      actualDone: "确认了两条投递记录",
      payload: {
        jobTitle: "内容运营实习",
        companyOrPlatform: "A 公司",
        submittedAt: "7 月 1 日",
        feedbackStatus: "暂无反馈",
        jdSummary: "负责内容整理",
        materialVersion: "社团经历版",
        userSuspicion: "表达可能太泛",
      },
      userConfirmed: true,
    }));
    expect(saveRecord).toHaveBeenNthCalledWith(2, expect.objectContaining({
      routeKey: "applications_to_review",
      recordType: "application",
      actualDone: "确认了两条投递记录",
      payload: {
        jobTitle: "新媒体运营实习",
        companyOrPlatform: "B 公司",
        submittedAt: "7 月 3 日",
        feedbackStatus: "已查看",
        jdSummary: "负责选题和数据记录",
        materialVersion: "项目经历版",
        userSuspicion: "缺少数据记录细节",
      },
      userConfirmed: true,
    }));
  });

  it("associates application field help with the field for assistive technology", async () => {
    routeKeyParam = "applications_to_review";
    vi.mocked(loadCurrentAction).mockReturnValue(applicationOutput);
    vi.mocked(loadDraft).mockReturnValue({
      jobTitle: "内容运营实习",
      companyOrPlatform: "A 公司",
      submittedAt: "7 月 1 日",
      feedbackStatus: "暂无反馈",
      jdSummary: "负责内容整理",
      materialVersion: "社团经历版",
    });

    render(<RecordPage />);

    const field = await screen.findByLabelText("这份岗位主要要求");
    const describedByIds = field.getAttribute("aria-describedby")?.split(" ") ?? [];
    expect(describedByIds).toContain("record-missing-requirements");
    expect(document.getElementById(describedByIds[0] ?? "")).toHaveTextContent(
      "这份岗位主要要求会用来对照这次投递的岗位到底在要什么。",
    );
  });

  it("does not save friendly failure as a completed record", async () => {
    vi.mocked(loadCurrentAction).mockReturnValue({
      ...missingInfoOutput,
      outputType: "friendly_failure",
      recordGuide: {
        recordType: "fill_info",
        fieldsToRecord: ["draft"],
        requiresUserConfirmation: false,
      },
    });

    render(<RecordPage />);

    expect(await screen.findByText("这一步先不保存成完成记录")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存补充信息，继续判断" })).not.toBeInTheDocument();
    expect(saveRecord).not.toHaveBeenCalled();
  });

  it("shows loading and then a single recovery action when no current action exists", async () => {
    vi.mocked(loadCurrentAction).mockReturnValue(null);

    render(<RecordPage />);

    expect(screen.getByRole("status")).toHaveTextContent("正在读取要记录的行动");
    expect(await screen.findByText("还没有可以记录的行动")).toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("uses ordinary fallback copy instead of exposing an unknown record field token", async () => {
    vi.mocked(loadCurrentAction).mockReturnValue({
      ...missingInfoOutput,
      recordGuide: {
        recordType: "fill_info",
        fieldsToRecord: ["internal_secret_token"],
        requiresUserConfirmation: true,
      },
    });

    render(<RecordPage />);

    expect(await screen.findByLabelText("补充信息")).toBeInTheDocument();
    expect(screen.queryByText(/internal_secret_token/)).not.toBeInTheDocument();
  });
});
