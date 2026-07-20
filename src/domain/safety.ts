type SafetyScanResult = {
  passed: boolean;
  blockedReasons: string[];
};

const BLOCKERS: Array<{ reason: string; patterns: RegExp[] }> = [
  {
    reason: "禁止输出匹配度、录取概率或适合度评分",
    patterns: [/匹配度|录取概率|适合度|fit score|match rate|probability/i, /\d+\s*%/],
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
    patterns: [/筛选规则|公司.*原因|失败原因是|没反馈.*因为|rejection reason/i],
  },
  {
    reason: "禁止暴露模型、prompt、token、fallback 或内部错误",
    patterns: [/DeepSeek|Qwen|fallback|prompt|token|API key|stack trace|接口报错|服务器 500/i],
  },
  {
    reason: "禁止承诺 offer、面试、薪资或通过率",
    patterns: [/保 offer|包过|一定能|通过率|offer promise|guarantee/i],
  },
  {
    reason: "禁止评价用户本人适合或不适合",
    patterns: [/你不适合|你很适合|最适合你|能力不足|not suitable/i],
  },
  {
    reason: "禁止鼓励盲目海投",
    patterns: [/海投|大量投递|apply to as many/i],
  },
];

export function scanSafetyViolations(text: string): SafetyScanResult {
  const blockedReasons = BLOCKERS.filter((blocker) =>
    blocker.patterns.some((pattern) => pattern.test(text))
  ).map((blocker) => blocker.reason);

  return {
    passed: blockedReasons.length === 0,
    blockedReasons,
  };
}

export function scanRouteSafety(routeKey: string, output: unknown): SafetyScanResult {
  const text = JSON.stringify(output);
  const base = scanSafetyViolations(text);
  const blockedReasons = [...base.blockedReasons];

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
