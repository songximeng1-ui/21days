import type { RouteKey, RouteOutput } from "@/domain/types";

export type SourceRef = {
  sourceType: "user_input" | "confirmed_record";
  path: string;
  quote: string;
  recordId?: string;
  recordVersion?: number;
};

export type ClaimProvenance = {
  kind: "fact" | "inference";
  sources: SourceRef[];
  derivedFromClaims?: string[];
};

export type OutputProvenance = Record<string, ClaimProvenance>;

type ProvenanceResult =
  | { ok: true; output: RouteOutput }
  | { ok: false; unsupportedPath: string };

type TextLeaf = { path: string; value: string };
type SourceText = { path: string; text: string };

const FACT_PATHS: Record<RouteKey, RegExp> = {
  direction_to_jobs: /^routeResult\.explorableDirections\.\d+\.basisFromUserMaterial\.\d+$/,
  experience_to_resume:
    /^routeResult\.(?:confirmedFacts|supportingFacts)\.\d+$|^routeResult\.resumeSnippetDraft$/,
  jd_to_revision:
    /^routeResult\.(?:jdKeyRequirements|supportedByMaterial)\.\d+$/,
  applications_to_review: /^routeResult\.reviewBasis\.\d+$/,
};

const FACT_TOOL_MARKERS = [
  "Python",
  "Excel",
  "SQL",
  "Tableau",
  "Salesforce",
  "Power BI",
  "Google Sheets",
  "Notion",
  "Figma",
  "Photoshop",
  "Premiere",
  "飞书",
  "钉钉",
  "Canva",
  "SPSS",
  "MATLAB",
];

const FACTUAL_ASSERTION =
  /(?:用户|候选人|求职者|本人|我|[A-Za-z0-9\u4e00-\u9fff]{1,20}(?:公司|大学|学院|学校)).{0,16}(?:拥有|具备|曾经|缺乏|明确要求|明确偏好|只接受|毕业于|就读于|工作了|完成了|有.{0,8}经验|没有.{0,12}经验)|反馈(?:为|是)|(?:实现|达成|带来|降低|节省|转化|增长|提升|获得|获奖)了/;

const NON_FACTUAL_WARNING =
  /不要|不得|不能|未确认|未保存|缺少|仍缺|不添加|不补写|不声称|不做|还看不出|无法确认|不确定|待验证|需验证|可能/;

const STRUCTURAL_TOKENS = new Set([
  "参与",
  "协助",
  "使用",
  "进行",
  "相关",
  "工作",
  "实际",
  "完成",
  "最终",
  "本次",
  "这次",
  "一项",
  "一个",
  "一份",
  "等",
  "以及",
  "并且",
  "其中",
  "工具",
  "交付物",
  "交付",
  "结果",
  "材料",
  "内容",
  "保留",
  "边界",
]);

