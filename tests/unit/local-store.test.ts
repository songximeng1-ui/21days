import { beforeEach, describe, expect, it } from "vitest";
import {
  clearRecords,
  deleteRecord,
  loadDraft,
  loadRecords,
  mergeDraft,
  saveDraft,
  saveRecord,
  updateRecord,
} from "@/lib/local-store";

describe("local record storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("saves records locally and removes one record by id", () => {
    const first = saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "Confirm real actions",
      actualDone: "Listed three real actions.",
      payload: { actualActions: "planned topics", deliverable: "posts" },
      userConfirmed: true,
    });
    saveRecord({
      routeKey: "jd_to_revision",
      recordType: "jd_compare",
      actionTitle: "Save a JD",
      actualDone: "Saved one JD.",
      payload: { targetJobTitle: "operations intern" },
      userConfirmed: true,
    });

    deleteRecord(first.id);

    expect(loadRecords()).toHaveLength(1);
    expect(loadRecords()[0].actionTitle).toBe("Save a JD");
  });

  it("clears all local records", () => {
    saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "Confirm real actions",
      actualDone: "Listed three real actions.",
      payload: {},
      userConfirmed: true,
    });

    clearRecords();

    expect(loadRecords()).toEqual([]);
  });

  it("updates one local record", () => {
    const record = saveRecord({
      routeKey: "experience_to_resume",
      recordType: "experience_fact",
      actionTitle: "Confirm real actions",
      actualDone: "Draft content.",
      payload: { actualActions: "draft" },
      userConfirmed: true,
    });

    updateRecord(record.id, { actualDone: "Edited content.", payload: { actualActions: "edited" } });

    expect(loadRecords()[0].actualDone).toBe("Edited content.");
    expect(loadRecords()[0].payload.actualActions).toBe("edited");
  });

  it("merges completed missing-info payloads back into the route draft", () => {
    saveDraft("jd_to_revision", {
      targetJobTitle: "产品运营实习",
      userMaterial: "社团活动经历",
    });

    mergeDraft("jd_to_revision", {
      jdTextOrRequirements: "负责用户调研、数据整理、活动复盘",
    });

    expect(loadDraft("jd_to_revision")).toEqual({
      targetJobTitle: "产品运营实习",
      userMaterial: "社团活动经历",
      jdTextOrRequirements: "负责用户调研、数据整理、活动复盘",
    });
  });
});
