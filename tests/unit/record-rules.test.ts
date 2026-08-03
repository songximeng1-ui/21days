import { describe, expect, it } from "vitest";
import {
  isApplicationRecordComplete,
  isResumeSnippetGrounded,
  splitApplicationRecordPayload,
} from "@/domain/record-rules";
import { APPLICATION_RECORD_FIELDS } from "@/domain/route-contracts";

describe("application record rules", () => {
  it("uses the same six-field sufficiency rule when splitting two application records", () => {
    const records = splitApplicationRecordPayload({
      jobTitle: "内容运营实习",
      companyOrPlatform: "A 公司",
      submittedAt: "7 月 1 日",
      feedbackStatus: "暂无反馈",
      jdSummary: "负责内容整理",
      materialVersion: "社团经历版",
      userSuspicion: "表达太泛",
      jobTitle2: "新媒体运营实习",
      companyOrPlatform2: "B 公司",
      submittedAt2: "7 月 3 日",
      feedbackStatus2: "已查看",
      jdSummary2: "负责选题和数据记录",
      materialVersion2: "项目经历版",
      userSuspicion2: "缺少数据记录细节",
    });

    expect(records).toEqual([
      {
        jobTitle: "内容运营实习",
        companyOrPlatform: "A 公司",
        submittedAt: "7 月 1 日",
        feedbackStatus: "暂无反馈",
        jdSummary: "负责内容整理",
        materialVersion: "社团经历版",
        userSuspicion: "表达太泛",
      },
      {
        jobTitle: "新媒体运营实习",
        companyOrPlatform: "B 公司",
        submittedAt: "7 月 3 日",
        feedbackStatus: "已查看",
        jdSummary: "负责选题和数据记录",
        materialVersion: "项目经历版",
        userSuspicion: "缺少数据记录细节",
      },
    ]);
    expect(records.every(isApplicationRecordComplete)).toBe(true);
  });

  it("does not return a partially filled second application as a formal record", () => {
    expect(
      splitApplicationRecordPayload({
        jobTitle: "内容运营实习",
        companyOrPlatform: "A 公司",
        submittedAt: "7 月 1 日",
        feedbackStatus: "暂无反馈",
        jdSummary: "负责内容整理",
        materialVersion: "社团经历版",
        jobTitle2: "新媒体运营实习",
      }),
    ).toEqual([
      {
        jobTitle: "内容运营实习",
        companyOrPlatform: "A 公司",
        submittedAt: "7 月 1 日",
        feedbackStatus: "暂无反馈",
        jdSummary: "负责内容整理",
        materialVersion: "社团经历版",
        userSuspicion: "",
      },
    ]);
  });

  it("uses the shared route-contract fields and safely rejects unknown input", () => {
    const complete = Object.fromEntries(
      APPLICATION_RECORD_FIELDS.map((field) => [field, `${field} 的真实值`]),
    );

    expect(isApplicationRecordComplete(complete)).toBe(true);
    expect(isApplicationRecordComplete(null)).toBe(false);
    expect(isApplicationRecordComplete("不是记录")).toBe(false);
    expect(isApplicationRecordComplete({ ...complete, materialVersion: 42 })).toBe(false);
  });

  it("rejects standalone placeholders in every required application field", () => {
    const complete = Object.fromEntries(
      APPLICATION_RECORD_FIELDS.map((field) => [field, `${field} 的真实值`]),
    );

    for (const field of APPLICATION_RECORD_FIELDS) {
      expect(
        isApplicationRecordComplete({ ...complete, [field]: "尚不清楚" }),
        field,
      ).toBe(false);
    }
    expect(
      isApplicationRecordComplete({ ...complete, feedbackStatus: "暂无反馈" }),
    ).toBe(true);
  });

  it.each(["无明确结果", "no clear result"])(
    "rejects %s as an application JD summary or material version",
    (placeholder) => {
      const complete = Object.fromEntries(
        APPLICATION_RECORD_FIELDS.map((field) => [field, `${field} 的真实值`]),
      );

      expect(
        isApplicationRecordComplete({ ...complete, jdSummary: placeholder }),
      ).toBe(false);
      expect(
        isApplicationRecordComplete({ ...complete, materialVersion: placeholder }),
      ).toBe(false);
    },
  );
});

describe("resume snippet grounding", () => {
  const factualPayload = {
    confirmedFacts: "参与社团招新；整理报名表",
    supportingFacts: "整理报名表；形成报名名单",
    missingFacts: "还缺报名人数",
  };

  it("accepts a restrained snippet whose clauses are supported by saved facts", () => {
    expect(
      isResumeSnippetGrounded({
        ...factualPayload,
        resumeSnippet: "参与社团招新，整理报名信息并形成报名名单。",
      }),
    ).toBe(true);
  });

  it("treats fixed structural labels as presentation, not unsupported facts", () => {
    expect(
      isResumeSnippetGrounded({
        confirmedFacts: "参加学院活动宣传组；整理活动亮点、编辑推文、统计报名表",
        supportingFacts: "整理活动亮点、编辑推文、统计报名表；发布 2 篇推文，整理 120 条报名信息",
        resumeSnippet:
          "参加学院活动宣传组；实际完成：整理活动亮点、编辑推文、统计报名表；交付物或结果：发布 2 篇推文，整理 120 条报名信息。",
      }),
    ).toBe(true);
  });

  it("rejects edited numbers, tools, outcomes, and roles absent from the source facts", () => {
    for (const resumeSnippet of [
      "使用 Python 整理 1000 条数据，推动报名增长 30%。",
      "主导社团招新并获得优秀项目奖。",
      "负责客户运营并独立完成转化。",
    ]) {
      expect(
        isResumeSnippetGrounded({ ...factualPayload, resumeSnippet }),
        resumeSnippet,
      ).toBe(false);
    }
  });

  it("rejects an ordinary action verb that is absent from the source facts", () => {
    for (const resumeSnippet of ["分析报名名单。", "整理并拓展报名名单。"]) {
      expect(
        isResumeSnippetGrounded({
          ...factualPayload,
          resumeSnippet,
        }),
        resumeSnippet,
      ).toBe(false);
    }
  });
});
