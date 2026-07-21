import { render, screen } from "@testing-library/react";
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

  it("keeps the first-time question entry when there is no local progress", () => {
    render(<Home />);

    expect(screen.getByText("21 天陪跑 · 第 1 天")).toBeInTheDocument();
    expect(screen.getByText("你现在最想先解决哪件事？")).toBeInTheDocument();
    expect(screen.getByText("我不知道能投哪些岗位")).toBeInTheDocument();
  });

  it("shows a smaller continuation when the last action has not been recorded", async () => {
    saveCurrentAction(currentAction);

    render(<Home />);

    expect(await screen.findByText("上次这一步还没完成，今天可以把它缩小一点。")).toBeInTheDocument();
    expect(screen.getByText("今天先对照 JD 做 1 条投递前最小修改")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "继续一个更小版本" })).toHaveAttribute(
      "href",
      "/routes/jd_to_revision/input",
    );
    expect(screen.getByRole("link", { name: "换一个当前问题" })).toHaveAttribute("href", "#current-question");
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

    expect(await screen.findByText("上次这一步还没完成，今天可以把它缩小一点。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "继续一个更小版本" })).toHaveAttribute(
      "href",
      "/routes/jd_to_revision/input",
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
      nextAction: "明天先补这段经历的交付物。",
    });

    render(<Home />);

    expect(await screen.findByText(/21 天陪跑 · 第\s*2\s*天/)).toBeInTheDocument();
    expect(screen.getByText("最近推进：整理了社团招新报名表，并记录了自己负责的动作。")).toBeInTheDocument();
    expect(screen.getByText("明天先补这段经历的交付物。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "继续今天的行动" })).toHaveAttribute(
      "href",
      "/routes/experience_to_resume/input",
    );
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
    expect(screen.getByRole("link", { name: "继续今天的行动" })).toHaveAttribute(
      "href",
      "/routes/jd_to_revision/input",
    );
  });

  it("falls back to the first-time entry when the saved current action is invalid", async () => {
    window.localStorage.setItem("mvp-current-action", JSON.stringify({}));

    render(<Home />);

    expect(await screen.findByText("你现在最想先解决哪件事？")).toBeInTheDocument();
    expect(screen.getByText("我不知道能投哪些岗位")).toBeInTheDocument();
  });
});
