import { z } from "zod";

const scenarioSchema = z
  .enum(["success", "missing_info", "invalid_structure", "unsafe_output", "provider_failure"])
  .default("success");

const directionInputSchema = z.object({
  educationBackground: z.string().optional(),
  realExperiences: z.string().optional(),
  interestsOrAcceptables: z.string().optional(),
  constraints: z.string().optional(),
}).strict();

const experienceInputSchema = z.object({
  targetDirection: z.string().optional(),
  rawExperience: z.string().optional(),
  actualActions: z.string().optional(),
  deliverableOrResult: z.string().optional(),
}).strict();

const jdInputSchema = z.object({
  targetJobTitle: z.string().optional(),
  jdTextOrRequirements: z.string().optional(),
  userMaterial: z.string().optional(),
  currentQuestion: z.string().optional(),
}).strict();

export const applicationInputItemSchema = z.object({
  jobTitle: z.string().optional(),
  companyOrPlatform: z.string().optional(),
  submittedAt: z.string().optional(),
  feedbackStatus: z.string().optional(),
  jdSummary: z.string().optional(),
  materialVersion: z.string().optional(),
  userSuspicion: z.string().optional(),
}).strict();

const applicationInputSchema = z.object({
  applications: z.array(applicationInputItemSchema).optional(),
}).strict();

const routeModeSchema = z.discriminatedUnion("routeKey", [
  z.object({
    mode: z.literal("route").default("route"),
    routeKey: z.literal("direction_to_jobs"),
    input: directionInputSchema.default({}),
    scenario: scenarioSchema,
  }).strict(),
  z.object({
    mode: z.literal("route").default("route"),
    routeKey: z.literal("experience_to_resume"),
    input: experienceInputSchema.default({}),
    scenario: scenarioSchema,
  }).strict(),
  z.object({
    mode: z.literal("route").default("route"),
    routeKey: z.literal("jd_to_revision"),
    input: jdInputSchema.default({}),
    scenario: scenarioSchema,
  }).strict(),
  z.object({
    mode: z.literal("route").default("route"),
    routeKey: z.literal("applications_to_review"),
    input: applicationInputSchema.default({}),
    scenario: scenarioSchema,
  }).strict(),
]);

const singleRecordReviewInputSchema = z.object({ record: z.unknown() }).strict();
const applicationRecordsReviewInputSchema = z.object({
  records: z.array(z.unknown()).min(2).max(7),
}).strict();

const lightReviewModeSchema = z.discriminatedUnion("routeKey", [
  z.object({
    mode: z.literal("light_review"),
    routeKey: z.literal("direction_to_jobs"),
    input: singleRecordReviewInputSchema,
    scenario: scenarioSchema,
  }).strict(),
  z.object({
    mode: z.literal("light_review"),
    routeKey: z.literal("experience_to_resume"),
    input: singleRecordReviewInputSchema,
    scenario: scenarioSchema,
  }).strict(),
  z.object({
    mode: z.literal("light_review"),
    routeKey: z.literal("jd_to_revision"),
    input: singleRecordReviewInputSchema,
    scenario: scenarioSchema,
  }).strict(),
  z.object({
    mode: z.literal("light_review"),
    routeKey: z.literal("applications_to_review"),
    input: applicationRecordsReviewInputSchema,
    scenario: scenarioSchema,
  }).strict(),
]);

export const routeRequestSchema = z.union([routeModeSchema, lightReviewModeSchema]);
export type ParsedRouteRequest = z.infer<typeof routeRequestSchema>;
