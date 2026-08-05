import type { RouteOutput } from "@/domain/types";
import { scanRouteSafety } from "@/domain/safety";

type ValidationResult = {
  passed: boolean;
  issues: string[];
};

const MULTI_TASK_PATTERNS = [/three .*tasks/i, /full resume/i, /apply to \d+/i, /投递\s*\d+/];
const REPORT_FALLBACK_PATTERNS = [/基础版.*报告|完整.*报告|求职分析报告|reportTitle|sections/i];
const REPORT_FIELD_NAMES = ["reportTitle", "sections", "basicReport", "fallbackReport"];
const VAGUE_ACTION_PATTERNS = [
  /全面提升|提升竞争力|增强.*优势|继续优化|完善简历|提升表达/,
  /optimi[sz]e|improve|enhance.*competitiveness/i,
];
const CONCRETE_STEP_PATTERNS = [/保存|记录|复制|找到|打开|列出|标出|补|删|圈出|选择|填写|确认|搜索/];
const ABSTRACT_JD_EDIT_PATTERN = /补(?:充)?(?:一句|一条|1\s*(?:句|条))?(?:真实)?(?:动作|经历|表达)|对照.{0,16}要求(?:补|改)|修改一处|最小修改/;
const UNCERTAINTY_MARKERS = /可能|待验证|需验证|尚不确定|无法确认|不能确认/;
const NEGATED_POSSIBILITY_MARKERS = /不可能|绝无可能|没有可能|不太可能/;

export function validateRouteOutput(output: RouteOutput): ValidationResult {
  const issues: string[] = [];
  const action = output.todayAction;

  if (!action.actionTitle || !action.actionReason || !action.recordAfterDone) {
    issues.push("今日行动字段不完整");
  }
  if (output.outputType !== "friendly_failure" && !action.completionStandard?.trim()) {
    issues.push("今日行动必须写清可观察的完成标准");
  }

  const actionText = [action.actionTitle, action.actionReason, ...action.actionSteps].join(" ");
  if (MULTI_TASK_PATTERNS.some((pattern) => pattern.test(actionText))) {
    issues.push("今日行动不能拆成多个并列任务");
  }

  const outputText = JSON.stringify(output);
  if (REPORT_FALLBACK_PATTERNS.some((pattern) => pattern.test(outputText))) {
    issues.push("第一版 MVP 不生成基础版报告或完整报告");
  }

  if (output.routeResult && REPORT_FIELD_NAMES.some((field) => Object.hasOwn(output.routeResult ?? {}, field))) {
    issues.push("第一版 MVP 不生成基础版报告或完整报告");
  }

  if (
    VAGUE_ACTION_PATTERNS.some((pattern) => pattern.test(actionText)) &&
    action.actionSteps.every((step) => !CONCRETE_STEP_PATTERNS.some((pattern) => pattern.test(step)))
  ) {
    issues.push("今日行动过于空泛，必须能被用户直接执行和记录");
  }

  if (output.outputType === "light_review" && !hasLightReviewBlocks(output.routeResult)) {
    issues.push("轻复盘必须包含复盘依据、线索、信息缺口和下一步行动");
  }

  if (output.outputType === "route_result") {
    issues.push(...validateRouteResultShape(output));
  }

  if (output.outputType !== "friendly_failure" && !/15\s*-\s*30|15-30/.test(action.estimatedTime)) {
    issues.push("今日行动预计时间应优先为 15-30 分钟");
  }

  const safety = scanRouteSafety(output.routeKey, output);
  issues.push(...safety.blockedReasons);

  return {
    passed: issues.length === 0,
    issues,
  };
}

