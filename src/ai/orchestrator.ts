import type { AiProvider } from "@/ai/provider";
import { validateRouteOutput } from "@/domain/action-card";
import { getRouteStrategy, isPlaceholderValue, isRouteInputSufficient } from "@/domain/routes";
import type { RouteKey, RouteOutput } from "@/domain/types";
import type { LocalRecord } from "@/lib/local-store";
import { routeOutputSchema } from "@/schemas/route-output";

type GenerateRouteOutputInput = {
  routeKey: RouteKey;
  input: Record<string, unknown>;
  provider: AiProvider;
};

type GenerateLightReviewInput = {
  record: LocalRecord;
  provider: AiProvider;
};

export function makeFriendlyFailureOutput(routeKey: RouteKey): RouteOutput {
  return {
    routeKey,
    outputType: "friendly_failure",
    shortAssessment: "这次暂时没整理出来。你可以先保存当前填写内容，稍后继续。",
    routeResult: null,
    missingInfo: null,
    todayAction: {
      actionTitle: "当前内容已保存，稍后继续",
      actionReason: "这次暂时没有整理出可执行的小行动，先保留当前填写内容。",
      actionSteps: ["稍后从当前内容继续"],
      estimatedTime: "已保存，稍后继续",
      recordAfterDone: "保留当前草稿，稍后继续。",
      actionType: "fill_info",
    },
    recordGuide: {
      recordType: "fill_info",
      fieldsToRecord: ["draft"],
      requiresUserConfirmation: true,
    },
  };
}

export async function generateRouteOutput({
  routeKey,
  input,
  provider,
}: GenerateRouteOutputInput): Promise<RouteOutput> {
  if (!isRouteInputSufficient(routeKey, input)) {
    return makeMissingInfoOutput(routeKey, input);
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const rawOutput = await provider.generate({ routeKey, input });
      const output = routeOutputSchema.parse(rawOutput);
      const validation = validateRouteOutput(output);

      if (output.outputType === "friendly_failure") {
        return makeFriendlyFailureOutput(routeKey);
      }

      if (
        output.routeKey === routeKey &&
        validation.passed &&
        hasGroundedRouteEvidence(routeKey, output.routeResult, input)
      ) {
        return output;
      }
    } catch {
      return makeFriendlyFailureOutput(routeKey);
    }
  }

  return makeFriendlyFailureOutput(routeKey);
}

export async function generateLightReviewOutput({
  record,
  provider,
}: GenerateLightReviewInput): Promise<RouteOutput> {
  if (!record.userConfirmed || !record.actualDone.trim()) {
    return makeFriendlyFailureOutput(record.routeKey as RouteKey);
  }

  try {
    const rawOutput = await provider.generate({
      routeKey: record.routeKey as RouteKey,
      input: {
        mode: "light_review",
        record,
      },
    });
    const output = routeOutputSchema.parse(rawOutput);
    const validation = validateRouteOutput(output);

    if (!validation.passed || output.outputType !== "light_review" || output.routeKey !== record.routeKey) {
      return makeFriendlyFailureOutput(record.routeKey as RouteKey);
    }

    return output;
  } catch {
    return makeFriendlyFailureOutput(record.routeKey as RouteKey);
  }
}

function makeMissingInfoOutput(routeKey: RouteKey, input: Record<string, unknown>): RouteOutput {
  const config = getMissingInfoConfig(routeKey, input);

  return {
    routeKey,
    outputType: "missing_info",
    shortAssessment: config.shortAssessment,
    routeResult: null,
    missingInfo: {
      cannotJudge: config.cannotJudge,
      alreadyKnown: collectKnownFacts(input),
      missingFields: config.missingFields,
    },
    todayAction: {
      actionTitle: config.actionTitle,
      actionReason: config.actionReason,
      actionSteps: config.actionSteps,
      estimatedTime: "15-30 分钟",
      recordAfterDone: config.recordAfterDone,
      actionType: "fill_info",
    },
    recordGuide: {
      recordType: config.recordType,
      fieldsToRecord: config.fieldsToRecord,
      requiresUserConfirmation: true,
    },
  };
}

const fieldLabelMap: Record<string, string> = {
  targetDirection: "目标方向",
  rawExperience: "真实经历",
  actualActions: "实际动作",
  deliverableOrResult: "交付物或结果",
  targetJobTitle: "目标岗位名称",
  jdTextOrRequirements: "真实 JD 或岗位要求",
  userMaterial: "准备使用的材料",
  educationBackground: "专业或学习背景",
  realExperiences: "真实经历",
  interestsOrAcceptables: "兴趣或可接受事项",
  constraints: "暂不接受的条件",
  applications: "投递记录",
};

