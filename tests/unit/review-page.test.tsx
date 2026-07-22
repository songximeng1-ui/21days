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
        shortAssessment: "可以继续复盘。",
        routeResult: {
          reviewBasis: ["内容运营实习", "新媒体运营实习"],
          clues: ["两条记录可以对照"],
          missingInfo: ["还缺材料版本"],
          nextAction: "下一步先补一条最低字段投递记录",
        },
        missingInfo: null,
        todayAction: {
          actionTitle: "下一步先补一条最低字段投递记录",
          actionReason: "让投递复盘继续有依据。",
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

    expect(await screen.findByText("已根据这条记录生成轻复盘。")).toBeInTheDocument();
    expect(loadLatestReview()).toMatchObject({
      nextActionType: "application_record",
      nextRecordType: "application",
      nextFieldsToRecord: ["jobTitle", "companyOrPlatform", "submittedAt", "feedbackStatus"],
    });
  });
});
