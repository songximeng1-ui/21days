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
import { validateRouteOutput } from "@/domain/action-card";
import { getRouteStrategy, isPlaceholderValue, isRouteInputSufficient } from "@/domain/routes";
import { hasGroundedExperienceRoleStrength, scanRouteSafety } from "@/domain/safety";
import type { ActionType, RecordType, RouteKey, RouteOutput } from "@/domain/types";
import type { LocalRecord } from "@/lib/local-store";
import { routeOutputSchema } from "@/schemas/route-output";

type GenerateRouteOutputInput = {
  routeKey: RouteKey;
  input: Record<string, unknown>;
  provider?: AiProvider;
  primary?: AiProvider;
  fallback?: AiProvider;
  reporter?: AiFailureReporter;
  requestId?: string;
};

type GenerateLightReviewInput = {
  record: LocalRecord;
  provider?: AiProvider;
  primary?: AiProvider;
  fallback?: AiProvider;
  reporter?: AiFailureReporter;
  requestId?: string;
};

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
  };
}

export async function generateRouteOutput({
  routeKey,
  input,
  provider,
  primary,
  fallback,
  reporter,
}: GenerateRouteOutputInput): Promise<RouteOutput> {
  if (!isRouteInputSufficient(routeKey, input)) {
    return makeMissingInfoOutput(routeKey, input);
  }

  return orchestrateOutput({
    routeKey,
    input,
    mode: "route",
    ...resolveProviders(provider, primary, fallback),
    reporter: reporter ?? noopAiFailureReporter,
    requestId: createRequestId(),
  });
}

export async function generateLightReviewOutput({
  record,
  provider,
  primary,
  fallback,
  reporter,
}: GenerateLightReviewInput): Promise<RouteOutput> {
  if (!record.userConfirmed || !record.actualDone.trim()) {
    return makeFriendlyFailureOutput(record.routeKey as RouteKey);
  }

  const routeKey = record.routeKey as RouteKey;
  return orchestrateOutput({
    routeKey,
    input: { mode: "light_review", record },
    mode: "light_review",
    ...resolveProviders(provider, primary, fallback),
    reporter: reporter ?? noopAiFailureReporter,
    requestId: createRequestId(),
  });
}

type OrchestrateOutputInput = {
  routeKey: RouteKey;
  input: Record<string, unknown>;
  mode: "route" | "light_review";
  primary?: AiProvider;
  fallback?: AiProvider;
  reporter: AiFailureReporter;
  requestId: string;
};

type AttemptFailure = {
  stage: AiFailureStage;
  code: string;
  retryPrimary: boolean;
  allowFallback: boolean;
  durationMs: number;
  schemaPaths?: string[];
  httpStatusClass?: AiProviderError["httpStatusClass"];
};

type AttemptResult =
  | { output: RouteOutput; failure?: never }
  | { output?: never; failure: AttemptFailure };

async function orchestrateOutput(options: OrchestrateOutputInput): Promise<RouteOutput> {
  if (!options.primary) return makeFriendlyFailureOutput(options.routeKey);

  let primaryFailuresAllowFallback = true;
  let retryFeedback: AiRetryFeedback | undefined;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = await generateAndValidate(options.primary, options, retryFeedback);
    if (result.output) return result.output;

    primaryFailuresAllowFallback = primaryFailuresAllowFallback && result.failure.allowFallback;
    await reportAttemptFailure(options, "primary", attempt, result.failure);
    if (!result.failure.retryPrimary) return makeFriendlyFailureOutput(options.routeKey);
    retryFeedback = toRetryFeedback(result.failure);
  }

  if (primaryFailuresAllowFallback && options.fallback) {
    const result = await generateAndValidate(options.fallback, options);
    if (result.output) return result.output;
    await reportAttemptFailure(options, "fallback", 1, result.failure);
  }

  return makeFriendlyFailureOutput(options.routeKey);
}

async function generateAndValidate(
  provider: AiProvider,
  options: Pick<OrchestrateOutputInput, "routeKey" | "input" | "mode">,
  retryFeedback?: AiRetryFeedback,
): Promise<AttemptResult> {
  const startedAt = nowMs();
  let rawOutput: RouteOutput;

  try {
    rawOutput = await provider.generate({
      routeKey: options.routeKey,
      input: options.input,
      ...(retryFeedback ? { retryFeedback } : {}),
    });
  } catch (error) {
    return { failure: providerFailure(error, nowMs() - startedAt) };
  }

  const durationMs = nowMs() - startedAt;
  const parsed = routeOutputSchema.safeParse(rawOutput);
  if (!parsed.success) {
    return {
      failure: {
        stage: "candidate_schema",
        code: "candidate_zod",
        retryPrimary: true,
        allowFallback: true,
        durationMs,
        schemaPaths: collectSchemaPaths(parsed.error.issues),
      },
    };
  }

  const output = parsed.data as RouteOutput;
  if (output.routeKey !== options.routeKey) {
    return { failure: contentFailure("route_mismatch", "route_mismatch", durationMs) };
  }

  const expectedOutputType = options.mode === "light_review" ? "light_review" : "route_result";
  if (output.outputType !== expectedOutputType) {
    return { failure: contentFailure("route_shape", "unexpected_output_type", durationMs) };
  }

  const hardContractIssue = validateHardRouteContract(options.routeKey, output, options.mode);
  if (hardContractIssue) {
    return {
      failure: contentFailure(
        hardContractIssue,
        hardContractIssue === "action" ? "action_contract" : "route_shape",
        durationMs,
      ),
    };
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
    return { failure: contentFailure("route_shape", "route_shape", durationMs) };
  }
  if (nonSafetyIssues.some(isActionIssue)) {
    return { failure: contentFailure("action", "action_contract", durationMs) };
  }
  if (safety.blockedReasons.length > 0) {
    return { failure: contentFailure("safety", "safety_boundary", durationMs) };
  }
  if (!hasGroundedOutput(options.routeKey, output, options.input, options.mode)) {
    return { failure: contentFailure("grounding", "grounding_failure", durationMs) };
  }

  return { output };
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
    retryPrimary: eligible,
    allowFallback: eligible,
    durationMs,
    httpStatusClass: error.httpStatusClass,
  };
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
    fieldsToRecord: ["beforeSnippet", "afterSnippet", "jdRequirement", "submitted"],
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

function hasExactOrderedValues(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function hasExactDirectionItems(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (direction) =>
        isRecord(direction) &&
        hasExactKeys(direction, DIRECTION_RESULT_KEYS) &&
        typeof direction.validationFocus === "string" &&
        direction.validationFocus.trim().length > 0,
    )
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
  return kind !== "non_retryable_http";
}

function providerStage(kind: AiProviderErrorKind): AiFailureStage {
  if (kind === "transport") return "provider_transport";
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
  if (mode === "route") return hasGroundedRouteEvidence(routeKey, output.routeResult, input);
  const record = asRecord(input.record);
  return lightReviewBasisIsGrounded(output.routeResult?.reviewBasis, {
    actualDone: record.actualDone,
    payload: record.payload,
  });
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

function makeMissingInfoOutput(routeKey: RouteKey, input: Record<string, unknown>): RouteOutput {
  const config = getMissingInfoConfig(routeKey, input);

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

const missingFieldCopy: Record<string, MissingInfoConfig> = {
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
    return directions.every((direction) =>
      isRecord(direction) && claimsAreGrounded(direction.basisFromUserMaterial, {
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
    return (
      claimsAreGrounded(routeResult.jdKeyRequirements, {
        jdTextOrRequirements: input.jdTextOrRequirements,
      }) &&
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
