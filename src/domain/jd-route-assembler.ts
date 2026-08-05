import type { RouteOutput } from "@/domain/types";
import {
  buildJdEvidenceCatalog,
  verifyExactSourceRef,
  type ExactSourceRef,
  type JdRouteInput,
} from "@/domain/jd-evidence-contract";
import {
  jdMappingCandidateSchema,
  type JdMappingCandidate,
  type JdMappingDecision,
} from "@/schemas/jd-mapping-candidate";
import { classifyJdMaterialEvidence, containsPromptInjection } from "@/domain/jd-action-clarity";

type JdModification = {
  requirementQuote: string;
  materialQuotes: string[];
  revisionTarget: string;
  candidateRevision: string;
  reason: string;
};

export { buildJdEvidenceCatalog } from "@/domain/jd-evidence-contract";
export type { JdEvidenceCatalog } from "@/domain/jd-evidence-contract";

export function assembleJdRouteOutput(
  input: JdRouteInput,
  rawCandidate: JdMappingCandidate,
): RouteOutput {
  const candidate = jdMappingCandidateSchema.parse(rawCandidate);
  const catalog = buildJdEvidenceCatalog(input);
  const requirementById = new Map(catalog.requirements.map((source) => [source.sourceId, source]));
  const materialById = new Map(catalog.materials.map((source) => [source.sourceId, source]));
  const requiredSelection = catalog.requirements.map((source) => source.sourceId);
  if (
    candidate.selectedRequirementIds.length !== requiredSelection.length
    || requiredSelection.some((id) => !candidate.selectedRequirementIds.includes(id))
  ) {
    throw new Error("JD decisions must completely cover the first 3-5 request requirements");
  }

  const resolved = candidate.decisions.map((decision) => resolveDecision(
    input,
    decision,
    requirementById,
    materialById,
  ));
  const safeModifications = resolved
    .filter((item): item is typeof item & { modification: JdModification } => item.modification !== null)
    .sort((left, right) => modificationScore(right.modification) - modificationScore(left.modification))
    .slice(0, 2)
    .map((item) => item.modification);
  const isStrictAllKeep = resolved.length >= 3
    && resolved.every(({ decision, relationSupported }) =>
      decision.disposition === "keep"
      && decision.relation === "direct"
      && relationSupported
    );
  const externalDecision = isStrictAllKeep
    ? "all_keep"
    : safeModifications.length > 0
      ? "modify"
      : "collect_evidence";
  const requirementsChecked = resolved.map(({ requirement }) => requirement.exactQuote);
  const evidenceGaps = uniqueStrings(resolved
    .filter(({ decision, modification, relationSupported }) => !relationSupported
      || decision.disposition === "collect_evidence" || (
      (decision.disposition === "replace" || decision.disposition === "insert") && !modification
    ))
    .map(({ requirement }) => `“${compact(requirement.exactQuote, 42)}”对应的实际动作、工具或结果`));
  if (
    !isStrictAllKeep
    && safeModifications.length === 0
    && resolved.every(({ decision }) => decision.disposition === "keep")
  ) {
    evidenceGaps.push("请提供完整 JD 或至少 3 条关键要求后再确认当前版本无需修改。");
  }
  const evidenceRequest = externalDecision === "all_keep"
    ? null
    : evidenceGaps.length > 0
      ? `补充或核对：${evidenceGaps.slice(0, 3).join("；")}`
      : null;
  const allReferencedMaterial = uniqueStrings(resolved.flatMap(({ materials }) =>
    materials
      .filter((source) => isRequestFactualEvidence(source.exactQuote))
      .map((source) => source.exactQuote)
  ));
  const firstModification = safeModifications[0];
  const evidenceCheck = firstModification
    ? `打开“${compact(firstModification.revisionTarget, 42)}”对应的原始文档、截图、数据记录或上线版本，逐项核对动作、数字、工具、角色和结果。`
    : "打开原始文档、截图、数据记录或上线版本；找不到来源就记录证据缺口，不改材料。";

  return {
    routeKey: "jd_to_revision",
    outputType: "route_result",
    shortAssessment: externalDecision === "modify"
      ? `已有 ${safeModifications.length} 处可核对的真实证据，今天只处理这些位置。`
      : externalDecision === "all_keep"
        ? "前 3–5 条岗位要求均有直接来源，当前版本不需要为了修改而修改。"
        : "当前没有安全的可改写位置，先补一项真实证据。",
    routeResult: {
      decision: externalDecision,
      requirementsChecked,
      modifications: safeModifications,
      evidenceRequest,
      afterSubmissionRecording: externalDecision === "all_keep"
        ? ["记录当前版本、投递状态和下一次要观察的反馈。"]
        : externalDecision === "collect_evidence"
          ? ["记录证据查找位置、核对结果，并回到输入页重新判断。"]
          : ["记录修改前原句、修改后原句、对应岗位要求、当前版本和是否已投递。"],

      // Compatibility display fields are derived only from the authoritative decisions above.
      jdKeyRequirements: requirementsChecked,
      supportedByMaterial: allReferencedMaterial,
      unclearFromMaterial: evidenceGaps,
      minimalRevisionActions: safeModifications.map((item) => `核对并修改“${compact(item.revisionTarget, 42)}”这一处。`),
      revisionTarget: firstModification?.revisionTarget,
      candidateRevision: firstModification?.candidateRevision ?? null,
      evidenceCheck,
    },
    missingInfo: null,
    todayAction: buildTodayAction(externalDecision, safeModifications, evidenceCheck, evidenceRequest),
    recordGuide: {
      recordType: "jd_compare",
      fieldsToRecord: externalDecision === "modify"
        ? ["targetJobTitle", "beforeSnippet", "afterSnippet", "jdRequirement", "submitted"]
        : externalDecision === "collect_evidence"
          ? ["targetJobTitle", "jdRequirement", "evidenceLocation", "evidenceResult"]
          : ["targetJobTitle", "materialVersion", "submitted", "observationPoint"],
      requiresUserConfirmation: true,
    },
  };
}

