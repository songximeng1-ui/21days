import { describe, expect, it } from "vitest";
import { MockAiProvider } from "@/ai/mock-provider";
import { routeRequestSchema } from "@/schemas/route-request";
import * as routeOutputSchemas from "@/schemas/route-output";
import { getRouteContract } from "@/domain/route-contracts";
import { getRouteStrategy } from "@/domain/routes";
import { attachOutputProvenance } from "@/domain/provenance";
import type { RouteOutput } from "@/domain/types";

const sufficientInputs = {
  direction_to_jobs: {
    educationBackground: "内容运营相关课程",
    realExperiences: "整理并发布过社团新媒体运营推文",
    interestsOrAcceptables: "愿意尝试客户支持沟通",
    constraints: "不接受长期出差",
  },
  experience_to_resume: {
    targetDirection: "运营",
    rawExperience: "社团公众号排版",
    actualActions: "整理并发布 5 篇推文",
    deliverableOrResult: "保存了 5 篇推文链接",
  },
  jd_to_revision: {
    targetJobTitle: "运营实习生",
    jdTextOrRequirements: "负责内容整理和 Excel 台账",
    userMaterial: "整理社团报名信息并使用 Excel 汇总",
  },
  applications_to_review: {
    applications: [
      {
        jobTitle: "运营实习生",
        companyOrPlatform: "A 公司",
        submittedAt: "2026-07-01",
        feedbackStatus: "暂无反馈",
        jdSummary: "内容整理",
        materialVersion: "社团经历版",
      },
      {
        jobTitle: "内容实习生",
        companyOrPlatform: "B 公司",
        submittedAt: "2026-07-03",
        feedbackStatus: "已查看",
        jdSummary: "选题与数据记录",
        materialVersion: "项目经历版",
      },
    ],
  },
} as const;

