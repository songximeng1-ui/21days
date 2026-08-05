import { z } from "zod";
import { ROUTE_KEYS } from "@/domain/types";

export const ROUTE_OUTPUT_LIMITS = {
  shortText: 240,
  paragraph: 2_000,
  longText: 6_000,
  listItems: 12,
  routeResultTotalCharacters: 16_000,
} as const;

const shortTextSchema = z.string().min(1).max(ROUTE_OUTPUT_LIMITS.shortText);
const paragraphSchema = z.string().min(1).max(ROUTE_OUTPUT_LIMITS.paragraph);
const longTextSchema = z.string().min(1).max(ROUTE_OUTPUT_LIMITS.longText);
const paragraphListSchema = z.array(paragraphSchema).max(ROUTE_OUTPUT_LIMITS.listItems);

export const todayActionSchema = z.object({
  actionTitle: shortTextSchema,
  actionReason: paragraphSchema,
  actionSteps: paragraphListSchema.min(1).max(4),
  estimatedTime: shortTextSchema,
  recordAfterDone: paragraphSchema,
  completionStandard: paragraphSchema.optional(),
  actionType: z.enum([
    "job_sample",
    "experience_fact",
    "resume_snippet",
    "jd_revision",
    "application_record",
    "feedback_record",
    "fill_info",
  ]),
}).strict();

export const recordGuideSchema = z.object({
  recordType: z.enum([
    "job_sample",
    "experience_fact",
    "resume_snippet",
    "jd_compare",
    "application",
    "feedback",
    "fill_info",
  ]),
  fieldsToRecord: z.array(z.string().min(1).max(80)).max(20),
  requiresUserConfirmation: z.boolean(),
}).strict();

export const missingInfoSchema = z.object({
  cannotJudge: paragraphSchema,
  alreadyKnown: paragraphListSchema,
  missingFields: paragraphListSchema,
  fillAction: todayActionSchema.optional(),
}).strict();

export const routeOutputEnvelopeSchema = z.object({
  routeKey: z.enum(ROUTE_KEYS),
  outputType: z.enum(["route_result", "missing_info", "light_review", "friendly_failure"]),
  shortAssessment: paragraphSchema,
  routeResult: z.record(z.string(), z.unknown()).nullable(),
  missingInfo: missingInfoSchema.nullable(),
  todayAction: todayActionSchema,
  recordGuide: recordGuideSchema,
}).strict().superRefine(enforceRouteResultCharacterBudget);

const directionResultSchema = z.object({
  explorableDirections: z.array(z.object({
    directionName: shortTextSchema,
    searchKeywords: paragraphListSchema,
    basisFromUserMaterial: paragraphListSchema,
    riskOrGap: paragraphSchema,
    validationFocus: paragraphSchema,
  }).strict()).min(2).max(3),
}).strict();

const experienceResultSchema = z.object({
  confirmedFacts: paragraphListSchema,
  missingFacts: paragraphListSchema,
  doNotExaggerate: paragraphListSchema,
  resumeSnippetDraft: longTextSchema,
  supportingFacts: paragraphListSchema,
}).strict();

