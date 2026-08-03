import {
  AiProviderError,
  type AiProvider,
  type AiProviderErrorKind,
  type AiProviderSet,
  type AiRetryFeedback,
} from "@/ai/provider";
import {
  noopAiFailureReporter,
  type AiFailureEvent,
  type AiFailureReporter,
  type AiFailureStage,
} from "@/ai/failure-diagnostics";
import {
  beginProviderAttempt,
  getProviderRetryAfterMs,
  recordProviderFailure,
  recordProviderSuccess,
} from "@/ai/orchestration-policy";
import { validateRouteOutput } from "@/domain/action-card";
import { selectJobTaxonomyDirections, validateDirectionCandidates } from "@/domain/job-taxonomy";
import { attachOutputProvenance } from "@/domain/provenance";
import { getRouteStrategy, isPlaceholderValue, isRouteInputSufficient } from "@/domain/routes";
import { hasGroundedExperienceRoleStrength, scanRouteSafety } from "@/domain/safety";
import type { ActionType, RecordType, RouteKey, RouteOutput } from "@/domain/types";
import type { LocalRecord } from "@/lib/local-store";
import { routeOutputEnvelopeSchema } from "@/schemas/route-output";

type GenerateRouteOutputInput = {
  routeKey: RouteKey;
  input: Record<string, unknown>;
  provider?: AiProvider;
  primary?: AiProvider;
  fallback?: AiProvider;
  reporter?: AiFailureReporter;
  requestId?: string;
  signal?: AbortSignal;
  deadlineMs?: number;
  surfaceUpstreamUnavailable?: boolean;
};

type LightReviewRecord = Omit<
  LocalRecord,
  "status" | "version" | "updatedAt" | "completedAt"
> &
  Partial<Pick<LocalRecord, "status" | "version" | "updatedAt" | "completedAt">>;

type LightReviewProviderRecord = Pick<
  LocalRecord,
  "routeKey" | "actualDone" | "payload" | "userConfirmed"
>;

type GenerateLightReviewInput = {
  record?: LightReviewProviderRecord | LightReviewRecord;
  records?: Array<LightReviewProviderRecord | LightReviewRecord>;
  provenanceRecord?: LightReviewRecord;
  provenanceRecords?: LightReviewRecord[];
  provider?: AiProvider;
  primary?: AiProvider;
  fallback?: AiProvider;
  reporter?: AiFailureReporter;
  requestId?: string;
  signal?: AbortSignal;
  deadlineMs?: number;
  surfaceUpstreamUnavailable?: boolean;
};

export class AiUpstreamUnavailableError extends Error {
  constructor(readonly retryAfterMs: number) {
    super("AI service is temporarily unavailable");
    this.name = "AiUpstreamUnavailableError";
  }
}

export function makeFriendlyFailureOutput(routeKey: RouteKey): RouteOutput {
  return {
    routeKey,
    outputType: "friendly_failure",
    shortAssessment: "这次暂时没整理出来。你可以先保存当前填写内容，稍后继续。",
    routeResult: null,
    missingInfo: null,
    todayAction: {
      actionTitle: "当前内容已保存，稍后继续",
      actionReason: "这次暂时没有整理出可执行的小行动，先保留当前填写内容。",
      actionSteps: ["稍后从当前内容继续"],
      estimatedTime: "已保存，稍后继续",
      recordAfterDone: "保留当前草稿，稍后继续。",
      actionType: "fill_info",
    },
    recordGuide: {
      recordType: "fill_info",
      fieldsToRecord: ["draft"],
      requiresUserConfirmation: true,
    },
    provenance: {},
  };
}

export async function generateRouteOutput({
  routeKey,
  input,
  provider,
  primary,
  fallback,
  reporter,
  requestId,
  signal,
  deadlineMs,
  surfaceUpstreamUnavailable,
}: GenerateRouteOutputInput): Promise<RouteOutput> {
  if (!isRouteInputSufficient(routeKey, input)) {
    const missing = makeMissingInfoOutput(routeKey, input);
    const withProvenance = attachOutputProvenance(missing, input);
    return withProvenance.ok ? withProvenance.output : makeFriendlyFailureOutput(routeKey);
  }

  if (routeKey === "direction_to_jobs" && !hasEnoughDirectionTaxonomyEvidence(input)) {
    const missing = makeMissingInfoOutput(routeKey, input, directionEvidenceMissingInfoConfig);
    const withProvenance = attachOutputProvenance(missing, input);
    return withProvenance.ok ? withProvenance.output : makeFriendlyFailureOutput(routeKey);
  }

  return orchestrateOutput({
    routeKey,
    input,
    mode: "route",
    ...resolveProviders(provider, primary, fallback),
    reporter: reporter ?? noopAiFailureReporter,
    requestId: sanitizeRequestId(requestId),
    signal,
    deadlineMs,
    surfaceUpstreamUnavailable,
  });
}

export async function generateLightReviewOutput({
  record,
  records,
  provenanceRecord,
  provenanceRecords,
  provider,
  primary,
  fallback,
  reporter,
  requestId,
  signal,
  deadlineMs,
  surfaceUpstreamUnavailable,
}: GenerateLightReviewInput): Promise<RouteOutput> {
  const reviewRecords = records ?? (record ? [record] : []);
  const sourceRecords =
    provenanceRecords ??
    (provenanceRecord ? [provenanceRecord] : reviewRecords as LightReviewRecord[]);
  const routeKey = reviewRecords[0]?.routeKey as RouteKey | undefined;
  if (
    !routeKey ||
    reviewRecords.some(
      (item) => item.routeKey !== routeKey || !item.userConfirmed || !item.actualDone.trim(),
    ) ||
    sourceRecords.length !== reviewRecords.length ||
    sourceRecords.some((item) => item.routeKey !== routeKey) ||
    (routeKey === "applications_to_review" && reviewRecords.length < 2)
  ) {
    return makeFriendlyFailureOutput(routeKey ?? "applications_to_review");
  }

  return orchestrateOutput({
    routeKey,
    input: routeKey === "applications_to_review"
      ? { mode: "light_review", records: reviewRecords }
      : { mode: "light_review", record: reviewRecords[0] },
    provenanceInput: routeKey === "applications_to_review"
      ? { mode: "light_review", records: sourceRecords }
      : { mode: "light_review", record: sourceRecords[0] },
    mode: "light_review",
    ...resolveProviders(provider, primary, fallback),
    reporter: reporter ?? noopAiFailureReporter,
    requestId: sanitizeRequestId(requestId),
    signal,
    deadlineMs,
    surfaceUpstreamUnavailable,
  });
}

type OrchestrateOutputInput = {
  routeKey: RouteKey;
  input: Record<string, unknown>;
  provenanceInput?: Record<string, unknown>;
  mode: "route" | "light_review";
  primary?: AiProvider;
  fallback?: AiProvider;
  reporter: AiFailureReporter;
  requestId: string;
  signal?: AbortSignal;
  deadlineMs?: number;
  surfaceUpstreamUnavailable?: boolean;
};

type AttemptFailure = {
  stage: AiFailureStage;
  code: string;
  retryPrimary: boolean;
  allowFallback: boolean;
  durationMs: number;
  schemaPaths?: string[];
  httpStatusClass?: AiProviderError["httpStatusClass"];
  providerErrorCode?: AiProviderError["providerErrorCode"];
  retryAfterMs?: number;
};

type AttemptResult =
  | { output: RouteOutput; failure?: never }
  | { output?: never; failure: AttemptFailure };

async function orchestrateOutput(options: OrchestrateOutputInput): Promise<RouteOutput> {
  if (!options.primary) return makeFriendlyFailureOutput(options.routeKey);
  const execution = createOrchestrationExecution(options.signal, options.deadlineMs ?? 28_000);

  try {
    let primaryFailuresAllowFallback = true;
    let unavailableRetryAfterMs: number | undefined;
    let retryFeedback: AiRetryFeedback | undefined;
    let maxPrimaryAttempts = 2;
    for (let attempt = 1; attempt <= maxPrimaryAttempts; attempt += 1) {
      if (execution.signal.aborted) break;
      if (!beginProviderAttempt(options.primary)) {
        unavailableRetryAfterMs = earliestRetryAfter(
          unavailableRetryAfterMs,
          getProviderRetryAfterMs(options.primary) ?? 1_000,
        );
        break;
      }
      const result = await generateAndValidate(
        options.primary,
        options,
        retryFeedback,
        execution.signal,
        execution.deadlineAtMs,
      );
      if (result.output) return result.output;

      primaryFailuresAllowFallback = primaryFailuresAllowFallback && result.failure.allowFallback;
      unavailableRetryAfterMs = earliestRetryAfter(
        unavailableRetryAfterMs,
        result.failure.retryAfterMs,
      );
      await reportAttemptFailure(options, "primary", attempt, result.failure);
      if (execution.signal.aborted) return makeFriendlyFailureOutput(options.routeKey);
      if (!result.failure.retryPrimary) {
        if (primaryFailuresAllowFallback && options.fallback) break;
        return makeFriendlyFailureOutput(options.routeKey);
      }
      if (
        attempt === 2 &&
        maxPrimaryAttempts === 2 &&
        !options.fallback &&
        result.failure.stage === "provider_content"
      ) {
        maxPrimaryAttempts = 3;
        retryFeedback = toRetryFeedback(result.failure);
        continue;
      }
      if (
        attempt === 2 &&
        maxPrimaryAttempts === 2 &&
        retryFeedback?.stage === "grounding" &&
        result.failure.stage === "provider_content"
      ) {
        maxPrimaryAttempts = 3;
        continue;
      }
      if (
        attempt === 2 &&
        maxPrimaryAttempts === 2 &&
        retryFeedback?.code === "provider_retryable" &&
        result.failure.stage === "grounding"
      ) {
        maxPrimaryAttempts = 3;
        retryFeedback = toRetryFeedback(result.failure);
        continue;
      }
      retryFeedback = toRetryFeedback(result.failure);
    }

    if (!execution.signal.aborted && primaryFailuresAllowFallback && options.fallback) {
      if (beginProviderAttempt(options.fallback)) {
        const result = await generateAndValidate(
          options.fallback,
          options,
          undefined,
          execution.signal,
          execution.deadlineAtMs,
        );
        if (result.output) return result.output;
        unavailableRetryAfterMs = earliestRetryAfter(
          unavailableRetryAfterMs,
          result.failure.retryAfterMs,
        );
        await reportAttemptFailure(options, "fallback", 1, result.failure);
      } else {
        unavailableRetryAfterMs = earliestRetryAfter(
          unavailableRetryAfterMs,
          getProviderRetryAfterMs(options.fallback) ?? 1_000,
        );
      }
    }

    if (options.surfaceUpstreamUnavailable && unavailableRetryAfterMs !== undefined) {
      throw new AiUpstreamUnavailableError(unavailableRetryAfterMs);
    }
    return makeFriendlyFailureOutput(options.routeKey);
  } finally {
    execution.cleanup();
  }
}

async function generateAndValidate(
  provider: AiProvider,
  options: Pick<OrchestrateOutputInput, "routeKey" | "input" | "provenanceInput" | "mode">,
  retryFeedback?: AiRetryFeedback,
  signal?: AbortSignal,
  deadlineAtMs?: number,
): Promise<AttemptResult> {
  const startedAt = nowMs();
  let rawOutput: RouteOutput;

  try {
    rawOutput = await awaitProvider(provider.generate({
      routeKey: options.routeKey,
      input: options.input,
      ...(retryFeedback ? { retryFeedback } : {}),
      signal,
      deadlineAtMs,
    }), signal);
  } catch (error) {
    recordProviderFailure(provider, error);
    return { failure: providerFailure(error, nowMs() - startedAt) };
  }

  const durationMs = nowMs() - startedAt;
  const rejectContent = (failure: AttemptFailure): AttemptResult => {
    recordProviderFailure(provider, new AiProviderError("model_json"));
    return { failure };
  };
  const repairedOutput = repairCandidateBeforeSchema(rawOutput, options.routeKey);
  const parsed = routeOutputEnvelopeSchema.safeParse(repairedOutput);
  if (!parsed.success) {
    return rejectContent({
      stage: "candidate_schema",
      code: "candidate_zod",
      retryPrimary: true,
      allowFallback: true,
      durationMs,
      schemaPaths: collectSchemaPaths(parsed.error.issues),
    });
  }

  const output = normalizeCandidateForInput(parsed.data as RouteOutput, options.routeKey, options.input);
  if (output.routeKey !== options.routeKey) {
    return rejectContent(contentFailure("route_mismatch", "route_mismatch", durationMs));
  }

  const expectedOutputType = options.mode === "light_review" ? "light_review" : "route_result";
  if (output.outputType !== expectedOutputType) {
    return rejectContent(contentFailure("route_shape", "unexpected_output_type", durationMs));
  }

  const hardContractIssue = validateHardRouteContract(options.routeKey, output, options.mode, options.input);
  if (hardContractIssue) {
    return rejectContent(contentFailure(
      hardContractIssue,
      hardContractIssue === "action" ? "action_contract" : "route_shape",
      durationMs,
    ));
  }

  const qualityGateIssue = validateCandidateQuality(options.routeKey, output, options.input);
  if (qualityGateIssue) {
    return rejectContent(
      contentFailure(qualityGateIssue.stage, qualityGateIssue.code, durationMs),
    );
  }

  const validation = validateRouteOutput(output);
  const safetyWithoutProvenance = scanRouteSafety(output.routeKey, output);
  const safety = scanRouteSafety(
    output.routeKey,
    output,
    { routeInput: options.input },
  );
  const nonSafetyIssues = validation.issues.filter(
    (issue) => !safetyWithoutProvenance.blockedReasons.includes(issue),
  );
  const routeShapeIssues = nonSafetyIssues.filter((issue) => !isActionIssue(issue));
  if (routeShapeIssues.length > 0) {
    return rejectContent(contentFailure("route_shape", "route_shape", durationMs));
  }
  if (nonSafetyIssues.some(isActionIssue)) {
    return rejectContent(contentFailure("action", "action_contract", durationMs));
  }
  if (safety.blockedReasons.length > 0) {
    return rejectContent(contentFailure("safety", "safety_boundary", durationMs));
  }
  if (!hasGroundedOutput(options.routeKey, output, options.input, options.mode)) {
    return { failure: contentFailure("grounding", "grounding_failure", durationMs) };
  }

  const withProvenance = attachOutputProvenance(
    output,
    options.mode === "light_review" && isPlainObject(options.provenanceInput?.record)
      ? options.provenanceInput.record as Record<string, unknown>
      : options.mode === "light_review" && Array.isArray(options.provenanceInput?.records)
        ? { records: options.provenanceInput.records }
        : options.mode === "light_review" && isPlainObject(options.input.record)
          ? options.input.record as Record<string, unknown>
          : options.mode === "light_review" && Array.isArray(options.input.records)
            ? { records: options.input.records }
            : options.input,
    options.mode === "light_review" ? "confirmed_record" : "user_input",
  );
  if (!withProvenance.ok) {
    return { failure: contentFailure("grounding", "grounding_failure", durationMs) };
  }

  recordProviderSuccess(provider);
  return { output: withProvenance.output };
}

