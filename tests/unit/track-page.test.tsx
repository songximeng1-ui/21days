import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it } from "vitest";
import TrackPage from "@/app/track/page";
import {
  loadCurrentAction,
  loadDraft,
  loadRecords,
  saveCurrentAction,
  saveDraft,
  saveRecord,
  saveReview,
} from "@/lib/local-store";

describe("TrackPage destructive-action protection", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("keeps a record when deletion is cancelled and exposes keyboard-focusable controls", async () => {
    saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "整理一段真实经历",
      actualDone: "整理了报名表。",
      payload: { actualActions: "整理报名表" },
      userConfirmed: true,
    });
    render(<TrackPage />);

    const deleteTrigger = await screen.findByRole("button", { name: "删除这条记录" });
    fireEvent.click(deleteTrigger);
    expect(loadRecords()).toHaveLength(1);

    const confirm = screen.getByRole("button", { name: "确认删除这条记录" });
    const cancel = screen.getByRole("button", { name: "取消删除" });
    await waitFor(() => expect(confirm).toHaveFocus());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    fireEvent.click(cancel);

    expect(loadRecords()).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "确认删除这条记录" })).not.toBeInTheDocument();
    await waitFor(() => expect(deleteTrigger).toHaveFocus());
  });

  it("deletes a record only after explicit confirmation", async () => {
    saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "整理一段真实经历",
      actualDone: "整理了报名表。",
      payload: {},
      userConfirmed: true,
    });
    render(<TrackPage />);

    fireEvent.click(await screen.findByRole("button", { name: "删除这条记录" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除这条记录" }));

    expect(loadRecords()).toEqual([]);
  });

  it("explains everything cleared and changes nothing when clear-all is cancelled", async () => {
    saveDraft("jd_to_revision", { userMaterial: "真实材料" });
    saveCurrentAction({
      routeKey: "jd_to_revision",
      outputType: "missing_info",
      shortAssessment: "还缺岗位要求。",
      routeResult: null,
      missingInfo: {
        cannotJudge: "材料支撑关系",
        alreadyKnown: ["目标岗位"],
        missingFields: ["岗位要求"],
      },
      todayAction: {
        actionTitle: "补岗位要求",
        actionReason: "有真实要求后再判断。",
        actionSteps: ["找到岗位页面"],
        estimatedTime: "15-30 分钟",
        recordAfterDone: "保存岗位要求。",
        actionType: "fill_info",
      },
      recordGuide: {
        recordType: "fill_info",
        fieldsToRecord: ["jdTextOrRequirements"],
        requiresUserConfirmation: true,
      },
    });
    const record = saveRecord({
      routeKey: "jd_to_revision",
      recordType: "fill_info",
      actionTitle: "补岗位要求",
      actualDone: "补了岗位要求。",
      payload: {},
      userConfirmed: true,
    });
    saveReview({
      basedOnRecordIds: [record.id],
      routeKey: "jd_to_revision",
      reviewBasis: ["补了岗位要求"],
      clues: [],
      missingInfo: [],
      nextAction: "继续判断",
    });
    render(<TrackPage />);

    const clearTrigger = await screen.findByRole("button", { name: "清空我的记录" });
    fireEvent.click(clearTrigger);
    expect(screen.getByText(/当前行动、所有草稿、求职记录和查看结果/)).toBeInTheDocument();
    const clearConfirm = screen.getByRole("button", { name: "确认清空全部内容" });
    await waitFor(() => expect(clearConfirm).toHaveFocus());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消清空" }));

    expect(loadDraft("jd_to_revision")).toEqual({ userMaterial: "真实材料" });
    expect(loadCurrentAction()).not.toBeNull();
    expect(loadRecords()).toHaveLength(1);
    await waitFor(() => expect(clearTrigger).toHaveFocus());
  });
});
