export const ROUTE_KEYS = [
  "direction_to_jobs",
  "experience_to_resume",
  "jd_to_revision",
  "applications_to_review",
] as const;

export type RouteKey = (typeof ROUTE_KEYS)[number];

export type OutputType = "route_result" | "missing_info" | "light_review" | "friendly_failure";

export type ActionType =
  | "job_sample"
  | "experience_fact"
  | "resume_snippet"
  | "jd_revision"
  | "application_record"
  | "feedback_record"
  | "fill_info";

export type RecordType =
  | "job_sample"
  | "experience_fact"
  | "resume_snippet"
  | "jd_compare"
  | "application"
  | "feedback"
  | "fill_info";

export type TodayAction = {
  actionTitle: string;
  actionReason: string;
  actionSteps: string[];
  estimatedTime: string;
  recordAfterDone: string;
  actionType: ActionType;
};

export type RecordGuide = {
  recordType: RecordType;
  fieldsToRecord: string[];
  requiresUserConfirmation: boolean;
};

export type MissingInfo = {
  cannotJudge: string;
  alreadyKnown: string[];
  missingFields: string[];
  fillAction?: TodayAction;
};

export type RouteOutput = {
  routeKey: RouteKey;
  outputType: OutputType;
  shortAssessment: string;
  routeResult: Record<string, unknown> | null;
  missingInfo: MissingInfo | null;
  todayAction: TodayAction;
  recordGuide: RecordGuide;
};