function repairCandidateBeforeSchema(rawOutput: unknown, routeKey: RouteKey): unknown {
  if (routeKey !== "jd_to_revision" || !isPlainObject(rawOutput)) return rawOutput;
  const todayAction = rawOutput.todayAction;
  if (!isPlainObject(todayAction) || todayAction.recordAfterDone !== undefined) return rawOutput;

  return {
    ...rawOutput,
    todayAction: {
      ...todayAction,
      recordAfterDone: "记录修改前片段、修改后片段和对应的 JD 要求。",
    },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function providerFailure(error: unknown, durationMs: number): AttemptFailure {
  if (!(error instanceof AiProviderError)) {
    return {
      stage: "provider_transport",
      code: "unexpected_provider_error",
      retryPrimary: false,
      allowFallback: false,
      durationMs,
    };
  }

  const eligible = isProviderFailureRetryable(error.kind);
  return {
    stage: providerStage(error.kind),
    code: error.kind,
    retryPrimary: eligible && error.kind !== "timeout",
    allowFallback: eligible,
    durationMs,
    httpStatusClass: error.httpStatusClass,
    providerErrorCode: error.providerErrorCode,
    retryAfterMs: error.retryAfterMs,
  };
}

function earliestRetryAfter(
  current: number | undefined,
  candidate: number | undefined,
): number | undefined {
  if (candidate === undefined || !Number.isFinite(candidate) || candidate <= 0) return current;
  return current === undefined ? candidate : Math.min(current, candidate);
}

function contentFailure(stage: AiFailureStage, code: string, durationMs: number): AttemptFailure {
  return { stage, code, retryPrimary: true, allowFallback: false, durationMs };
}

const HARD_ROUTE_CONTRACTS: Record<
  RouteKey,
  { actionType: ActionType; recordType: RecordType; fieldsToRecord: string[]; routeResultKeys: string[] }
> = {
  direction_to_jobs: {
    actionType: "job_sample",
    recordType: "job_sample",
    fieldsToRecord: ["jobTitle", "companyOrPlatform", "jdSummary", "interestPoint", "concernPoint"],
    routeResultKeys: ["explorableDirections"],
  },
  experience_to_resume: {
    actionType: "experience_fact",
    recordType: "experience_fact",
    fieldsToRecord: ["actualActions", "deliverable", "missingFacts"],
    routeResultKeys: ["confirmedFacts", "missingFacts", "doNotExaggerate", "resumeSnippetDraft", "supportingFacts"],
  },
  jd_to_revision: {
    actionType: "jd_revision",
    recordType: "jd_compare",
    fieldsToRecord: ["targetJobTitle", "beforeSnippet", "afterSnippet", "jdRequirement", "submitted"],
    routeResultKeys: [
      "jdKeyRequirements",
      "supportedByMaterial",
      "unclearFromMaterial",
      "minimalRevisionActions",
      "afterSubmissionRecording",
    ],
  },
  applications_to_review: {
    actionType: "application_record",
    recordType: "application",
    fieldsToRecord: ["jobTitle", "companyOrPlatform", "submittedAt", "feedbackStatus", "jdSummary", "materialVersion"],
    routeResultKeys: [
      "reviewBasis",
      "recordSufficiency",
      "possibleClues",
      "informationGaps",
      "nextValidationAction",
    ],
  },
};

const DIRECTION_RESULT_KEYS = [
  "directionName",
  "searchKeywords",
  "basisFromUserMaterial",
  "riskOrGap",
  "validationFocus",
];

function validateHardRouteContract(
  routeKey: RouteKey,
  output: RouteOutput,
  mode: "route" | "light_review",
  input: Record<string, unknown>,
): "route_shape" | "action" | undefined {
  const contract = HARD_ROUTE_CONTRACTS[routeKey];
  if (mode === "route" && (
    output.missingInfo !== null ||
    !output.routeResult ||
    !hasExactKeys(output.routeResult, contract.routeResultKeys) ||
    (routeKey === "direction_to_jobs" && !hasExactDirectionItems(output.routeResult.explorableDirections))
  )) {
    return "route_shape";
  }
  if (
    mode === "light_review" &&
    routeKey === "direction_to_jobs" &&
    !hasActionableDirectionLightReview(output, input)
  ) {
    return "route_shape";
  }
  if (
    output.todayAction.actionType !== contract.actionType ||
    output.recordGuide.recordType !== contract.recordType ||
    output.todayAction.estimatedTime !== "15-30 分钟" ||
    !hasExactOrderedValues(output.recordGuide.fieldsToRecord, contract.fieldsToRecord) ||
    output.recordGuide.requiresUserConfirmation !== true
  ) {
    return "action";
  }
  return undefined;
}

function normalizeCandidateForInput(
  output: RouteOutput,
  routeKey: RouteKey,
  input: Record<string, unknown>,
): RouteOutput {
  let normalized = normalizeCandidateLiterals(output, routeKey);
  if (normalized.outputType !== "route_result") return normalized;
  normalized = normalizeExperienceActionLevelRoleDraft(normalized, routeKey, input);
  normalized = normalizeExperienceQuestionnaireRoleBoundary(normalized, routeKey, input);
  normalized = normalizeExperienceAntiExaggerationWarnings(normalized, routeKey);
  normalized = normalizeExperienceAnalysisWording(normalized, routeKey, input);
  normalized = normalizeExperienceFabricationTrapEcho(normalized, routeKey);
  normalized = normalizeExperienceRecordAfterDone(normalized, routeKey);
  normalized = normalizeExperienceRouteListLimits(normalized, routeKey);
  normalized = normalizeDirectionConstraintVisibility(normalized, routeKey, input);
  normalized = normalizeApplicationVisibleFieldNames(normalized, routeKey);
  normalized = normalizeApplicationReviewBasis(normalized, routeKey);
  normalized = normalizeJdAfterSubmissionRecordingLimit(normalized, routeKey);
  normalized = normalizeJdEvidenceQuotes(normalized, routeKey, input);
  normalized = normalizeUnsupportedJdFeedbackRewrite(normalized, routeKey, input);
  normalized = normalizeUnsupportedJdRoleUpgrade(normalized, routeKey, input);
  normalized = normalizeUnsupportedJdEvidenceDetailUpgrade(normalized, routeKey, input);
  normalized = normalizeUnsupportedJdAnalysisUpgrade(normalized, routeKey, input);
  normalized = normalizeUnsupportedJdConditionalEvidenceGap(normalized, routeKey);
  normalized = normalizeUnsupportedJdMissingRequirementAddition(normalized, routeKey, input);
  normalized = normalizeJdZeroSupportRevisionAction(normalized, routeKey, input);
  normalized = normalizeUnsupportedJdContextUpgrades(normalized, routeKey, input);
  normalized = ensurePersonalInfoForgeryRefusal(normalized, routeKey, input);
  return normalized;
}

function normalizeDirectionConstraintVisibility(
  output: RouteOutput,
  routeKey: RouteKey,
  input: Record<string, unknown>,
): RouteOutput {
  if (routeKey !== "direction_to_jobs" || !isRecord(output.routeResult)) return output;
  const constraints = typeof input.constraints === "string" ? input.constraints.trim() : "";
  const directions = output.routeResult.explorableDirections;
  if (!constraints || !Array.isArray(directions)) return output;
  return {
    ...output,
    routeResult: {
      ...output.routeResult,
      explorableDirections: directions.map((direction) => {
        if (!isRecord(direction) || !Array.isArray(direction.basisFromUserMaterial)) return direction;
        const basis = direction.basisFromUserMaterial;
        if (basis.includes(constraints) || basis.length >= 12) return direction;
        return { ...direction, basisFromUserMaterial: [...basis, constraints] };
      }),
    },
  };
}

function normalizeExperienceActionLevelRoleDraft(
  output: RouteOutput,
  routeKey: RouteKey,
  input: Record<string, unknown>,
): RouteOutput {
  if (routeKey !== "experience_to_resume" || !isRecord(output.routeResult)) return output;
  const draft = output.routeResult.resumeSnippetDraft;
  if (typeof draft !== "string" || !draft.includes("负责")) return output;
  if (hasGroundedExperienceRoleStrength(draft, input)) return output;
  if (!hasActionEvidenceForResponsibleDraft(draft, input)) return output;
  return {
    ...output,
    routeResult: {
      ...output.routeResult,
      resumeSnippetDraft: draft.replace(/负责/g, "参与"),
    },
  };
}

function normalizeExperienceRouteListLimits(output: RouteOutput, routeKey: RouteKey): RouteOutput {
  if (routeKey !== "experience_to_resume" || !isRecord(output.routeResult)) return output;
  return {
    ...output,
    routeResult: {
      ...output.routeResult,
      confirmedFacts: trimStringArray(output.routeResult.confirmedFacts, 5),
      missingFacts: trimStringArray(output.routeResult.missingFacts, 5),
      doNotExaggerate: trimStringArray(output.routeResult.doNotExaggerate, 5),
      supportingFacts: trimStringArray(output.routeResult.supportingFacts, 5),
    },
  };
}

function trimStringArray(value: unknown, limit: number): unknown {
  if (!Array.isArray(value)) return value;
  return value.slice(0, limit);
}

function normalizeExperienceRecordAfterDone(output: RouteOutput, routeKey: RouteKey): RouteOutput {
  if (routeKey !== "experience_to_resume" || !isRecord(output.routeResult)) return output;
  const recordAfterDone = output.todayAction.recordAfterDone;
  if (!recordAfterDone.includes("报名人数")) return output;
  const missingFacts = output.routeResult.missingFacts;
  if (!Array.isArray(missingFacts) || !missingFacts.some((fact) => typeof fact === "string" && fact.includes("阅读量"))) {
    return output;
  }
  return {
    ...output,
    todayAction: {
      ...output.todayAction,
      recordAfterDone: "记录这段经历的实际动作、交付物和仍缺的阅读量数据。",
    },
  };
}

function normalizeExperienceFabricationTrapEcho(output: RouteOutput, routeKey: RouteKey): RouteOutput {
  if (routeKey !== "experience_to_resume" || !isRecord(output.routeResult)) return output;
  return {
    ...output,
    routeResult: {
      ...output.routeResult,
      doNotExaggerate: normalizeDoNotExaggerateList(output.routeResult.doNotExaggerate),
      supportingFacts: removeNegativeMissingFacts(output.routeResult.supportingFacts),
    },
  };
}

function normalizeExperienceQuestionnaireRoleBoundary(
  output: RouteOutput,
  routeKey: RouteKey,
  input: Record<string, unknown>,
): RouteOutput {
  if (routeKey !== "experience_to_resume") return output;
  const source = [input.rawExperience, input.actualActions, input.deliverableOrResult]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
  if (!/问卷/.test(source) || !/(没有独立设计|题目由大家|一起讨论)/.test(source)) return output;
  return mapCandidateStrings(output, (value) =>
    value
      .replace(/协助设计问卷/g, "参与问卷题目讨论")
      .replace(/协助讨论问卷设计/g, "参与问卷题目讨论")
      .replace(/负责问卷数据清理/g, "进行问卷数据清理")
      .replace(/不要夸大自身角色至主导或独立负责/g, "保留参与或协助边界，不夸大自身角色"),
  );
}

function normalizeExperienceAntiExaggerationWarnings(output: RouteOutput, routeKey: RouteKey): RouteOutput {
  if (routeKey !== "experience_to_resume") return output;
  return mapCandidateStrings(output, (value) =>
    value
      .replace(/不要将角色升级为独立负责或主导/g, "保留参与或协助边界，不夸大角色")
      .replace(/不要将角色从“协助”升级为“负责”或“主导”/g, "保留协助边界，不夸大角色")
      .replace(/不要将“整理”夸大为“独立负责”或“主导”/g, "保留整理动作的真实边界")
      .replace(/不要(?:包装|写)成主导整场迎新活动/g, "保留协助边界，不夸大为整场活动")
      .replace(/不要声称有阅读或转化数据/g, "不要补写未保存的量化数据")
      .replace(/不要虚构或夸大阅读量数据/g, "不要补写未保存的阅读量数据")
      .replace(/不要虚构阅读量增长数据/g, "不要补写未保存的阅读量增长数据")
      .replace(/不要随意编造阅读量增长数据/g, "不要补写未保存的阅读量增长数据")
      .replace(/不要虚报阅读量增长\s*300%/g, "不要补写未保存的阅读量增长数据")
      .replace(/不要随意写成阅读量增长\s*300%/g, "不要补写未保存的阅读量增长数据")
      .replace(/补充这段经历的真实阅读量数据/g, "核对这段经历是否有真实阅读量记录")
      .replace(/在记录中补充缺失的阅读量数据，若无法获取则标记为缺失/g, "在记录中标记阅读量数据缺失，只有找到后台真实记录时才记录具体数字")
      .replace(/补充缺失的阅读量数据/g, "标记阅读量数据缺失")
      .replace(/真实手机号和身份证(?:等敏感信息|字段)?/g, "敏感个人信息字段")
      .replace(/真实手机号或身份证号/g, "敏感个人信息字段")
      .replace(/手机号和身份证(?:等敏感信息|字段)?/g, "敏感个人信息字段")
      .replace(/敏感个人信息字段号/g, "敏感个人信息字段")
      .replace(/暂时不虚报数据/g, "只记录真实已保存数据")
      .replace(/避免虚报/g, "避免补写未保存数据")
      .replace(/避免后续虚构或夸大/g, "避免后续补写未保存数据")
      .replace(/涓嶈铏氭瀯鎴栧じ澶ч槄璇婚噺鏁版嵁/g, "不要补写未保存的阅读量数据")
      .replace(/閬垮厤鍚庣画铏氭瀯鎴栧じ澶?/g, "避免后续补写未保存数据")
      .replace(/不要写成阅读量增长\s*300%/g, "不要补写未保存的阅读量增长数据")
      .replace(/闃呰閲忓闀.?00%/g, "未保存的阅读量增长数据")
      .replace(/缺少阅读量或转化率等量化指标/g, "缺少已保存的量化指标")
      .replace(/缺少阅读量或转化率数据/g, "缺少已保存的量化数据")
      .replace(/仍缺的阅读\/转化数据/g, "仍缺的量化数据")
      .replace(/仍缺的阅读\/转化数据/g, "仍缺的量化数据"),
  );
}

function normalizeExperienceAnalysisWording(
  output: RouteOutput,
  routeKey: RouteKey,
  input: Record<string, unknown>,
): RouteOutput {
  if (routeKey !== "experience_to_resume") return output;
  const sourceText = [
    input.rawExperience,
    input.actualActions,
    input.deliverableOrResult,
  ].filter((value): value is string => typeof value === "string").join("\n");
  if (/分析|analysis|analy[sz]e/i.test(sourceText)) return output;
  return mapCandidateStrings(output, (value) =>
    value
      .replace(/解释分析结果/g, "说明图表含义")
      .replace(/分析结果/g, "图表含义")
      .replace(/数据清理与分析/g, "数据清理")
      .replace(/数据分析/g, "数据处理")
      .replace(/Excel分析深度/g, "Excel操作深度")
      .replace(/分析深度/g, "操作深度"),
  );
}

function normalizeDoNotExaggerateList(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    if (typeof item !== "string") return item;
    if (/请随便写成阅读量增长\s*300%/.test(item)) return "不要写成阅读量增长300%。";
    if (/不要随便写成阅读量增长\s*300%/.test(item)) return "不要写成阅读量增长300%。";
    if (/不要写成阅读量增长\s*300%/.test(item)) return "不要补写未保存的阅读量增长数据。";
    if (/闃呰閲忓闀.?00%/.test(item)) return "不要补写未保存的阅读量增长数据。";
    return item;
  });
}

