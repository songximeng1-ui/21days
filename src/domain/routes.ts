import { ROUTE_KEYS, type RecordType, type RouteKey } from "@/domain/types";

export { ROUTE_KEYS };

type RouteStrategy = {
  routeKey: RouteKey;
  label: string;
  recordType: RecordType;
  requiredFields: string[];
};

const ROUTE_STRATEGIES: Record<RouteKey, RouteStrategy> = {
  direction_to_jobs: {
    routeKey: "direction_to_jobs",
    label: "我不知道能投哪些岗位",
    recordType: "job_sample",
    requiredFields: ["educationBackground", "realExperiences", "interestsOrAcceptables"],
  },
  experience_to_resume: {
    routeKey: "experience_to_resume",
    label: "我的经历不知道怎么写进简历",
    recordType: "experience_fact",
    requiredFields: ["targetDirection", "rawExperience", "actualActions", "deliverableOrResult"],
  },
  jd_to_revision: {
    routeKey: "jd_to_revision",
    label: "我看到岗位了，不知道投递前怎么改",
    recordType: "jd_compare",
    requiredFields: ["targetJobTitle", "jdTextOrRequirements", "userMaterial"],
  },
  applications_to_review: {
    routeKey: "applications_to_review",
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
      return applications.length >= 1;
    }

    return hasMeaningfulValue(applications);
  }

  return getRouteStrategy(routeKey).requiredFields.every((field) => hasMeaningfulValue(input[field]));
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
