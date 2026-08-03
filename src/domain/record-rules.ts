import { APPLICATION_RECORD_FIELDS } from "@/domain/route-contracts";

const APPLICATION_FIELDS = [
  ...APPLICATION_RECORD_FIELDS,
  "userSuspicion",
] as const;

const PLACEHOLDER_PREFIX = "(?:暂时还|目前还|暂时|目前|还|尚)?";
const PLACEHOLDER_STATE = "(?:不确定|不知道|不清楚|没有|没整理|未整理)";
const PLACEHOLDER_VALUE = new RegExp(
  `^(?:${PLACEHOLDER_PREFIX}${PLACEHOLDER_STATE}|暂无|无|无明确版本|unknown|not sure|none)[。.!！]?$`,
  "i",
);
const NO_CLEAR_APPLICATION_DETAIL = /^(?:无明确结果|no clear result)[。.!！]?$/i;

export function isApplicationRecordComplete(
  record: unknown,
): boolean {
  if (typeof record !== "object" || record === null) return false;
  const values = record as Record<string, unknown>;
  return APPLICATION_RECORD_FIELDS.every((field) => {
    const value = values[field];
    if (typeof value !== "string") return false;
    const cleaned = value.trim();
    if (!cleaned || PLACEHOLDER_VALUE.test(cleaned)) return false;
    return field !== "jdSummary" && field !== "materialVersion"
      ? true
      : !NO_CLEAR_APPLICATION_DETAIL.test(cleaned);
  });
}

export function splitApplicationRecordPayload(
  payload: Record<string, string>,
): Array<Record<string, string>> {
  return ["", "2"].flatMap((suffix) => {
    const record = Object.fromEntries(
      APPLICATION_FIELDS.map((field) => [
        field,
        payload[`${field}${suffix}`]?.trim() ?? "",
      ]),
    );
    return isApplicationRecordComplete(record) ? [record] : [];
  });
}

const RISKY_RESUME_FACTS = [
  /\d+(?:\.\d+)?%?/g,
  /Python|Excel|SQL|Tableau|Salesforce|Power BI|Google Sheets|Notion|Figma|Photoshop|Premiere|飞书|钉钉|Canva|SPSS|MATLAB/gi,
  /主导|独立负责|独立完成|增长|提升|降低|转化|获奖|获得[^，。；]{0,12}奖/g,
];
const RESUME_ACTION_VERBS = [
  "独立负责",
  "独立完成",
  "参与",
  "协助",
  "负责",
  "主导",
  "组织",
  "策划",
  "设计",
  "开发",
  "搭建",
  "撰写",
  "编写",
  "制作",
  "审核",
  "管理",
  "运营",
  "协调",
  "主持",
  "收集",
  "下载",
  "清洗",
  "分析",
  "解释",
  "发布",
  "上传",
  "复制",
  "合并",
  "去重",
  "沟通",
  "统计",
  "记录",
  "优化",
  "推动",
  "处理",
  "整理",
  "核对",
  "形成",
  "完成",
  "使用",
] as const;
const RESUME_NEUTRAL_WORDS = new Set(["的", "了", "并", "和", "及", "与", "将", "把", "信息"]);
const RESUME_WORD_SEGMENTER = new Intl.Segmenter("zh-CN", { granularity: "word" });

export function isResumeSnippetGrounded(payload: {
  confirmedFacts?: string;
  supportingFacts?: string;
  missingFacts?: string;
  resumeSnippet?: string;
}): boolean {
  const snippet = payload.resumeSnippet?.trim() ?? "";
  const source = [payload.confirmedFacts, payload.supportingFacts]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("；");
  if (!snippet || !source) return false;

  const normalizedSource = normalizeFactText(source);
  for (const pattern of RISKY_RESUME_FACTS) {
    for (const match of snippet.matchAll(pattern)) {
      const atom = normalizeFactText(match[0]);
      if (atom && !normalizedSource.includes(atom)) return false;
    }
  }

  return snippet
    .split(/[，,。；;！!？?\n\r]+/)
    .map((clause) => clause.trim())
    .filter(Boolean)
    .every((clause) => clauseIsSupported(clause, normalizedSource));
}

function clauseIsSupported(clause: string, normalizedSource: string): boolean {
  const factualClause = clause.replace(
    /^(?:实际完成|交付物或结果)\s*[：:]\s*/u,
    "",
  );
  const normalizedClause = normalizeFactText(factualClause);
  if (!normalizedClause) return true;
  if (normalizedSource.includes(normalizedClause)) return true;
  const actionVerbs = RESUME_ACTION_VERBS.filter((verb) => normalizedClause.includes(verb));
  if (actionVerbs.length === 0) return false;
  if (!actionVerbs.every((verb) => normalizedSource.includes(verb))) return false;
  return Array.from(RESUME_WORD_SEGMENTER.segment(factualClause)).every((segment) => {
    if (!segment.isWordLike) return true;
    const word = normalizeFactText(segment.segment);
    return !word || RESUME_NEUTRAL_WORDS.has(word) || normalizedSource.includes(word);
  });
}

function normalizeFactText(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s、，,。；;：:！!？?（）()“”"'·/_-]+/g, "");
}
