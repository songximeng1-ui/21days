import type { AiProvider } from "@/ai/provider";
import { validateRouteOutput } from "@/domain/action-card";
import { isRouteInputSufficient } from "@/domain/routes";
import type { RouteKey, RouteOutput } from "@/domain/types";
import { routeOutputSchema } from "@/schemas/route-output";

type GenerateRouteOutputInput = {
  routeKey: RouteKey;
  input: Record<string, unknown>;
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
      actionTitle: "先保存当前填写内容，稍后继续",
      actionReason: "当前内容不应该丢失，稍后可以从这里接着推进。",
      actionSteps: ["保存当前内容", "稍后回到这一页继续"],
      estimatedTime: "15-30 分钟",
      recordAfterDone: "保存当前草稿。",
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

    if (!validation.passed) {
      return makeFriendlyFailureOutput(routeKey);
    }

    return output;
  } catch {
    return makeFriendlyFailureOutput(routeKey);
  }
}

function makeMissingInfoOutput(routeKey: RouteKey, input: Record<string, unknown>): RouteOutput {
  const isJdRoute = routeKey === "jd_to_revision";
  const title = isJdRoute
    ? "今天先补这份岗位的真实 JD 或 3-5 条岗位要求"
    : "今天先补一小块真实信息";

  return {
    routeKey,
    outputType: "missing_info",
    shortAssessment: isJdRoute
      ? "现在还不能可靠判断这份岗位和你的材料支撑关系，因为还缺真实 JD。"
      : "现在还不能可靠整理出下一步，因为还缺一块真实信息。",
    routeResult: null,
    missingInfo: {
      cannotJudge: isJdRoute ? "材料与 JD 的支撑关系" : "路线深度判断",
      alreadyKnown: Object.keys(input),
      missingFields: isJdRoute ? ["jdTextOrRequirements"] : ["requiredRouteFields"],
    },
    todayAction: {
      actionTitle: title,
      actionReason: "补完这一项后，系统才能继续整理今天先做的一步。",
      actionSteps: isJdRoute
        ? ["找到目标岗位页面", "复制 JD 或写下 3-5 条岗位要求", "保存后回来继续"]
        : ["补一条真实信息", "保存草稿", "回来继续生成今日行动"],
      estimatedTime: "15-30 分钟",
      recordAfterDone: isJdRoute ? "记录岗位名称和真实 JD。" : "记录补充的真实信息。",
      actionType: "fill_info",
    },
    recordGuide: {
      recordType: "fill_info",
      fieldsToRecord: isJdRoute ? ["targetJobTitle", "jdTextOrRequirements"] : ["note"],
      requiresUserConfirmation: true,
    },
  };
}