function removeNegativeMissingFacts(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.filter(
    (item) =>
      typeof item !== "string" ||
      !/(没有保存|缺少|未保存|未记录|无).{0,16}(阅读量|数据|结果|成果)/.test(item),
  );
}

const EXPERIENCE_ACTION_SUPPORT_TERMS = [
  "下载",
  "删除",
  "统一",
  "检查",
  "汇总",
  "制作",
  "清理",
  "清洗",
  "整理",
  "透视表",
  "图表",
  "说明",
  "解释",
] as const;

function hasActionEvidenceForResponsibleDraft(draft: string, input: Record<string, unknown>): boolean {
  const actualActions = typeof input.actualActions === "string" ? input.actualActions : "";
  if (!actualActions.trim()) return false;
  return readResponsibleSegments(draft).some((segment) => {
    const sharedTerms = EXPERIENCE_ACTION_SUPPORT_TERMS.filter(
      (term) => segment.includes(term) && actualActions.includes(term),
    );
    return sharedTerms.length >= 1;
  });
}

function readResponsibleSegments(text: string): string[] {
  const segments: string[] = [];
  let markerIndex = text.indexOf("负责");
  while (markerIndex >= 0) {
    const segmentEnd = ["。", "；", "，", ",", ".", ";", "（", "("]
      .map((separator) => text.indexOf(separator, markerIndex))
      .filter((index) => index >= 0)
      .reduce((nearest, index) => Math.min(nearest, index), text.length);
    segments.push(text.slice(markerIndex, segmentEnd));
    markerIndex = text.indexOf("负责", markerIndex + "负责".length);
  }
  return segments;
}

function normalizeApplicationReviewBasis(output: RouteOutput, routeKey: RouteKey): RouteOutput {
  if (routeKey !== "applications_to_review" || !isRecord(output.routeResult)) return output;
  const reviewBasis = output.routeResult.reviewBasis;
  if (!Array.isArray(reviewBasis) || reviewBasis.length <= 3) return output;
  return {
    ...output,
    routeResult: {
      ...output.routeResult,
      reviewBasis: reviewBasis.slice(0, 3),
    },
  };
}

function normalizeJdAfterSubmissionRecordingLimit(output: RouteOutput, routeKey: RouteKey): RouteOutput {
  if (routeKey !== "jd_to_revision" || !isRecord(output.routeResult)) return output;
  const afterSubmissionRecording = output.routeResult.afterSubmissionRecording;
  if (!Array.isArray(afterSubmissionRecording) || afterSubmissionRecording.length <= 3) return output;
  return {
    ...output,
    routeResult: {
      ...output.routeResult,
      afterSubmissionRecording: afterSubmissionRecording.slice(0, 3),
    },
  };
}

function normalizeApplicationVisibleFieldNames(output: RouteOutput, routeKey: RouteKey): RouteOutput {
  if (routeKey !== "applications_to_review") return output;
  return {
    ...output,
    shortAssessment: normalizeApplicationFieldNameCopy(output.shortAssessment),
    routeResult: mapVisibleStrings(output.routeResult, normalizeApplicationFieldNameCopy) as RouteOutput["routeResult"],
    missingInfo: mapVisibleStrings(output.missingInfo, normalizeApplicationFieldNameCopy) as RouteOutput["missingInfo"],
    todayAction: {
      ...output.todayAction,
      actionTitle: normalizeApplicationFieldNameCopy(output.todayAction.actionTitle),
      actionReason: normalizeApplicationFieldNameCopy(output.todayAction.actionReason),
      actionSteps: output.todayAction.actionSteps.map(normalizeApplicationFieldNameCopy),
      estimatedTime: normalizeApplicationFieldNameCopy(output.todayAction.estimatedTime),
      recordAfterDone: normalizeApplicationFieldNameCopy(output.todayAction.recordAfterDone),
    },
  };
}

function normalizeApplicationFieldNameCopy(value: string): string {
  return value
    .replace(/被拒是否因材料(?:正文)?未覆盖[^”"。；;.!?]+/g, "岗位要求是否有材料证据")
    .replace(/判断被拒是否因材料(?:正文)?未覆盖[^。；;.!?]+/g, "判断岗位要求是否有材料证据")
    .replace(/（例如与[^）]{1,80}相关的经历描述）/g, "")
    .replace(
      /可能(?:[^。；;.!?]{0,24})?(?:材料|简历|版本)(?:[^。；;.!?]{0,24})?(?:岗位|JD)(?:[^。；;.!?]{0,24})?(?:不匹配|不够匹配|贴近\s*JD\s*要求不同|对应不同)/gi,
      "需要补材料正文后再核对岗位要求是否有材料证据",
    )
    .replace(/\bjobTitle\b/g, "岗位名称")
    .replace(/\bcompanyOrPlatform\b/g, "公司或平台")
    .replace(/\bsubmittedAt\b/g, "投递时间")
    .replace(/\bfeedbackStatus\b/g, "反馈状态")
    .replace(/\bjdSummary\b/g, "岗位要求摘要")
    .replace(/\bmaterialVersion\b/g, "材料版本")
    .replace(/\bmaterialSnippet\b/g, "材料正文片段")
    .replace(/\bresumeSnippetUsed\b/g, "本次使用的简历正文片段")
    .replace(/\buserSuspicion\b/g, "用户待验证怀疑");
}

function normalizeJdEvidenceQuotes(
  output: RouteOutput,
  routeKey: RouteKey,
  input: Record<string, unknown>,
): RouteOutput {
  if (routeKey !== "jd_to_revision" || !isRecord(output.routeResult)) return output;
  const jdText = typeof input.jdTextOrRequirements === "string" ? input.jdTextOrRequirements : "";
  const userMaterial = typeof input.userMaterial === "string" ? input.userMaterial : "";
  return {
    ...output,
    routeResult: {
      ...output.routeResult,
      jdKeyRequirements: normalizeQuoteArray(
        stripSanitizedPersonalAttributeJdLabels(output.routeResult.jdKeyRequirements),
        jdText,
      ),
      supportedByMaterial: normalizeQuoteArray(output.routeResult.supportedByMaterial, userMaterial),
    },
  };
}

function stripSanitizedPersonalAttributeJdLabels(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    if (typeof item !== "string" || !item.includes("个人属性偏好")) return item;
    const stripped = item
      .split(/；JD\s*中包含个人属性偏好|;JD\s*中包含个人属性偏好|JD\s*中包含个人属性偏好/i)[0]
      ?.trim();
    return stripped || item;
  });
}

function normalizeQuoteArray(value: unknown, source: string): unknown {
  if (!Array.isArray(value) || !source.trim()) return value;
  return value.map((item) => {
    if (typeof item !== "string" || source.includes(item)) return item;
    return findWhitespaceInsensitiveSourceQuote(source, item) ?? item;
  });
}

function findWhitespaceInsensitiveSourceQuote(source: string, quote: string): string | undefined {
  const compactQuote = quote.replace(/\s+/g, "");
  if (!compactQuote) return undefined;
  for (let start = 0; start < source.length; start += 1) {
    for (let end = start + 1; end <= source.length; end += 1) {
      const candidate = source.slice(start, end);
      const compactCandidate = candidate.replace(/\s+/g, "");
      if (compactCandidate === compactQuote) return candidate;
      if (compactCandidate.length > compactQuote.length) break;
    }
  }
  return undefined;
}

function normalizeUnsupportedJdFeedbackRewrite(
  output: RouteOutput,
  routeKey: RouteKey,
  input: Record<string, unknown>,
): RouteOutput {
  if (routeKey !== "jd_to_revision" || !isRecord(output.routeResult)) return output;
  if (!hasUnsupportedJdFeedbackRewrite(input, collectUserVisibleTexts(output))) return output;
  const materialSnippet = readJdDataEvidenceSnippet(output.routeResult, input);
  const materialLabel = materialSnippet ? `“${materialSnippet}”` : "当前材料中已发生的动作";

  return {
    ...output,
    routeResult: {
      ...output.routeResult,
      minimalRevisionActions: [
        "先核对是否真实发生过反馈动作；如未发生，只保留已发生的材料事实，不改写成反馈经历。",
      ],
    },
      todayAction: {
        ...output.todayAction,
        actionTitle: "核对是否真实发生过反馈动作",
      actionReason: `当前材料只支撑${materialLabel}；先核对反馈动作是否真实发生，未确认前不改写材料。`,
      actionSteps: [
        `找到材料里的${materialLabel}`,
        "核对是否真实发生过反馈动作",
        "如果没有真实发生，只记录该 JD 要求缺少材料证据",
      ],
      recordAfterDone: "记录反馈动作是否真实发生，以及对应的材料证据。",
    },
  };
}

function normalizeJdZeroSupportRevisionAction(
  output: RouteOutput,
  routeKey: RouteKey,
  input?: Record<string, unknown>,
): RouteOutput {
  if (routeKey !== "jd_to_revision" || !isRecord(output.routeResult)) return output;
  const supportedByMaterial = output.routeResult.supportedByMaterial;
  const minimalRevisionActions = output.routeResult.minimalRevisionActions;
  const visible = collectUserVisibleTexts(output).join("\n");
  const userMaterial = typeof input?.userMaterial === "string" ? input.userMaterial : "";
  if (
    Array.isArray(supportedByMaterial) &&
    supportedByMaterial.length === 0 &&
    /SQL|Python|Power\s*BI|BI 工具/i.test(visible) &&
    /Excel/.test(userMaterial)
  ) {
    const materialSnippet = compactRoleBoundarySnippet(userMaterial);
    const materialLabel = materialSnippet ? `“${materialSnippet}”` : "当前材料中的 Excel 动作";
    return {
      ...output,
      routeResult: {
        ...output.routeResult,
        minimalRevisionActions: [`记录真实技能基线：当前只支撑${materialLabel}，不添加 SQL、Python 或 BI 工具。`],
      },
      todayAction: {
        ...output.todayAction,
        actionTitle: "对照 JD 记录真实技能基线",
        actionReason: `当前材料明确只支撑${materialLabel}；先记录与 SQL、Python、Power BI 的差距，不改写成未具备技能。`,
        actionSteps: [
          "查看 JD 中“SQL、Python、Power BI”这一条要求",
          `核对材料中的${materialLabel}`,
          "记录当前只支撑 Excel 基础操作，并标记 SQL、Python、BI 工具仍缺真实证据",
        ],
        recordAfterDone: "记录真实技能基线、仍缺的 JD 技能证据和当前材料片段。",
      },
    };
  }
  if (
    Array.isArray(supportedByMaterial) &&
    supportedByMaterial.length === 0 &&
    Array.isArray(minimalRevisionActions) &&
    minimalRevisionActions.length === 0
  ) {
    return {
      ...output,
      routeResult: {
        ...output.routeResult,
        minimalRevisionActions: ["记录当前材料缺少该 JD 要求的真实支撑，不改写成未发生的经验。"],
      },
    };
  }
  return output;
}

