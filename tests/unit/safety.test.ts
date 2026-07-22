import { describe, expect, it } from "vitest";
import { scanSafetyViolations } from "@/domain/safety";

describe("scanSafetyViolations", () => {
  it("blocks outcome promises, fit scoring, fabricated evidence, and internal terms", () => {
    const result = scanSafetyViolations(
      "匹配度 82%，录取概率很高。DeepSeek fallback 后建议你编一个项目数据，这样更适合投递。"
    );

    expect(result.passed).toBe(false);
    expect(result.blockedReasons).toEqual(
      expect.arrayContaining([
        "禁止输出匹配度、录取概率或适合度评分",
        "禁止编造经历、JD、数据、结果或反馈",
        "禁止暴露模型、prompt、token、fallback 或内部错误",
      ])
    );
  });

  it("allows grounded, low-pressure action copy", () => {
    const result = scanSafetyViolations(
      "当前材料里还看不出具体交付物。今天先补这段经历里实际做过的 3 个动作。"
    );

    expect(result).toEqual({ passed: true, blockedReasons: [] });
  });

  it("allows user-provided factual percentages when they are not fit or outcome scores", () => {
    const result = scanSafetyViolations("用户记录里写到公众号阅读量提升 20%，今天先确认这个数据是否真实。");

    expect(result).toEqual({ passed: true, blockedReasons: [] });
  });

  it("blocks non-numeric outcome probability and failure attribution copy", () => {
    const result = scanSafetyViolations("通过概率很高，大概率能进面。没反馈是因为你的简历太弱。");

    expect(result.passed).toBe(false);
    expect(result.blockedReasons).toEqual(
      expect.arrayContaining([
        "禁止输出匹配度、录取概率或适合度评分",
        "禁止猜测公司筛选规则或失败原因",
      ])
    );
  });

  it("blocks internal workflow terms, absolute application conclusions, and ordinary fit judgments", () => {
    const result = scanSafetyViolations(
      "主模型重试失败，已切换副模型。你适合做产品，这份岗位不能投，主要卡在学历。",
    );

    expect(result.passed).toBe(false);
    expect(result.blockedReasons).toEqual(
      expect.arrayContaining([
        "禁止暴露模型、prompt、token、fallback 或内部错误",
        "禁止评价用户本人适合或不适合",
        "禁止给出绝对投递结论",
        "禁止猜测公司筛选规则或失败原因",
      ]),
    );
  });

  it("allows explicit safety reminders that tell users not to fabricate or exaggerate", () => {
    expect(scanSafetyViolations("不要编造数据，也不要把参与写成主导。"))
      .toEqual({ passed: true, blockedReasons: [] });
  });

  it("blocks reversed absolute-application wording and disguised failure attribution", () => {
    const result = scanSafetyViolations("你可以直接投这个岗位；无反馈说明简历不行。");

    expect(result.passed).toBe(false);
    expect(result.blockedReasons).toEqual(expect.arrayContaining([
      "禁止给出绝对投递结论",
      "禁止猜测公司筛选规则或失败原因",
    ]));
  });
});
