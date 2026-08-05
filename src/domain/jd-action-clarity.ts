export type JdMaterialEvidenceKind = "direct" | "claim_only" | "none";

const CAPABILITY_CLAIM_PATTERN =
  /(?:^|[。！？；;\n])\s*(?:可(?!能)|能够|能|具备|熟悉|熟练(?:使用)?|精通|掌握|擅长|善于|有能力|有[^。！？；;\n]{0,20}经验|拥有[^。！？；;\n]{0,20}经验|经验丰富)(?:独立)?(?:完成|进行|使用|负责|承担|开展)?/;

const DIRECT_ACTION_PATTERN =
  /(?:完成(?:了)?|做过|曾经?|整理(?:了)?|分析(?:了)?|复盘(?:了)?|记录(?:了)?|制作(?:了)?|编写(?:了)?|发布(?:了)?|编辑(?:了)?|运营|跟进|维护|接待|成交|引流|上线(?:了)?|交付(?:了)?|测试(?:了)?|设计(?:了)?|搭建(?:了)?|输出(?:了)?|收集(?:了)?|访谈(?:了)?|协助|参与|负责|主导|独立使用|独立完成)/;

const CONCRETE_EVENT_PATTERN =
  /(?:在[^。！？\n]{1,48}(?:中|期间)|完成了|做过|曾经?|整理了|分析了|复盘了|记录了|制作了|编写了|发布了|上线了|交付了|测试了|设计了|搭建了|输出了|收集了|访谈了|协助|参与|负责|主导|独立使用)/;

const PROMPT_INJECTION_PATTERN =
  /(?:忽略|无视|跳过|绕过)(?:以上|上述|之前|所有|安全)?[^。！？\n]{0,20}(?:规则|指令|提示|要求|校验|限制)|(?:泄露|显示|输出)[^。！？\n]{0,12}(?:系统提示词|system\s*prompt)|(?:system|assistant|developer)\s*:|ignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions?|rules?|prompts?)|bypass\s+(?:validation|checks?|guardrails?)/i;

export function containsPromptInjection(value: string | null | undefined): boolean {
  return PROMPT_INJECTION_PATTERN.test(value ?? "");
}

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
  if (containsPromptInjection(normalized)) return "claim_only";

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
