import type { RouteOutput } from "@/domain/types";
import { scanRouteSafety } from "@/domain/safety";

type ValidationResult = {
  passed: boolean;
  issues: string[];
};

const MULTI_TASK_PATTERNS = [/three .*tasks/i, /full resume/i, /apply to \d+/i, /投递\s*\d+/];

export function validateRouteOutput(output: RouteOutput): ValidationResult {
  const issues: string[] = [];
  const action = output.todayAction;

  if (!action.actionTitle || !action.actionReason || !action.recordAfterDone) {
    issues.push("今日行动字段不完整");
  }

  const actionText = [action.actionTitle, action.actionReason, ...action.actionSteps].join(" ");
  if (MULTI_TASK_PATTERNS.some((pattern) => pattern.test(actionText))) {
    issues.push("今日行动不能拆成多个并列任务");
  }

  if (!/15\s*-\s*30|15-30/.test(action.estimatedTime)) {
    issues.push("今日行动预计时间应优先为 15-30 分钟");
  }

  const safety = scanRouteSafety(output.routeKey, output);
  issues.push(...safety.blockedReasons);

  return {
    passed: issues.length === 0,
    issues,
  };
}