type MissingInfoConfig = {
    shortAssessment: string;
    cannotJudge: string;
    missingFields: string[];
    actionTitle: string;
    actionReason: string;
    actionSteps: string[];
    recordAfterDone: string;
    fieldsToRecord: string[];
    recordType: RouteOutput["recordGuide"]["recordType"];
};

const missingFieldCopy: Record<string, MissingInfoConfig> = {
  educationBackground: {
    shortAssessment: "现在还不能可靠把方向落到岗位样本，因为还缺你的真实背景或偏好。",
    cannotJudge: "哪些岗位样本值得先看",
    missingFields: ["专业或学习背景"],
    actionTitle: "今天先补你的专业或学习背景",
    actionReason: "先有真实材料，后面才能用岗位样本验证方向。",
    actionSteps: ["写下专业或主要学习方向", "如果暂时不确定，写最近学过的课程领域", "保存后回来继续"],
    recordAfterDone: "记录专业或学习背景。",
    fieldsToRecord: ["educationBackground"],
    recordType: "fill_info",
  },
  realExperiences: {
    shortAssessment: "现在还不能可靠把方向落到岗位样本，因为还缺一段真实经历。",
    cannotJudge: "哪些岗位样本值得先看",
    missingFields: ["做过的真实经历"],
    actionTitle: "今天先补 1 条真实经历",
    actionReason: "先有真实经历，后面才能用岗位样本验证方向。",
    actionSteps: ["选一段课程、项目、社团、兼职或实习经历", "写下发生过什么和你做了什么", "保存后回来继续"],
    recordAfterDone: "记录这段真实经历。",
    fieldsToRecord: ["realExperiences"],
    recordType: "fill_info",
  },
  interestsOrAcceptables: {
    shortAssessment: "现在还不能可靠把方向落到岗位样本，因为还缺一个可接受的工作内容。",
    cannotJudge: "哪些岗位样本值得先看",
    missingFields: ["感兴趣或不排斥的事情"],
    actionTitle: "今天先写 1 个不排斥的工作内容",
    actionReason: "先有一个低压力的筛选条件，后面才好缩小岗位样本。",
    actionSteps: ["回想做过的事情", "写下一个不排斥继续做的内容", "保存后回来继续"],
    recordAfterDone: "记录一个不排斥的工作内容。",
    fieldsToRecord: ["interestsOrAcceptables"],
    recordType: "fill_info",
  },
  targetDirection: {
    shortAssessment: "现在还不能可靠整理简历材料，因为还缺大致目标方向。",
    cannotJudge: "这段经历应重点整理哪些事实",
    missingFields: ["大致目标方向或岗位类型"],
    actionTitle: "今天先写下一个大致目标方向",
    actionReason: "先有一个暂定方向，后面才好决定这段经历重点说什么。",
    actionSteps: ["写下一个正在考虑的方向或岗位类型", "暂时不用确定职业定位", "保存后回来继续"],
    recordAfterDone: "记录这个暂定方向。",
    fieldsToRecord: ["targetDirection"],
    recordType: "fill_info",
  },
  rawExperience: {
    shortAssessment: "现在还不能可靠整理简历材料，因为还缺一段真实经历。",
    cannotJudge: "这段经历能保守写成什么材料",
    missingFields: ["一段真实经历"],
    actionTitle: "今天先写下一段真实经历",
    actionReason: "先说明真实发生过什么，后面才能整理事实边界。",
    actionSteps: ["选一段课程、项目、社团、兼职或实习经历", "用自己的话写下发生过什么", "保存后回来继续"],
    recordAfterDone: "记录这段真实经历。",
    fieldsToRecord: ["rawExperience"],
    recordType: "fill_info",
  },
  actualActions: {
    shortAssessment: "现在还不能可靠整理简历材料，因为还缺这段经历里实际做过的动作。",
    cannotJudge: "这段经历能保守写成什么材料",
    missingFields: ["实际动作"],
    actionTitle: "今天先补这段经历里实际做过的 3 个动作",
    actionReason: "事实边界清楚后，才适合整理简历片段。",
    actionSteps: ["回想这段经历", "列出 1-3 个真实动作", "写下有没有交付物或结果"],
    recordAfterDone: "记录实际动作、交付物和仍不确定的地方。",
    fieldsToRecord: ["actualActions"],
    recordType: "fill_info",
  },
  deliverableOrResult: {
    shortAssessment: "现在还不能可靠整理简历材料，因为还没确认交付物或结果。",
    cannotJudge: "这段经历能保守写成什么材料",
    missingFields: ["交付物或结果；没有可写无明确结果"],
    actionTitle: "今天先确认这段经历有没有交付物或结果",
    actionReason: "把有和没有都说清楚，才能避免为了好看而补不存在的结果。",
    actionSteps: ["查找作品、表格、文档或记录", "有就写真实内容，没有就写无明确结果", "保存后回来继续"],
    recordAfterDone: "记录交付物或无明确结果。",
    fieldsToRecord: ["deliverableOrResult"],
    recordType: "fill_info",
  },
  targetJobTitle: {
    shortAssessment: "现在还不能可靠判断岗位和材料的支撑关系，因为还缺目标岗位名称。",
    cannotJudge: "材料与 JD 的支撑关系",
    missingFields: ["目标岗位名称"],
    actionTitle: "今天先补目标岗位名称",
    actionReason: "先确认正在准备哪一个岗位，后面才能对照真实要求。",
    actionSteps: ["打开目标岗位页面", "复制岗位名称", "保存后回来继续"],
    recordAfterDone: "记录目标岗位名称。",
    fieldsToRecord: ["targetJobTitle"],
    recordType: "fill_info",
  },
  jdTextOrRequirements: {
    shortAssessment: "现在还不能可靠判断这份岗位和你的材料支撑关系，因为还缺真实 JD。",
    cannotJudge: "材料与 JD 的支撑关系",
    missingFields: ["真实 JD 或 3-5 条岗位要求"],
    actionTitle: "今天先补这份岗位的真实 JD 或 3-5 条岗位要求",
    actionReason: "补完这一项后，后面才好继续整理今天先做的一步。",
    actionSteps: ["找到目标岗位页面", "复制 JD 或写下 3-5 条岗位要求", "保存后回来继续"],
    recordAfterDone: "记录岗位名称和真实 JD。",
    fieldsToRecord: ["jdTextOrRequirements"],
    recordType: "fill_info",
  },
  userMaterial: {
    shortAssessment: "现在还不能可靠判断这份岗位和你的材料支撑关系，因为还缺准备使用的材料。",
    cannotJudge: "材料与 JD 的支撑关系",
    missingFields: ["准备使用的相关经历或简历片段"],
    actionTitle: "今天先补准备使用的材料：相关经历或简历片段",
    actionReason: "有真实材料后，才能判断哪些 JD 要求已经有支撑。",
    actionSteps: ["打开准备投递的简历", "复制一段最相关的经历", "保存后回来继续"],
    recordAfterDone: "记录准备使用的真实材料。",
    fieldsToRecord: ["userMaterial"],
    recordType: "fill_info",
  },
};

