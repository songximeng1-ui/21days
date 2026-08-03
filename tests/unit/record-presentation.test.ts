import { describe, expect, it } from "vitest";
import {
  formatUserFacingList,
  getVisibleRecordFields,
} from "@/domain/record-presentation";

describe("record presentation", () => {
  it("joins user-facing review items without the full-stop-semicolon collision", () => {
    expect(
      formatUserFacingList(["改完了一句话。", "又核对了一处。"]),
    ).toBe("改完了一句话；又核对了一处。");
  });

  it("shows an ISO application date in the Chinese page locale", () => {
    expect(getVisibleRecordFields({ submittedAt: "2026-07-03" })).toEqual([
      { field: "submittedAt", label: "投递时间", value: "2026/7/3" },
    ]);
  });
});
