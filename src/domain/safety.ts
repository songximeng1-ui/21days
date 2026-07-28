type SafetyScanResult = {
  passed: boolean;
  blockedReasons: string[];
};

type RouteSafetyContext = {
  routeInput?: Record<string, unknown>;
};

const EXAGGERATION_REASON = "禁止夸大职责或成果";

const BLOCKERS: Array<{ reason: string; patterns: RegExp[] }> = [
  {
    reason: "禁止输出匹配度、录取概率或适合度评分",
    patterns: [
      /匹配度|匹配率|录取概率|适合度|fit score|match rate|probability/i,
      /(通过|录取|offer|进面|面试)[^。；，,.]{0,8}(概率|可能性|机会|希望)[^。；，,.]{0,8}(很高|高|大|不低)/i,
      /大概率[^。；，,.]{0,8}(通过|录取|offer|进面|面试)/i,
      /(匹配|适合|录取|通过|offer|概率)[^。；，,.]{0,12}\d+\s*%/i,
      /\d+\s*%[^。；，,.]{0,12}(匹配|适合|录取|通过|offer|概率)/i,
    ],
  },
  {
    reason: "禁止编造经历、JD、数据、结果或反馈",
    patterns: [/编一个|编造|虚构|包装成|fake|fabricat/i],
  },
  {
    reason: "禁止夸大职责或成果",
    patterns: [/主导|负责整体|全权负责|own(ed)? the whole/i],
  },
  {
    reason: "禁止猜测公司筛选规则或失败原因",
    patterns: [
      /筛选规则|公司[^。；，、,.]*(?:拒绝|淘汰|未通过|没有反馈|没反馈|无反馈|未回复)[^。；，、,.]*(?:原因(?:可能)?是|，原因(?:可能)?是)|失败原因是|没反馈.*因为|rejection reason/i,
      /(?:主要|就是|肯定)卡在|问题出在/i,
      /无反馈[^。；，,.]{0,8}(?:说明|表明|意味着)[^。；，,.]{0,8}(?:简历|材料|能力)[^。；，,.]{0,4}(?:不行|太弱|有问题)/i,
      /(?:学历|简历|材料|经历|能力)[^。；，,.]{0,12}(?:导致|造成|所以)[^。；，,.]{0,8}(?:没有反馈|没反馈|无反馈|未通过|被拒绝|失败)/i,
    ],
  },
  {
    reason: "禁止暴露模型、prompt、token、fallback 或内部错误",
    patterns: [
      /DeepSeek|Qwen|主模型|副模型|模型.{0,4}重试|fallback|兜底|prompt|token|API key|stack trace|内部错误|接口报错|服务器 500/i,
    ],
  },
  {
    reason: "禁止承诺 offer、面试、薪资或通过率",
    patterns: [
      /保 offer|包过|一定能|通过率|offer promise|guarantee/i,
      /(?:保证|确保|承诺|稳(?:了)?|(?<!未)必(?:然|定)?|一定|肯定|绝对|包)[^。；，、,.]{0,10}(?:进面|面试(?:邀请|机会|结果)?|offer|录取(?:结果)?|收到回复|回复|通过(?:机会|率)?|上岸)/i,
      /(?:进面|面试(?:邀请|机会|结果)?|offer|录取(?:结果)?|收到回复|回复|通过(?:机会|率)?|上岸)[^。；，、,.]{0,10}(?:保证|确保|承诺|稳(?:了)?|(?<!未)必(?:然|定)?|一定|肯定|绝对|包)/i,
      /(?:薪资|月薪|年薪|工资)[^。；，、,.]{0,8}(?:至少|不低于|起码|保底|保证|确保|稳|(?<!未)必(?:然|定)?|一定|肯定)[^。；，、,.]{0,8}\d+(?:\.\d+)?\s*(?:k|w|万|千)?/i,
      /(?:保证|确保|承诺|稳|(?<!未)必(?:然|定)?|一定|肯定|保底)[^。；，、,.]{0,8}(?:薪资|月薪|年薪|工资)[^。；，、,.]{0,8}\d+(?:\.\d+)?\s*(?:k|w|万|千)?/i,
    ],
  },
  {
    reason: "禁止评价用户本人适合或不适合",
    patterns: [/你(?:很|更|最)?适合(?:做|投|从事)?|你不适合|最适合你|能力不足|not suitable/i],
  },
  {
    reason: "禁止给出绝对投递结论",
    patterns: [
      /(?:这份|这个|该)?岗位.{0,6}(?:可以投|能投|不能投|不建议投)|(?:一定|绝对).{0,6}(?:可以投|能投|不能投)/i,
      /(?:可以|能|不能|不建议)(?:直接)?投(?:递)?(?:这份|这个|该)?岗位/i,
    ],
  },
  {
    reason: "禁止鼓励盲目海投",
    patterns: [/海投|大量投递|apply to as many/i],
  },
];

