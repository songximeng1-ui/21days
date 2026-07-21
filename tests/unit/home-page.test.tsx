import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it } from "vitest";
import Home from "@/app/page";
import { saveCurrentAction, saveRecord, saveReview } from "@/lib/local-store";
import type { RouteOutput } from "@/domain/types";

const currentAction: RouteOutput = {
  routeKey: "jd_to_revision",
  outputType: "route_result",
  shortAssessment: "这里先看材料和 JD 的支撑关系。",
  routeResult: {},
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

describe("Home", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("keeps the first-time question entry when there is no local progress", async () => {
    render(<Home />);

    expect(await screen.findByText("21 天陪跑 · 第 1 次推进")).toBeInTheDocument();
    expect(screen.getByText("你现在最想先解决哪件事？")).toBeInTheDocument();
    expect(screen.getByText("我不知道能投哪些岗位")).toBeInTheDocument();
  });

  it("shows a smaller continuation when the last action has not been recorded", async () => {
    saveCurrentAction(currentAction);

    render(<Home />);

    expect(screen.queryByText("你现在最想先解决哪件事？")).not.toBeInTheDocument();
    expect(await screen.findByText("上次这一步还没做完，今天可以把它缩小一点。")).toBeInTheDocument();
    expect(screen.getByText("今天先对照 JD 做 1 条投递前最小修改")).toBeInTheDocument();
    expect(screen.getByText("先改最能支撑 JD 的一处表达。")).toBeInTheDocument();
    expect(screen.getByText("圈出 JD 的 1 条关键要求")).toBeInTheDocument();
    expect(screen.getByText("15-30 分钟")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看这一步行动" })).toHaveAttribute(
      "href",
      "/routes/jd_to_revision/action",
    );
    expect(screen.queryByText("我不知道能投哪些岗位")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "换一个当前问题" }));
    expect(screen.getByText("你现在想换成哪个问题？")).toBeInTheDocument();
    expect(screen.getByText("我不知道能投哪些岗位")).toBeInTheDocument();
  });

  it("keeps the current action unfinished when an unrelated route has the same action title", async () => {
    saveCurrentAction(currentAction);
    saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: currentAction.todayAction.actionTitle,
      actualDone: "整理了一段经历事实。",
      payload: { actualActions: "整理经历" },
      userConfirmed: true,
    });

    render(<Home />);

    expect(await screen.findByText("上次这一步还没做完，今天可以把它缩小一点。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看这一步行动" })).toHaveAttribute(
      "href",
      "/routes/jd_to_revision/action",
    );
  });

  it("keeps a same-route same-title new action unfinished without its action record", async () => {
    saveRecord({
      routeKey: "jd_to_revision",
      recordType: "jd_compare",
      actionTitle: currentAction.todayAction.actionTitle,
      actualDone: "上次已经改过另一版 JD 片段。",
      payload: { afterSnippet: "另一版片段" },
      userConfirmed: true,
    });
    saveCurrentAction(currentAction);

    render(<Home />);

    expect(await screen.findByText("上次这一步还没做完，今天可以把它缩小一点。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看这一步行动" })).toHaveAttribute(
      "href",
      "/routes/jd_to_revision/action",
    );
  });

  it("shows the latest record and review next action for returning users", async () => {
    const record = saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "今天先确认这段经历里实际做过的 3 个动作",
      actualDone: "整理了社团招新报名表，并记录了自己负责的动作。",
      payload: { actualActions: "整理报名表" },
      userConfirmed: true,
    });
    saveReview({
      basedOnRecordIds: [record.id],
      routeKey: "experience_to_resume",
      reviewBasis: ["整理了社团招新报名表"],
      clues: ["这段经历可以继续补交付物"],
      missingInfo: ["还缺交付物"],
      nextAction: "下一步先补这段经历的交付物。",
    });

    render(<Home />);

    expect(await screen.findByText("21 天陪跑 · 已保存 1 次推进")).toBeInTheDocument();
    expect(screen.getByText("最近推进：整理了社团招新报名表，并记录了自己负责的动作。")).toBeInTheDocument();
    expect(screen.getByText("下一步先补这段经历的交付物。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "继续：下一步先补这段经历的交付物。" })).toHaveAttribute(
      "href",
      "/routes/experience_to_resume/input",
    );
    expect(screen.queryByText("我不知道能投哪些岗位")).not.toBeInTheDocument();
  });

  it("sends the latest record to light review when it has not been reviewed", async () => {
    saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "今天先确认这段经历里实际做过的 3 个动作",
      actualDone: "整理了社团招新报名表。",
      payload: { actualActions: "整理报名表" },
      userConfirmed: true,
    });

    render(<Home />);

    expect(await screen.findByText("最近推进：整理了社团招新报名表。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "基于这条记录轻复盘" })).toHaveAttribute("href", "/review");
    expect(screen.queryByText("我不知道能投哪些岗位")).not.toBeInTheDocument();
  });

  it("does not attach an older review to a newer record", async () => {
    const oldRecord = saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "今天先确认这段经历里实际做过的 3 个动作",
      actualDone: "整理了一段旧经历。",
      payload: { actualActions: "整理旧经历" },
      userConfirmed: true,
    });
    saveReview({
      basedOnRecordIds: [oldRecord.id],
      routeKey: "experience_to_resume",
      reviewBasis: ["整理了一段旧经历"],
      clues: ["可以继续补旧经历"],
      missingInfo: [],
      nextAction: "继续补旧经历的交付物。",
    });
    saveRecord({
      routeKey: "jd_to_revision",
      recordType: "jd_compare",
      actionTitle: "今天先对照 JD 做 1 条投递前最小修改",
      actualDone: "刚刚改完 JD 相关的一句话。",
      payload: { afterSnippet: "改完一句话" },
      userConfirmed: true,
    });

    render(<Home />);

    expect(await screen.findByText("最近推进：刚刚改完 JD 相关的一句话。")).toBeInTheDocument();
    expect(screen.queryByText("继续补旧经历的交付物。")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "基于这条记录轻复盘" })).toHaveAttribute("href", "/review");
  });

  it("falls back to the first-time entry when the saved current action is invalid", async () => {
    window.localStorage.setItem("mvp-current-action", JSON.stringify({}));

    render(<Home />);

    expect(await screen.findByText("你现在最想先解决哪件事？")).toBeInTheDocument();
    expect(screen.getByText("我不知道能投哪些岗位")).toBeInTheDocument();
  });

  it("migrates an older saved current action without losing the return state", async () => {
    window.localStorage.setItem("mvp-current-action", JSON.stringify(currentAction));

    render(<Home />);

    expect(await screen.findByText("上次这一步还没做完，今天可以把它缩小一点。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看这一步行动" })).toHaveAttribute(
      "href",
      "/routes/jd_to_revision/action",
    );
    expect(JSON.parse(window.localStorage.getItem("mvp-current-action") ?? "{}")).toMatchObject({
      actionId: expect.any(String),
      actionCreatedAt: expect.any(String),
    });
  });
});