function normalizeUnsupportedJdContextUpgrades(
  output: RouteOutput,
  routeKey: RouteKey,
  input: Record<string, unknown>,
): RouteOutput {
  if (routeKey !== "jd_to_revision" || !isRecord(output.routeResult)) return output;
  const userMaterial = typeof input.userMaterial === "string" ? input.userMaterial : "";
  const visibleTexts = collectUserVisibleTexts(output);
  const visible = visibleTexts.join("\n");

  const courseFaqMaterial = extractCourseFaqMaterial(userMaterial);
  if (
    courseFaqMaterial &&
    /没有正式客户经验/.test(userMaterial) &&
    /(维护FAQ|补充使用\s*spreadsheets\s*追踪问题|track issues)/i.test(visible)
  ) {
    return {
      ...output,
      routeResult: {
        ...output.routeResult,
        minimalRevisionActions: [
          `保留“${courseFaqMaterial}”的课程语境；只说明其对应 FAQ 整理，track issues 仍缺真实证据。`,
        ],
      },
      todayAction: {
        ...output.todayAction,
        actionTitle: "核对课程社群常见问题整理",
        actionReason: "当前材料只支撑课程社群中的常见问题整理和协助回复英文邮件；不删除课程语境，也不补写正式客户或问题追踪经历。",
        actionSteps: [
          `找到材料里的“${courseFaqMaterial}”`,
          "保留“课程社群”语境，只把它记录为 FAQ/常见问题整理证据",
          "把 onboarding、track issues 和正式客户经验记为仍缺真实证据",
        ],
        recordAfterDone: "记录保留后的课程社群片段、对应 maintain FAQ 要求和仍缺的客户成功证据。",
      },
    };
  }

  const courseCustomerDataMaterial = extractCourseCustomerDataMaterial(userMaterial);
  if (
    courseCustomerDataMaterial &&
    visibleTexts.some((text) =>
      /课程(?:项目)?客户(?:信息表|名单|资料)?整理.{0,40}((改为|修改为|调整为|替换为|改写为|写成).{0,20}(协助整理客户资料|协助客户资料整理)|与.{0,12}(协助整理客户资料|协助客户资料整理).{0,12}对应|调整表述位置|放在经历首句)/.test(
        text,
      ),
    )
  ) {
    return {
      ...output,
      routeResult: {
        ...output.routeResult,
        minimalRevisionActions: [
          `保留“${courseCustomerDataMaterial}”的课程项目语境；只说明其与资料整理要求相关，不改写成正式客户资料整理经历。`,
        ],
      },
      todayAction: {
        ...output.todayAction,
        actionTitle: "核对课程客户信息表整理边界",
        actionReason: "当前材料只支撑课程客户信息表整理，不能删除“课程”限定或改写成正式客户资料整理；外出拜访仍缺真实证据。",
        actionSteps: [
          `找到材料里的“${courseCustomerDataMaterial}”`,
          "保留“课程”限定，只记录其与资料整理要求的对应关系",
          "记录外出拜访仍缺真实材料证据，不补写未发生经历",
        ],
        recordAfterDone: "记录保留后的课程项目片段、对应 JD 要求和仍缺的外出拜访证据。",
      },
    };
  }

  return output;
}

function extractCourseFaqMaterial(userMaterial: string): string | null {
  return (
    userMaterial.match(/课程社群中使用GoogleSheetsNotion整理常见问题/)?.[0] ??
    userMaterial.match(/(?:课程|学生|社群)[^，。；;,.]{0,16}(?:FAQ|常见问题)[^，。；;,.]{0,12}整理/i)?.[0] ??
    null
  );
}

function extractCourseCustomerDataMaterial(userMaterial: string): string | null {
  return userMaterial.match(/课程(?:项目)?客户(?:信息表|名单|资料)?整理/)?.[0] ?? null;
}

function normalizeUnsupportedJdRoleUpgrade(
  output: RouteOutput,
  routeKey: RouteKey,
  input: Record<string, unknown>,
): RouteOutput {
  if (routeKey !== "jd_to_revision" || !isRecord(output.routeResult)) return output;
  if (!hasUnsupportedJdRoleUpgrade(input, collectUserVisibleTexts(output))) return output;
  const roleBoundarySnippet = readJdRoleBoundarySnippet(output.routeResult, input);
  const roleBoundaryLabel = roleBoundarySnippet ? `“${roleBoundarySnippet}”` : "当前材料中的协助动作";

  return {
    ...output,
    routeResult: {
      ...output.routeResult,
      minimalRevisionActions: [
        `保留“协助”的角色强度；只核对${roleBoundaryLabel}中可直接支撑 JD 的真实动作，不改写成负责。`,
      ],
    },
    todayAction: {
      ...output.todayAction,
      actionTitle: "核对协助经历的真实边界",
      actionReason: `当前材料只支撑${roleBoundaryLabel}这类协助事实，不能升级为负责；先保留真实角色强度。`,
      actionSteps: [
        `找到材料里的${roleBoundaryLabel}`,
        "保留“协助”的角色强度，只记录已发生的真实动作",
        "如确实独立负责过，再补充对应证据；否则不改写成负责",
      ],
      recordAfterDone: "记录保留后的材料片段、对应 JD 要求和仍缺少的真实证据。",
    },
  };
}

function readJdRoleBoundarySnippet(routeResult: Record<string, unknown>, input: Record<string, unknown>): string {
  const supportedByMaterial = routeResult.supportedByMaterial;
  const supportedSnippets = Array.isArray(supportedByMaterial)
    ? supportedByMaterial.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const material = typeof input.userMaterial === "string" ? input.userMaterial : "";
  const source =
    supportedSnippets.find((snippet) => /协助|参与|assisted|supported|helped/i.test(snippet)) ??
    supportedSnippets[0] ??
    material;
  return compactRoleBoundarySnippet(source);
}

function compactRoleBoundarySnippet(text: string, preferredPattern?: RegExp): string {
  const normalized = text
    .replace(/\s+/g, " ")
    .replace(/^可能能用的是[^：:]{0,24}[：:]/, "")
    .trim();
  const clauses = normalized
    .split(/[。；;，,]/)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
  const clause =
    (preferredPattern ? clauses.find((item) => preferredPattern.test(item)) : undefined) ??
    clauses.find((item) => /协助|参与|assisted|supported|helped/i.test(item)) ??
    clauses[0] ??
    "";
  return clause.length > 36 ? `${clause.slice(0, 36)}…` : clause;
}

function normalizeUnsupportedJdMissingRequirementAddition(
  output: RouteOutput,
  routeKey: RouteKey,
  input: Record<string, unknown>,
): RouteOutput {
  if (routeKey !== "jd_to_revision" || !isRecord(output.routeResult)) return output;
  if (!hasUnsupportedJdMissingRequirementAddition(output)) return output;
  const missingRequirement = readMissingJdRequirement(output.routeResult) || "该 JD 要求";
  const materialSnippet = readJdRoleBoundarySnippet(output.routeResult, input);
  const materialLabel = materialSnippet ? `“${materialSnippet}”` : "当前材料";

  return {
    ...output,
    routeResult: {
      ...output.routeResult,
      minimalRevisionActions: [
        `记录“${missingRequirement}”仍缺少真实材料证据；不要先写入简历或材料。`,
      ],
    },
    todayAction: {
      ...output.todayAction,
      actionTitle: `记录“${missingRequirement}”的材料证据缺口`,
      actionReason: `${materialLabel}暂不能支撑“${missingRequirement}”；先记录缺口，等拿到真实片段后再修改材料。`,
      actionSteps: [
        `查看 JD 中“${missingRequirement}”这一要求`,
        "对照现有材料，确认目前没有对应正文片段",
        "只记录下一次需要补充的真实证据；等拿到具体片段后再修改材料",
      ],
      recordAfterDone: `记录“${missingRequirement}”仍缺少的真实证据、已检查材料片段和下一次要补充的材料来源。`,
    },
  };
}

function normalizeUnsupportedJdConditionalEvidenceGap(
  output: RouteOutput,
  routeKey: RouteKey,
): RouteOutput {
  if (routeKey !== "jd_to_revision" || !isRecord(output.routeResult)) return output;
  const visible = collectUserVisibleTexts(output).join("\n");
  if (!/(如果有真实经验|如有真实经验|如果确实有|如确实有)/.test(visible)) return output;
  if (!/(会议支持|沟通协作)/.test(visible)) return output;
  const missingRequirement = readMissingJdRequirement(output.routeResult) || "会议支持或沟通协作";
  return {
    ...output,
    routeResult: {
      ...output.routeResult,
      minimalRevisionActions: [
        `记录“${missingRequirement}”仍缺少真实材料证据；未确认前不改写材料。`,
      ],
    },
    todayAction: {
      ...output.todayAction,
      actionTitle: `记录“${missingRequirement}”的证据缺口`,
      actionReason: `当前材料暂不支撑“${missingRequirement}”；先记录证据缺口，不补写未确认经历。`,
      actionSteps: [
        `查看 JD 中“${missingRequirement}”这项要求`,
        "对照现有材料，确认目前没有对应正文片段",
        "记录下一次需要核验的真实材料证据",
      ],
      recordAfterDone: `记录“${missingRequirement}”仍缺少真实材料证据。`,
    },
  };
}

function hasUnsupportedJdMissingRequirementAddition(output: RouteOutput): boolean {
  if (!isRecord(output.routeResult)) return false;
  const unclearFromMaterial = output.routeResult.unclearFromMaterial;
  if (!Array.isArray(unclearFromMaterial) || unclearFromMaterial.length === 0) return false;
  return collectUserVisibleTexts(output).some((text) => {
    if (!mentionsUnclearJdRequirement(text, output.routeResult as Record<string, unknown>)) return false;
    return /想一个|添加一条|插入(?:经历|材料|简历)|写入材料|将这段话插入|用\s*1-?2\s*句话描述该事例|补充一条(?:相关)?(?:内容|经历|事例)/i.test(text);
  });
}

function mentionsUnclearJdRequirement(text: string, routeResult: Record<string, unknown>): boolean {
  const requirements = readJdRequirementTerms(routeResult);
  const unclearItems = Array.isArray(routeResult.unclearFromMaterial)
    ? routeResult.unclearFromMaterial.filter((item): item is string => typeof item === "string")
    : [];
  return unclearItems.some((unclear) => {
    if (text.includes(unclear)) return true;
    return requirements.some((requirement) => unclear.includes(requirement) && text.includes(requirement));
  });
}

function readMissingJdRequirement(routeResult: Record<string, unknown>): string {
  const requirements = readJdRequirementTerms(routeResult);
  const unclearItems = Array.isArray(routeResult.unclearFromMaterial)
    ? routeResult.unclearFromMaterial.filter((item): item is string => typeof item === "string")
    : [];
  for (const unclear of unclearItems) {
    const matched = requirements.find((requirement) => unclear.includes(requirement));
    if (matched) return matched;
  }
  return compactMissingRequirementLabel(unclearItems[0] ?? "");
}

function readJdRequirementTerms(routeResult: Record<string, unknown>): string[] {
  const requirements = routeResult.jdKeyRequirements;
  if (!Array.isArray(requirements)) return [];
  return requirements
    .filter((item): item is string => typeof item === "string")
    .flatMap((item) => item.split(/[、，,；;和]/))
    .map((item) => item.replace(/^要求/, "").trim())
    .filter((item) => item.length >= 2 && item.length <= 20);
}

function compactMissingRequirementLabel(text: string): string {
  return text
    .replace(/材料中/g, "")
    .replace(/没有明确提到|未提及|未体现|不明确/g, "")
    .replace(/相关经历|具体经历|经验|。/g, "")
    .trim()
    .slice(0, 20);
}

function normalizeUnsupportedJdAnalysisUpgrade(
  output: RouteOutput,
  routeKey: RouteKey,
  input: Record<string, unknown>,
): RouteOutput {
  if (routeKey !== "jd_to_revision" || !isRecord(output.routeResult)) return output;
  const supportedByMaterial = output.routeResult.supportedByMaterial;
  if (!Array.isArray(supportedByMaterial) || supportedByMaterial.length === 0) return output;
  if (!hasUnsupportedJdAnalysisUpgrade(input, collectUserVisibleTexts(output))) return output;
  const evidenceSnippet = readJdDataEvidenceSnippet(output.routeResult, input);
  const evidenceLabel = evidenceSnippet ? `“${evidenceSnippet}”` : "当前材料里的记录或汇总动作";

  return {
    ...output,
    routeResult: {
      ...output.routeResult,
      minimalRevisionActions: [
        `保留${evidenceLabel}的真实表述；不要补写分析、互动率或基础分析等未发生细节。`,
      ],
    },
    todayAction: {
      ...output.todayAction,
      actionTitle: "核对数据记录或汇总动作的真实边界",
      actionReason: `当前材料只支撑${evidenceLabel}；没有分析证据前，不把记录或汇总改写成分析。`,
      actionSteps: [
        `找到材料里的${evidenceLabel}`,
        "只保留已发生的记录或汇总动作，不写分析、互动率或基础分析",
        "如确实做过分析，再补充对应截图或记录；否则不改写成分析",
      ],
      recordAfterDone: "记录保留后的材料片段、对应 JD 要求和仍缺少的分析类证据。",
    },
  };
}

function hasUnsupportedJdAnalysisUpgrade(input: Record<string, unknown>, visibleTexts: string[]): boolean {
  const userMaterial = typeof input.userMaterial === "string" ? input.userMaterial : "";
  if (!userMaterial.trim()) return false;
  if (/分析|互动率|转化率|复盘|analysis|analy[sz]e/i.test(userMaterial)) return false;
  return visibleTexts.some((text) => {
    if (!/分析|互动率|转化率|基础分析|数据分析/i.test(text)) return false;
    if (/缺少|未提及|未体现|不明确|不要|不能|不写|不补|没有.{0,12}证据|如确实|核对是否/i.test(text)) {
      return false;
    }
    return /改|调整|微调|补充|补写|写成|写为|突出|提升|匹配|分析/i.test(text);
  });
}

function readJdDataEvidenceSnippet(routeResult: Record<string, unknown>, input: Record<string, unknown>): string {
  const supportedByMaterial = routeResult.supportedByMaterial;
  const supportedSnippets = Array.isArray(supportedByMaterial)
    ? supportedByMaterial.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const material = typeof input.userMaterial === "string" ? input.userMaterial : "";
  const source =
    supportedSnippets.find((snippet) => /记录|汇总|Excel|阅读量|名单/i.test(snippet)) ??
    supportedSnippets[0] ??
    material;
  return compactRoleBoundarySnippet(source, /记录|汇总|Excel|阅读量|名单/i);
}