function resolveDecision(
  input: JdRouteInput,
  decision: JdMappingDecision,
  requirementById: Map<string, ExactSourceRef>,
  materialById: Map<string, ExactSourceRef>,
) {
  const requirement = requirementById.get(decision.requirementId);
  if (!requirement || !verifyExactSourceRef(input, requirement)) {
    throw new Error(`JD decision references unknown requirement source ID: ${decision.requirementId}`);
  }
  const materials = decision.evidenceIds.map((id) => {
    const source = materialById.get(id);
    if (!source || !verifyExactSourceRef(input, source)) {
      throw new Error(`JD decision references unknown material source ID: ${id}`);
    }
    return source;
  });
  for (const id of decision.conflictSourceIds ?? []) {
    const source = requirementById.get(id) ?? materialById.get(id);
    if (!source || !verifyExactSourceRef(input, source)) {
      throw new Error(`JD decision references unknown conflict source ID: ${id}`);
    }
  }
  const target = decision.revisionTargetId
    ? materialById.get(decision.revisionTargetId)
    : undefined;
  const factualMaterials = materials.filter(
    (source) => isRequestFactualEvidence(source.exactQuote),
  );
  const relationSupported = decision.relation !== "unsupported"
    && factualMaterials.some((source) => isJdRequirementEvidenceRelationSupported(
      requirement.exactQuote,
      source.exactQuote,
      decision.relation,
    ));
  const canModify = Boolean(
    decision.candidate
    && target
    && decision.candidate.trim() !== target.exactQuote.trim()
    && materials.some((source) => source.sourceId === target.sourceId)
    && factualMaterials.length > 0
    && relationSupported
    && isCandidateGrounded(
      decision.candidate,
      factualMaterials.map((source) => source.exactQuote).join("\n"),
    )
  );
  const modification: JdModification | null = canModify && decision.candidate && target
    ? {
        requirementQuote: requirement.exactQuote,
        materialQuotes: materials.map((source) => source.exactQuote),
        revisionTarget: target.exactQuote,
        candidateRevision: decision.candidate,
        reason: decision.relation === "direct"
          ? "岗位要求与材料中的逐字事实直接相关，候选句只重排或收紧已有内容。"
          : "材料只覆盖岗位要求的一部分，候选句仅保留有来源的已有事实。",
      }
    : null;
  return { decision, requirement, materials, modification, relationSupported };
}

