import type { RouteOutput } from "@/domain/types";
import { scanRouteSafety } from "@/domain/safety";

type ValidationResult = {
  passed: boolean;
  issues: string[];
};

const MULTI_TASK_PATTERNS = [/three .*tasks/i, /full resume/i, /apply to \d+/i, /投递\s*\d+/];
const REPORT_FALLBACK_PATTERNS = [/基础版.*报告|完整.*报告|求职分析报告|reportTitle|sections/i];
const VAGUE_ACTION_PATTERNS = [
  /全面提升|提升竞争力|增强.*优势|继续优化|完善简历|提升表达/,
  /optimi[sz]e|improve|enhance.*competitiveness/i,
];
const CONCRETE_STEP_PATTERNS = [/保存|记录|复制|找到|打开|列出|标出|补|删|圈出|选择|填写|确认|搜索/];

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

  const outputText = JSON.stringify(output);
  if (REPORT_FALLBACK_PATTERNS.some((pattern) => pattern.test(outputText))) {
    issues.push("第一版 MVP 不生成基础版报告或完整报告");
  }

  if (
    VAGUE_ACTION_PATTERNS.some((pattern) => pattern.test(actionText)) &&
    action.actionSteps.every((step) => !CONCRETE_STEP_PATTERNS.some((pattern) => pattern.test(step)))
  ) {
    issues.push("今日行动过于空泛，必须能被用户直接执行和记录");
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
