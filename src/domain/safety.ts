type SafetyScanResult = {
  passed: boolean;
  blockedReasons: string[];
};

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
      /筛选规则|公司.*原因|失败原因是|没反馈.*因为|rejection reason/i,
      /(?:主要|就是|肯定)卡在|问题出在/i,
      /无反馈[^。；，,.]{0,8}(?:说明|表明|意味着)[^。；，,.]{0,8}(?:简历|材料|能力)[^。；，,.]{0,4}(?:不行|太弱|有问题)/i,
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
    patterns: [/保 offer|包过|一定能|通过率|offer promise|guarantee/i],
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
  const textWithoutGuardrailReminders = stripCompliantGuardrailReminders(text);
  const blockedReasons = BLOCKERS.filter((blocker) =>
    blocker.patterns.some((pattern) => pattern.test(textWithoutGuardrailReminders))
  ).map((blocker) => blocker.reason);

  return {
    passed: blockedReasons.length === 0,
    blockedReasons,
  };
}

function stripCompliantGuardrailReminders(text: string): string {
  return text
    .replace(/(?:不要|不能|不得|请勿|避免)编造[^。；，,.]*[。；，,.]?/gi, "")
    .replace(/(?:不要|不能|不得|请勿|避免)把参与写成主导[^。；，,.]*[。；，,.]?/gi, "")
    .replace(/(?:不要|不能|不得|请勿|避免)把协助写成负责[^。；，,.]*[。；，,.]?/gi, "")
    .replace(/(?:不评价|不能评价|不得评价)你本人适不适合[^。；，,.]*[。；，,.]?/gi, "")
    .replace(/(?:不输出|不能输出|不得输出|不给出|不能给出|不得给出)[^。；，,.]*(?:能投|不能投|匹配度|录取概率)[^。；，,.]*[。；，,.]?/gi, "");
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