export function attachOutputProvenance(
  output: RouteOutput,
  input: Record<string, unknown>,
  sourceType: SourceRef["sourceType"] = "user_input",
): ProvenanceResult {
  const recordMetadata =
    sourceType === "confirmed_record"
      ? {
          recordId: typeof input.id === "string" ? input.id : undefined,
          recordVersion: typeof input.version === "number" ? input.version : undefined,
        }
      : {};
  const sources = collectSourceRefs(input, sourceType, "", recordMetadata);
  const sourceTexts = collectSafeSourceTextEntries(input);
  const visibleLeaves = [
    ...collectTextLeaves(output.shortAssessment, "shortAssessment"),
    ...collectTextLeaves(output.routeResult, "routeResult"),
    ...collectTextLeaves(output.missingInfo, "missingInfo"),
    ...collectTextLeaves(output.todayAction, "todayAction"),
    ...collectTextLeaves(output.recordGuide, "recordGuide"),
  ];

  if (visibleLeaves.length === 0) {
    return { ok: true, output: { ...output, provenance: {} } };
  }
  const provenance: OutputProvenance = {};
  const missingFieldPaths =
    output.outputType === "missing_info"
      ? visibleLeaves
          .filter((leaf) => /^missingInfo\.missingFields\.\d+$/.test(leaf.path))
          .map((leaf) => leaf.path)
      : [];
  const factPaths = visibleLeaves
    .filter((leaf) =>
      missingFieldPaths.includes(leaf.path) || claimKind(leaf, output) === "fact",
    )
    .map((leaf) => leaf.path);
  const routeDerivedClaimPaths =
    factPaths.length > 0 ? factPaths : collectVerifiableInputStateClaims(input);
  for (const leaf of visibleLeaves) {
    const missingFieldIndex = missingFieldPaths.indexOf(leaf.path);
    const isObservedMissingField = missingFieldIndex >= 0;
    const kind = isObservedMissingField ? "fact" : claimKind(leaf, output);
    const derivedClaimPaths =
      kind === "inference"
        ? findDerivedClaimPaths(leaf.path, routeDerivedClaimPaths)
        : [];
    const supportingPaths =
      kind === "fact" && !isObservedMissingField
        ? findSupportingSourcePaths(leaf.value, sourceTexts, leaf.path)
        : [];
    const observedMissingSource =
      isObservedMissingField
        ? [{
            sourceType: "user_input" as const,
            path: observedMissingInputPath(output, missingFieldIndex),
            quote: "未提供",
          }]
        : [];
    if (kind === "fact" && supportingPaths.length === 0 && !isObservedMissingField) {
      return { ok: false, unsupportedPath: leaf.path };
    }
    if (kind === "inference" && derivedClaimPaths.length === 0) {
      return { ok: false, unsupportedPath: leaf.path };
    }
    const matchingSources = isObservedMissingField
      ? observedMissingSource
      : sources
          .filter((source) => supportingPaths.includes(source.path))
          .map((source) => ({
            ...source,
            quote: getEvidenceQuote(
              sourceTexts.find((entry) => entry.path === source.path)?.text ?? source.quote,
              leaf.value,
            ),
          }));
    provenance[leaf.path] = {
      kind,
      sources: matchingSources,
      ...(kind === "fact" ? {} : { derivedFromClaims: derivedClaimPaths }),
    };
  }

  return { ok: true, output: { ...output, provenance } };
}

function observedMissingInputPath(output: RouteOutput, missingFieldIndex: number): string {
  const field =
    output.recordGuide.fieldsToRecord[missingFieldIndex] ??
    output.recordGuide.fieldsToRecord[0] ??
    "input";
  if (output.routeKey !== "applications_to_review") return field;
  const isSecondApplication = field.endsWith("2");
  const normalizedField = isSecondApplication ? field.slice(0, -1) : field;
  return `applications.${isSecondApplication ? 1 : 0}.${normalizedField}`;
}

function atomicFactsAreGrounded(value: string, sourceValue: string): boolean {
  const atomicFacts = collectAtomicFacts(value);
  const normalizedSource = normalizeAtomicFact(sourceValue);
  return atomicFacts.every((fact) =>
    normalizedSource.includes(normalizeAtomicFact(fact)),
  );
}

function claimKind(
  leaf: TextLeaf,
  output: RouteOutput,
): ClaimProvenance["kind"] {
  if (FACT_PATHS[output.routeKey].test(leaf.path)) return "fact";
  if (/^missingInfo\.alreadyKnown\.\d+$/.test(leaf.path)) {
    return /[：:]/.test(leaf.value) ? "fact" : "inference";
  }
  if (isStructuralMetadata(leaf.path)) return "inference";
  if (isSensitiveAttributeAssertion(leaf.value)) return "fact";
  if (isExplicitlyNonFactual(leaf.value)) return "inference";
  if (hasAdvisoryFraming(leaf.path, leaf.value)) return "inference";
  if (isPositiveFactualAssertion(leaf.value)) return "fact";
  if (isExplicitInferenceContext(leaf.path)) return "inference";
  return "fact";
}

