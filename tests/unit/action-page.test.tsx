import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ActionPage from "@/app/routes/[routeKey]/action/page";
import RecordPage from "@/app/routes/[routeKey]/record/page";
import type { RouteOutput } from "@/domain/types";
import { loadCurrentAction, mergeDraft, saveRecord } from "@/lib/local-store";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ routeKey: "jd_to_revision" }),
  useRouter: () => ({ push }),
}));

vi.mock("@/lib/local-store", () => ({
  loadCurrentAction: vi.fn(),
  saveRecord: vi.fn(),
  mergeDraft: vi.fn(),
}));

const missingInfoOutput: RouteOutput = {
  routeKey: "jd_to_revision",
  outputType: "missing_info",
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

describe("ActionPage", () => {
  beforeEach(() => {
    push.mockReset();
    vi.mocked(saveRecord).mockReset();
    vi.mocked(mergeDraft).mockReset();
    vi.mocked(loadCurrentAction).mockReturnValue(missingInfoOutput);
  });

  it("lets users record a completed missing-info action", async () => {
    render(<ActionPage />);

    const recordLink = await screen.findByRole("link", { name: "我补完了，去记录" });

    expect(recordLink).toHaveAttribute("href", "/routes/jd_to_revision/record");
  });
});

describe("RecordPage", () => {
  beforeEach(() => {
    push.mockReset();
    vi.mocked(saveRecord).mockReset();
    vi.mocked(loadCurrentAction).mockReturnValue(missingInfoOutput);
  });

  it("saves completed fill-info records and returns to route input", async () => {
    render(<RecordPage />);

    fireEvent.change(await screen.findByLabelText("实际完成了什么？"), {
      target: { value: "补了真实 JD 和岗位要求" },
    });
    fireEvent.change(screen.getByLabelText("目标岗位名称"), {
      target: { value: "产品运营实习生" },
    });
    fireEvent.change(screen.getByLabelText("真实 JD 或 3-5 条岗位要求"), {
      target: { value: "负责用户调研、数据整理、活动复盘" },
    });
    fireEvent.click(screen.getByLabelText(/我确认这条记录反映了我实际做过的事/));

    fireEvent.click(screen.getByRole("button", { name: "保存补充信息，继续判断" }));

    expect(saveRecord).toHaveBeenCalledWith({
      routeKey: "jd_to_revision",
      recordType: "fill_info",
      actionTitle: "今天先补这份岗位的真实 JD 或 3-5 条岗位要求",
      actualDone: "补了真实 JD 和岗位要求",
      payload: {
        targetJobTitle: "产品运营实习生",
        jdTextOrRequirements: "负责用户调研、数据整理、活动复盘",
      },
      userConfirmed: true,
    });
    expect(mergeDraft).toHaveBeenCalledWith("jd_to_revision", {
      targetJobTitle: "产品运营实习生",
      jdTextOrRequirements: "负责用户调研、数据整理、活动复盘",
    });
    expect(push).toHaveBeenCalledWith("/routes/jd_to_revision/input");
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
