export type JdMaterialEvidenceKind = "direct" | "claim_only" | "none";

const CAPABILITY_CLAIM_PATTERN =
  /(?:^|[。！？；;\n])\s*(?:可(?!能)|能够|能|具备|熟悉|掌握|擅长|善于|有能力)(?:独立)?(?:完成|进行|使用|负责|承担|开展)?/;

const DIRECT_ACTION_PATTERN =
  /(?:完成了|做过|曾经?|整理了|分析了|复盘了|记录了|制作了|编写了|发布了|上线了|交付了|测试了|设计了|搭建了|输出了|收集了|访谈了|协助|参与|负责|主导|独立使用|独立完成)/;

const CONCRETE_EVENT_PATTERN =
  /(?:在[^。！？\n]{1,48}(?:中|期间)|完成了|做过|曾经?|整理了|分析了|复盘了|记录了|制作了|编写了|发布了|上线了|交付了|测试了|设计了|搭建了|输出了|收集了|访谈了|协助|参与|负责|主导|独立使用)/;

/**
 * Separates a statement of ability from evidence that an action actually happened.
 * This is intentionally conservative: a capability claim must be verified before it
 * can be turned into resume copy.
 */
export function classifyJdMaterialEvidence(
  material: string | null | undefined,
): JdMaterialEvidenceKind {
  const normalized = material?.trim() ?? "";
  if (!normalized) {
    return "none";
  }

  const isCapabilityClaim = CAPABILITY_CLAIM_PATTERN.test(normalized);
  const hasDirectAction = DIRECT_ACTION_PATTERN.test(normalized);

  if (isCapabilityClaim && !CONCRETE_EVENT_PATTERN.test(normalized)) {
    return "claim_only";
  }

  return hasDirectAction || !isCapabilityClaim ? "direct" : "claim_only";
}

export function compactEvidenceAnchor(value: string, maxLength = 42): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  const characters = Array.from(normalized);
  if (characters.length <= maxLength) {
    return normalized;
  }

  if (maxLength <= 1) {
    return "…";
  }

  return `${characters.slice(0, maxLength - 1).join("")}…`;
}
