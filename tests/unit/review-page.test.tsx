import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReviewPage from "@/app/review/page";
import { saveRecord } from "@/lib/local-store";

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
});