function isSensitiveAttributeAssertion(value: string): boolean {
  return /(?:偏好|只接受|要求).{0,12}(?:985|211|院校|名校|党员|学历|户籍|性别|男性|女性|婚育|年龄|身高)/.test(
    value,
  );
}

function isStructuralMetadata(path: string): boolean {
  return (
    path === "todayAction.estimatedTime" ||
    path === "todayAction.actionType" ||
    path.startsWith("recordGuide.")
  );
}

function isExplicitInferenceContext(path: string): boolean {
  return (
    /^routeResult\.explorableDirections\.\d+\.(?:directionName|searchKeywords\.\d+|riskOrGap|validationFocus)$/.test(path) ||
    /^routeResult\.(?:missingFacts|doNotExaggerate|unclearFromMaterial|minimalRevisionActions|afterSubmissionRecording|possibleClues|informationGaps)\.\d+$/.test(path) ||
    /^routeResult\.(?:nextValidationAction|nextAction)$/.test(path) ||
    path === "routeResult.recordSufficiency" ||
    /^routeResult\.(?:clues|missingInfo)\.\d+$/.test(path) ||
    path === "todayAction.actionTitle" ||
    path.startsWith("todayAction.actionSteps.") ||
    path === "todayAction.recordAfterDone" ||
    path.startsWith("missingInfo.")
  );
}

function findDerivedClaimPaths(path: string, routeClaims: string[]): string[] {
  const directionItem = path.match(/^routeResult\.explorableDirections\.(\d+)\./);
  if (!directionItem) return routeClaims;
  const sameItemPrefix =
    `routeResult.explorableDirections.${directionItem[1]}.basisFromUserMaterial.`;
  return routeClaims.filter((claimPath) => claimPath.startsWith(sameItemPrefix));
}

function collectVerifiableInputStateClaims(value: unknown, path = "input"): string[] {
  if (typeof value !== "object" || value === null) return [path];
  if (Array.isArray(value)) {
    return value.length === 0
      ? [path]
      : value.flatMap((item, index) =>
          collectVerifiableInputStateClaims(item, `${path}.${index}`),
        );
  }
  const entries = Object.entries(value);
  return entries.length === 0
    ? path === "input" ? [] : [path]
    : entries.flatMap(([key, child]) =>
        collectVerifiableInputStateClaims(child, `${path}.${key}`),
      );
}

function isPositiveFactualAssertion(value: string): boolean {
  const text = value.trim();
  return (
    FACTUAL_ASSERTION.test(text) ||
    /\b(?:has|have|had|owns?|possesses?|used|uses|completed?|achieved?|increased?|reduced?|built|created|analy[sz]ed|organized|submitted|worked|graduated|requires?|required|prefers?)\b/i.test(text) ||
    /拥有|具备|曾经|已经完成|已完成|使用了|曾使用|毕业于|就读于|工作于|明确要求|明确偏好|只接受/.test(text)
  );
}

function isExplicitlyNonFactual(value: string): boolean {
  return (
    NON_FACTUAL_WARNING.test(value.trim()) ||
    /\b(?:may|might|could|possibly|unclear|unknown|missing|not confirmed|needs? verification|should|recommend|next step|do not|don't|cannot|can't|no grounded|not available|unavailable)\b/i.test(
      value,
    ) ||
    /^(?:Compare|Review|Check|Use|Open|Save|Record|Return|Try|Validate)\b/i.test(value.trim()) ||
    /可能|也许|尚不清楚|不确定|未确认|待验证|需验证|缺少|还缺|不要|不得|不能|未具备|不改写|只支撑|差距|建议|下一步|下一次|可以先|能够?先|能先|能让|先把|先用|先让|再补|就能|适合/.test(
      value,
    )
  );
}

function hasAdvisoryFraming(path: string, value: string): boolean {
  if (path !== "shortAssessment" && path !== "todayAction.actionReason") {
    return false;
  }
  return /先|才(?:能|好|适合)|后面|当前|这里|值得|更(?:可靠|主动|贴近|适合|清楚)|改为|调整为|为了|以便/.test(value);
}

