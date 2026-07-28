import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReviewPage from "@/app/review/page";
import { loadLatestReview, saveRecord } from "@/lib/local-store";

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

  it("shows loading and then an honest empty state without review claims", async () => {
    render(<ReviewPage />);

    expect(screen.getByRole("status")).toHaveTextContent("正在读取最近的记录");
    expect(await screen.findByText("还没有可以回头看的记录")).toBeInTheDocument();
    expect(screen.queryByText("这一步已经留下记录，可以用于判断下一步。")).not.toBeInTheDocument();
    expect(screen.queryByText("看到的线索")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("stores the generated next action type and record guide with the review", async () => {
    saveRecord({
      routeKey: "applications_to_review",
      recordType: "application",
      actionTitle: "确认两条投递记录",
      actualDone: "确认了两条投递记录。",
      payload: { jobTitle: "内容运营实习", jobTitle2: "新媒体运营实习" },
      userConfirmed: true,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({
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
      }),
    }));

    render(<ReviewPage />);

    expect(await screen.findByText("已根据这条记录整理出下一步。")).toBeInTheDocument();
    expect(screen.queryByText(/轻复盘/)).not.toBeInTheDocument();
    expect(screen.queryByText(/复盘/)).not.toBeInTheDocument();
    expect(loadLatestReview()).toMatchObject({
      nextActionType: "application_record",
      nextRecordType: "application",
      nextFieldsToRecord: ["jobTitle", "companyOrPlatform", "submittedAt", "feedbackStatus"],
    });
  });
});