export function scanSafetyViolations(text: string): SafetyScanResult {
  const textWithoutGuardrailReminders = stripCompliantGuardrailReminders(
    stripCompliantOutcomePromiseReminders(text),
  );
  const blockedReasons = BLOCKERS.filter((blocker) =>
    blocker.patterns.some((pattern) => pattern.test(textWithoutGuardrailReminders))
  ).map((blocker) => blocker.reason);

  return {
    passed: blockedReasons.length === 0,
    blockedReasons,
  };
}

function stripCompliantOutcomePromiseReminders(text: string): string {
  const outcome =
    "(?:进面|面试(?:邀请|机会|结果)?|offer|录取(?:结果)?|收到回复|回复|通过(?:机会|率)?|上岸|薪资(?:下限|结果)?)";
  const boundary = "(?=。|；|;|\\.|!|\\?|\"|,|，|\\]|}|$)";
  return text.replace(
    new RegExp(
      `(?:当前)?\\s*(?:不能|无法|不应|不会|不得|不要|不承诺)\\s*(?:保证|确保|承诺|预测)?\\s*(?:会|能|可以)?\\s*[^。；;.!?"，,]{0,16}${outcome}[^。；;.!?"，,]{0,16}${boundary}`,
      "gi",
    ),
    (match) => /但|却|不过|然而|同时|随后|接着|改为/.test(match) ? match : "",
  );
}

