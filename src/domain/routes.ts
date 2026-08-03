import { ROUTE_KEYS, type RecordType, type RouteKey } from "@/domain/types";
import { getRouteContract } from "@/domain/route-contracts";
import { isApplicationRecordComplete } from "@/domain/record-rules";

export { ROUTE_KEYS };

type RouteStrategy = {
  routeKey: RouteKey;
  routeName: string;
  label: string;
  recordType: RecordType;
  requiredFields: string[];
};

const ROUTE_STRATEGIES: Record<RouteKey, RouteStrategy> = {
  direction_to_jobs: {
    routeKey: "direction_to_jobs",
    routeName: "方向 -> 岗位样本",
    label: "我不知道能投哪些岗位",
    recordType: "job_sample",
    requiredFields: [...getRouteContract("direction_to_jobs").inputFields],
  },
  experience_to_resume: {
    routeKey: "experience_to_resume",
    routeName: "经历 -> 简历材料",
    label: "我的经历不知道怎么写进简历",
    recordType: "experience_fact",
    requiredFields: [...getRouteContract("experience_to_resume").inputFields],
  },
  jd_to_revision: {
    routeKey: "jd_to_revision",
    routeName: "JD -> 投递前最小修改",
    label: "我看到岗位了，不知道投递前怎么改",
    recordType: "jd_compare",
    requiredFields: [...getRouteContract("jd_to_revision").inputFields],
  },
  applications_to_review: {
    routeKey: "applications_to_review",
    routeName: "投递记录 -> 轻复盘",
    label: "我投了一些，但没什么反馈",
    recordType: "application",
    requiredFields: [...getRouteContract("applications_to_review").inputFields],
  },
};

export function getRouteStrategy(routeKey: RouteKey): RouteStrategy {
  return ROUTE_STRATEGIES[routeKey];
}

export function isRouteInputSufficient(routeKey: RouteKey, input: Record<string, unknown>): boolean {
  if (routeKey === "applications_to_review") {
    const applications = input.applications;
    if (Array.isArray(applications)) {
      return applications.filter((application) => isApplicationRecordComplete(application)).length >= 2;
    }

    return false;
  }

  return getRouteStrategy(routeKey).requiredFields.every((field) => hasMeaningfulValue(input[field]));
}

function hasMeaningfulValue(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const cleaned = value.trim();
  return cleaned.length > 0 && !isPlaceholderValue(cleaned);
}

const PLACEHOLDER_PREFIX = "(?:暂时还|目前还|暂时|目前|还|尚)?";
const PLACEHOLDER_STATE = "(?:不确定|不知道|不清楚|没有|没整理|未整理)";
const PLACEHOLDER_VALUE = new RegExp(
  `^(?:${PLACEHOLDER_PREFIX}${PLACEHOLDER_STATE}|暂无|无|无明确版本|unknown|not sure|none)[。.!！]?$`,
  "i",
);

export function isPlaceholderValue(value: string): boolean {
  return PLACEHOLDER_VALUE.test(value.trim());
}