function findSupportingSourcePaths(
  value: string,
  sourceTexts: SourceText[],
  outputPath = "",
): string[] {
  const groundedValue =
    /^missingInfo\.alreadyKnown\.\d+$/.test(outputPath)
      ? value.split(/[：:]/).slice(1).join(":").trim() || value
      : value;
  const matchedPaths = new Set<string>();
  for (const unit of collectGroundingUnits(groundedValue)) {
    const matching = sourceTexts.filter(({ text }) => sourceSupportsUnit(unit, text));
    if (matching.length === 0) return [];
    for (const source of matching) {
      matchedPaths.add(source.path);
    }
  }
  return [...matchedPaths];
}

function collectGroundingUnits(value: string): string[] {
  const units = value
    .split(/[；;。，,\n\r]+/)
    .map((unit) => unit.trim())
    .filter(Boolean);
  return units.length > 0 ? units : [value.trim()];
}

function sourceSupportsUnit(unit: string, source: string): boolean {
  if (!unit || !atomicFactsAreGrounded(unit, source)) return false;

  const normalizedUnit = normalizeAtomicFact(unit);
  const normalizedSource = normalizeAtomicFact(source);
  if (normalizedSource.includes(normalizedUnit)) return true;

  const contentTokens = extractContentTokens(unit);
  return (
    contentTokens.length > 0 &&
    contentTokens.every((token) => sourceContainsToken(source, token))
  );
}

function sourceContainsToken(source: string, token: string): boolean {
  if (/^[A-Za-z0-9]+$/.test(token)) {
    const normalizedSource = normalizeAtomicFact(source);
    if (
      FACT_TOOL_MARKERS.some(
        (tool) =>
          normalizeAtomicFact(tool).includes(normalizeAtomicFact(token)) &&
          normalizedSource.includes(normalizeAtomicFact(tool)),
      )
    ) {
      return true;
    }
    return new RegExp(`\\b${escapeRegExp(token)}\\b`, "i").test(source);
  }
  return normalizeAtomicFact(source).includes(normalizeAtomicFact(token));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getEvidenceQuote(source: string, claim: string): string {
  const supportingUnit =
    collectGroundingUnits(claim).find((unit) => sourceSupportsUnit(unit, source)) ??
    claim.trim();
  const exactIndex = source.toLocaleLowerCase().indexOf(supportingUnit.toLocaleLowerCase());
  if (exactIndex >= 0) return source.slice(exactIndex, exactIndex + 12);

  const evidenceTokens = [
    ...collectAtomicFacts(supportingUnit),
    ...extractContentTokens(supportingUnit),
  ].sort((left, right) => right.length - left.length);
  for (const token of evidenceTokens) {
    const tokenIndex = source.toLocaleLowerCase().indexOf(token.toLocaleLowerCase());
    if (tokenIndex >= 0) return source.slice(tokenIndex, tokenIndex + 12);
  }
  return source.slice(0, 12);
}

function extractContentTokens(value: string): string[] {
  const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
  return [...segmenter.segment(value)]
    .filter((segment) => segment.isWordLike)
    .map((segment) => segment.segment.trim())
    .filter((token) => {
      if (!token || STRUCTURAL_TOKENS.has(token)) return false;
      if (/^\d+(?:\.\d+)?%?$/.test(token)) return false;
      if (/^[\p{Script=Han}]$/u.test(token)) return false;
      return true;
    });
}

function normalizeAtomicFact(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s、，,。；;:：·._/-]+/g, "");
}