function validateRouteResultShape(output: RouteOutput): string[] {
  const result = output.routeResult;
  if (!result) return ["路线输出必须包含对应路线结果"];

  if (output.routeKey === "direction_to_jobs") {
    const directions = result.explorableDirections;
    if (!Array.isArray(directions) || directions.length < 2 || directions.length > 3) {
      return ["方向路线必须包含可探索方向和搜索关键词"];
    }

    const validDirections = directions.every((direction) => {
      if (!isRecord(direction)) return false;
      return (
        hasText(direction.directionName) &&
        hasStringArray(direction.searchKeywords, 3, 5) &&
        hasStringArray(direction.basisFromUserMaterial, 1, 5) &&
        hasText(direction.riskOrGap)
      );
    });
    return validDirections ? [] : ["方向路线必须包含可探索方向和搜索关键词"];
  }

  if (output.routeKey === "experience_to_resume") {
    return hasStringArray(result.confirmedFacts, 1, 5) &&
      hasStringArray(result.missingFacts, 1, 5) &&
      hasStringArray(result.doNotExaggerate, 1, 5) &&
      hasText(result.resumeSnippetDraft) &&
      hasStringArray(result.supportingFacts, 1, 5)
      ? []
      : ["经历路线必须包含事实、缺口、克制边界和事实支撑"];
  }

  if (output.routeKey === "jd_to_revision") {
    if (!("decision" in result)) {
      const hasLegacyClarityContract = hasText(result.revisionTarget) &&
        Object.hasOwn(result, "candidateRevision") &&
        (result.candidateRevision === null || hasText(result.candidateRevision)) &&
        hasText(result.evidenceCheck);
      const hasLegacyAbstractEditWithoutTarget = ABSTRACT_JD_EDIT_PATTERN.test([
        output.todayAction.actionTitle,
        ...output.todayAction.actionSteps,
      ].join(" ")) && !hasText(result.revisionTarget);
      const hasLegacyUnsupportedCandidate = Array.isArray(result.supportedByMaterial) &&
        result.supportedByMaterial.length === 0 &&
        result.candidateRevision !== null;
      return hasStringArray(result.jdKeyRequirements, 1, 5) &&
        hasStringArray(result.supportedByMaterial, 0, 5) &&
        hasStringArray(result.unclearFromMaterial, 1, 5) &&
        hasStringArray(result.minimalRevisionActions, 1, 2) &&
        hasStringArray(result.afterSubmissionRecording, 1, 3) &&
        hasLegacyClarityContract &&
        !hasLegacyAbstractEditWithoutTarget &&
        !hasLegacyUnsupportedCandidate
        ? []
        : ["JD 路线必须包含明确编辑对象、证据核对、候选文本边界和完成标准"];
    }
    const decision = result.decision;
    const modifications = Array.isArray(result.modifications) ? result.modifications : [];
    const groundedModifications = modifications.every((item) =>
      isRecord(item)
      && hasText(item.requirementQuote)
      && hasStringArray(item.materialQuotes, 1, 3)
      && hasText(item.revisionTarget)
      && hasText(item.candidateRevision)
      && hasText(item.reason)
    );
    const hasClarityContract = decision === "modify"
      ? modifications.length >= 1
        && modifications.length <= 2
        && groundedModifications
        && hasText(result.revisionTarget)
        && hasText(result.candidateRevision)
        && hasText(result.evidenceCheck)
      : decision === "collect_evidence"
        ? modifications.length === 0
          && result.candidateRevision === null
          && hasText(result.evidenceRequest)
        : decision === "all_keep"
          && modifications.length === 0
          && result.candidateRevision === null
          && result.evidenceRequest === null
          && hasStringArray(result.requirementsChecked, 3, 5);
    const hasAbstractEditWithoutTarget = ABSTRACT_JD_EDIT_PATTERN.test([
      output.todayAction.actionTitle,
      ...output.todayAction.actionSteps,
    ].join(" ")) && !hasText(result.revisionTarget);
    const hasUnsupportedCandidate = Array.isArray(result.supportedByMaterial) &&
      result.supportedByMaterial.length === 0 &&
      result.candidateRevision !== null;
    return hasStringArray(result.requirementsChecked, 1, 5) &&
      hasStringArray(result.jdKeyRequirements, 1, 5) &&
      hasStringArray(result.supportedByMaterial, 0, 5) &&
      hasStringArray(result.unclearFromMaterial, 0, 5) &&
      hasStringArray(result.minimalRevisionActions, 0, 2) &&
      hasStringArray(result.afterSubmissionRecording, 1, 3) &&
      hasClarityContract &&
      !hasAbstractEditWithoutTarget &&
      !hasUnsupportedCandidate
      ? []
      : ["JD 路线必须包含明确编辑对象、证据核对、候选文本边界和完成标准"];
  }

  if (output.routeKey === "applications_to_review") {
    return hasStringArray(result.reviewBasis, 1, 3) &&
      hasText(result.recordSufficiency) &&
      hasUncertainStringArray(result.possibleClues, 1, 3) &&
      hasStringArray(result.informationGaps, 1, 3) &&
      hasText(result.nextValidationAction)
      ? []
      : ["投递复盘路线必须包含复盘依据、线索、信息缺口和下一轮动作"];
  }

  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasLightReviewBlocks(routeResult: RouteOutput["routeResult"]): boolean {
  if (!routeResult) {
    return false;
  }

  return (
    hasStringArray(routeResult.reviewBasis, 1, 3) &&
    hasStringArray(routeResult.clues, 1, 3) &&
    hasStringArray(routeResult.missingInfo, 1, 3) &&
    typeof routeResult.nextAction === "string" &&
    routeResult.nextAction.trim().length > 0
  );
}

function hasStringArray(value: unknown, min: number, max: number): boolean {
  return (
    Array.isArray(value) &&
    value.length >= min &&
    value.length <= max &&
    value.every((item) => typeof item === "string" && item.trim().length > 0)
  );
}

function hasUncertainStringArray(value: unknown, min: number, max: number): boolean {
  return (
    Array.isArray(value) &&
    hasStringArray(value, min, max) &&
    value.every(
      (item: unknown) =>
        typeof item === "string" &&
        !NEGATED_POSSIBILITY_MARKERS.test(item) &&
        UNCERTAINTY_MARKERS.test(item),
    )
  );
}