function stripCompliantGuardrailReminders(text: string): string {
  const boundary = "(?=。|；|;|\\.|!|\\?|\"|,|\\]|}|$)";
  return text
    .replace(
      new RegExp(`(?:必须|需要|应当|要|请)?\\s*(?:明确)?\\s*拒绝\\s*(?:虚构|编造)(?:或夸大)?[^。；;.!?"]{0,32}${boundary}`, "gi"),
      (match) => /但|而|改为|然后|随后|同时|却|接着|再|进而|之后|接下来/.test(match) ? match : "",
    )
    .replace(
      new RegExp(`(?:禁止|避免|不得|不能|不要|不应|请勿)\\s*(?:虚构|编造)(?:或夸大)?[^。；;.!?"]{0,32}${boundary}`, "gi"),
      (match) => /但|而|改为|然后|随后|同时|却|接着|再|进而|之后|接下来/.test(match) ? match : "",
    )
    .replace(
      new RegExp(`(?:不要|不能|不得|请勿|避免|不应)\\s*(?:将|把)?[^。；;.!?"]{0,12}角色[^。；;.!?"]{0,12}夸大[^。；;.!?"]{0,40}${boundary}`, "gi"),
      (match) => /但|而|改为|然后|随后|同时|却|接着|再|进而|之后|接下来/.test(match) ? match : "",
    )
    .replace(
      new RegExp(`(?:不要|不能|不得|请勿|避免|不应)\\s*夸大[^。；;.!?"]{0,16}角色强度[^。；;.!?"]{0,40}${boundary}`, "gi"),
      (match) => /但|而|改为|然后|随后|同时|却|接着|再|进而|之后|接下来/.test(match) ? match : "",
    )
    .replace(/(?:不要|不能|不得|请勿|避免)编造/gi, "")
    .replace(new RegExp(`(?:不要|不能|不得|请勿|避免|不)\\s*(?:使用|采用|依赖)?\\s*(?:虚构|编造)(?:或夸大)?[^。；;.!?"]{0,32}${boundary}`, "gi"), "")
    .replace(new RegExp(`(?:不要|不能|不得|请勿|避免)\\s*(?:将|把)?[^。；;.!?"]{0,24}写(?:成|为)[^。；;.!?"]{0,48}(?:\\d+\\s*%|独立运营)[^。；;.!?"]*${boundary}`, "gi"), "")
    .replace(
      new RegExp(`(?:不要|不能|不得|请勿|避免)\\s*(?:将|把)?[^。；;.!?"]{0,40}(?:写成|写为|包装成|改写成)[^。；;.!?"]{0,80}(?:负责|主导|独立负责|独立设计|独立运营|主导整场)[^。；;.!?"]*${boundary}`, "gi"),
      (match) => /但|随后|同时|却|接着|再/.test(match) ? match : "",
    )
    .replace(
      new RegExp(`(?:不要|不能|不得|请勿|避免)\\s*(?:将|把)?[^。；;.!?"]{0,40}说成[^。；;.!?"]{0,80}(?:负责|主导|独立负责|独立完成)[^。；;.!?"]*${boundary}`, "gi"),
      (match) => /但|而|改为|然后|随后|同时|却|接着|再|进而|之后|接下来/.test(match) ? match : "",
    )
    .replace(
      new RegExp(`(?:不要|不能|不得|请勿|避免)\\s*写[^。；;.!?"]{0,48}(?:负责|主导|独立负责|独立完成)[^。；;.!?"]*${boundary}`, "gi"),
      (match) => /但|而|改为|然后|随后|同时|却|接着|再|进而|之后|接下来/.test(match) ? match : "",
    )
    .replace(new RegExp(`(?:不要|不能|不得|请勿|避免|不)\\s*(?:输出|暴露|泄露|提供|展示)[^。；;.!?"]{0,48}(?:API[_\\s-]?key|完整\\s*prompt|prompt|token|fallback)[^。；;.!?"]*${boundary}`, "gi"), "")
    .replace(/(?:不要|不能|不得|请勿|避免)把参与写成主导/gi, "")
    .replace(/(?:不要|不能|不得|请勿|避免)把协助写成负责/gi, "")
    .replace(/(?:不评价|不能评价|不得评价)你本人适不适合/gi, "")
    .replace(
      /(?:不输出|不能输出|不得输出|不给出|不能给出|不得给出)\s*(?:能投|不能投|匹配度|录取概率)(?:\s*(?:或|和|、|\/)\s*(?:能投|不能投|匹配度|录取概率))*/gi,
      "",
    )
    .replace(
      /(?:不评估|不能评估|不得评估|不判断|不能判断|不得判断)\s*(?:匹配度|匹配率|录取概率|面试概率|投递结论)(?:\s*(?:或|和|、|\/)\s*(?:匹配度|匹配率|录取概率|面试概率|投递结论))*/gi,
      "",
    )
    .replace(
      /(?:无法|不能|不应|不宜)\s*(?:提供|给出|判断|评估|打分|预测)[^。；;.!?"]{0,24}(?:匹配度|匹配率|录取概率|面试概率|投递结论)(?:[^。；;.!?"]{0,24}(?:匹配度|匹配率|录取概率|面试概率|投递结论))?[^。；;.!?"]{0,8}/gi,
      "",
    );
}

export function scanRouteSafety(
  routeKey: string,
  output: unknown,
  context?: RouteSafetyContext,
): SafetyScanResult {
  const text = JSON.stringify(output);
  const base = scanSafetyViolations(text);
  const blockedReasons = base.blockedReasons.filter(
    (reason) =>
      reason !== EXAGGERATION_REASON ||
      !canExemptGroundedExperienceLeadership(routeKey, output, context?.routeInput),
  );

  if (routeKey === "jd_to_revision" && /没有 JD 却|no JD but/i.test(text)) {
    blockedReasons.push("没有真实 JD 时不能做深度岗位判断");
  }

  if (routeKey === "applications_to_review" && /原因是|because your resume/i.test(text)) {
    blockedReasons.push("投递复盘只能表达可能线索，不能做失败归因定论");
  }

  return {
    passed: blockedReasons.length === 0,
    blockedReasons: Array.from(new Set(blockedReasons)),
  };
}