const authoritativeJdResultSchema = z.object({
  decision: z.enum(["modify", "collect_evidence", "all_keep"]),
  requirementsChecked: paragraphListSchema.min(1).max(5),
  modifications: z.array(z.object({
    requirementQuote: paragraphSchema,
    materialQuotes: paragraphListSchema.min(1).max(3),
    revisionTarget: paragraphSchema,
    candidateRevision: paragraphSchema,
    reason: paragraphSchema,
  }).strict()).max(2),
  evidenceRequest: paragraphSchema.nullable(),
  jdKeyRequirements: paragraphListSchema,
  supportedByMaterial: paragraphListSchema,
  unclearFromMaterial: paragraphListSchema,
  minimalRevisionActions: paragraphListSchema,
  afterSubmissionRecording: paragraphListSchema,
  revisionTarget: paragraphSchema.optional(),
  candidateRevision: paragraphSchema.nullable().optional(),
  evidenceCheck: paragraphSchema.optional(),
}).strict().superRefine((result, context) => {
  if (result.decision === "modify" && result.modifications.length === 0) {
    context.addIssue({ code: "custom", path: ["modifications"], message: "Modify requires one or two grounded changes." });
  }
  if (result.decision !== "modify" && result.modifications.length !== 0) {
    context.addIssue({ code: "custom", path: ["modifications"], message: "Collect-evidence and all-keep cannot carry changes." });
  }
  if (result.decision === "collect_evidence" && !result.evidenceRequest) {
    context.addIssue({ code: "custom", path: ["evidenceRequest"], message: "Collect-evidence requires a concrete evidence request." });
  }
  if (result.decision === "all_keep" && result.requirementsChecked.length < 3) {
    context.addIssue({ code: "custom", path: ["requirementsChecked"], message: "All-keep requires three to five checked requirements." });
  }
  if (result.decision === "all_keep" && result.evidenceRequest !== null) {
    context.addIssue({ code: "custom", path: ["evidenceRequest"], message: "All-keep cannot request missing evidence." });
  }
});

// Read compatibility for pre-P0 local actions and friendly-mode test fixtures only.
// The production orchestrator separately requires the signed narrow JD envelope.
const legacyJdResultSchema = z.object({
  jdKeyRequirements: paragraphListSchema,
  supportedByMaterial: paragraphListSchema,
  unclearFromMaterial: paragraphListSchema,
  minimalRevisionActions: paragraphListSchema,
  afterSubmissionRecording: paragraphListSchema,
  revisionTarget: paragraphSchema.optional(),
  candidateRevision: paragraphSchema.nullable().optional(),
  evidenceCheck: paragraphSchema.optional(),
}).strict();

const jdResultSchema = z.union([authoritativeJdResultSchema, legacyJdResultSchema]);

const applicationsResultSchema = z.object({
  reviewBasis: paragraphListSchema,
  recordSufficiency: shortTextSchema,
  possibleClues: paragraphListSchema,
  informationGaps: paragraphListSchema,
  nextValidationAction: paragraphSchema,
}).strict();

const lightReviewResultSchema = z.object({
  reviewBasis: paragraphListSchema,
  clues: paragraphListSchema,
  missingInfo: paragraphListSchema,
  nextAction: paragraphSchema,
}).strict();

const sourceRefSchema = z.object({
  sourceType: z.enum(["user_input", "confirmed_record"]),
  path: z.string().min(1).max(500),
  quote: z.string().min(1).max(12),
  recordId: z.string().min(1).max(120).optional(),
  recordVersion: z.number().int().positive().optional(),
}).strict().superRefine((source, context) => {
  if (!isAllowedSourcePath(source.sourceType, source.path)) {
    context.addIssue({
      code: "custom",
      path: ["path"],
      message: "Source path is outside the accepted input or record projection.",
    });
  }
  if (
    source.sourceType === "confirmed_record" &&
    (!source.recordId || source.recordVersion === undefined)
  ) {
    context.addIssue({
      code: "custom",
      message: "Confirmed-record sources require record identity and version.",
    });
  }
  if (
    source.sourceType === "user_input" &&
    (source.recordId !== undefined || source.recordVersion !== undefined)
  ) {
    context.addIssue({
      code: "custom",
      message: "User-input sources must not carry record identity.",
    });
  }
});

const USER_INPUT_FIELDS = new Set([
  "educationBackground",
  "realExperiences",
  "interestsOrAcceptables",
  "constraints",
  "targetDirection",
  "rawExperience",
  "actualActions",
  "deliverableOrResult",
  "targetJobTitle",
  "jdTextOrRequirements",
  "userMaterial",
  "jobTitle",
  "companyOrPlatform",
  "submittedAt",
  "feedbackStatus",
  "jdSummary",
  "materialVersion",
  "userSuspicion",
  "applications",
]);

