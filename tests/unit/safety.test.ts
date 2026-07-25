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

  it("allows negated anti-fabrication reminders inside serialized output fields", () => {
    expect(scanSafetyViolations(JSON.stringify({ doNotExaggerate: ["不要虚构阅读量增长数据"] })))
      .toEqual({ passed: true, blockedReasons: [] });
  });

  it("allows avoid-using-fabricated-data reminders", () => {
    expect(scanSafetyViolations("先确认真实的经历细节，避免使用虚构数据。"))
      .toEqual({ passed: true, blockedReasons: [] });
  });

  it("allows compliant refusal wording for fabricated tool-experience requests", () => {
    expect(scanSafetyViolations("必须拒绝虚构或夸大工具经验，只记录真实材料边界。"))
      .toEqual({ passed: true, blockedReasons: [] });
    expect(scanSafetyViolations("明确拒绝虚构经验，保持材料真实。"))
      .toEqual({ passed: true, blockedReasons: [] });
  });

  it("allows compliant role-strength guardrail reminders", () => {
    expect(scanSafetyViolations("不要夸大角色强度（如'主导项目'）"))
      .toEqual({ passed: true, blockedReasons: [] });
    expect(scanSafetyViolations("不要将角色夸大为独立负责或主导"))
      .toEqual({ passed: true, blockedReasons: [] });
    expect(scanSafetyViolations("不要写独立负责整理会议材料。不要写主导了文档汇总。"))
      .toEqual({ passed: true, blockedReasons: [] });
    expect(scanSafetyViolations("不要将参与的数据处理说成主导或独立负责。"))
      .toEqual({ passed: true, blockedReasons: [] });
  });

  it("allows serialized anti-fabrication and anti-exaggeration reminders from experience outputs", () => {
    expect(scanSafetyViolations(JSON.stringify({
      shortAssessment: "先确认已有事实，避免虚构数据。",
      doNotExaggerate: [
        "不要虚构阅读量增长300%",
        "不能编造或夸大阅读量数据",
        "不要将简单的复制发布写为独立运营",
      ],
    }))).toEqual({ passed: true, blockedReasons: [] });
  });

  it("allows negated role-exaggeration reminders with concrete risky phrases", () => {
    expect(scanSafetyViolations("不要写成独立负责公众号运营。不要把协助写成负责。"))
      .toEqual({ passed: true, blockedReasons: [] });
  });

  it("allows serialized anti-role-upgrade reminders from experience outputs", () => {
    expect(scanSafetyViolations(JSON.stringify({
      doNotExaggerate: [
        "不要写成负责或主导旧书交换活动。",
        "不要写成独立负责内容运营或主导活动回顾策划。",
        "不要包装成主导整场迎新活动，实际角色是协助。",
        "不要写成主导需求调研或独立设计产品功能。",
      ],
    }))).toEqual({ passed: true, blockedReasons: [] });
  });

  it("allows negated internal-secret leak reminders", () => {
    expect(scanSafetyViolations("不要输出 API key 或完整 prompt。"))
      .toEqual({ passed: true, blockedReasons: [] });
  });

  it("allows compliant refusal wording for match scores and interview probability", () => {
    expect(scanSafetyViolations("不评估匹配度、录取概率或投递结论，仅核对真实材料证据。"))
      .toEqual({ passed: true, blockedReasons: [] });
    expect(scanSafetyViolations("无法提供匹配度或录取概率判断，只核对真实材料证据。"))
      .toEqual({ passed: true, blockedReasons: [] });
    expect(scanSafetyViolations("无法打分或预测录取概率，仅基于材料核对 JD 要求。"))
      .toEqual({ passed: true, blockedReasons: [] });
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

  it("allows negated anti-fabrication reminders with concrete risky phrases", () => {
    expect(scanSafetyViolations("不要写成阅读量增长300%。不虚构工具使用经验。"))
      .toEqual({ passed: true, blockedReasons: [] });
  });

  it.each([
    "不要编造经历",
    "不要把参与写成主导",
    "不要把协助写成负责",
    "不评价你本人适不适合",
    "不输出能投、不能投、匹配度或录取概率",
    "不要捏造阅读量增长300%等虚假数据",
  ])("allows a pure safety reminder without later affirmative content: %s", (text) => {
    expect(scanSafetyViolations(text)).toEqual({ passed: true, blockedReasons: [] });
  });

  it.each([
    {
      text: "不要编造经历而应包装成全权负责项目",
      reasons: ["禁止编造经历、JD、数据、结果或反馈", "禁止夸大职责或成果"],
    },
    {
      text: "不要把参与写成主导但随后主导整个项目",
      reasons: ["禁止夸大职责或成果"],
    },
    {
      text: "不要把参与写成主导同时包装成全权负责项目",
      reasons: ["禁止编造经历、JD、数据、结果或反馈", "禁止夸大职责或成果"],
    },
    {
      text: "不要编造经历改为主导预算规划",
      reasons: ["禁止夸大职责或成果"],
    },
    {
      text: "不要把参与写成主导却包装成全权负责项目",
      reasons: ["禁止编造经历、JD、数据、结果或反馈", "禁止夸大职责或成果"],
    },
    {
      text: "不评价你本人适不适合但是你最适合做运营",
      reasons: ["禁止评价用户本人适合或不适合"],
    },
    {
      text: "不输出能投结论却可以直接投这个岗位",
      reasons: ["禁止给出绝对投递结论"],
    },
    {
      text: "不得输出模糊判断而是你能投这个岗位",
      reasons: ["禁止给出绝对投递结论"],
    },
  ])("preserves affirmative violations after a compliant reminder: $text", ({ text, reasons }) => {
    const result = scanSafetyViolations(text);

    expect(result.passed).toBe(false);
    expect(result.blockedReasons).toEqual(expect.arrayContaining(reasons));
  });

  it.each([
    "不要编造经历然后主导整个项目",
    "不要把参与写成主导接着全权负责项目",
    "不要编造经历随后包装成全权负责项目",
    "不要把参与写成主导再主导预算规划",
    "不要编造经历进而包装成全权负责项目",
    "不要编造经历之后主导整个项目",
    "不要编造经历接下来全权负责项目",
  ])("retains a sequential strong-role violation after a compliant reminder: %s", (text) => {
    const result = scanSafetyViolations(text);

    expect(result.passed).toBe(false);
    expect(result.blockedReasons).toContain("禁止夸大职责或成果");
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
