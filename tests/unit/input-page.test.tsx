import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RouteInputPage from "@/app/routes/[routeKey]/input/page";
import { loadCurrentAction, saveDraft } from "@/lib/local-store";
import { withTestProvenance } from "../helpers/test-provenance";

const push = vi.fn();
let routeKeyParam = "experience_to_resume";

vi.mock("next/navigation", () => ({
  useParams: () => ({ routeKey: routeKeyParam }),
  useRouter: () => ({ push }),
}));

describe("RouteInputPage draft status", () => {
  beforeEach(() => {
    window.localStorage.clear();
    push.mockReset();
    routeKeyParam = "experience_to_resume";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a category-level external AI notice before submit without exposing provider routing", async () => {
    render(<RouteInputPage />);

    const notice = await screen.findByLabelText("外部 AI 数据说明");
    const submit = screen.getByRole("button", { name: "生成今天先做的一步" });

    expect(notice).toHaveTextContent(/经历、JD 或投递记录/);
    expect(notice).toHaveTextContent(/姓名、手机号、证件号/);
    expect(notice).toHaveTextContent(/应用服务端/);
    expect(notice).toHaveTextContent(/第三方 AI 瞬时处理/);
    expect(notice).toHaveTextContent(/不持久化原文/);
    expect(notice.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.body).not.toHaveTextContent(/DeepSeek|Qwen|fallback|主模型|副模型/i);
  });

  it("aborts the browser request after 30 seconds so the route can cancel its upstream provider", async () => {
    vi.useFakeTimers();
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
    render(<RouteInputPage />);
    await act(async () => {
      await vi.runAllTicks();
      fireEvent.click(screen.getByRole("button", { name: "生成今天先做的一步" }));
      await vi.advanceTimersByTimeAsync(30_000);
      await Promise.resolve();
    });

    expect(requestSignal?.aborted).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent(/这次暂时没整理出来/);
  });

  it("aborts a pending browser request when navigating away", async () => {
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise(() => undefined);
    }));
    const view = render(<RouteInputPage />);

    fireEvent.click(await screen.findByRole("button", { name: "生成今天先做的一步" }));
    expect(requestSignal?.aborted).toBe(false);

    view.unmount();

    expect(requestSignal?.aborted).toBe(true);
  });

  it("submits only the active route contract fields when an old draft contains extra private keys", async () => {
    saveDraft("experience_to_resume", {
      targetDirection: "运营",
      rawExperience: "社团活动",
      actualActions: "整理报名表",
      deliverableOrResult: "报名名单",
      privateNotes: "PRIVATE_DRAFT_CANARY",
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<RouteInputPage />);
    await screen.findByText("已恢复草稿。");

    fireEvent.click(screen.getByRole("button", { name: "生成今天先做的一步" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.input).toEqual({
      targetDirection: "运营",
      rawExperience: "社团活动",
      actualActions: "整理报名表",
      deliverableOrResult: "报名名单",
    });
    expect(JSON.stringify(body)).not.toContain("PRIVATE_DRAFT_CANARY");
  });

  it("asks the user to remove sensitive information when the API rejects it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 422 })),
    );
    render(<RouteInputPage />);
    const experience = await screen.findByLabelText(/先写一段相关真实经历/);
    fireEvent.change(experience, { target: { value: "联系电话 13800138000" } });

    fireEvent.click(screen.getByRole("button", { name: "生成今天先做的一步" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "请先删除手机号、证件号、邮箱或婚育健康等敏感信息，再重新生成。",
    );
    expect(experience).toHaveValue("联系电话 13800138000");
  });

  it("distinguishes a local action-save failure from an AI request failure", async () => {
    const output = withTestProvenance({
      routeKey: "experience_to_resume",
      outputType: "route_result",
      shortAssessment: "可以先整理真实动作。",
      routeResult: {
        confirmedFacts: ["参加社团活动"],
        missingFacts: ["还缺交付物"],
        doNotExaggerate: ["不要夸大职责"],
        resumeSnippetDraft: "参加社团活动并整理报名表。",
        supportingFacts: ["整理报名表"],
      },
      missingInfo: null,
      todayAction: {
        actionTitle: "今天先核对 1 段真实经历",
        actionReason: "先确认事实。",
        actionSteps: ["核对实际动作"],
        estimatedTime: "15-30 分钟",
        recordAfterDone: "记录实际动作。",
        actionType: "experience_fact",
      },
      recordGuide: {
        recordType: "experience_fact",
        fieldsToRecord: ["actualActions", "deliverable", "missingFacts"],
        requiresUserConfirmation: true,
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify(output),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )));
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === "mvp-current-action") throw new Error("quota");
      return originalSetItem.call(this, key, value);
    });
    render(<RouteInputPage />);

    fireEvent.click(await screen.findByRole("button", { name: "生成今天先做的一步" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "行动已经整理好，但这次没有保存成功。请保留本页并重试。",
    );
    expect(push).not.toHaveBeenCalled();
    expect(loadCurrentAction()).toBeNull();
  });

  it("shows reading and then an unsaved state instead of claiming a fresh draft was saved", async () => {
    render(<RouteInputPage />);

    expect(screen.getByRole("status")).toHaveTextContent("正在读取草稿");
    expect(await screen.findByText("还没有保存的草稿。")).toBeInTheDocument();
    expect(screen.queryByText("已保存草稿。")).not.toBeInTheDocument();
  });

  it("reports a successful save only after an input change", async () => {
    render(<RouteInputPage />);
    const field = await screen.findByLabelText("你大概想投什么方向？");

    fireEvent.change(field, { target: { value: "内容运营" } });

    expect(field).toHaveValue("内容运营");
    expect(screen.getByRole("status")).toHaveTextContent("已保存草稿。");
  });

  it("keeps direction constraints visible but clearly optional", async () => {
    routeKeyParam = "direction_to_jobs";
    render(<RouteInputPage />);

    const constraints = await screen.findByLabelText(
      "有哪些暂时不想接受的工作条件？（可选）",
    );
    expect(constraints).not.toBeRequired();
  });

  it("uses compact single-line controls for short application fields", async () => {
    routeKeyParam = "applications_to_review";
    render(<RouteInputPage />);

    expect(await screen.findByLabelText("第 1 条投递：岗位名称")).toHaveAttribute(
      "type",
      "text",
    );
    expect(screen.getByLabelText("第 1 条投递：公司或平台")).toHaveAttribute(
      "type",
      "text",
    );
    expect(screen.getByLabelText("第 1 条投递：投递时间")).toHaveAttribute(
      "type",
      "date",
    );
    expect(screen.getByLabelText("第 1 条投递：当前反馈状态")).toHaveProperty(
      "tagName",
      "SELECT",
    );
    expect(screen.getByLabelText("第 1 条投递：这份岗位主要要求")).toHaveProperty(
      "tagName",
      "TEXTAREA",
    );

    fireEvent.click(screen.getByRole("button", { name: "再补第 2 条投递记录" }));
    expect(screen.getByLabelText("第 2 条投递：投递时间")).toHaveAttribute(
      "type",
      "date",
    );
    expect(screen.getByLabelText("第 2 条投递：当前反馈状态")).toHaveProperty(
      "tagName",
      "SELECT",
    );
  });

  it("keeps the typed value and shows friendly copy when saving fails", async () => {
    render(<RouteInputPage />);
    const field = await screen.findByLabelText("你大概想投什么方向？");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });

    fireEvent.change(field, { target: { value: "内容运营" } });

    expect(field).toHaveValue("内容运营");
    expect(screen.getByRole("status")).toHaveTextContent(
      "这次没有保存成功，请先不要关闭页面，稍后再试。",
    );
    expect(screen.queryByText(/quota|localStorage|setItem/i)).not.toBeInTheDocument();
  });

  it("does not claim the draft was saved when saving and submission both fail", async () => {
    render(<RouteInputPage />);
    const field = await screen.findByLabelText("你大概想投什么方向？");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    fireEvent.change(field, { target: { value: "内容运营" } });
    fireEvent.click(screen.getByRole("button", { name: "生成今天先做的一步" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "这次暂时没整理出来。当前填写还保留在页面上，但没有保存成功，请稍后再试。",
      );
    });
    expect(screen.getByRole("status")).not.toHaveTextContent("草稿已经保存在本页");
    expect(field).toHaveValue("内容运营");
  });
  it("does not persist or navigate when the API returns a cross-route output", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        routeKey: "experience_to_resume",
        outputType: "route_result",
        shortAssessment: "Grounded only in the submitted experience.",
        routeResult: {
          confirmedFacts: ["Organized a registration sheet"],
          missingFacts: ["No measured outcome"],
          doNotExaggerate: ["Do not invent growth"],
          resumeSnippetDraft: "Organized a registration sheet",
          supportingFacts: ["Organized a registration sheet"],
        },
        missingInfo: null,
        todayAction: {
          actionTitle: "Record an application",
          actionReason: "Wrong route action",
          actionSteps: ["Save an application"],
          estimatedTime: "15-30 分钟",
          recordAfterDone: "Save the application",
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
    render(<RouteInputPage />);
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button")).not.toBeDisabled();
    });
    expect(loadCurrentAction()).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("does not persist or navigate when an API route result exceeds the character budget", async () => {
    const fact = "真实事实".repeat(450);
    const output = withTestProvenance({
      routeKey: "experience_to_resume",
      outputType: "route_result",
      shortAssessment: "可以先整理真实动作。",
      routeResult: {
        confirmedFacts: Array.from({ length: 10 }, () => fact),
        missingFacts: ["还缺交付物"],
        doNotExaggerate: ["不要夸大职责"],
        resumeSnippetDraft: "参加社团活动并整理报名表。",
        supportingFacts: ["整理报名表"],
      },
      missingInfo: null,
      todayAction: {
        actionTitle: "确认真实动作",
        actionReason: "先确认事实。",
        actionSteps: ["列出动作"],
        estimatedTime: "15-30 分钟",
        recordAfterDone: "记录真实动作。",
        actionType: "experience_fact",
      },
      recordGuide: {
        recordType: "experience_fact",
        fieldsToRecord: ["actualActions", "deliverable", "missingFacts"],
        requiresUserConfirmation: true,
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => output,
    }));
    render(<RouteInputPage />);
    await act(async () => Promise.resolve());

    fireEvent.change(screen.getByLabelText(/你大概想投什么方向/), {
      target: { value: "运营" },
    });
    fireEvent.change(screen.getByLabelText(/先写一段相关真实经历/), {
      target: { value: "社团活动" },
    });
    fireEvent.change(screen.getByLabelText(/实际做过哪些动作/), {
      target: { value: "整理报名表" },
    });
    fireEvent.change(screen.getByLabelText(/有交付物或结果吗/), {
      target: { value: "报名名单" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成今天先做的一步" }));

    await waitFor(() => expect(screen.getByRole("button", {
      name: "生成今天先做的一步",
    })).not.toBeDisabled());
    expect(loadCurrentAction()).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });
});
