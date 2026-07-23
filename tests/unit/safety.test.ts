import { describe, expect, it } from "vitest";
import {
  hasGroundedExperienceRoleStrength,
  scanRouteSafety,
  scanSafetyViolations,
} from "@/domain/safety";

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

  it("allows neutral application-record field instructions", () => {
    const result = scanSafetyViolations("记录岗位名称、公司、来源和保存原因。");

    expect(result).toEqual({ passed: true, blockedReasons: [] });
  });

  it.each([
    "记录公司、拒绝状态、来源和保存原因。",
    "表格包含公司、是否未通过、跟进人和备注原因。",
  ])("allows neutral application-record field lists: %s", (text) => {
    expect(scanSafetyViolations(text)).toEqual({ passed: true, blockedReasons: [] });
  });

  it.each([
    "公司拒绝你的原因可能是学历不符。",
    "公司拒绝了你，原因是学历不符。",
    "公司没有反馈，原因可能是简历太弱。",
  ])("blocks explicit company failure attribution: %s", (text) => {
    expect(scanSafetyViolations(text).blockedReasons).toContain("禁止猜测公司筛选规则或失败原因");
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

  it.each([
    "经历写得太泛导致没有反馈。",
    "材料问题造成未通过。",
    "学历不符所以被拒绝。",
  ])("blocks reversed causal failure attribution: %s", (text) => {
    expect(scanSafetyViolations(text).blockedReasons).toContain("禁止猜测公司筛选规则或失败原因");
  });

  it("allows explicitly uncertain, non-causal application clues", () => {
    expect(
      scanSafetyViolations("两条记录使用了同一材料版本，这是待验证线索，当前记录不能确认原因。"),
    ).toEqual({ passed: true, blockedReasons: [] });
  });

  it.each(["建议海投", "建议大量投递", "apply to as many jobs as possible"])(
    "blocks blind mass-application advice: %s",
    (text) => {
      expect(scanSafetyViolations(text).blockedReasons).toContain("禁止鼓励盲目海投");
    },
  );

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

  it("allows a grounded experience leadership marker only with allowlisted route provenance", () => {
    const output = {
      routeResult: {
        confirmedFacts: ["主导整理信息并排版"],
        resumeSnippetDraft: "主导整理信息并排版。",
        supportingFacts: ["主导整理信息并排版"],
      },
    };

    expect(
      scanRouteSafety("experience_to_resume", output, {
        routeInput: { actualActions: "主导整理信息并排版" },
      }),
    ).toEqual({ passed: true, blockedReasons: [] });
    expect(scanRouteSafety("experience_to_resume", output).blockedReasons).toContain("禁止夸大职责或成果");
  });

  it.each([
    ["targetDirection", "主导方向", "主导整理信息并排版。"],
    ["rawExperience", "没有主导整理信息并排版", "主导整理信息并排版。"],
    ["actualActions", "并未主导整理信息并排版", "主导整理信息并排版。"],
    ["rawExperience", "不是负责整体工作", "负责整体工作。"],
    ["actualActions", "不要写成主导", "主导整理信息并排版。"],
    ["deliverableOrResult", "不是全权负责活动材料", "全权负责活动材料。"],
  ])("does not treat %s=%s as affirmative role provenance", (field, sourceText, resumeSnippetDraft) => {
    const output = { routeResult: { resumeSnippetDraft } };

    expect(
      scanRouteSafety("experience_to_resume", output, {
        routeInput: {
          rawExperience: "参与社团活动",
          actualActions: "整理信息并排版",
          deliverableOrResult: "形成推文",
          [field]: sourceText,
        },
      }).blockedReasons,
    ).toContain("禁止夸大职责或成果");
  });

  it.each(["rawExperience", "actualActions", "deliverableOrResult"])(
    "allows affirmative grounded leadership provenance from %s",
    (field) => {
      const sourceText = "主导整理信息并排版";
      const output = {
        routeResult: {
          confirmedFacts: [sourceText],
          resumeSnippetDraft: "主导整理信息并排版。",
          supportingFacts: [sourceText],
        },
      };

      expect(
        scanRouteSafety("experience_to_resume", output, {
          routeInput: { [field]: sourceText },
        }),
      ).toEqual({ passed: true, blockedReasons: [] });
    },
  );

  it.each([
    ["主导", "主导摆放桌椅", "主导预算规划"],
    ["负责", "负责摆放桌椅", "负责预算规划"],
    ["独立负责", "独立负责摆放桌椅", "独立负责预算规划"],
    ["独立完成", "独立完成桌椅摆放", "独立完成预算规划"],
  ])(
    "does not let the same %s marker authorize a different fact",
    (_marker, sourceFact, draftFact) => {
      expect(
        hasGroundedExperienceRoleStrength(draftFact, {
          actualActions: sourceFact,
        }),
      ).toBe(false);
    },
  );

  it.each([
    "主导摆放桌椅",
    "负责摆放桌椅",
    "独立负责摆放桌椅",
    "独立完成桌椅摆放",
  ])("allows the same affirmative strong-role fact: %s", (fact) => {
    expect(
      hasGroundedExperienceRoleStrength(fact, {
        actualActions: fact,
      }),
    ).toBe(true);
  });

  it("keeps a different grounded leadership fact from exempting an unsafe draft", () => {
    const output = {
      routeResult: {
        confirmedFacts: ["主导摆放桌椅"],
        resumeSnippetDraft: "主导预算规划。",
        supportingFacts: ["主导摆放桌椅"],
      },
    };

    expect(
      scanRouteSafety("experience_to_resume", output, {
        routeInput: { actualActions: "主导摆放桌椅" },
      }).blockedReasons,
    ).toContain("禁止夸大职责或成果");
  });

  it("does not exempt a leadership evidence fragment quoted from a negated source", () => {
    const output = {
      routeResult: {
        confirmedFacts: ["主导整理信息并排版"],
        resumeSnippetDraft: "参与整理信息并排版。",
        supportingFacts: ["整理信息并排版"],
      },
    };

    expect(
      scanRouteSafety("experience_to_resume", output, {
        routeInput: { actualActions: "没有主导整理信息并排版" },
      }).blockedReasons,
    ).toContain("禁止夸大职责或成果");
  });

  it.each([
    "并没有真正意义上在该项目中实际主导整理信息并排版",
    "不确定是否主导整理信息并排版",
    "无法确认是否主导整理信息并排版",
  ])("treats the full normal-route clause as non-affirmative provenance: %s", (sourceText) => {
    const groundedFragment = "主导整理信息并排版";
    const output = {
      routeResult: {
        confirmedFacts: [groundedFragment],
        resumeSnippetDraft: `${groundedFragment}。`,
        supportingFacts: [groundedFragment],
      },
    };

    expect(
      scanRouteSafety("experience_to_resume", output, {
        routeInput: { actualActions: sourceText },
      }).blockedReasons,
    ).toContain("禁止夸大职责或成果");
  });

  it.each([
    "主导整理信息并排版（尚未确认）",
    "主导整理信息并排版，真实性待核实",
    "主导整理信息并排版 (not confirmed)",
  ])("rejects postfixed uncertainty in normal-route role provenance: %s", (sourceText) => {
    const groundedFragment = "主导整理信息并排版";
    const output = {
      routeResult: {
        confirmedFacts: [groundedFragment],
        resumeSnippetDraft: `${groundedFragment}。`,
        supportingFacts: [groundedFragment],
      },
    };

    expect(
      scanRouteSafety("experience_to_resume", output, {
        routeInput: { actualActions: sourceText },
      }).blockedReasons,
    ).toContain("禁止夸大职责或成果");
  });

  it("binds normal-route role provenance to the specific source occurrence", () => {
    const sourceText = "主导整理信息并排版（尚未确认）；后来主导摆放桌椅";
    const makeOutput = (claim: string) => ({
      routeResult: {
        confirmedFacts: [claim],
        resumeSnippetDraft: `${claim}。`,
        supportingFacts: [claim],
      },
    });

    expect(
      scanRouteSafety("experience_to_resume", makeOutput("主导整理信息并排版"), {
        routeInput: { actualActions: sourceText },
      }).blockedReasons,
    ).toContain("禁止夸大职责或成果");
    expect(
      scanRouteSafety("experience_to_resume", makeOutput("后来主导摆放桌椅"), {
        routeInput: { actualActions: sourceText },
      }),
    ).toEqual({ passed: true, blockedReasons: [] });
  });

  it.each([
    "不确定是否参与前期讨论，后来主导整理信息并排版",
    "无法确认是否参与前期讨论；后来主导整理信息并排版",
  ])("keeps a later independent affirmative role clause grounded: %s", (sourceText) => {
    const groundedFact = "主导整理信息并排版";
    const output = {
      routeResult: {
        confirmedFacts: [groundedFact],
        resumeSnippetDraft: `${groundedFact}。`,
        supportingFacts: [groundedFact],
      },
    };

    expect(
      scanRouteSafety("experience_to_resume", output, {
        routeInput: { actualActions: sourceText },
      }),
    ).toEqual({ passed: true, blockedReasons: [] });
  });

  it("allows a confirmed experience light review to quote grounded leadership only in reviewBasis", () => {
    const groundedFact = "主导整理信息并排版";
    const output = { routeResult: { reviewBasis: [groundedFact] } };

    expect(
      scanRouteSafety("experience_to_resume", output, {
        routeInput: {
          mode: "light_review",
          record: {
            actualDone: groundedFact,
            payload: {},
            userConfirmed: true,
            routeKey: "experience_to_resume",
          },
        },
      }),
    ).toEqual({ passed: true, blockedReasons: [] });
  });

  it("allows reviewBasis to quote affirmative leadership from a confirmed payload scalar leaf", () => {
    const groundedFact = "主导整理活动材料";

    expect(
      scanRouteSafety("experience_to_resume", { routeResult: { reviewBasis: [groundedFact] } }, {
        routeInput: {
          mode: "light_review",
          record: {
            routeKey: "experience_to_resume",
            actualDone: "保存了真实经历",
            payload: { details: { actualAction: groundedFact } },
            userConfirmed: true,
          },
        },
      }),
    ).toEqual({ passed: true, blockedReasons: [] });
  });

  it.each([
    "并没有真正意义上在该项目中实际主导整理信息并排版",
    "不确定是否主导整理信息并排版",
    "无法确认是否主导整理信息并排版",
  ])("does not treat a confirmed light-review uncertainty clause as affirmative provenance: %s", (sourceText) => {
    expect(
      scanRouteSafety("experience_to_resume", {
        routeResult: { reviewBasis: ["主导整理信息并排版"] },
      }, {
        routeInput: {
          mode: "light_review",
          record: {
            routeKey: "experience_to_resume",
            actualDone: sourceText,
            payload: {},
            userConfirmed: true,
          },
        },
      }).blockedReasons,
    ).toContain("禁止夸大职责或成果");
  });

  it.each([
    "主导整理信息并排版（尚未确认）",
    "主导整理信息并排版，真实性待核实",
    "主导整理信息并排版 (not confirmed)",
  ])("rejects postfixed uncertainty in confirmed light-review provenance: %s", (sourceText) => {
    expect(
      scanRouteSafety("experience_to_resume", {
        routeResult: { reviewBasis: ["主导整理信息并排版"] },
      }, {
        routeInput: {
          mode: "light_review",
          record: {
            routeKey: "experience_to_resume",
            actualDone: sourceText,
            payload: {},
            userConfirmed: true,
          },
        },
      }).blockedReasons,
    ).toContain("禁止夸大职责或成果");
  });

  it("binds confirmed light-review provenance to the specific quoted occurrence", () => {
    const context = {
      routeInput: {
        mode: "light_review",
        record: {
          routeKey: "experience_to_resume",
          actualDone: "主导整理信息并排版（尚未确认）；后来主导摆放桌椅",
          payload: {},
          userConfirmed: true,
        },
      },
    };

    expect(
      scanRouteSafety("experience_to_resume", {
        routeResult: { reviewBasis: ["主导整理信息并排版"] },
      }, context).blockedReasons,
    ).toContain("禁止夸大职责或成果");
    expect(
      scanRouteSafety("experience_to_resume", {
        routeResult: { reviewBasis: ["后来主导摆放桌椅"] },
      }, context),
    ).toEqual({ passed: true, blockedReasons: [] });
  });

  it.each([
    ["shortAssessment", { shortAssessment: "主导整理信息并排版", routeResult: { reviewBasis: ["整理信息"] } }],
    ["clues", { routeResult: { reviewBasis: ["整理信息"], clues: ["主导整理信息并排版"] } }],
    ["missingInfo", { routeResult: { reviewBasis: ["整理信息"], missingInfo: ["主导整理信息并排版"] } }],
    ["nextAction", { routeResult: { reviewBasis: ["整理信息"], nextAction: "主导整理信息并排版" } }],
    ["action copy", { routeResult: { reviewBasis: ["整理信息"] }, todayAction: { actionTitle: "主导整理信息并排版" } }],
  ])("does not exempt a grounded light-review role marker in %s", (_name, output) => {
    expect(
      scanRouteSafety("experience_to_resume", output, {
        routeInput: {
          mode: "light_review",
          record: {
            actualDone: "主导整理信息并排版",
            payload: {},
            userConfirmed: true,
            routeKey: "experience_to_resume",
          },
        },
      }).blockedReasons,
    ).toContain("禁止夸大职责或成果");
  });

  it.each([
    {
      name: "an unconfirmed record",
      record: {
        routeKey: "experience_to_resume",
        actualDone: "主导整理信息并排版",
        payload: {},
        userConfirmed: false,
      },
    },
    {
      name: "a private record field",
      record: {
        routeKey: "experience_to_resume",
        actualDone: "整理信息并排版",
        payload: {},
        privateNotes: "主导整理信息并排版",
        userConfirmed: true,
      },
    },
    {
      name: "another route record",
      record: {
        actualDone: "主导整理信息并排版",
        payload: {},
        userConfirmed: true,
        routeKey: "jd_to_revision",
      },
    },
  ])("does not establish light-review role provenance from $name", ({ record }) => {
    expect(
      scanRouteSafety("experience_to_resume", { routeResult: { reviewBasis: ["主导整理信息并排版"] } }, {
        routeInput: { mode: "light_review", record },
      }).blockedReasons,
    ).toContain("禁止夸大职责或成果");
  });

  it("does not exempt an ungrounded leadership claim outside the resume draft", () => {
    const output = {
      shortAssessment: "你主导了整体工作。",
      routeResult: { resumeSnippetDraft: "主导整理信息并排版。" },
    };

    expect(
      scanRouteSafety("experience_to_resume", output, {
        routeInput: { actualActions: "主导整理信息并排版" },
      }).blockedReasons,
    ).toContain("禁止夸大职责或成果");
  });

  it("does not use non-allowlisted provenance or provenance from another route", () => {
    const output = { routeResult: { resumeSnippetDraft: "主导整理信息并排版。" } };

    expect(
      scanRouteSafety("experience_to_resume", output, {
        routeInput: { privateNotes: "主导整理信息并排版" },
      }).blockedReasons,
    ).toContain("禁止夸大职责或成果");
    expect(
      scanRouteSafety("jd_to_revision", output, {
        routeInput: { actualActions: "主导整理信息并排版" },
      }).blockedReasons,
    ).toContain("禁止夸大职责或成果");
  });
});
