import type { RouteOutput } from "@/domain/types";
import {
  jdMappingCandidateSchema,
  type JdMappingCandidate,
} from "@/schemas/jd-mapping-candidate";

type JdRouteInput = {
  targetJobTitle: string;
  jdTextOrRequirements: string;
  userMaterial: string;
  currentQuestion?: string;
};

type EvidenceItem = { id: string; quote: string };

export type JdEvidenceCatalog = {
  requirements: EvidenceItem[];
  materials: EvidenceItem[];
};

export function buildJdEvidenceCatalog(input: JdRouteInput): JdEvidenceCatalog {
  return {
    requirements: splitExactEvidence(input.jdTextOrRequirements, "req"),
    materials: splitExactEvidence(input.userMaterial, "mat"),
  };
}

export function assembleJdRouteOutput(
  input: JdRouteInput,
  rawCandidate: JdMappingCandidate,
): RouteOutput {
  const candidate = jdMappingCandidateSchema.parse(rawCandidate);
  const catalog = buildJdEvidenceCatalog(input);
  const mappings = candidate.mappings.flatMap((mapping) => {
    const requirement = catalog.requirements.find((item) => item.id === mapping.requirementId);
    const material = mapping.materialId === null
      ? undefined
      : catalog.materials.find((item) => item.id === mapping.materialId);
    if (!requirement || (mapping.materialId !== null && !material)) return [];
    return [{ mapping, requirement, material }];
  });
  if (mappings.length === 0) throw new Error("JD mapping does not reference known evidence IDs");

  const requirements = uniqueQuotes(mappings.map((item) => item.requirement.quote));
  const materials = uniqueQuotes(mappings.flatMap((item) => item.material?.quote ?? []));
  const firstSupported = mappings.find((item) => item.material)?.material;
  const revisionTarget = firstSupported?.quote ?? catalog.materials[0]?.quote;
  if (!revisionTarget) throw new Error("JD route requires an exact material revision target");

  const safeMapping = mappings.find(({ mapping, material }) =>
    mapping.candidate !== null
      && material !== undefined
      && isCandidateGrounded(mapping.candidate, material.quote)
  );
  const candidateRevision = safeMapping?.mapping.candidate ?? null;
  const risks = uniqueQuotes([
    ...mappings.flatMap((item) => item.mapping.risk ?? []),
    ...detectExplicitEvidenceGaps(input.jdTextOrRequirements, input.userMaterial),
  ]);
  const unclearFromMaterial = risks.length > 0
    ? risks.slice(0, 5)
    : ["仍需打开原始交付物核对材料中的动作和结果。"];
  const evidenceCheck = `打开“${compact(revisionTarget, 42)}”对应的原始文档、截图、数据记录或上线版本，逐项核对动作、数字和交付物；没有证据的要求标记为“证据不足”。`;

  return {
    routeKey: "jd_to_revision",
    outputType: "route_result",
    shortAssessment: candidateRevision
      ? "可以先核对一处有材料支撑的候选句；其余岗位要求仍需补证。"
      : "仍需核对这处材料的原始证据，暂不改写。",
    routeResult: {
      jdKeyRequirements: requirements.slice(0, 5),
      supportedByMaterial: materials.slice(0, 5),
      unclearFromMaterial,
      minimalRevisionActions: candidateRevision
        ? ["只替换这一处材料原句；保留可核对的动作、数字和角色边界。"]
        : ["暂不改写；记录“证据不足”，保留当前事实边界。"],
      afterSubmissionRecording: ["记录投递岗位、修改前原句、修改后原句和本次材料版本。"],
      revisionTarget,
      candidateRevision,
      evidenceCheck,
    },
    missingInfo: null,
    todayAction: {
      actionTitle: candidateRevision ? "核对并替换 1 处材料原句" : "核对 1 处材料原句的证据",
      actionReason: "先完成一处有证据边界的修改，避免把岗位要求写成没有发生过的经历。",
      actionSteps: candidateRevision
        ? [evidenceCheck, "对照候选句，只保留原始材料能证明的内容", "保存修改前后两版"]
        : [evidenceCheck, "找到证据就记录原句；找不到就保留原文并标记证据不足"],
      estimatedTime: "15-30 分钟",
      recordAfterDone: "记录修改前原句、修改后原句、对应岗位要求和是否已投递。",
      completionStandard: candidateRevision
        ? "已保存 1 组可逐字对照的修改前后文本，并能指出每个动作和数字的原始证据。"
        : "已保存 1 条证据核对结果，或明确记录“证据不足，暂不改材料”。",
      actionType: "jd_revision",
    },
    recordGuide: {
      recordType: "jd_compare",
      fieldsToRecord: ["targetJobTitle", "beforeSnippet", "afterSnippet", "jdRequirement", "submitted"],
      requiresUserConfirmation: true,
    },
  };
}

function splitExactEvidence(value: string, prefix: "req" | "mat"): EvidenceItem[] {
  const lines = value
    .split(prefix === "req" ? /\r?\n+|[；;]/ : /\r?\n+/)
    .map((item) => item.replace(/^\s*(?:[-*•]|\d+[.)、])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 5);
  const quotes = lines.length > 0 ? lines : [value.trim()].filter(Boolean);
  return quotes.map((quote, index) => ({ id: `${prefix}-${index + 1}`, quote }));
}

function uniqueQuotes(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function compact(value: string, max: number): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max)}…`;
}

function isCandidateGrounded(candidate: string, evidence: string): boolean {
  const unsupportedRoleClaims = ["主导", "负责", "独立完成", "协同研发设计", "跨团队协作"];
  if (unsupportedRoleClaims.some((claim) => candidate.includes(claim) && !evidence.includes(claim))) {
    return false;
  }
  const unsupportedScaleClaims = [
    /(?:覆盖|服务|触达|拥有)?\s*(?:数[十百千万]|\d+(?:\.\d+)?万?\+?)\s*名?用户/,
    /迭代(?:了)?\s*(?:数次|\d+\s*次)/,
  ];
  if (unsupportedScaleClaims.some((claim) => claim.test(candidate) && !claim.test(evidence))) {
    return false;
  }
  const protectedTerms = ["Office", "SQL", "Python", "Tableau", "Power BI", "PRD"];
  if (protectedTerms.some((term) => candidate.toLowerCase().includes(term.toLowerCase())
    && !evidence.toLowerCase().includes(term.toLowerCase()))) {
    return false;
  }
  const candidateNumbers = candidate.match(/\d+(?:\.\d+)?%?|\d+\+?/g) ?? [];
  return candidateNumbers.every((number) => evidence.includes(number));
}

function detectExplicitEvidenceGaps(jd: string, material: string): string[] {
  const gaps: string[] = [];
  if (/Office|数据分析工具/i.test(jd) && !/Office|SQL|Python|Tableau|Power\s*BI/i.test(material)) {
    gaps.push("材料未提供 Office 或主流数据分析工具的使用证据，不能补写工具经验。");
  }
  if (/PRD/i.test(jd) && !/PRD/i.test(material)) {
    gaps.push("材料未提供 PRD 交付物证据，不能把产品全流程直接写成产出 PRD。");
  }
  if (/协同研发设计|跨团队/i.test(jd) && !/协同研发设计|跨团队/i.test(material)) {
    gaps.push("材料未提供跨团队协同研发设计的事实，不能推断协作角色。");
  }
  return gaps;
}