const USER_INPUT_FIELDS_BY_ROUTE: Record<(typeof ROUTE_KEYS)[number], Set<string>> = {
  direction_to_jobs: new Set([
    "educationBackground",
    "realExperiences",
    "interestsOrAcceptables",
    "constraints",
  ]),
  experience_to_resume: new Set([
    "targetDirection",
    "rawExperience",
    "actualActions",
    "deliverableOrResult",
  ]),
  jd_to_revision: new Set([
    "targetJobTitle",
    "jdTextOrRequirements",
    "userMaterial",
    "currentQuestion",
  ]),
  applications_to_review: new Set([
    "jobTitle",
    "companyOrPlatform",
    "submittedAt",
    "feedbackStatus",
    "jdSummary",
    "materialVersion",
    "userSuspicion",
  ]),
};

const RECORD_PAYLOAD_FIELDS_BY_ROUTE: Record<(typeof ROUTE_KEYS)[number], Set<string>> = {
  direction_to_jobs: new Set([
    "jobTitle",
    "companyOrPlatform",
    "jdSummary",
    "interestPoint",
    "concernPoint",
  ]),
  experience_to_resume: new Set([
    "actualActions",
    "deliverable",
    "confirmedFacts",
    "supportingFacts",
    "missingFacts",
    "resumeSnippet",
    "stillMissing",
  ]),
  jd_to_revision: new Set([
    "beforeSnippet",
    "afterSnippet",
    "jdRequirement",
    "submitted",
  ]),
  applications_to_review: new Set([
    "jobTitle",
    "companyOrPlatform",
    "submittedAt",
    "feedbackStatus",
    "jdSummary",
    "materialVersion",
    "userSuspicion",
  ]),
};

function isAllowedSourcePath(
  sourceType: "user_input" | "confirmed_record",
  path: string,
): boolean {
  if (sourceType === "confirmed_record") {
    return /^(?:(?:records\.\d+\.)?actualDone|(?:records\.\d+\.)?payload\.[A-Za-z][A-Za-z0-9]*)$/.test(
      path,
    );
  }
  if (process.env.NODE_ENV === "test" && path === "testFixture") return true;
  if (USER_INPUT_FIELDS.has(path)) return true;
  const applicationPath = path.match(/^applications\.\d+\.([A-Za-z][A-Za-z0-9]*)$/);
  return Boolean(applicationPath && USER_INPUT_FIELDS.has(applicationPath[1]));
}

const provenanceSchema = z.record(
  z.string().min(1).max(500),
  z.object({
    kind: z.enum(["fact", "inference"]),
    sources: z.array(sourceRefSchema).max(64),
    derivedFromClaims: z.array(z.string().min(1).max(500)).max(50).optional(),
  }).strict().superRefine((claim, context) => {
    if (claim.kind === "fact" && claim.sources.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["sources"],
        message: "Fact claims require at least one source.",
      });
    }
    if (
      claim.kind === "inference" &&
      (!claim.derivedFromClaims || claim.derivedFromClaims.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["derivedFromClaims"],
        message: "Inference claims require at least one grounded claim.",
      });
    }
  }),
);

const sharedShape = {
  shortAssessment: paragraphSchema,
  provenance: provenanceSchema.optional(),
};

function routeResultVariant<
  Route extends (typeof ROUTE_KEYS)[number],
  Result extends z.ZodTypeAny,
  Action extends Parameters<typeof z.literal>[0],
  RecordKind extends Parameters<typeof z.literal>[0],
