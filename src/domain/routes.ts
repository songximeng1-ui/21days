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
      return applications.some((application) => hasApplicationRecordDetails(application));
    }

    return hasApplicationRecordDetails(applications);
  }

  return getRouteStrategy(routeKey).requiredFields.every((field) => hasMeaningfulValue(input[field]));
}

function hasApplicationRecordDetails(value: unknown): boolean {
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return ["jobTitle", "companyOrPlatform", "submittedAt", "feedbackStatus"].every((field) =>
      hasMeaningfulValue(record[field])
    );
  }

  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  const parts = normalized.split(/[，,、；;\n]/).map((part) => part.trim()).filter(Boolean);
  const hasJob = /岗位|实习|助理|运营|产品|设计|开发|销售|hr|财务|行政/i.test(normalized);
  const hasCompany = /公司|平台|单位|机构|企业|工作室|厂|店|A\s*公司|B\s*公司/i.test(normalized);
  const hasTime = /\d+\s*(月|日|号)|昨天|今天|上周|本周|202\d|投递/.test(normalized);
  const hasFeedback = /暂无反馈|无反馈|没反馈|已拒|拒绝|面试|笔试|待回复|通过|反馈状态/.test(normalized);

  return parts.length >= 4 || (hasJob && hasCompany && hasTime && hasFeedback);
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