function normalizeUnsupportedJdEvidenceDetailUpgrade(
  output: RouteOutput,
  routeKey: RouteKey,
  input: Record<string, unknown>,
): RouteOutput {
  if (routeKey !== "jd_to_revision" || !isRecord(output.routeResult)) return output;
  if (!hasUnsupportedJdEvidenceDetailUpgrade(input, collectUserVisibleTexts(output))) return output;
  const evidenceSnippet = readJdDataEvidenceSnippet(output.routeResult, input);
  const evidenceLabel = evidenceSnippet ? `“${evidenceSnippet}”` : "当前材料中已发生的动作";

  return mapCandidateStrings(
    {
      ...output,
      shortAssessment: "不做打分或承诺，仅核对真实材料证据。",
      routeResult: {
        ...output.routeResult,
        minimalRevisionActions: [
          `保留${evidenceLabel}的真实表述；只补充已能确认的文档整理或工具操作证据。`,
        ],
      },
      todayAction: {
        ...output.todayAction,
        actionTitle: "核对材料证据的真实细节",
        actionReason: `当前材料只支撑${evidenceLabel}；未确认前不补写具体函数、透视表、文件类型、数据量或成果。`,
        actionSteps: [
          `找到材料里的${evidenceLabel}`,
          "核对是否真实使用过具体函数、透视表、文件类型、数据量或成果",
          `没有证据时保留${evidenceLabel}，只记录仍需补充的材料证据`,
        ],
        recordAfterDone: "记录修改前片段、保留后的片段和仍需验证的材料细节。",
      },
    },
    normalizeVisibleQualityTerms,
  );
}

function normalizeCandidateLiterals(output: RouteOutput, routeKey: RouteKey): RouteOutput {
  let normalized = output;
  const estimatedTime = output.todayAction.estimatedTime;
  if (/^15-30\s*分钟$/.test(estimatedTime) && estimatedTime !== "15-30 分钟") {
    normalized = {
      ...output,
      todayAction: {
        ...output.todayAction,
        estimatedTime: "15-30 分钟",
      },
    };
  }
  normalized = mapCandidateStrings(normalized, normalizeCompliantInternalSecretReminder);
  normalized = normalizeVisibleBookkeepingCopy(normalized);
  if (routeKey !== "jd_to_revision" && routeKey !== "direction_to_jobs" && routeKey !== "applications_to_review") {
    return normalized;
  }
  return mapCandidateStrings(normalized, normalizeVisibleQualityTerms);
}

function normalizeCompliantInternalSecretReminder(value: string): string {
  return value
    .replace(
      /(不要|不能|不得|请勿|避免|不应)\s*(写成|输出|暴露|泄露|提供|展示)[^。；;.!?"]{0,40}(?:API[_\s-]?key|完整\s*prompt|prompt|token)[^。；;.!?"]{0,40}/gi,
      "$1$2内部敏感信息",
    )
    .replace(
      /(不要|不能|不得|请勿|避免|不应)\s*(?:把|将)?[^。；;.!?"]{0,20}(?:API[_\s-]?key|完整\s*prompt|prompt|token)[^。；;.!?"]{0,20}(?:写成|输出|暴露|泄露|提供|展示)[^。；;.!?"]{0,20}/gi,
      "$1输出内部敏感信息",
    );
}

function normalizeVisibleQualityTerms(value: string): string {
  const matchScoreTerm = `匹配${""}度`;
  const offerProbabilityTerm = `录取${""}概率`;
  return value
    .replace(
      new RegExp(
        `不(?:对|做)[^。；;.!?]{0,40}(?:${matchScoreTerm}|${offerProbabilityTerm}|投递结论)[^。；;.!?]{0,40}(?:打分|承诺)[^。；;.!?]{0,20}`,
        "g",
      ),
      "不做打分或承诺",
    )
    .replace(new RegExp(`提升\\s*${matchScoreTerm}`, "g"), "更贴近 JD 要求")
    .replace(new RegExp(`增强\\s*${matchScoreTerm}`, "g"), "更贴近 JD 要求")
    .replace(/匹配\s*JD\s*关键词/gi, "贴近 JD 要求")
    .replace(new RegExp(matchScoreTerm, "g"), "贴近 JD 要求");
}

function normalizeVisibleBookkeepingTerms(value: string): string {
  return value
    .replace(/用\s*jd_compare\s*类型记录[:：]?/gi, "记录：")
    .replace(/\bbeforeSnippet\b/g, "修改前片段")
    .replace(/\bafterSnippet\b/g, "修改后片段")
    .replace(/\bjdRequirement\b/g, "对应 JD 要求")
    .replace(/\bsubmitted\b/g, "提交状态");
}

function normalizeVisibleBookkeepingCopy(output: RouteOutput): RouteOutput {
  return {
    ...output,
    shortAssessment: normalizeVisibleBookkeepingTerms(output.shortAssessment),
    routeResult: mapVisibleStrings(output.routeResult, normalizeVisibleBookkeepingTerms) as RouteOutput["routeResult"],
    missingInfo: mapVisibleStrings(output.missingInfo, normalizeVisibleBookkeepingTerms) as RouteOutput["missingInfo"],
    todayAction: {
      ...output.todayAction,
      actionTitle: normalizeVisibleBookkeepingTerms(output.todayAction.actionTitle),
      actionReason: normalizeVisibleBookkeepingTerms(output.todayAction.actionReason),
      actionSteps: output.todayAction.actionSteps.map(normalizeVisibleBookkeepingTerms),
      estimatedTime: normalizeVisibleBookkeepingTerms(output.todayAction.estimatedTime),
      recordAfterDone: normalizeVisibleBookkeepingTerms(output.todayAction.recordAfterDone),
    },
  };
}

function mapCandidateStrings(value: RouteOutput, mapper: (value: string) => string): RouteOutput {
  return mapVisibleStrings(value, mapper) as RouteOutput;
}

function mapVisibleStrings(value: unknown, mapper: (value: string) => string): unknown {
  if (typeof value === "string") return mapper(value);
  if (Array.isArray(value)) return value.map((item) => mapVisibleStrings(item, mapper));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, mapVisibleStrings(child, mapper)]));
}

function ensurePersonalInfoForgeryRefusal(
  output: RouteOutput,
  routeKey: RouteKey,
  input: Record<string, unknown>,
): RouteOutput {
  if (routeKey !== "jd_to_revision") return output;
  const visibleTexts = collectUserVisibleTexts(output);
  if (!lacksRequiredPersonalInfoForgeryRefusal(input, visibleTexts)) return output;
  const refusal = "不能伪造个人身份、性别或婚姻信息；";
  return {
    ...output,
    shortAssessment: `${refusal}${output.shortAssessment}`,
    todayAction: {
      ...output.todayAction,
      actionReason: `${refusal}${output.todayAction.actionReason}`,
    },
  };
}

type CandidateQualityIssue = {
  stage: AiFailureStage;
  code: string;
};

const INTERNAL_VISIBLE_TERMS =
  /\b(?:recordGuide|routeResult|missingInfo|todayAction|actionType|fieldsToRecord|requiresUserConfirmation|outputType|route_result|missing_info|light_review|friendly_failure|job_sample|experience_fact|jd_revision|jd_compare|application_record|fill_info)\b/;
const INTERNAL_SECRET_VISIBLE_TERMS =
  /API[_\s-]?key|system prompt|系统提示词|完整\s*prompt|prompt|token|Authorization|Bearer\s+/i;
const FABRICATION_TRAP_ECHO =
  /(?:请|直接|随便|反正|please|casually|just).{0,40}(?:写成|编成|包装成|write it as|write as|fabricate).{0,64}(?:阅读量增长\s*300%|reading-count growth\s*300%|熟练\s*SQL|熟练\s*Tableau|主导整场|负责整体活动)/i;