describe("route discriminated contracts", () => {
  it("accepts every valid route result and rejects a mismatched route/result pair", async () => {
    for (const routeKey of Object.keys(sufficientInputs) as Array<keyof typeof sufficientInputs>) {
      const output = await new MockAiProvider("success").generate({
        routeKey,
        input: sufficientInputs[routeKey],
      });
      expect(routeOutputSchemas.routeOutputSchema.safeParse(output).success).toBe(true);
    }

    const experience = await new MockAiProvider("success").generate({
      routeKey: "experience_to_resume",
      input: sufficientInputs.experience_to_resume,
    });
    expect(
      routeOutputSchemas.routeOutputSchema.safeParse({
        ...experience,
        routeKey: "direction_to_jobs",
      }).success,
    ).toBe(false);
  });

  it("rejects route-result fields, action types, and record types from another route", async () => {
    const output = await new MockAiProvider("success").generate({
      routeKey: "experience_to_resume",
      input: sufficientInputs.experience_to_resume,
    });

    expect(
      routeOutputSchemas.routeOutputSchema.safeParse({
        ...output,
        routeResult: { ...output.routeResult, unexpectedFact: "not in contract" },
      }).success,
    ).toBe(false);
    expect(
      routeOutputSchemas.routeOutputSchema.safeParse({
        ...output,
        todayAction: { ...output.todayAction, actionType: "job_sample" },
      }).success,
    ).toBe(false);
    expect(
      routeOutputSchemas.routeOutputSchema.safeParse({
        ...output,
        recordGuide: { ...output.recordGuide, recordType: "job_sample" },
      }).success,
    ).toBe(false);
  });

  it("uses routeKey to select a strict input contract", () => {
    expect(
      routeRequestSchema.safeParse({
        mode: "route",
        routeKey: "direction_to_jobs",
        input: sufficientInputs.direction_to_jobs,
      }).success,
    ).toBe(true);
    expect(
      routeRequestSchema.safeParse({
        mode: "route",
        routeKey: "direction_to_jobs",
        input: {
          ...sufficientInputs.direction_to_jobs,
          privateNotes: "must not cross the route boundary",
        },
      }).success,
    ).toBe(false);
    expect(
      routeRequestSchema.safeParse({
        mode: "route",
        routeKey: "experience_to_resume",
        input: sufficientInputs.direction_to_jobs,
      }).success,
    ).toBe(false);
  });

  it("uses the same input-field contract for route sufficiency", () => {
    for (const routeKey of Object.keys(sufficientInputs) as Array<keyof typeof sufficientInputs>) {
      expect(getRouteStrategy(routeKey).requiredFields).toEqual(
        getRouteContract(routeKey).inputFields,
      );
    }
  });

  it("keeps the target job title in the canonical JD comparison record", () => {
    expect(getRouteContract("jd_to_revision").fieldsToRecord).toEqual([
      "targetJobTitle",
      "beforeSnippet",
      "afterSnippet",
      "jdRequirement",
      "submitted",
    ]);
  });

  it("keeps provenance inside the strict persisted output contract", async () => {
    const output = await new MockAiProvider("success").generate({
      routeKey: "experience_to_resume",
      input: sufficientInputs.experience_to_resume,
    });
    const result = attachOutputProvenance(output, sufficientInputs.experience_to_resume);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(routeOutputSchemas.routeOutputSchema.safeParse(result.output).success).toBe(true);
  });

  it.each([
    ["direction_to_jobs", "job_sample", "job_sample"],
    ["experience_to_resume", "experience_fact", "experience_fact"],
    ["jd_to_revision", "jd_revision", "jd_compare"],
    ["applications_to_review", "application_record", "application"],
  ] as const)(
    "binds light review for %s to its route action and record contract",
    (routeKey, actionType, recordType) => {
      const valid = makeNonRouteResult(routeKey, "light_review", actionType, recordType);
      expect(routeOutputSchemas.routeOutputSchema.safeParse(valid).success).toBe(true);
      expect(
        routeOutputSchemas.routeOutputSchema.safeParse({
          ...valid,
          todayAction: { ...valid.todayAction, actionType: "application_record" },
          recordGuide: { ...valid.recordGuide, recordType: "application" },
        }).success,
      ).toBe(routeKey === "applications_to_review");
    },
  );

  it.each([
    ["direction_to_jobs", "fill_info"],
    ["experience_to_resume", "fill_info"],
    ["jd_to_revision", "fill_info"],
    ["applications_to_review", "application"],
  ] as const)(
    "binds %s missing-info output to its route-specific record type",
    (routeKey, recordType) => {
      const valid = makeNonRouteResult(routeKey, "missing_info", "fill_info", recordType);
      expect(routeOutputSchemas.routeOutputSchema.safeParse(valid).success).toBe(true);
    },
  );

  it.each([
    "direction_to_jobs",
    "experience_to_resume",
    "jd_to_revision",
    "applications_to_review",
  ] as const)(
    "requires fill_info/fill_info for %s friendly-failure outputs",
    (routeKey) => {
      const valid = makeNonRouteResult(routeKey, "friendly_failure", "fill_info", "fill_info");
      expect(routeOutputSchemas.routeOutputSchema.safeParse(valid).success).toBe(true);
      expect(
        routeOutputSchemas.routeOutputSchema.safeParse({
          ...valid,
          todayAction: { ...valid.todayAction, actionType: "experience_fact" },
          recordGuide: { ...valid.recordGuide, recordType: "experience_fact" },
        }).success,
      ).toBe(false);
    },
  );

  it("requires every inference provenance entry to derive from a grounded claim", () => {
    const output = makeNonRouteResult(
      "experience_to_resume",
      "light_review",
      "experience_fact",
      "experience_fact",
    );
    expect(
      routeOutputSchemas.routeOutputSchema.safeParse({
        ...output,
        provenance: {
          shortAssessment: {
            kind: "inference",
            sources: [],
            derivedFromClaims: [],
          },
        },
      }).success,
    ).toBe(false);
  });

  it.each([
    ["", false],
    ["r", true],
    ["r".repeat(120), true],
    ["r".repeat(121), false],
  ])("bounds confirmed-record recordId at 1 to 120 characters", (recordId, expected) => {
    const output = makeNonRouteResult(
      "experience_to_resume",
      "light_review",
      "experience_fact",
      "experience_fact",
    );
    expect(routeOutputSchemas.routeOutputSchema.safeParse({
      ...output,
      provenance: {
        shortAssessment: {
          kind: "fact",
          sources: [{
            sourceType: "confirmed_record",
            path: "actualDone",
            quote: "已确认",
            recordId,
            recordVersion: 1,
          }],
        },
      },
    }).success).toBe(expected);
  });

  it.each([
    { recordId: "record-1" },
    { recordVersion: 1 },
  ])("rejects user-input sources that carry record identity", (identity) => {
    const output = makeNonRouteResult(
      "experience_to_resume",
      "light_review",
      "experience_fact",
      "experience_fact",
    );
    expect(routeOutputSchemas.routeOutputSchema.safeParse({
      ...output,
      provenance: {
        shortAssessment: {
          kind: "fact",
          sources: [{
            sourceType: "user_input",
            path: "actualActions",
            quote: "整理过素材",
            ...identity,
          }],
        },
      },
    }).success).toBe(false);
  });

  it.each([
    [64, true],
    [65, false],
  ])("allows at most 64 sources for one claim", (count, expected) => {
    const output = makeNonRouteResult(
      "experience_to_resume",
      "light_review",
      "experience_fact",
      "experience_fact",
    );
    const source = {
      sourceType: "user_input" as const,
      path: "actualActions",
      quote: "整理过素材",
    };
    expect(routeOutputSchemas.routeOutputSchema.safeParse({
      ...output,
      provenance: {
        shortAssessment: {
          kind: "fact",
          sources: Array.from({ length: count }, () => source),
        },
      },
    }).success).toBe(expected);
  });

  it("infers a parsed route result as a RouteOutput-compatible value", async () => {
    const output = await new MockAiProvider("success").generate({
      routeKey: "experience_to_resume",
      input: sufficientInputs.experience_to_resume,
    });
    const parsed: RouteOutput = routeOutputSchemas.routeOutputSchema.parse(output);

    expect(parsed.routeKey).toBe("experience_to_resume");
  });

  it("keeps candidate parsing compatible while requiring provenance at the final boundary", async () => {
    const candidate = await new MockAiProvider("success").generate({
      routeKey: "experience_to_resume",
      input: sufficientInputs.experience_to_resume,
    });
    const finalSchema = routeOutputSchemas.routeOutputWithProvenanceSchema;

    expect(routeOutputSchemas.routeOutputSchema.safeParse(candidate).success).toBe(true);
    expect(finalSchema.safeParse(candidate).success).toBe(false);
    expect(finalSchema.safeParse({ ...candidate, provenance: {} }).success).toBe(false);
    expect(finalSchema.safeParse({
      ...candidate,
      provenance: {
        shortAssessment: {
          kind: "fact",
          sources: [{
            sourceType: "user_input",
            path: "does.not.exist",
            quote: "伪造引用",
          }],
        },
      },
    }).success).toBe(false);

    const withProvenance = attachOutputProvenance(
      candidate,
      sufficientInputs.experience_to_resume,
    );
    expect(withProvenance.ok).toBe(true);
    if (!withProvenance.ok) return;
    expect(finalSchema.safeParse(withProvenance.output).success).toBe(true);
    const forgedSources = structuredClone(withProvenance.output);
    for (const claim of Object.values(forgedSources.provenance ?? {})) {
      if (claim.kind === "fact") {
        claim.sources = claim.sources.map((source) => ({
          ...source,
          path: "does.not.exist",
          quote: "伪造引用",
        }));
      }
    }
    expect(finalSchema.safeParse(forgedSources).success).toBe(false);
    const crossRouteSources = structuredClone(withProvenance.output);
    for (const claim of Object.values(crossRouteSources.provenance ?? {})) {
      if (claim.kind === "fact") {
        claim.sources = claim.sources.map((source) => ({
          ...source,
          path: "jdTextOrRequirements",
        }));
      }
    }
    expect(finalSchema.safeParse(crossRouteSources).success).toBe(false);
  });

  it("rejects nested provider extras instead of silently stripping them", async () => {
    const candidate = await new MockAiProvider("success").generate({
      routeKey: "experience_to_resume",
      input: sufficientInputs.experience_to_resume,
    });

    expect(routeOutputSchemas.routeOutputSchema.safeParse({
      ...candidate,
      todayAction: { ...candidate.todayAction, rawProviderExtra: "blocked" },
      recordGuide: { ...candidate.recordGuide, rawProviderExtra: "blocked" },
    }).success).toBe(false);
  });
});

function makeNonRouteResult(
  routeKey: RouteOutput["routeKey"],
  outputType: "missing_info" | "friendly_failure" | "light_review",
  actionType: RouteOutput["todayAction"]["actionType"],
  recordType: RouteOutput["recordGuide"]["recordType"],
) {
  return {
    routeKey,
    outputType,
    shortAssessment: "Review the grounded record",
    routeResult: outputType === "light_review"
      ? {
          reviewBasis: ["Grounded record"],
          clues: ["Could validate one clue"],
          missingInfo: ["Missing one detail"],
          nextAction: "Check one detail",
        }
      : null,
    missingInfo: outputType === "missing_info"
      ? {
          cannotJudge: "Cannot judge yet",
          alreadyKnown: ["Grounded record"],
          missingFields: ["One detail"],
        }
      : null,
    todayAction: {
      actionTitle: "Check one detail",
      actionReason: "Use the grounded record",
      actionSteps: ["Open the record"],
      estimatedTime: "15-30 minutes",
      recordAfterDone: "Save the detail",
      actionType,
    },
    recordGuide: {
      recordType,
      fieldsToRecord: recordType === "fill_info" ? ["draft"] : ["actualActions"],
      requiresUserConfirmation: true,
    },
  };
}