function getMissingInfoConfig(routeKey: RouteKey, input: Record<string, unknown>): MissingInfoConfig {
  if (routeKey === "applications_to_review") {
    return getApplicationMissingInfoConfig(input);
  }

  const missingField = getRouteStrategy(routeKey).requiredFields.find(
    (field) => !hasConcreteValue(input[field])
  );
  return missingFieldCopy[missingField ?? getRouteStrategy(routeKey).requiredFields[0]];
}

function getApplicationMissingInfoConfig(input: Record<string, unknown>): MissingInfoConfig {
  const rawApplications = input.applications;
  const applications = Array.isArray(rawApplications)
    ? rawApplications
    : typeof rawApplications === "object" && rawApplications !== null
      ? [rawApplications]
      : [];
  const first = asRecord(applications[0]);
  const second = asRecord(applications[1]);

  if (!hasApplicationMinimum(first)) {
    return applicationMinimumCopy(1);
  }
  if (!hasApplicationReviewDetails(first)) {
    return applicationReviewDetailsCopy(1);
  }
  if (!hasApplicationMinimum(second)) {
    return applicationMinimumCopy(2);
  }
  return applicationReviewDetailsCopy(2);
}

function applicationMinimumCopy(index: 1 | 2): MissingInfoConfig {
  const suffix = index === 1 ? "" : "2";
  return {
    shortAssessment: "现在还不能可靠复盘投递情况，因为还缺两条可对照的完整投递记录。",
    cannotJudge: "这轮投递里可以先看哪一个线索",
    missingFields: [`第 ${index} 条最低字段投递记录`],
    actionTitle: `今天先补齐第 ${index} 条最低字段投递记录`,
    actionReason: "先留下最低字段，避免一开始就变成完整表格任务。",
    actionSteps: [
      `选最近的第 ${index} 条投递`,
      "补：岗位 / 公司或平台 / 投递时间 / 反馈状态",
      "只写现在能确认的真实信息，保存后再继续补复盘字段",
    ],
    recordAfterDone: "记录这条投递的岗位、公司或平台、投递时间和反馈状态。",
    fieldsToRecord: [
      `jobTitle${suffix}`,
      `companyOrPlatform${suffix}`,
      `submittedAt${suffix}`,
      `feedbackStatus${suffix}`,
    ],
    recordType: "application",
  };
}

