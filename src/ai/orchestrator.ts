import type { AiProvider } from "@/ai/provider";
import { validateRouteOutput } from "@/domain/action-card";
import { isRouteInputSufficient } from "@/domain/routes";
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

  try {
    const rawOutput = await provider.generate({ routeKey, input });
    const output = routeOutputSchema.parse(rawOutput);
    const validation = validateRouteOutput(output);

    if (output.routeKey !== routeKey) {
      return makeFriendlyFailureOutput(routeKey);
    }

    if (!validation.passed) {
      return makeFriendlyFailureOutput(routeKey);
    }

    return output;
  } catch {
    return makeFriendlyFailureOutput(routeKey);
  }
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
  const config = missingInfoCopy[routeKey];

  return {
    routeKey,
    outputType: "missing_info",
    shortAssessment: config.shortAssessment,
    routeResult: null,
    missingInfo: {
      cannotJudge: config.cannotJudge,
      alreadyKnown: Object.keys(input).map((field) => fieldLabelMap[field] ?? field),
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
      recordType: "fill_info",
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

const missingInfoCopy: Record<
  RouteKey,
  {
    shortAssessment: string;
    cannotJudge: string;
    missingFields: string[];
    actionTitle: string;
    actionReason: string;
    actionSteps: string[];
    recordAfterDone: string;
    fieldsToRecord: string[];
  }
> = {
  direction_to_jobs: {
    shortAssessment: "现在还不能可靠把方向落到岗位样本，因为还缺你的真实背景或偏好。",
    cannotJudge: "哪些岗位样本值得先看",
    missingFields: ["专业或学习背景", "做过的真实经历", "感兴趣或不排斥的事情"],
    actionTitle: "今天先补 1 条真实经历和 1 个可接受方向",
    actionReason: "先有真实材料，后面才能用岗位样本验证方向。",
    actionSteps: ["补一条课程、项目、社团、兼职或实习经历", "写一个不排斥的工作内容", "保存后回来继续"],
    recordAfterDone: "记录补充的经历和可接受方向。",
    fieldsToRecord: ["realExperiences", "interestsOrAcceptables"],
  },
  experience_to_resume: {
    shortAssessment: "现在还不能可靠整理简历材料，因为还缺这段经历里实际做过的动作。",
    cannotJudge: "这段经历能保守写成什么材料",
    missingFields: ["实际动作", "交付物或结果"],
    actionTitle: "今天先补这段经历里实际做过的 3 个动作",
    actionReason: "事实边界清楚后，才适合整理简历片段。",
    actionSteps: ["回想这段经历", "列出 1-3 个真实动作", "写下有没有交付物或结果"],
    recordAfterDone: "记录实际动作、交付物和仍不确定的地方。",
    fieldsToRecord: ["actualActions", "deliverable"],
  },
  jd_to_revision: {
    shortAssessment: "现在还不能可靠判断这份岗位和你的材料支撑关系，因为还缺真实 JD。",
    cannotJudge: "材料与 JD 的支撑关系",
    missingFields: ["真实 JD 或 3-5 条岗位要求"],
    actionTitle: "今天先补这份岗位的真实 JD 或 3-5 条岗位要求",
    actionReason: "补完这一项后，系统才能继续整理今天先做的一步。",
    actionSteps: ["找到目标岗位页面", "复制 JD 或写下 3-5 条岗位要求", "保存后回来继续"],
    recordAfterDone: "记录岗位名称和真实 JD。",
    fieldsToRecord: ["targetJobTitle", "jdTextOrRequirements"],
  },
  applications_to_review: {
    shortAssessment: "现在还不能可靠复盘投递情况，因为还缺一条完整投递记录。",
    cannotJudge: "这轮投递里可以先看哪一个线索",
    missingFields: ["岗位名称", "公司或平台", "投递时间", "反馈状态"],
    actionTitle: "今天先补齐 1 条真实投递记录",
    actionReason: "先把记录补完整，再看下一步怎么调整，避免凭感觉归因。",
    actionSteps: ["选最近一条投递", "补岗位、公司或平台、投递时间", "补当前反馈状态"],
    recordAfterDone: "记录岗位、公司或平台、投递时间和反馈状态。",
    fieldsToRecord: ["jobTitle", "companyOrPlatform", "submittedAt", "feedbackStatus"],
  },
};
