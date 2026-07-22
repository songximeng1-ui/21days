import { ROUTE_KEYS, type RecordType, type RouteKey } from "@/domain/types";

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
    requiredFields: ["educationBackground", "realExperiences", "interestsOrAcceptables"],
  },
  experience_to_resume: {
    routeKey: "experience_to_resume",
    routeName: "经历 -> 简历材料",
    label: "我的经历不知道怎么写进简历",
    recordType: "experience_fact",
    requiredFields: ["targetDirection", "rawExperience", "actualActions", "deliverableOrResult"],
  },
  jd_to_revision: {
    routeKey: "jd_to_revision",
    routeName: "JD -> 投递前最小修改",
    label: "我看到岗位了，不知道投递前怎么改",
    recordType: "jd_compare",
    requiredFields: ["targetJobTitle", "jdTextOrRequirements", "userMaterial"],
  },
  applications_to_review: {
    routeKey: "applications_to_review",
    routeName: "投递记录 -> 轻复盘",
    label: "我投了一些，但没什么反馈",
    recordType: "application",
    requiredFields: ["applications"],
  },
};

export function getRouteStrategy(routeKey: RouteKey): RouteStrategy {
  return ROUTE_STRATEGIES[routeKey];
}

export function isRouteInputSufficient(routeKey: RouteKey, input: Record<string, unknown>): boolean {
  if (routeKey === "applications_to_review") {
    const applications = input.applications;
    if (Array.isArray(applications)) {
      return applications.filter((application) => hasApplicationReviewDetails(application)).length >= 2;
    }

    return false;
  }

  return getRouteStrategy(routeKey).requiredFields.every((field) => hasMeaningfulValue(input[field]));
}

function hasApplicationReviewDetails(value: unknown): boolean {
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return (
      ["jobTitle", "companyOrPlatform", "submittedAt", "feedbackStatus"].every((field) =>
        hasMeaningfulValue(record[field])
      ) &&
      ["jdSummary", "materialVersion"].every((field) => hasSpecificReviewValue(record[field]))
    );
  }

  return false;
}

function hasMeaningfulValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return value !== null && value !== undefined;
}

function hasSpecificReviewValue(value: unknown): boolean {
  if (!hasMeaningfulValue(value) || typeof value !== "string") {
    return false;
  }

  return !/^(不确定|不知道|不清楚|暂时没有|还没整理|没有|无|无明确版本|unknown|not sure|none)$/i.test(
    value.trim()
  );
}