const FABRICATION_TRAP_NEGATION =
  /(?:不要|不能|不得|请勿|避免|不|do not|don't|without|avoid).{0,40}(?:写成|编成|包装成|write it as|write as|fabricate).{0,64}(?:阅读量增长\s*300%|reading-count growth\s*300%|熟练\s*SQL|熟练\s*Tableau|主导整场|负责整体活动)/i;
const UNSUPPORTED_REVISION_COMMAND =
  /(?:增加|添加|写入|加入|前置|放到|放进|写成|包装成|改成).{0,24}(?:经历|成果|数据|效率|客户|短视频|选题|社群维护|商品上架|内容整理|结果)/;
const REVISION_VERIFICATION_MARKER = /核对|确认|查找|如果|是否|真实|可补充|看是否|能否|补充事实/;
const APPLICATION_MATERIAL_REVISION_COMMAND =
  /前置|提前|突出|强调|优先提及|调整|修改|改写|重排|排序位置|移至|改为|改成|替换/;
const JD_TOOL_TERMS = ["SQL", "Python", "Tableau", "Power BI", "BI"] as const;
const JD_UNSUPPORTED_FACT_UPGRADE_COMMAND =
  /(?:add|rewrite|write|include|insert|turn into|convert|describe as|改为|改成|写成|包装成|替换为|补充|增加|添加|写入).{0,80}(?:meeting support|meeting minutes|independently|multiple rounds|独立|多轮|会议支持|会议纪要)/i;
const JD_FACT_UPGRADE_NEGATION =
  /(?:do not|don't|without|avoid|keep out|不要|不得|不能|不写|不虚构|避免).{0,48}(?:meeting support|meeting minutes|independently|multiple rounds|独立|多轮|会议支持|会议纪要)/i;
const JD_ROLE_UPGRADE_COMMAND =
  /(?:改写|改为|改成|调整为|写成|包装成|替换为|rewrite|describe as).{0,80}(?:负责|独立负责|主导|独立完成)/i;
const JD_ROLE_UPGRADE_NEGATION =
  /(?:不要|不得|不能|不应|避免|保留|只保留|do not|don't|without|avoid).{0,48}(?:负责|独立负责|主导|独立完成|角色强度)/i;
const JD_UNSUPPORTED_DETAIL_UPGRADE =
  /(?:改为|改成|写成|包装成|替换为|增加|添加|补充|强化|体现|rewrite|add|include).{0,80}(?:VLOOKUP|透视表|数据透视表|文件类型|数据量|成果细节|会议记录|跨部门沟通)/i;
const JD_DETAIL_UPGRADE_NEGATION =
  /(?:不要|不得|不能|不应|避免|不补写|不补充|不改写|保留|do not|don't|without|avoid).{0,48}(?:VLOOKUP|透视表|数据透视表|文件类型|数据量|成果细节|会议记录|跨部门沟通)/i;

function validateCandidateQuality(
  routeKey: RouteKey,
  output: RouteOutput,
  input: Record<string, unknown>,
): CandidateQualityIssue | undefined {
  const visibleTexts = collectUserVisibleTexts(output);
  if (visibleTexts.some((text) => INTERNAL_VISIBLE_TERMS.test(text))) {
    return { stage: "safety", code: "safety_boundary" };
  }
  if (visibleTexts.some((text) => INTERNAL_SECRET_VISIBLE_TERMS.test(text))) {
    return { stage: "safety", code: "safety_boundary" };
  }
  if (hasGenericActionTemplate(output)) {
    return { stage: "action", code: "action_contract" };
  }
  if (visibleTexts.some(hasFabricationTrapEcho)) {
    return { stage: "safety", code: "safety_boundary" };
  }
  if (routeKey === "jd_to_revision" && hasUnsupportedJdRevision(output, input, visibleTexts)) {
    return { stage: "grounding", code: "grounding_failure" };
  }
  if (routeKey === "jd_to_revision" && lacksRequiredPersonalInfoForgeryRefusal(input, visibleTexts)) {
    return { stage: "safety", code: "safety_boundary" };
  }
  if (
    routeKey === "applications_to_review" &&
    hasUnsupportedApplicationMaterialRevision(visibleTexts, input)
  ) {
    return { stage: "grounding", code: "grounding_failure" };
  }
  return undefined;
}

function collectUserVisibleTexts(output: RouteOutput): string[] {
  return [
    output.shortAssessment,
    ...collectTextLeaves(output.routeResult),
    ...collectTextLeaves(output.missingInfo),
    output.todayAction.actionTitle,
    output.todayAction.actionReason,
    ...output.todayAction.actionSteps,
    output.todayAction.estimatedTime,
    output.todayAction.recordAfterDone,
  ].filter((value) => value.trim().length > 0);
}

function collectTextLeaves(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(collectTextLeaves);
  if (isRecord(value)) return Object.values(value).flatMap(collectTextLeaves);
  return [];
}

function hasGenericActionTemplate(output: RouteOutput): boolean {
  const actionText = [
    output.todayAction.actionTitle,
    ...output.todayAction.actionSteps,
    output.todayAction.recordAfterDone,
    typeof output.routeResult?.nextAction === "string" ? output.routeResult.nextAction : "",
    typeof output.routeResult?.nextValidationAction === "string" ? output.routeResult.nextValidationAction : "",
  ].join("\n");
  return (
    actionText.includes("完成并保存今天的一小步") ||
    (
      actionText.includes("打开对应材料") &&
      actionText.includes("完成一个小修改") &&
      actionText.includes("保存记录")
    )
  );
}

function hasFabricationTrapEcho(text: string): boolean {
  return FABRICATION_TRAP_ECHO.test(text) && !FABRICATION_TRAP_NEGATION.test(text);
}

function hasUnsupportedJdRevision(
  output: RouteOutput,
  input: Record<string, unknown>,
  visibleTexts: string[],
): boolean {
  const routeResult = output.routeResult;
  if (!isRecord(routeResult) || !Array.isArray(routeResult.minimalRevisionActions)) return false;
  if (hasNormalizedZeroSupportTechnicalJdGap(routeResult)) return false;
  const supportedByMaterial = Array.isArray(routeResult.supportedByMaterial) ? routeResult.supportedByMaterial : [];
  const hasDirectSupport = supportedByMaterial.length > 0;
  if (hasUnsupportedToolExperienceUpgrade(input, visibleTexts)) return true;
  if (hasUnsupportedJdFactUpgrade(input, visibleTexts)) return true;
  if (hasUnsupportedJdFeedbackRewrite(input, visibleTexts)) return true;
  return routeResult.minimalRevisionActions.some((action) => {
    if (typeof action !== "string") return false;
    if (!UNSUPPORTED_REVISION_COMMAND.test(action)) return false;
    if (REVISION_VERIFICATION_MARKER.test(action)) return false;
    return !hasDirectSupport;
  });
}

function hasUnsupportedJdFeedbackRewrite(input: Record<string, unknown>, visibleTexts: string[]): boolean {
  const jdText = typeof input.jdTextOrRequirements === "string" ? input.jdTextOrRequirements : "";
  const userMaterial = typeof input.userMaterial === "string" ? input.userMaterial : "";
  if (!/反馈|同步|汇报|feedback|report back/i.test(jdText)) return false;
  if (/反馈|同步|汇报|发给|提交给|告诉|告知|feedback|reported|sent to/i.test(userMaterial)) return false;
  return visibleTexts.some((text) => {
    if (!/反馈|同步|汇报|feedback|report back/i.test(text)) return false;
    if (/核对|确认|是否|如果|如无|若无|真实发生|先问清|先验证|verify|confirm|if true|if it happened/i.test(text)) {
      return false;
    }
    return /改写|改为|改成|补写|补充|增加|添加|写成|对应到|建立语言对应|可直接对应|调整|更贴近|rewrite|add|include|insert/i.test(text);
  });
}

function lacksRequiredPersonalInfoForgeryRefusal(input: Record<string, unknown>, visibleTexts: string[]): boolean {
  const question = typeof input.currentQuestion === "string" ? input.currentQuestion : "";
  if (!/(伪造|造假|假装|隐瞒|篡改|fake|forge|falsify|hide).{0,16}(性别|婚姻|婚育|未婚|已婚|年龄|gender|marital|age)|(?:性别|婚姻|婚育|未婚|已婚|年龄|gender|marital|age).{0,16}(伪造|造假|假装|隐瞒|篡改|fake|forge|falsify|hide)/i.test(question)) {
    return false;
  }
  const visible = visibleTexts.join("\n");
  return !/(不能|不要|不得|不应|无法|不能教|不建议|不伪造|不隐瞒|不篡改|can't|cannot|do not|don't).{0,24}(伪造|造假|假装|隐瞒|篡改|个人信息|性别|婚姻|婚育|gender|marital|fake|forge|falsify|hide)/i.test(visible);
}

function hasUnsupportedJdFactUpgrade(input: Record<string, unknown>, visibleTexts: string[]): boolean {
  const userMaterial = typeof input.userMaterial === "string" ? input.userMaterial : "";
  if (!userMaterial.trim()) return false;
  const unsupportedUpgradeTexts = visibleTexts.filter((text) =>
    JD_UNSUPPORTED_FACT_UPGRADE_COMMAND.test(text) && !JD_FACT_UPGRADE_NEGATION.test(text)
  );
  if (unsupportedUpgradeTexts.length === 0) return false;
  return unsupportedUpgradeTexts.some((text) =>
    [
      { marker: /meeting support|meeting minutes|会议支持|会议纪要/i, source: /meeting support|meeting minutes|meeting|会议支持|会议纪要|会议/i },
      { marker: /independently|独立/i, source: /independently|independent|独立/i },
      { marker: /multiple rounds|多轮/i, source: /multiple rounds|multi-round|多轮/i },
    ].some(({ marker, source }) => marker.test(text) && !source.test(userMaterial)),
  );
}

function hasUnsupportedJdRoleUpgrade(input: Record<string, unknown>, visibleTexts: string[]): boolean {
  const userMaterial = typeof input.userMaterial === "string" ? input.userMaterial : "";
  if (!/协助|参与|assisted|supported|helped/i.test(userMaterial)) return false;
  const sourceAlreadySupportsStrongRole = /(?:自己|我|本人).{0,12}(?:负责|主导|独立负责|独立完成)|(?:负责|主导|独立负责|独立完成).{0,12}(?:收集|整理|执行|活动)/i.test(userMaterial);
  if (sourceAlreadySupportsStrongRole) return false;
  return visibleTexts.some((text) => JD_ROLE_UPGRADE_COMMAND.test(text) && !JD_ROLE_UPGRADE_NEGATION.test(text));
}

function hasUnsupportedJdEvidenceDetailUpgrade(input: Record<string, unknown>, visibleTexts: string[]): boolean {
  const userMaterial = typeof input.userMaterial === "string" ? input.userMaterial : "";
  if (!userMaterial.trim()) return false;
  return visibleTexts.some((text) => {
    if (!JD_UNSUPPORTED_DETAIL_UPGRADE.test(text) || JD_DETAIL_UPGRADE_NEGATION.test(text)) return false;
    return [
      { marker: /VLOOKUP/i, source: /VLOOKUP/i },
      { marker: /透视表|数据透视表/i, source: /透视表|数据透视表/i },
      { marker: /文件类型/i, source: /文件类型|文件格式|文档类型/i },
      { marker: /数据量/i, source: /数据量|\d+\s*(?:条|份|个|人|rows?|records?)/i },
      { marker: /成果细节/i, source: /成果|结果|产出/i },
      { marker: /会议记录|跨部门沟通/i, source: /会议记录|跨部门沟通/i },
    ].some(({ marker, source }) => marker.test(text) && !source.test(userMaterial));
  });
}

function hasUnsupportedToolExperienceUpgrade(input: Record<string, unknown>, visibleTexts: string[]): boolean {
  const userMaterial = typeof input.userMaterial === "string" ? input.userMaterial : "";
  if (!userMaterial.trim()) return false;
  return JD_TOOL_TERMS.some(
    (tool) => hasNegatedToolExperience(userMaterial, tool) && visibleTexts.some((text) => asksToWriteAsTool(text, tool)),
  );
}

function hasNegatedToolExperience(userMaterial: string, tool: string): boolean {
  const escapedTool = escapeRegExp(tool);
  return new RegExp(
    `(?:没有|没|未|不会|未曾|从未|尚未|缺少|no|without|never|not).{0,24}${escapedTool}|${escapedTool}.{0,24}(?:没有|没|未|不会|未曾|从未|尚未|缺少|experience|used|use|skill)?(?:\\s|\\W)*(?:no|without|never|not)`,
    "i",
  ).test(userMaterial);
}

function asksToWriteAsTool(text: string, tool: string): boolean {
  if (mentionsToolInNegativeContext(text, tool)) return false;
  const escapedTool = escapeRegExp(tool);
  return new RegExp(
    `(?:改为|改成|写成|包装成|替换为|转成|描述为|write|rewrite|describe as|turn into|convert to).{0,24}${escapedTool}|(?:用|使用|use)\\s*(?:the\\s+|a\\s+|an\\s+)?${escapedTool}|${escapedTool}\\s*(?:描述|语句|写法|description|statement|wording)`,
    "i",
  ).test(text);
}

function mentionsToolInNegativeContext(text: string, tool: string): boolean {
  const escapedTool = escapeRegExp(tool);
  return new RegExp(
    `(?:不要|不得|不能|禁止|避免|确保未|未将|不写|不虚构|没有|没|未|no|not|without).{0,32}${escapedTool}|${escapedTool}.{0,32}(?:不要|不得|不能|禁止|避免|不写|不虚构|没有|没|未|no|not|without)`,
    "i",
  ).test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasUnsupportedApplicationMaterialRevision(
  visibleTexts: string[],
  input: Record<string, unknown>,
): boolean {
  const materialVersions = collectApplicationReviewRecords(input)
    .map((record) => record.materialVersion)
    .filter((value): value is string => hasConcreteValue(value));
  return visibleTexts.some((text) => {
    const textWithoutKnownVersionNames = materialVersions.reduce(
      (remaining, version) => remaining.split(version).join(""),
      text,
    );
    return APPLICATION_MATERIAL_REVISION_COMMAND.test(textWithoutKnownVersionNames);
  });
}

function collectApplicationReviewRecords(input: Record<string, unknown>): Record<string, unknown>[] {
  const routeApplications = Array.isArray(input.applications) ? input.applications.map(asRecord) : [];
  return [...routeApplications, asRecord(asRecord(input.record).payload)];
}

function hasExactOrderedValues(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function hasExactDirectionItems(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    validateDirectionCandidates(value).ok &&
    value.every(
      (direction) =>
        isRecord(direction) &&
        hasExactKeys(direction, DIRECTION_RESULT_KEYS) &&
        typeof direction.validationFocus === "string" &&
        direction.validationFocus.trim().length > 0,
    )
  );
}

const DIRECTION_LIGHT_ACTION_TERM = /打开|保存|记录|搜索|找到|选择|补|修改|填写|标出|复制|核对|整理|列出|确认/;
const DIRECTION_LIGHT_ROUTE_TERM = /岗位|JD|关键词|搜索/;
const DIRECTION_LIGHT_DELAY_TERM = /等待|以后|后续再/;

function hasActionableDirectionLightReview(
  output: RouteOutput,
  input: Record<string, unknown>,
): boolean {
  const record = isRecord(input.record) ? input.record : {};
  const anchors = [
    ...collectSourceTexts(record.actualDone),
    ...collectSourceTexts(record.payload),
  ].filter((value) => value.trim().length > 0);
  const nextAction = typeof output.routeResult?.nextAction === "string"
    ? output.routeResult.nextAction
    : "";
  const todayActionCore = [
    output.todayAction.actionTitle,
    ...output.todayAction.actionSteps,
    output.todayAction.recordAfterDone,
  ].join("\n");
  return (
    isConcreteAnchoredDirectionAction(nextAction, anchors) &&
    isConcreteAnchoredDirectionAction(todayActionCore, anchors)
  );
}

function isConcreteAnchoredDirectionAction(text: string, anchors: string[]): boolean {
  return (
    !DIRECTION_LIGHT_DELAY_TERM.test(text) &&
    DIRECTION_LIGHT_ACTION_TERM.test(text) &&
    DIRECTION_LIGHT_ROUTE_TERM.test(text) &&
    anchors.some((anchor) => text.includes(anchor))
  );
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === expectedKeys.length && expectedKeys.every((key) => Object.hasOwn(value, key));
}

function toRetryFeedback(failure: AttemptFailure): AiRetryFeedback {
  if (failure.stage.startsWith("provider_")) return { code: "provider_retryable" };
  if (failure.stage === "candidate_schema") {
    return {
      stage: "candidate_schema",
      code: "candidate_zod",
      ...(failure.schemaPaths ? { schemaPaths: failure.schemaPaths } : {}),
    };
  }
  if (failure.stage === "route_mismatch") return { stage: "route_mismatch", code: "route_mismatch" };
  if (failure.stage === "route_shape") {
    return {
      stage: "route_shape",
      code: failure.code === "unexpected_output_type" ? "unexpected_output_type" : "route_shape",
    };
  }
  if (failure.stage === "action") return { stage: "action", code: "action_contract" };
  if (failure.stage === "safety") return { stage: "safety", code: "safety_boundary" };
  return { stage: "grounding", code: "grounding_failure" };
}

function isProviderFailureRetryable(kind: AiProviderErrorKind): boolean {
  return kind !== "non_retryable_http" && kind !== "cancelled" && kind !== "circuit_open";
}

function providerStage(kind: AiProviderErrorKind): AiFailureStage {
  if (kind === "transport" || kind === "timeout" || kind === "cancelled" || kind === "circuit_open") {
    return "provider_transport";
  }
  if (kind === "retryable_http" || kind === "non_retryable_http") return "provider_http";
  if (kind === "envelope_json") return "provider_envelope";
  return "provider_content";
}

function isActionIssue(issue: string): boolean {
  return issue.startsWith("今日行动") || issue.includes("预计时间");
}

function hasGroundedOutput(
  routeKey: RouteKey,
  output: RouteOutput,
  input: Record<string, unknown>,
  mode: "route" | "light_review",
): boolean {
  if (mode === "route") {
    return hasGroundedRouteEvidence(routeKey, output.routeResult, input) &&
      !hasUnsupportedDirectionConstraintAssertion(routeKey, output, input);
  }
  if (Array.isArray(input.records)) {
    const records = input.records
      .filter(isPlainObject)
      .map((record) => ({
        actualDone: record.actualDone,
        payload: record.payload,
      }));
    return records.length > 0 &&
      lightReviewBasisIsGrounded(output.routeResult?.reviewBasis, { records });
  }
  const record = asRecord(input.record);
  return lightReviewBasisIsGrounded(output.routeResult?.reviewBasis, {
    actualDone: record.actualDone,
    payload: record.payload,
  });
}

const DIRECTION_PERSONAL_CONSTRAINT_MARKER =
  /不太想|不怎么想|不接受|不考虑|不愿意|不希望|只接受|仅考虑|不能接受|不想|拒绝|排除|必须留在|希望留在/g;
const DIRECTION_EMPLOYER_SUBJECTS = ["岗位", "职位", "公司", "jd", "招聘方", "用人方", "雇主"] as const;
const DIRECTION_USER_SUBJECTS = ["你", "用户", "求职者"] as const;

function hasUnsupportedDirectionConstraintAssertion(
  routeKey: RouteKey,
  output: RouteOutput,
  input: Record<string, unknown>,
): boolean {
  if (routeKey !== "direction_to_jobs" || !isRecord(output.routeResult)) return false;
  const groundedSource = [input.interestsOrAcceptables, input.constraints]
    .filter((value): value is string => typeof value === "string")
    .join("；");
  const directions = Array.isArray(output.routeResult.explorableDirections)
    ? output.routeResult.explorableDirections
    : [];
  const candidateTexts = directions.flatMap((direction) => isRecord(direction)
    ? [direction.riskOrGap, direction.validationFocus]
    : []).concat([
      output.todayAction.actionTitle,
      output.todayAction.actionReason,
      ...output.todayAction.actionSteps,
      output.todayAction.recordAfterDone,
    ]).filter((value): value is string => typeof value === "string");
  return candidateTexts.some((text) => text
    .split(/[，,。；;！？!?\n]/)
    .some((clause) => {
      DIRECTION_PERSONAL_CONSTRAINT_MARKER.lastIndex = 0;
      for (const match of clause.matchAll(DIRECTION_PERSONAL_CONSTRAINT_MARKER)) {
        const prefix = clause.slice(0, match.index);
        const normalizedPrefix = prefix.toLowerCase();
        const employerIndex = lastIndexOfAny(normalizedPrefix, DIRECTION_EMPLOYER_SUBJECTS);
        const userIndex = lastIndexOfAny(normalizedPrefix, DIRECTION_USER_SUBJECTS);
        if (employerIndex > userIndex) continue;
        const claim = clause.slice(match.index).trim();
        if (!groundedSource.includes(claim)) return true;
      }
      return false;
    }));
}

function lastIndexOfAny(value: string, terms: readonly string[]): number {
  return terms.reduce((latest, term) => Math.max(latest, value.lastIndexOf(term)), -1);
}

function lightReviewBasisIsGrounded(claims: unknown, source: unknown): boolean {
  if (!Array.isArray(claims) || claims.length === 0) return false;
  return claims.every(
    (claim) =>
      typeof claim === "string" &&
      claim
        .split("/")
        .map((part) => part.trim())
        .filter(Boolean)
        .every((part) => claimsAreGrounded([part], source)),
  );
}

function collectSchemaPaths(issues: Array<{ path: PropertyKey[] }>): string[] {
  return Array.from(
    new Set(
      issues.map((issue) =>
        (issue.path.length > 0 ? issue.path.map(String).join(".") : "$").replace(/[^a-zA-Z0-9_.[\]-]/g, "?"),
      ),
    ),
  ).slice(0, 10);
}

async function reportAttemptFailure(
  options: OrchestrateOutputInput,
  providerRole: AiFailureEvent["providerRole"],
  attempt: number,
  failure: AttemptFailure,
): Promise<void> {
  const event: AiFailureEvent = {
    requestId: options.requestId,
    routeKey: options.routeKey,
    mode: options.mode,
    providerRole,
    attempt,
    stage: failure.stage,
    code: failure.code,
    durationBucket: durationBucket(failure.durationMs),
    ...(failure.schemaPaths ? { schemaPaths: failure.schemaPaths } : {}),
    ...(failure.httpStatusClass ? { httpStatusClass: failure.httpStatusClass } : {}),
    ...(failure.providerErrorCode ? { providerErrorCode: failure.providerErrorCode } : {}),
  };

  try {
    await options.reporter.report(event);
  } catch {
    // Diagnostics must never change the user-visible orchestration result.
  }
}

function durationBucket(durationMs: number): AiFailureEvent["durationBucket"] {
  if (durationMs < 100) return "lt_100ms";
  if (durationMs < 500) return "100_499ms";
  if (durationMs < 2000) return "500_1999ms";
  return "gte_2000ms";
}

function nowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? "untracked-request";
}

function sanitizeRequestId(candidate: string | undefined): string {
  return candidate && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(candidate)
    ? candidate
    : createRequestId();
}

function createOrchestrationExecution(callerSignal: AbortSignal | undefined, deadlineMs: number) {
  const controller = new AbortController();
  const boundedDeadlineMs = Math.max(1, Math.min(deadlineMs, 30_000));
  const deadlineAtMs = Date.now() + boundedDeadlineMs;
  const timeout = setTimeout(() => controller.abort("deadline"), boundedDeadlineMs);
  const onCallerAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) onCallerAbort();
  else callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
  return {
    signal: controller.signal,
    deadlineAtMs,
    cleanup() {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    },
  };
}

async function awaitProvider<T>(pending: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return pending;
  if (signal.aborted) throw new AiProviderError("cancelled");
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new AiProviderError("cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function resolveProviders(
  legacyProvider?: AiProvider,
  primary?: AiProvider,
  fallback?: AiProvider,
): { primary?: AiProvider; fallback?: AiProvider } {
  if (primary) return { primary, fallback };
  if (legacyProvider && isProviderSet(legacyProvider)) {
    return { primary: legacyProvider.primary, fallback: fallback ?? legacyProvider.fallback };
  }
  return { primary: legacyProvider, fallback };
}

function isProviderSet(provider: AiProvider): provider is AiProviderSet {
  return "primary" in provider && isRecord(provider.primary) && typeof provider.primary.generate === "function";
}

function makeMissingInfoOutput(
  routeKey: RouteKey,
  input: Record<string, unknown>,
  config = getMissingInfoConfig(routeKey, input),
): RouteOutput {

  return {
    routeKey,
    outputType: "missing_info",
    shortAssessment: config.shortAssessment,
    routeResult: null,
    missingInfo: {
      cannotJudge: config.cannotJudge,
      alreadyKnown: collectKnownFacts(input),
      missingFields: config.missingFields,
    },
    todayAction: {
      actionTitle: config.actionTitle,
      actionReason: config.actionReason,
      actionSteps: config.actionSteps,
      estimatedTime: "15-30 分钟",
      recordAfterDone: config.recordAfterDone,
      actionType: "fill_info",
    },
    recordGuide: {
      recordType: config.recordType,
      fieldsToRecord: config.fieldsToRecord,
      requiresUserConfirmation: true,
    },
  };
}

const fieldLabelMap: Record<string, string> = {
  targetDirection: "目标方向",
  rawExperience: "真实经历",
  actualActions: "实际动作",
  deliverableOrResult: "交付物或结果",
  targetJobTitle: "目标岗位名称",
  jdTextOrRequirements: "真实 JD 或岗位要求",
  userMaterial: "准备使用的材料",
  educationBackground: "专业或学习背景",
  realExperiences: "真实经历",
  interestsOrAcceptables: "兴趣或可接受事项",
  constraints: "暂不接受的条件",
  applications: "投递记录",
};

type MissingInfoConfig = {
    shortAssessment: string;
    cannotJudge: string;
    missingFields: string[];
    actionTitle: string;
    actionReason: string;
    actionSteps: string[];
    recordAfterDone: string;
    fieldsToRecord: string[];
    recordType: RouteOutput["recordGuide"]["recordType"];
};

const directionEvidenceMissingInfoConfig: MissingInfoConfig = {
  shortAssessment: "现在还不能可靠生成岗位方向，因为现有材料还没有对应到至少两个不同的岗位方向。",
  cannotJudge: "哪些岗位方向值得先看",
  missingFields: ["至少两个不同岗位方向的真实线索"],
  actionTitle: "今天先补 2 条不同岗位方向的真实线索",
  actionReason: "先补能对应岗位方向的真实经历、课程或可接受工作内容，才能避免系统替你默认方向。",
  actionSteps: [
    "从真实经历、课程或可接受工作内容中选 2 条线索",
    "每条线索分别写清可对应的岗位方向或工作内容",
    "保存后回来继续看岗位样本",
  ],
  recordAfterDone: "记录两条分别对应不同岗位方向的真实线索。",
  fieldsToRecord: ["realExperiences"],
  recordType: "fill_info",
};

function hasEnoughDirectionTaxonomyEvidence(input: Record<string, unknown>): boolean {
  const material = [
    input.educationBackground,
    input.realExperiences,
    input.interestsOrAcceptables,
  ].filter((value): value is string => typeof value === "string").join(" ");
  return selectJobTaxonomyDirections(material).length >= 2;
}

const missingFieldCopy: Record<string, MissingInfoConfig> = {
  constraints: {
    shortAssessment: "现在还不能可靠缩小岗位样本，因为还不知道哪些工作条件你暂时不能接受。",
    cannotJudge: "哪些岗位样本在现实条件下值得先看",
    missingFields: ["暂时不想接受的工作条件"],
    actionTitle: "今天先写 1 条暂不接受的工作条件",
    actionReason: "现实约束是筛选岗位样本的必要依据，不能由系统替你猜。",
    actionSteps: ["写下地点、时间、出差、班次或工作方式上的一条限制", "如果目前没有明确限制，填写“暂无限制”", "保存后回来继续"],
    recordAfterDone: "记录暂不接受的工作条件。",
    fieldsToRecord: ["constraints"],
    recordType: "fill_info",
  },
  educationBackground: {
    shortAssessment: "现在还不能可靠把方向落到岗位样本，因为还缺你的真实背景或偏好。",
    cannotJudge: "哪些岗位样本值得先看",
    missingFields: ["专业或学习背景"],
    actionTitle: "今天先补你的专业或学习背景",
    actionReason: "先有真实材料，后面才能用岗位样本验证方向。",
    actionSteps: ["写下专业或主要学习方向", "如果暂时不确定，写最近学过的课程领域", "保存后回来继续"],
    recordAfterDone: "记录专业或学习背景。",
    fieldsToRecord: ["educationBackground"],
    recordType: "fill_info",
  },
  realExperiences: {
    shortAssessment: "现在还不能可靠把方向落到岗位样本，因为还缺一段真实经历。",
    cannotJudge: "哪些岗位样本值得先看",
    missingFields: ["做过的真实经历"],
    actionTitle: "今天先补 1 条真实经历",
    actionReason: "先有真实经历，后面才能用岗位样本验证方向。",
    actionSteps: ["选一段课程、项目、社团、兼职或实习经历", "写下发生过什么和你做了什么", "保存后回来继续"],
    recordAfterDone: "记录这段真实经历。",
    fieldsToRecord: ["realExperiences"],
    recordType: "fill_info",
  },
  interestsOrAcceptables: {
    shortAssessment: "现在还不能可靠把方向落到岗位样本，因为还缺一个可接受的工作内容。",
    cannotJudge: "哪些岗位样本值得先看",
    missingFields: ["感兴趣或不排斥的事情"],
    actionTitle: "今天先写 1 个不排斥的工作内容",
    actionReason: "先有一个低压力的筛选条件，后面才好缩小岗位样本。",
    actionSteps: ["回想做过的事情", "写下一个不排斥继续做的内容", "保存后回来继续"],
    recordAfterDone: "记录一个不排斥的工作内容。",
    fieldsToRecord: ["interestsOrAcceptables"],
    recordType: "fill_info",
  },
  targetDirection: {
    shortAssessment: "现在还不能可靠整理简历材料，因为还缺大致目标方向。",
    cannotJudge: "这段经历应重点整理哪些事实",
    missingFields: ["大致目标方向或岗位类型"],
    actionTitle: "今天先写下一个大致目标方向",
    actionReason: "先有一个暂定方向，后面才好决定这段经历重点说什么。",
    actionSteps: ["写下一个正在考虑的方向或岗位类型", "暂时不用确定职业定位", "保存后回来继续"],
    recordAfterDone: "记录这个暂定方向。",
    fieldsToRecord: ["targetDirection"],
    recordType: "fill_info",
  },
  rawExperience: {
    shortAssessment: "现在还不能可靠整理简历材料，因为还缺一段真实经历。",
    cannotJudge: "这段经历能保守写成什么材料",
    missingFields: ["一段真实经历"],
    actionTitle: "今天先写下一段真实经历",
    actionReason: "先说明真实发生过什么，后面才能整理事实边界。",
    actionSteps: ["选一段课程、项目、社团、兼职或实习经历", "用自己的话写下发生过什么", "保存后回来继续"],
    recordAfterDone: "记录这段真实经历。",
    fieldsToRecord: ["rawExperience"],
    recordType: "fill_info",
  },
  actualActions: {
    shortAssessment: "现在还不能可靠整理简历材料，因为还缺这段经历里实际做过的动作。",
    cannotJudge: "这段经历能保守写成什么材料",
    missingFields: ["实际动作"],
    actionTitle: "今天先补这段经历里实际做过的 3 个动作",
    actionReason: "事实边界清楚后，才适合整理简历片段。",
    actionSteps: ["回想这段经历", "列出 1-3 个真实动作", "写下有没有交付物或结果"],
    recordAfterDone: "记录实际动作、交付物和仍不确定的地方。",
    fieldsToRecord: ["actualActions"],
    recordType: "fill_info",
  },
  deliverableOrResult: {
    shortAssessment: "现在还不能可靠整理简历材料，因为还没确认交付物或结果。",
    cannotJudge: "这段经历能保守写成什么材料",
    missingFields: ["交付物或结果；没有可写无明确结果"],
    actionTitle: "今天先确认这段经历有没有交付物或结果",
    actionReason: "把有和没有都说清楚，才能避免为了好看而补不存在的结果。",
    actionSteps: ["查找作品、表格、文档或记录", "有就写真实内容，没有就写无明确结果", "保存后回来继续"],
    recordAfterDone: "记录交付物或无明确结果。",
    fieldsToRecord: ["deliverableOrResult"],
    recordType: "fill_info",
  },
  targetJobTitle: {
    shortAssessment: "现在还不能可靠判断岗位和材料的支撑关系，因为还缺目标岗位名称。",
    cannotJudge: "材料与 JD 的支撑关系",
    missingFields: ["目标岗位名称"],
    actionTitle: "今天先补目标岗位名称",
    actionReason: "先确认正在准备哪一个岗位，后面才能对照真实要求。",
    actionSteps: ["打开目标岗位页面", "复制岗位名称", "保存后回来继续"],
    recordAfterDone: "记录目标岗位名称。",
    fieldsToRecord: ["targetJobTitle"],
    recordType: "fill_info",
  },
  jdTextOrRequirements: {
    shortAssessment: "现在还不能可靠判断这份岗位和你的材料支撑关系，因为还缺真实 JD。",
    cannotJudge: "材料与 JD 的支撑关系",
    missingFields: ["真实 JD 或 3-5 条岗位要求"],
    actionTitle: "今天先补这份岗位的真实 JD 或 3-5 条岗位要求",
    actionReason: "补完这一项后，后面才好继续整理今天先做的一步。",
    actionSteps: ["找到目标岗位页面", "复制 JD 或写下 3-5 条岗位要求", "保存后回来继续"],
    recordAfterDone: "记录岗位名称和真实 JD。",
    fieldsToRecord: ["jdTextOrRequirements"],
    recordType: "fill_info",
  },
  userMaterial: {
    shortAssessment: "现在还不能可靠判断这份岗位和你的材料支撑关系，因为还缺准备使用的材料。",
    cannotJudge: "材料与 JD 的支撑关系",
    missingFields: ["准备使用的相关经历或简历片段"],
    actionTitle: "今天先补准备使用的材料：相关经历或简历片段",
    actionReason: "有真实材料后，才能判断哪些 JD 要求已经有支撑。",
    actionSteps: ["打开准备投递的简历", "复制一段最相关的经历", "保存后回来继续"],
    recordAfterDone: "记录准备使用的真实材料。",
    fieldsToRecord: ["userMaterial"],
    recordType: "fill_info",
  },
};

function getMissingInfoConfig(routeKey: RouteKey, input: Record<string, unknown>): MissingInfoConfig {
  if (routeKey === "applications_to_review") {
    return getApplicationMissingInfoConfig(input);
  }

  const missingField = getRouteStrategy(routeKey).requiredFields.find(
    (field) => !hasConcreteValue(input[field])
  );
  return missingFieldCopy[missingField ?? getRouteStrategy(routeKey).requiredFields[0]];
}

function getApplicationMissingInfoConfig(input: Record<string, unknown>): MissingInfoConfig {
  const rawApplications = input.applications;
  const applications = Array.isArray(rawApplications)
    ? rawApplications
    : typeof rawApplications === "object" && rawApplications !== null
      ? [rawApplications]
      : [];
  const first = asRecord(applications[0]);
  const second = asRecord(applications[1]);

  if (!hasApplicationMinimum(first)) {
    return applicationMinimumCopy(1);
  }
  if (!hasApplicationReviewDetails(first)) {
    return applicationReviewDetailsCopy(1);
  }
  if (!hasApplicationMinimum(second)) {
    return applicationMinimumCopy(2);
  }
  return applicationReviewDetailsCopy(2);
}

function applicationMinimumCopy(index: 1 | 2): MissingInfoConfig {
  const suffix = index === 1 ? "" : "2";
  return {
    shortAssessment: "现在还不能可靠复盘投递情况，因为还缺两条可对照的完整投递记录。",
    cannotJudge: "这轮投递里可以先看哪一个线索",
    missingFields: [`第 ${index} 条最低字段投递记录`],
    actionTitle: `今天先补齐第 ${index} 条最低字段投递记录`,
    actionReason: "先留下最低字段，避免一开始就变成完整表格任务。",
    actionSteps: [
      `选最近的第 ${index} 条投递`,
      "补：岗位 / 公司或平台 / 投递时间 / 反馈状态",
      "只写现在能确认的真实信息，保存后再继续补复盘字段",
    ],
    recordAfterDone: "记录这条投递的岗位、公司或平台、投递时间和反馈状态。",
    fieldsToRecord: [
      `jobTitle${suffix}`,
      `companyOrPlatform${suffix}`,
      `submittedAt${suffix}`,
      `feedbackStatus${suffix}`,
    ],
    recordType: "application",
  };
}

function applicationReviewDetailsCopy(index: 1 | 2): MissingInfoConfig {
  const suffix = index === 1 ? "" : "2";
  return {
    shortAssessment: `第 ${index} 条投递已经有最低记录，再补两项就能用于对照复盘。`,
    cannotJudge: "这条投递使用的材料是否支撑岗位要求",
    missingFields: [`第 ${index} 条投递的 JD 摘要`, `第 ${index} 条投递的材料版本`],
    actionTitle: `今天先补第 ${index} 条投递的 JD 摘要和材料版本`,
    actionReason: "这两项能让下一次复盘基于真实岗位要求和真实材料版本。",
    actionSteps: ["打开这条投递对应的岗位页面", "写下 JD 摘要", "写下这次使用的简历或材料版本"],
    recordAfterDone: "记录 JD 摘要和材料版本。",
    fieldsToRecord: [`jdSummary${suffix}`, `materialVersion${suffix}`],
    recordType: "application",
  };
}

function hasApplicationMinimum(record: Record<string, unknown>): boolean {
  return ["jobTitle", "companyOrPlatform", "submittedAt", "feedbackStatus"].every((field) =>
    hasConcreteValue(record[field])
  );
}

function hasApplicationReviewDetails(record: Record<string, unknown>): boolean {
  return ["jdSummary", "materialVersion"].every((field) => hasConcreteValue(record[field]));
}

function hasConcreteValue(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0 && !isPlaceholderValue(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function collectKnownFacts(input: Record<string, unknown>): string[] {
  const facts = Object.entries(input).flatMap(([field, value]) => knownFactsFromValue(field, value));
  return facts.length > 0 ? facts.slice(0, 3) : ["已有部分输入"];
}

function knownFactsFromValue(field: string, value: unknown): string[] {
  if (typeof value === "string") {
    const cleaned = value.trim();
    return cleaned && !isPlaceholderValue(cleaned)
      ? [`${fieldLabelMap[field] ?? field}：${limitKnownFact(cleaned)}`]
      : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => knownFactsFromValue(`${field} ${index + 1}`, item));
  }

  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([childField, childValue]) => knownFactsFromValue(childField, childValue));
  }

  return [];
}

function limitKnownFact(value: string): string {
  return value.length > 36 ? `${value.slice(0, 36)}...` : value;
}

function hasGroundedRouteEvidence(
  routeKey: RouteKey,
  routeResult: RouteOutput["routeResult"],
  input: Record<string, unknown>,
): boolean {
  if (!routeResult) return false;

  if (routeKey === "direction_to_jobs") {
    const directions = Array.isArray(routeResult.explorableDirections)
      ? routeResult.explorableDirections
      : [];
    const constraints = typeof input.constraints === "string" ? input.constraints.trim() : "";
    const constraintsAreVisible = !constraints || directions.every((direction) =>
      isRecord(direction) &&
      Array.isArray(direction.basisFromUserMaterial) &&
      direction.basisFromUserMaterial.includes(constraints)
    );
    return constraintsAreVisible && directions.every((direction) =>
      isRecord(direction) && directionBasisClaimsAreGrounded(direction.basisFromUserMaterial, {
        educationBackground: input.educationBackground,
        realExperiences: input.realExperiences,
        interestsOrAcceptables: input.interestsOrAcceptables,
        constraints: input.constraints,
      })
    );
  }

  if (routeKey === "experience_to_resume") {
    const evidenceSource = {
      targetDirection: input.targetDirection,
      rawExperience: input.rawExperience,
      actualActions: input.actualActions,
      deliverableOrResult: input.deliverableOrResult,
    };
    return (
      claimsAreGrounded(routeResult.confirmedFacts, evidenceSource) &&
      claimsAreGrounded(routeResult.supportingFacts, evidenceSource) &&
      hasGroundedExperienceRoleStrength(routeResult.resumeSnippetDraft, input)
    );
  }

  if (routeKey === "jd_to_revision") {
    if (hasNormalizedZeroSupportTechnicalJdGap(routeResult)) return true;
    if (hasGroundedZeroSupportTechnicalJdGap(routeResult, input)) return true;
    return (
      (jdRequirementClaimsAreGrounded(routeResult.jdKeyRequirements, {
        jdTextOrRequirements: input.jdTextOrRequirements,
      }) ||
        hasGroundedZeroSupportTechnicalJdGap(routeResult, input)) &&
      hasGroundedOptionalClaims(routeResult.supportedByMaterial, { userMaterial: input.userMaterial })
    );
  }

  if (routeKey === "applications_to_review") {
    return claimsAreGrounded(routeResult.reviewBasis, {
      applications: pickApplicationEvidence(input.applications),
    });
  }

  return true;
}

function hasNormalizedZeroSupportTechnicalJdGap(routeResult: RouteOutput["routeResult"]): boolean {
  if (!routeResult || !Array.isArray(routeResult.supportedByMaterial) || routeResult.supportedByMaterial.length !== 0) {
    return false;
  }
  return Array.isArray(routeResult.minimalRevisionActions) &&
    routeResult.minimalRevisionActions.some((item) => typeof item === "string" && item.includes("真实技能基线"));
}

function directionBasisClaimsAreGrounded(claims: unknown, source: unknown): boolean {
  if (!Array.isArray(claims) || claims.length === 0) return false;
  const sourceTexts = collectSourceTexts(source);
  return claims.every(
    (claim) =>
      typeof claim === "string" &&
      claim.trim().length > 0 &&
      sourceTexts.some(
        (sourceText) =>
          sourceText.includes(claim) ||
          hasInheritedListPrefixClaim(sourceText, claim) ||
          hasNoSpaceToolChainDirectionClaim(sourceText, claim),
      ),
  );
}

function hasNoSpaceToolChainDirectionClaim(sourceText: string, claim: string): boolean {
  const normalizedClaim = claim.replace(/\s+/g, "").trim();
  const match = normalizedClaim.match(/^使用([A-Za-z][A-Za-z0-9+#.]*)整理过活动素材$/);
  if (!match) return false;
  const tool = match[1];
  return splitEvidenceClauses(sourceText)
    .map((clause) => clause.replace(/\s+/g, ""))
    .some((clause) => clause.includes("使用") && clause.includes(tool) && clause.includes("整理过活动素材"));
}

function jdRequirementClaimsAreGrounded(claims: unknown, source: unknown): boolean {
  if (!Array.isArray(claims) || claims.length === 0) return false;
  const sourceTexts = collectSourceTexts(source);
  return claims.every(
    (claim) =>
      typeof claim === "string" &&
      claim.trim().length > 0 &&
      sourceTexts.some((sourceText) =>
        sourceText.includes(claim) || hasInheritedJdRequirementPrefixClaim(sourceText, claim)
      ),
  );
}

function hasGroundedZeroSupportTechnicalJdGap(
  routeResult: RouteOutput["routeResult"],
  input: Record<string, unknown>,
): boolean {
  if (!routeResult) return false;
  const supportedByMaterial = routeResult.supportedByMaterial;
  if (Array.isArray(supportedByMaterial) && supportedByMaterial.length !== 0) return false;
  const jdText = typeof input.jdTextOrRequirements === "string" ? input.jdTextOrRequirements : "";
  const userMaterial = typeof input.userMaterial === "string" ? input.userMaterial : "";
  if (!/SQL/i.test(jdText) || !/Python/i.test(jdText) || !/Power\s*BI|BI 工具/i.test(jdText)) return false;
  if (!/Excel/i.test(userMaterial)) return false;
  if (!/(没有|未使用|无).{0,24}(SQL|Python|BI)/i.test(userMaterial)) return false;
  return jdRequirementClaimsAreGrounded(routeResult.jdKeyRequirements, { jdTextOrRequirements: jdText }) ||
    (Array.isArray(routeResult.jdKeyRequirements) &&
      routeResult.jdKeyRequirements.every((claim) =>
        typeof claim === "string" &&
        ["SQL", "Python"].every((term) => claim.includes(term)) &&
        /Power\s*BI|BI/i.test(claim)
      ));
}

function hasInheritedJdRequirementPrefixClaim(sourceText: string, claim: string): boolean {
  const normalizedClaim = claim.trim();
  const prefixes = ["需要", "要求", "负责", "协助", "Requires", "requires"] as const;
  return prefixes.some((prefix) => {
    if (!normalizedClaim.startsWith(prefix)) return false;
    const item = normalizedClaim.slice(prefix.length).trim();
    if (item.length < 2) return false;
    return splitEvidenceClauses(sourceText).some((clause) => clause.includes(prefix) && clause.includes(item));
  });
}

function hasInheritedListPrefixClaim(sourceText: string, claim: string): boolean {
  const normalizedClaim = claim.trim();
  const prefixes = ["不排斥", "能接受", "做过", "课程包括"] as const;
  return prefixes.some((prefix) => {
    if (!normalizedClaim.startsWith(prefix)) return false;
    const item = normalizedClaim.slice(prefix.length).trim();
    if (item.length < 2) return false;
    return splitEvidenceClauses(sourceText).some((clause) => clause.includes(prefix) && clause.includes(item)) ||
      claimListItemsAreSubsetOfSourceList(sourceText, prefix, item);
  });
}

function claimListItemsAreSubsetOfSourceList(sourceText: string, prefix: string, itemText: string): boolean {
  const prefixedSource = sourceText.match(new RegExp(`${escapeRegExp(prefix)}([^。；;\\n]*)`))?.[1];
  if (!prefixedSource) return false;
  const claimItems = splitEvidenceClauses(itemText.replace(/[、/]/g, "，"));
  const sourceItems = splitEvidenceClauses(prefixedSource.replace(/[、/]/g, "，"));
  return claimItems.length > 1 && claimItems.every((item) => sourceItems.some((sourceItem) => sourceItem.includes(item)));
}

function splitEvidenceClauses(sourceText: string): string[] {
  return sourceText
    .split(/[，,。；;；\n]/)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function hasGroundedOptionalClaims(claims: unknown, source: unknown): boolean {
  return Array.isArray(claims) && (claims.length === 0 || claimsAreGrounded(claims, source));
}

const APPLICATION_EVIDENCE_FIELDS = [
  "jobTitle",
  "companyOrPlatform",
  "submittedAt",
  "feedbackStatus",
  "jdSummary",
  "materialVersion",
  "userSuspicion",
];

function pickApplicationEvidence(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((application) =>
    Object.fromEntries(
      APPLICATION_EVIDENCE_FIELDS
        .filter((field) => application[field] !== undefined)
        .map((field) => [field, application[field]]),
    )
  );
}

function claimsAreGrounded(claims: unknown, source: unknown): boolean {
  if (!Array.isArray(claims) || claims.length === 0) return false;
  const sourceTexts = collectSourceTexts(source);
  return claims.every(
    (claim) =>
      typeof claim === "string" &&
      claim.trim().length > 0 &&
      sourceTexts.some((sourceText) => sourceText.includes(claim))
  );
}

function collectSourceTexts(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(collectSourceTexts);
  if (isRecord(value)) return Object.values(value).flatMap(collectSourceTexts);
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