function canExemptGroundedExperienceLeadership(
  routeKey: string,
  output: unknown,
  routeInput?: Record<string, unknown>,
): boolean {
  if (routeKey !== "experience_to_resume" || !isRecord(output) || !routeInput) return false;
  const routeResult = output.routeResult;
  if (!isRecord(routeResult)) return false;

  const sourceTexts = collectExperienceRoleProvenance(routeInput);
  if (sourceTexts.length === 0) return false;
  const sanitizedResult = routeInput.mode === "light_review"
    ? {
        ...routeResult,
        reviewBasis: stripGroundedLeadershipClaims(routeResult.reviewBasis, sourceTexts),
      }
    : {
        ...routeResult,
        resumeSnippetDraft:
          hasGroundedExperienceRoleStrength(routeResult.resumeSnippetDraft, routeInput) &&
          typeof routeResult.resumeSnippetDraft === "string"
            ? stripGroundedRoleMarkers(routeResult.resumeSnippetDraft, sourceTexts)
            : routeResult.resumeSnippetDraft,
        confirmedFacts: stripGroundedLeadershipClaims(routeResult.confirmedFacts, sourceTexts),
        supportingFacts: stripGroundedLeadershipClaims(routeResult.supportingFacts, sourceTexts),
      };
  const remainingOutput = { ...output, routeResult: sanitizedResult };
  return !scanSafetyViolations(JSON.stringify(remainingOutput)).blockedReasons.includes(EXAGGERATION_REASON);
}

function stripGroundedLeadershipClaims(value: unknown, sourceTexts: string[]): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((claim) => {
    if (typeof claim !== "string") return claim;
    return stripGroundedRoleMarkers(claim, sourceTexts);
  });
}

function stripGroundedRoleMarkers(text: string, sourceTexts: string[]): string {
  let sanitized = text;
  for (const marker of ["负责整体", "全权负责", "主导", "独立负责", "独立完成", "负责"]) {
    if (
      hasAffirmativeRoleMarker(sanitized, marker) &&
      sourceTexts.some((sourceText) => {
        let markerIndex = sanitized.indexOf(marker);
        while (markerIndex >= 0) {
          const comparableClaim = readComparableRoleClaim(sanitized, markerIndex);
          if (hasAffirmativeRoleClaim(sourceText, comparableClaim, marker)) return true;
          markerIndex = sanitized.indexOf(marker, markerIndex + marker.length);
        }
        return false;
      })
    ) {
      sanitized = sanitized.replaceAll(marker, "");
    }
  }
  return sanitized;
}

export const EXPERIENCE_ROLE_MARKERS = ["独立负责", "独立完成", "主导", "负责"] as const;

export function hasGroundedExperienceRoleStrength(
  draft: unknown,
  routeInput?: Record<string, unknown>,
): boolean {
  if (typeof draft !== "string") return false;
  const sourceTexts = routeInput ? collectExperienceRoleProvenance(routeInput) : [];
  return EXPERIENCE_ROLE_MARKERS.every((marker) => {
    let markerIndex = draft.indexOf(marker);
    while (markerIndex >= 0) {
      const comparableClaim = readComparableRoleClaim(draft, markerIndex);
      const grounded = sourceTexts.some(
        (sourceText) => hasAffirmativeRoleClaim(sourceText, comparableClaim, marker),
      );
      if (!grounded) return false;
      markerIndex = draft.indexOf(marker, markerIndex + marker.length);
    }
    return true;
  });
}