>(
  routeKey: Route,
  routeResult: Result,
  actionType: Action,
  recordType: RecordKind,
) {
  return z.object({
    routeKey: z.literal(routeKey),
    outputType: z.literal("route_result"),
    ...sharedShape,
    routeResult,
    missingInfo: z.null(),
    todayAction: todayActionSchema.extend({ actionType: z.literal(actionType) }),
    recordGuide: recordGuideSchema.extend({ recordType: z.literal(recordType) }),
  }).strict();
}

const routeResultSchema = z.union([
  routeResultVariant(
    "direction_to_jobs",
    directionResultSchema,
    "job_sample",
    "job_sample",
  ),
  routeResultVariant(
    "experience_to_resume",
    experienceResultSchema,
    "experience_fact",
    "experience_fact",
  ),
  routeResultVariant(
    "jd_to_revision",
    jdResultSchema,
    "jd_revision",
    "jd_compare",
  ),
  routeResultVariant(
    "applications_to_review",
    applicationsResultSchema,
    "application_record",
    "application",
  ),
]);

function fillInfoVariant<
  Route extends (typeof ROUTE_KEYS)[number],
  Output extends "missing_info" | "friendly_failure",
  RecordKind extends "fill_info" | "application",
>(routeKey: Route, outputType: Output, recordType: RecordKind) {
  return z.object({
    routeKey: z.literal(routeKey),
    outputType: z.literal(outputType),
    ...sharedShape,
    routeResult: z.null(),
    missingInfo: outputType === "missing_info"
      ? missingInfoSchema.extend({
          fillAction: todayActionSchema.extend({
            actionType: z.literal("fill_info"),
          }).optional(),
        })
      : z.null(),
    todayAction: todayActionSchema.extend({
      actionType: z.literal("fill_info"),
    }),
    recordGuide: recordGuideSchema.extend({
      recordType: z.literal(recordType),
    }),
  }).strict();
}

function lightReviewVariant<
  Route extends (typeof ROUTE_KEYS)[number],
  Action extends Parameters<typeof z.literal>[0],
  RecordKind extends Parameters<typeof z.literal>[0],
>(routeKey: Route, actionType: Action, recordType: RecordKind) {
  return z.object({
    routeKey: z.literal(routeKey),
    outputType: z.literal("light_review"),
    ...sharedShape,
    routeResult: lightReviewResultSchema,
    missingInfo: z.null(),
    todayAction: todayActionSchema.extend({
      actionType: z.literal(actionType),
    }),
    recordGuide: recordGuideSchema.extend({
      recordType: z.literal(recordType),
    }),
  }).strict();
}

const missingInfoOutputSchema = z.union([
  fillInfoVariant("direction_to_jobs", "missing_info", "fill_info"),
  fillInfoVariant("experience_to_resume", "missing_info", "fill_info"),
  fillInfoVariant("jd_to_revision", "missing_info", "fill_info"),
  fillInfoVariant("applications_to_review", "missing_info", "application"),
]);

const friendlyFailureSchema = z.union([
  fillInfoVariant("direction_to_jobs", "friendly_failure", "fill_info"),
  fillInfoVariant("experience_to_resume", "friendly_failure", "fill_info"),
  fillInfoVariant("jd_to_revision", "friendly_failure", "fill_info"),
  fillInfoVariant("applications_to_review", "friendly_failure", "fill_info"),
]);

const lightReviewSchema = z.union([
  lightReviewVariant("direction_to_jobs", "job_sample", "job_sample"),
  lightReviewVariant("experience_to_resume", "experience_fact", "experience_fact"),
  lightReviewVariant("jd_to_revision", "jd_revision", "jd_compare"),
  lightReviewVariant("applications_to_review", "application_record", "application"),
]);

const routeOutputBaseSchema = z.union([
  routeResultSchema,
  missingInfoOutputSchema,
  friendlyFailureSchema,
  lightReviewSchema,
]);

export const routeOutputSchema = routeOutputBaseSchema.superRefine(
  enforceRouteResultCharacterBudget,
);