function applicationReviewDetailsCopy(index: 1 | 2): MissingInfoConfig {
  const suffix = index === 1 ? "" : "2";
  return {
    shortAssessment: `第 ${index} 条投递已经有最低记录，再补两项就能用于对照复盘。`,
    cannotJudge: "这条投递使用的材料是否支撑岗位要求",
    missingFields: [`第 ${index} 条投递的 JD 摘要`, `第 ${index} 条投递的材料版本`],
    actionTitle: `今天先补第 ${index} 条投递的 JD 摘要和材料版本`,
    actionReason: "这两项能让下一次复盘基于真实岗位要求和真实材料版本。",
    actionSteps: ["打开这条投递对应的岗位页面", "写下 JD 摘要", "写下这次使用的简历或材料版本"],
    recordAfterDone: "记录 JD 摘要和材料版本。",
    fieldsToRecord: [`jdSummary${suffix}`, `materialVersion${suffix}`],
    recordType: "application",
  };
}

function hasApplicationMinimum(record: Record<string, unknown>): boolean {
  return ["jobTitle", "companyOrPlatform", "submittedAt", "feedbackStatus"].every((field) =>
    hasConcreteValue(record[field])
  );
}

function hasApplicationReviewDetails(record: Record<string, unknown>): boolean {
  return ["jdSummary", "materialVersion"].every((field) => hasConcreteValue(record[field]));
}

function hasConcreteValue(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0 && !isPlaceholderValue(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function collectKnownFacts(input: Record<string, unknown>): string[] {
  const facts = Object.entries(input).flatMap(([field, value]) => knownFactsFromValue(field, value));
  return facts.length > 0 ? facts.slice(0, 3) : ["已有部分输入"];
}

function knownFactsFromValue(field: string, value: unknown): string[] {
  if (typeof value === "string") {
    const cleaned = value.trim();
    return cleaned && !isPlaceholderValue(cleaned)
      ? [`${fieldLabelMap[field] ?? field}：${limitKnownFact(cleaned)}`]
      : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => knownFactsFromValue(`${field} ${index + 1}`, item));
  }

  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([childField, childValue]) => knownFactsFromValue(childField, childValue));
  }

  return [];
}

function limitKnownFact(value: string): string {
  return value.length > 36 ? `${value.slice(0, 36)}...` : value;
}

function hasGroundedRouteEvidence(
  routeKey: RouteKey,
  routeResult: RouteOutput["routeResult"],
  input: Record<string, unknown>,
): boolean {
  if (!routeResult) return false;

  if (routeKey === "direction_to_jobs") {
    const directions = Array.isArray(routeResult.explorableDirections)
      ? routeResult.explorableDirections
      : [];
    return directions.every((direction) =>
      isRecord(direction) && claimsAreGrounded(direction.basisFromUserMaterial, input)
    );
  }

  if (routeKey === "experience_to_resume") {
    return (
      claimsAreGrounded(routeResult.confirmedFacts, input) &&
      claimsAreGrounded(routeResult.supportingFacts, input)
    );
  }

  if (routeKey === "jd_to_revision") {
    return (
      claimsAreGrounded(routeResult.jdKeyRequirements, {
        jdTextOrRequirements: input.jdTextOrRequirements,
      }) &&
      claimsAreGrounded(routeResult.supportedByMaterial, { userMaterial: input.userMaterial })
    );
  }

  if (routeKey === "applications_to_review") {
    return claimsAreGrounded(routeResult.reviewBasis, { applications: input.applications });
  }

  return true;
}

function claimsAreGrounded(claims: unknown, source: unknown): boolean {
  if (!Array.isArray(claims) || claims.length === 0) return false;
  const sourceTexts = collectSourceTexts(source);
  return claims.every(
    (claim) =>
      typeof claim === "string" &&
      claim.trim().length > 0 &&
      sourceTexts.some((sourceText) => normalizeGroundingText(sourceText).includes(normalizeGroundingText(claim)))
  );
}

function collectSourceTexts(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(collectSourceTexts);
  if (isRecord(value)) return Object.values(value).flatMap(collectSourceTexts);
  return [];
}

function normalizeGroundingText(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
