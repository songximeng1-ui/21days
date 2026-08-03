export const JOB_TAXONOMY_VERSION = "2026-07-31.v1";

type JobFamily = {
  directionNames: readonly string[];
  keywordRoots: readonly string[];
  defaultKeywords: readonly string[];
};

const JOB_FAMILIES: readonly JobFamily[] = [
  {
    directionNames: ["内容运营", "内容运营（Content Operations）"],
    keywordRoots: ["内容运营", "新媒体运营", "内容助理", "内容编辑", "ContentOperations", "运营助理"],
    defaultKeywords: ["内容运营 实习", "新媒体运营 助理", "内容助理 校招"],
  },
  {
    directionNames: ["Customer Success Assistant", "客户成功助理（Customer Success Assistant）"],
    keywordRoots: ["CustomerSuccess", "客户成功", "客户支持", "客户运营", "客服助理"],
    defaultKeywords: ["客户成功 助理", "Customer Success intern", "客户支持 实习"],
  },
  {
    directionNames: ["外贸跟单助理"],
    keywordRoots: ["外贸跟单", "外贸助理", "跟单员", "国际贸易助理"],
    defaultKeywords: ["外贸跟单 助理", "外贸助理 实习", "国际贸易 助理"],
  },
  {
    directionNames: ["审计助理"],
    keywordRoots: ["审计助理", "审计实习"],
    defaultKeywords: ["审计助理 实习", "审计助理 校招", "审计实习"],
  },
  {
    directionNames: ["行政数据整理"],
    keywordRoots: ["行政助理数据整理", "数据录入", "行政文员"],
    defaultKeywords: ["行政助理 数据整理", "数据录入 实习", "行政文员 实习"],
  },
  {
    directionNames: ["销售助理"],
    keywordRoots: ["销售助理", "销售实习", "商务拓展助理"],
    defaultKeywords: ["销售助理 实习", "销售 实习", "商务拓展 助理"],
  },
  {
    directionNames: ["活动执行", "活动执行/会展策划"],
    keywordRoots: ["活动执行", "会展助理", "会展策划", "活动运营"],
    defaultKeywords: ["活动执行 实习", "会展助理 实习", "活动运营 助理"],
  },
  {
    directionNames: ["运营支持/数据整理", "服务运营/运营支持"],
    keywordRoots: ["运营支持", "数据整理", "运营助理", "服务运营", "客户服务"],
    defaultKeywords: ["运营支持 实习", "数据整理 实习", "运营助理 校招"],
  },
] as const;

const NEGATIVE_INTENT_MARKERS = [
  "不太想",
  "不怎么想",
  "暂不想",
  "暂不考虑",
  "不想",
  "不接受",
  "不考虑",
  "不愿意",
  "不喜欢",
  "没兴趣",
  "不要",
  "拒绝",
  "排除",
  "避免",
] as const;

const POSITIVE_INTENT_MARKERS = [
  "愿意",
  "可以尝试",
  "能接受",
  "接受",
  "考虑",
  "想做",
  "不排斥",
  "可以做",
] as const;

export function validateDirectionCandidates(
  candidates: unknown,
): { ok: boolean; version: typeof JOB_TAXONOMY_VERSION } {
  if (!Array.isArray(candidates) || candidates.length < 2 || candidates.length > 3) {
    return { ok: false, version: JOB_TAXONOMY_VERSION };
  }
  const familyIndexes = candidates.map((candidate) =>
    isDirectionCandidate(candidate)
      ? JOB_FAMILIES.findIndex((family) =>
          family.directionNames.some((name) => name === candidate.directionName)
        )
      : -1
  );
  if (
    familyIndexes.some((familyIndex) => familyIndex < 0) ||
    new Set(familyIndexes).size !== familyIndexes.length
  ) {
    return { ok: false, version: JOB_TAXONOMY_VERSION };
  }
  const ok = candidates.every((candidate, index) => {
    if (!isDirectionCandidate(candidate)) return false;
    const family = JOB_FAMILIES[familyIndexes[index]];
    return Boolean(
      family &&
      candidate.searchKeywords.length > 0 &&
      candidate.searchKeywords.every((keyword) =>
        family.keywordRoots.some((root) => normalize(keyword).includes(normalize(root)))
      ),
    );
  });
  return { ok, version: JOB_TAXONOMY_VERSION };
}

export function selectJobTaxonomyDirections(material: string): Array<{
  directionName: string;
  searchKeywords: string[];
}> {
  const materialClauses = splitMaterialClauses(material);
  const ranked = JOB_FAMILIES.map((family, order) => ({
    family,
    order,
    score: [...family.directionNames, ...family.keywordRoots].reduce(
      (score, term) => score + (hasPositiveMention(materialClauses, term) ? 1 : 0),
      0,
    ),
  }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.order - right.order);
  return ranked.slice(0, 2).map(({ family }) => ({
    directionName: family.directionNames[0],
    searchKeywords: [...family.defaultKeywords],
  }));
}

function splitMaterialClauses(material: string): string[] {
  return material
    .split(/[，,。；;！!？?\n]|(?:但是|不过|然而|而是|但|而)/)
    .flatMap((clause) => {
      let inheritedNegative = false;
      return clause.split("、").map((part) => {
        const normalized = normalize(part);
        const hasNegative = NEGATIVE_INTENT_MARKERS.some((marker) => normalized.includes(marker));
        const hasPositive = !hasNegative &&
          POSITIVE_INTENT_MARKERS.some((marker) => normalized.includes(marker));
        if (hasNegative) inheritedNegative = true;
        if (hasPositive) inheritedNegative = false;
        return inheritedNegative && !hasPositive ? `不想${normalized}` : normalized;
      });
    })
    .filter(Boolean);
}

function hasPositiveMention(materialClauses: string[], term: string): boolean {
  const normalizedTerm = normalize(term);
  return materialClauses.some((clause) =>
    clause.includes(normalizedTerm) &&
    !NEGATIVE_INTENT_MARKERS.some((marker) => clause.includes(marker))
  );
}

function isDirectionCandidate(value: unknown): value is {
  directionName: string;
  searchKeywords: string[];
} {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { directionName?: unknown; searchKeywords?: unknown };
  return (
    typeof candidate.directionName === "string" &&
    Array.isArray(candidate.searchKeywords) &&
    candidate.searchKeywords.every((item) => typeof item === "string")
  );
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[\s（）()/_-]+/g, "");
}