function buildTodayAction(
  decision: "modify" | "collect_evidence" | "all_keep",
  modifications: JdModification[],
  evidenceCheck: string,
  evidenceRequest: string | null,
): RouteOutput["todayAction"] {
  if (decision === "all_keep") {
    return {
      actionTitle: "确认并保存当前版本",
      actionReason: "已检查的岗位要求都有直接来源，不需要为了凑修改而改写。",
      actionSteps: ["确认当前版本", "完成投递或记录已投递状态", "写下下一次要观察的反馈"],
      estimatedTime: "15-30 分钟",
      recordAfterDone: "记录当前版本、投递状态和观察点。",
      completionStandard: "已保存当前版本，并记录投递状态与一个可观察反馈。",
      actionType: "jd_revision",
    };
  }
  if (decision === "collect_evidence") {
    return {
      actionTitle: "补 1 项岗位要求的真实证据",
      actionReason: "当前没有可安全粘贴的修改句，先补来源再重新判断。",
      actionSteps: [evidenceRequest ?? evidenceCheck, "保存原始证据或明确记录未找到", "补充后重新提交判断"],
      estimatedTime: "15-30 分钟",
      recordAfterDone: "记录岗位要求、查找位置和证据结果。",
      completionStandard: "已保存 1 条原始证据，或明确记录证据缺口并重新提交。",
      actionType: "jd_revision",
    };
  }
  return {
    actionTitle: `核对并修改 ${modifications.length} 处材料`,
    actionReason: "只处理已有来源的高价值事实，不补写缺失经历。",
    actionSteps: [evidenceCheck, "逐字核对候选句中的动作、数字、工具、角色和结果", "确认后保存修改前后版本"],
    estimatedTime: "15-30 分钟",
    recordAfterDone: "记录修改前原句、修改后原句、对应岗位要求和是否已投递。",
    completionStandard: `已确认并保存 ${modifications.length} 组有来源的修改前后文本。`,
    actionType: "jd_revision",
  };
}