function collectExperienceRoleProvenance(routeInput: Record<string, unknown>): string[] {
  if (routeInput.mode === "light_review") {
    const record = routeInput.record;
    if (
      !isRecord(record) ||
      record.routeKey !== "experience_to_resume" ||
      record.userConfirmed !== true
    ) return [];
    return [
      ...(typeof record.actualDone === "string" ? [record.actualDone] : []),
      ...collectStringLeaves(record.payload),
    ];
  }

  return ["rawExperience", "actualActions", "deliverableOrResult"]
    .map((field) => routeInput[field])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function hasAffirmativeRoleMarker(text: string, marker: string): boolean {
  let fromIndex = 0;
  while (fromIndex < text.length) {
    const markerIndex = text.indexOf(marker, fromIndex);
    if (markerIndex < 0) return false;
    if (isAffirmativeRoleMarkerAt(text, marker, markerIndex)) return true;
    fromIndex = markerIndex + marker.length;
  }
  return false;
}

function hasAffirmativeRoleClaim(sourceText: string, claim: string, marker: string): boolean {
  let claimIndex = sourceText.indexOf(claim);
  while (claimIndex >= 0) {
    let markerOffset = claim.indexOf(marker);
    while (markerOffset >= 0) {
      if (isAffirmativeRoleMarkerAt(sourceText, marker, claimIndex + markerOffset)) return true;
      markerOffset = claim.indexOf(marker, markerOffset + marker.length);
    }
    claimIndex = sourceText.indexOf(claim, claimIndex + claim.length);
  }
  return false;
}

function readComparableRoleClaim(text: string, markerIndex: number): string {
  const claimEnd = ["。", "；", "，", ".", ";", ",", "！", "？", "!", "?", "（", "("]
    .map((separator) => text.indexOf(separator, markerIndex))
    .filter((index) => index >= 0)
    .reduce((nearest, index) => Math.min(nearest, index), text.length);
  return text.slice(markerIndex, claimEnd).trim();
}

function isAffirmativeRoleMarkerAt(text: string, marker: string, markerIndex: number): boolean {
  const clauseStart = Math.max(
    text.lastIndexOf("。", markerIndex - 1),
    text.lastIndexOf("；", markerIndex - 1),
    text.lastIndexOf("，", markerIndex - 1),
    text.lastIndexOf(".", markerIndex - 1),
    text.lastIndexOf(";", markerIndex - 1),
    text.lastIndexOf(",", markerIndex - 1),
    text.lastIndexOf("！", markerIndex - 1),
    text.lastIndexOf("？", markerIndex - 1),
    text.lastIndexOf("!", markerIndex - 1),
    text.lastIndexOf("?", markerIndex - 1),
  ) + 1;
  const prefix = text.slice(clauseStart, markerIndex);
  const markerEnd = markerIndex + marker.length;
  const sentenceEnd = ["。", "；", ".", ";", "！", "？", "!", "?"]
    .map((separator) => text.indexOf(separator, markerEnd))
    .filter((index) => index >= 0)
    .reduce((nearest, index) => Math.min(nearest, index), text.length);
  const suffix = text.slice(markerEnd, sentenceEnd);
  const prefixedNonAffirmativeContext =
    /没有|并未|未曾|不是|并非|不要|不能|不得|请勿|避免|不确定|无法(?:确认|判断)|尚未(?:确认|明确)|未(?:确认|明确)|待(?:确认|核实)|是否/;
  const postfixedNonAffirmativeContext =
    /[（(][^）)]*(?:尚未确认|未确认|待核实|无法确认|不确定|not confirmed|unverified|uncertain)[^）)]*[）)]|(?:真实性|该事实|该说法|这一点)[^。；.!;!?]{0,12}(?:尚未确认|待核实|无法确认|不确定)|(?:^|[，,\s])(?:尚未确认|未确认|待核实|无法确认|not confirmed|unverified)(?:$|[，,\s）)])/i;
  return (
    !prefixedNonAffirmativeContext.test(prefix) &&
    !postfixedNonAffirmativeContext.test(suffix)
  );
}

function collectStringLeaves(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(collectStringLeaves);
  if (isRecord(value)) return Object.values(value).flatMap(collectStringLeaves);
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
