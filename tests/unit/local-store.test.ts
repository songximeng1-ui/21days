import { beforeEach, describe, expect, it } from "vitest";
import { clearRecords, deleteRecord, loadRecords, saveRecord, updateRecord } from "@/lib/local-store";

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
      userConfirmed: true,
    });
    saveRecord({
      routeKey: "jd_to_revision",
      recordType: "jd_compare",
      actionTitle: "Save a JD",
      actualDone: "Saved one JD.",
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
      userConfirmed: true,
    });

    updateRecord(record.id, { actualDone: "Edited content." });

    expect(loadRecords()[0].actualDone).toBe("Edited content.");
  });
});