export const routeOutputWithProvenanceSchema = routeOutputSchema.superRefine(
  (output, context) => {
    if (output.outputType === "friendly_failure") return;
    const provenance = output.provenance;
    if (!provenance || Object.keys(provenance).length === 0) {
      context.addIssue({
        code: "custom",
        path: ["provenance"],
        message: "Non-failure output requires claim provenance.",
      });
      return;
    }

    const visiblePaths = collectVisibleTextPaths({
      shortAssessment: output.shortAssessment,
      routeResult: output.routeResult,
      missingInfo: output.missingInfo,
      todayAction: output.todayAction,
      recordGuide: output.recordGuide,
    });
    const visiblePathSet = new Set(visiblePaths);
    for (const path of visiblePaths) {
      if (!provenance[path]) {
        context.addIssue({
          code: "custom",
          path: ["provenance", path],
          message: "Every visible text claim requires provenance.",
        });
      }
    }
    for (const [path, claim] of Object.entries(provenance)) {
      if (!visiblePathSet.has(path)) {
        context.addIssue({
          code: "custom",
          path: ["provenance", path],
          message: "Provenance keys must identify visible claims.",
        });
      }
      for (const derivedPath of claim.derivedFromClaims ?? []) {
        if (provenance[derivedPath]?.kind !== "fact") {
          context.addIssue({
            code: "custom",
            path: ["provenance", path, "derivedFromClaims"],
            message: "Inference lineage must reference a visible grounded fact claim.",
          });
        }
      }
      for (const source of claim.sources) {
        if (!isAllowedSourcePathForRoute(output.routeKey, source.sourceType, source.path)) {
          context.addIssue({
            code: "custom",
            path: ["provenance", path, "sources"],
            message: "Source path does not belong to this route's accepted projection.",
          });
        }
      }
    }
  },
);

function isAllowedSourcePathForRoute(
  routeKey: (typeof ROUTE_KEYS)[number],
  sourceType: "user_input" | "confirmed_record",
  path: string,
): boolean {
  if (process.env.NODE_ENV === "test" && path === "testFixture") return true;
  if (sourceType === "user_input") {
    if (routeKey === "applications_to_review") {
      const match = path.match(/^applications\.\d+\.([A-Za-z][A-Za-z0-9]*)$/);
      return Boolean(match && USER_INPUT_FIELDS_BY_ROUTE[routeKey].has(match[1]));
    }
    return USER_INPUT_FIELDS_BY_ROUTE[routeKey].has(path);
  }
  if (/^(?:records\.\d+\.)?actualDone$/.test(path)) return true;
  const payloadMatch = path.match(/^(?:records\.\d+\.)?payload\.([A-Za-z][A-Za-z0-9]*)$/);
  return Boolean(payloadMatch && RECORD_PAYLOAD_FIELDS_BY_ROUTE[routeKey].has(payloadMatch[1]));
}

function collectVisibleTextPaths(value: unknown, path = ""): string[] {
  if (typeof value === "string" && value.trim()) return [path];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      collectVisibleTextPaths(item, path ? `${path}.${index}` : String(index)),
    );
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, child]) =>
      collectVisibleTextPaths(child, path ? `${path}.${key}` : key),
    );
  }
  return [];
}

function enforceRouteResultCharacterBudget(
  output: { routeResult?: unknown },
  context: z.RefinementCtx,
): void {
  if (
    countTextCharacters(output.routeResult) >
    ROUTE_OUTPUT_LIMITS.routeResultTotalCharacters
  ) {
    context.addIssue({
      code: "custom",
      path: ["routeResult"],
      message: "Route result exceeds the visible text budget.",
    });
  }
}

function countTextCharacters(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + countTextCharacters(item), 0);
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).reduce<number>(
      (total, item) => total + countTextCharacters(item),
      0,
    );
  }
  return 0;
}

export type ParsedRouteOutput = z.infer<typeof routeOutputSchema>;
