import type { ActionType, RecordType, RouteKey } from "@/domain/types";

export type RouteContract = {
  inputFields: readonly string[];
  optionalInputFields?: readonly string[];
  evidenceFields: readonly string[];
  actionType: ActionType;
  recordType: RecordType;
  fieldsToRecord: readonly string[];
  routeResultKeys: readonly string[];
};

export const APPLICATION_RECORD_FIELDS = [
  "jobTitle",
  "companyOrPlatform",
  "submittedAt",
  "feedbackStatus",
  "jdSummary",
  "materialVersion",
] as const;

export const ROUTE_CONTRACTS: Record<RouteKey, RouteContract> = {
  direction_to_jobs: {
    inputFields: [
      "educationBackground",
      "realExperiences",
      "interestsOrAcceptables",
    ],
    optionalInputFields: ["constraints"],
    evidenceFields: [
      "educationBackground",
      "realExperiences",
      "interestsOrAcceptables",
      "constraints",
    ],
    actionType: "job_sample",
    recordType: "job_sample",
    fieldsToRecord: [
      "jobTitle",
      "companyOrPlatform",
      "jdSummary",
      "interestPoint",
      "concernPoint",
    ],
    routeResultKeys: ["explorableDirections"],
  },
  experience_to_resume: {
    inputFields: ["targetDirection", "rawExperience", "actualActions", "deliverableOrResult"],
    evidenceFields: ["targetDirection", "rawExperience", "actualActions", "deliverableOrResult"],
    actionType: "experience_fact",
    recordType: "experience_fact",
    fieldsToRecord: ["actualActions", "deliverable", "missingFacts"],
    routeResultKeys: [
      "confirmedFacts",
      "missingFacts",
      "doNotExaggerate",
      "resumeSnippetDraft",
      "supportingFacts",
    ],
  },
  jd_to_revision: {
    inputFields: ["targetJobTitle", "jdTextOrRequirements", "userMaterial"],
    optionalInputFields: ["currentQuestion"],
    evidenceFields: ["targetJobTitle", "jdTextOrRequirements", "userMaterial"],
    actionType: "jd_revision",
    recordType: "jd_compare",
    fieldsToRecord: ["targetJobTitle", "beforeSnippet", "afterSnippet", "jdRequirement", "submitted"],
    routeResultKeys: [
      "jdKeyRequirements",
      "supportedByMaterial",
      "unclearFromMaterial",
      "minimalRevisionActions",
      "afterSubmissionRecording",
    ],
  },
  applications_to_review: {
    inputFields: ["applications"],
    evidenceFields: ["applications"],
    actionType: "application_record",
    recordType: "application",
    fieldsToRecord: [...APPLICATION_RECORD_FIELDS],
    routeResultKeys: [
      "reviewBasis",
      "recordSufficiency",
      "possibleClues",
      "informationGaps",
      "nextValidationAction",
    ],
  },
};

export function getRouteContract(routeKey: RouteKey): RouteContract {
  return ROUTE_CONTRACTS[routeKey];
}