function collectAtomicFacts(value: string): string[] {
  const facts = new Set<string>();

  for (const match of value.matchAll(/\d+(?:\.\d+)?%?/g)) {
    facts.add(match[0]);
  }
  for (const match of value.matchAll(/[\p{Script=Han}A-Za-z0-9]{1,18}\s*(?:公司|大学|学院|学校)/gu)) {
    facts.add(
      match[0]
        .replace(/^(?:在|对|向|从|就读于|毕业于|来自|协助|帮助|参与)/, "")
        .trim(),
    );
  }
  for (const tool of FACT_TOOL_MARKERS) {
    if (value.toLocaleLowerCase().includes(tool.toLocaleLowerCase())) facts.add(tool);
  }
  for (const marker of ["985", "211", "双一流", "奖学金", "硕士", "博士"]) {
    if (value.includes(marker)) facts.add(marker);
  }
  for (const marker of [
    "名校",
    "院校",
    "学历",
    "户籍",
    "本地",
    "男性",
    "女性",
    "性别",
    "党员",
    "婚育",
    "年龄",
    "身高",
  ]) {
    if (value.includes(marker)) facts.add(marker);
  }
  for (const marker of ["推动", "提升", "增长", "获奖", "获得"]) {
    if (value.includes(marker)) facts.add(marker);
  }

  return [...facts];
}

function collectSourceRefs(
  value: unknown,
  sourceType: SourceRef["sourceType"],
  path = "",
  recordMetadata: Partial<Pick<SourceRef, "recordId" | "recordVersion">> = {},
): SourceRef[] {
  if (typeof value === "string" && value.trim()) {
    const quote = getSafeSourceQuote(value, path);
    return quote ? [{ sourceType, path, quote, ...recordMetadata }] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      collectSourceRefs(
        item,
        sourceType,
        path ? `${path}.${index}` : String(index),
        recordMetadata,
      ),
    );
  }
  if (isRecord(value)) {
    const nestedRecordMetadata =
      sourceType === "confirmed_record"
        ? {
            recordId:
              typeof value.id === "string" ? value.id : recordMetadata.recordId,
            recordVersion:
              typeof value.version === "number"
                ? value.version
                : recordMetadata.recordVersion,
          }
        : recordMetadata;
    return Object.entries(value)
      .filter(([key]) => !RECORD_METADATA_KEYS.has(key))
      .flatMap(([key, child]) =>
        collectSourceRefs(
          child,
          sourceType,
          path ? `${path}.${key}` : key,
          nestedRecordMetadata,
        ),
      );
  }
  return [];
}

const RECORD_METADATA_KEYS = new Set([
  "id",
  "version",
  "createdAt",
  "updatedAt",
  "completedAt",
  "status",
  "routeKey",
  "recordType",
  "userConfirmed",
]);

function getSafeSourceQuote(value: string, path: string): string | undefined {
  return getSafeSourceText(value, path)?.slice(0, 12);
}

function collectSafeSourceTextEntries(value: unknown, path = ""): SourceText[] {
  if (typeof value === "string" && value.trim()) {
    const safeText = getSafeSourceText(value, path);
    return safeText ? [{ path, text: safeText }] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      collectSafeSourceTextEntries(item, path ? `${path}.${index}` : String(index)),
    );
  }
  if (isRecord(value)) {
    return Object.entries(value)
      .filter(([key]) => !RECORD_METADATA_KEYS.has(key))
      .flatMap(([key, child]) =>
        collectSafeSourceTextEntries(child, path ? `${path}.${key}` : key),
      );
  }
  return [];
}

function getSafeSourceText(value: string, path: string): string | undefined {
  if (/(?:^|\.)currentQuestion$/i.test(path)) return undefined;

  const unsafeClause =
    /忽略|系统(?:提示|规则)|提示词|prompt|api.?key|token|密钥|身份证|手机号|随便写|编造|伪造|虚构|匹配度|录取概率|1[3-9]\d{9}|\d{17}[\dXx]|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/i;
  const clauses = value
    .split(/[；;。\n\r]/)
    .map((clause) => clause.trim())
    .filter(Boolean);
  const safeClauses = clauses.filter((clause) => !unsafeClause.test(clause));
  return safeClauses.length > 0 ? safeClauses.join("；") : undefined;
}

function collectTextLeaves(value: unknown, path: string): TextLeaf[] {
  if (typeof value === "string" && value.trim()) return [{ path, value }];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectTextLeaves(item, `${path}.${index}`));
  }
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, child]) =>
      collectTextLeaves(child, `${path}.${key}`),
    );
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