function isCandidateGrounded(candidate: string, evidence: string): boolean {
  if (containsPromptInjection(candidate) || containsPromptInjection(evidence)) return false;
  const normalizedEvidence = evidence.replace(/\s+/g, " ").trim().toLowerCase();
  const candidateClauses = candidate
    .split(/[；;。！？\n\r]+/)
    .map((clause) => clause.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);
  if (
    candidateClauses.length === 0
    || !candidateClauses.every((clause) => normalizedEvidence.includes(clause))
  ) return false;
  const protectedClaims = [
    "主导", "负责", "独立", "独立完成", "牵头", "统筹", "协同研发设计", "跨团队协作",
    "Office", "SQL", "Python", "Tableau", "Power BI", "PRD",
    "用户数", "迭代次数", "数万用户", "多轮迭代", "正式用户", "跨部门",
    "产品方案", "需求文档", "数据看板", "分析报告", "原型",
    "提升", "增长", "降低", "转化", "引流", "成交", "排名", "上线", "交付",
  ];
  const lowerEvidence = evidence.toLowerCase();
  if (protectedClaims.some((claim) =>
    candidate.toLowerCase().includes(claim.toLowerCase())
    && !lowerEvidence.includes(claim.toLowerCase())
  )) return false;
  const candidateNumbers = candidate.match(/\d+(?:\.\d+)?%?|\d+\+?/g) ?? [];
  if (!candidateNumbers.every((number) => evidence.includes(number))) return false;
  const candidateLatinClaims = candidate.match(/[A-Za-z][A-Za-z0-9+.#/-]*/g) ?? [];
  if (!candidateLatinClaims.every((claim) =>
    ["and", "to", "the"].includes(claim.toLowerCase())
    || lowerEvidence.includes(claim.toLowerCase())
  )) return false;
  const factualAtoms = [
    "分析", "复盘", "优化", "推进", "识别风险", "产出", "方案", "协同", "研发设计",
    "全生命周期", "需求", "调研", "设计", "测试", "运营", "直播", "维护", "接待",
  ];
  return factualAtoms.every((atom) => !candidate.includes(atom) || evidence.includes(atom));
}

function isRequestFactualEvidence(evidence: string): boolean {
  if (classifyJdMaterialEvidence(evidence) !== "direct") return false;
  if (containsPromptInjection(evidence)) return false;
  return /完成|做过|曾|整理|分析|复盘|记录|制作|编写|发布|编辑|运营|跟进|维护|接待|成交|引流|上线|交付|测试|设计|搭建|输出|收集|访谈|协助|参与|负责|主导|使用/.test(evidence);
}

const REQUIREMENT_ATOMS = [
  /内容|推文|公众号|抖音|直播|账号/,
  /发布/,
  /运营/,
  /编辑/,
  /选题/,
  /产品|MVP/,
  /全生命周期|全流程/,
  /体验/,
  /测试/,
  /上线/,
  /研发/,
  /设计|UX|UI/,
  /数据|metrics?/i,
  /分析|analy[sz]e/i,
  /复盘|review/i,
  /转化/,
  /引流/,
  /成交/,
  /排名/,
  /Office|Excel|SQL|Python|Tableau|Power\s*BI|数据工具|分析工具/i,
  /流程/,
  /梳理|整理/,
  /优化|改进|improve/i,
  /协同|协作|collaborat/i,
  /项目|MVP/,
  /推进|推动|ship/i,
  /风险|risk/i,
  /AI|Codex|人工智能/i,
  /PRD|需求文档/,
  /产品方案|方案/,
  /客户|客情/,
  /销售|接待/,
  /跟进/,
  /维护|运维|maintain/i,
  /交付/,
  /完成/,
] as const;

export function isJdRequirementEvidenceRelationSupported(
  requirement: string,
  evidence: string,
  relation: "direct" | "partial" | "unsupported",
): boolean {
  if (relation === "unsupported") return false;
  if (containsPromptInjection(requirement) || containsPromptInjection(evidence)) return false;
  if (relation === "direct" && !directSpecificClaimsAreSupported(requirement, evidence)) {
    return false;
  }
  const requirementConcepts = REQUIREMENT_ATOMS
    .map((pattern, index) => pattern.test(requirement) ? index : -1)
    .filter((index) => index >= 0);
  const evidenceConcepts = new Set(REQUIREMENT_ATOMS
    .map((pattern, index) => pattern.test(evidence) ? index : -1)
    .filter((index) => index >= 0));
  if (requirementConcepts.length > 0) {
    const overlappingAtoms = requirementConcepts.filter((concept) => evidenceConcepts.has(concept));
    return relation === "direct"
      ? requirementConcepts.every((concept) => evidenceConcepts.has(concept))
      : overlappingAtoms.some((concept) => !WEAK_PARTIAL_ATOMS.has(concept));
  }
  const requirementBigrams = significantBigrams(requirement);
  const evidenceBigrams = new Set(significantBigrams(evidence));
  const overlap = requirementBigrams.filter((bigram) => evidenceBigrams.has(bigram)).length;
  return relation === "direct"
    ? requirementBigrams.length > 0 && overlap / requirementBigrams.length >= 0.6
    : overlap > 0;
}

// A shared topic noun alone is not enough to justify a candidate rewrite.
// Partial support needs at least one action/tool/lifecycle/project atom.
const WEAK_PARTIAL_ATOMS = new Set([5, 12]);

const NAMED_TOOL_PATTERN = /Power\s*BI|Office|Excel|SQL|Python|Tableau/gi;
const ROLE_AND_STRENGTH_MARKERS = [
  "独立完成", "经验丰富", "丰富经验", "主导", "牵头", "统筹", "独立", "负责",
  "参与", "协助", "精通", "熟练", "擅长", "能够", "有能力",
] as const;

function directSpecificClaimsAreSupported(requirement: string, evidence: string): boolean {
  const evidenceTools = new Set(extractNamedTools(evidence));
  if (!extractNamedTools(requirement).every((tool) => evidenceTools.has(tool))) return false;

  const evidenceNumbers = new Set(extractClaimNumbers(evidence));
  if (!extractClaimNumbers(requirement).every((number) => evidenceNumbers.has(number))) return false;

  return ROLE_AND_STRENGTH_MARKERS.every((marker) =>
    !requirement.includes(marker) || evidence.includes(marker)
  );
}

function extractNamedTools(value: string): string[] {
  return uniqueStrings((value.match(NAMED_TOOL_PATTERN) ?? [])
    .map((tool) => tool.replace(/\s+/g, "").toLowerCase()));
}

function extractClaimNumbers(value: string): string[] {
  const normalized = value.replace(/\s+/g, "");
  const arabic = normalized.match(
    /\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?(?:[-–—~至]\d+(?:\.\d+)?)?(?:个月|小时|分钟|万\+?|%|年|月|周|天|日|秒|人|位|条|次|家|个|项|场|份|篇|单|所|名|户|例|款|组|轮|届|版|倍|\+)?(?:以上|以内|左右)?/g,
  ) ?? [];
  const chinese = normalized.match(
    /[零〇一二两三四五六七八九十百千万]+(?:个月|小时|分钟|年|月|周|天|日|秒|人|位|条|次|家|个|项|场|份|篇|单|所|名|户|例|款|组|轮|届|版|倍)(?:以上|以内|左右)?/g,
  ) ?? [];
  return uniqueStrings([...arabic, ...chinese]);
}

function significantBigrams(value: string): string[] {
  const normalized = value.replace(/[\s\p{P}\p{S}]/gu, "");
  const bigrams: string[] = [];
  for (let index = 0; index < normalized.length - 1; index += 1) {
    bigrams.push(normalized.slice(index, index + 2).toLowerCase());
  }
  return uniqueStrings(bigrams);
}

function modificationScore(modification: JdModification): number {
  const text = `${modification.candidateRevision}\n${modification.materialQuotes.join("\n")}`;
  const numbers = text.match(/\d+(?:\.\d+)?%?|\d+\+?/g)?.length ?? 0;
  const productFlow = /PM[\s\S]*UX[\s\S]*UI[\s\S]*研发[\s\S]*测试[\s\S]*上线/.test(text) ? 5 : 0;
  return Math.min(numbers, 5) + productFlow + modification.materialQuotes.join("").length / 10_000;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function compact(value: string, max: number): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max)}…`;
}
