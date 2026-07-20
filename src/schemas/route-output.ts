import { z } from "zod";
import { ROUTE_KEYS } from "@/domain/types";

export const todayActionSchema = z.object({
  actionTitle: z.string().min(1),
  actionReason: z.string().min(1),
  actionSteps: z.array(z.string().min(1)).min(1).max(4),
  estimatedTime: z.string().min(1),
  recordAfterDone: z.string().min(1),
  actionType: z.enum([
    "job_sample",
    "experience_fact",
    "resume_snippet",
    "jd_revision",
    "application_record",
    "feedback_record",
    "fill_info",
  ]),
});

export const recordGuideSchema = z.object({
  recordType: z.enum([
    "job_sample",
    "experience_fact",
    "resume_snippet",
    "jd_compare",
    "application",
    "feedback",
    "fill_info",
  ]),
  fieldsToRecord: z.array(z.string().min(1)),
  requiresUserConfirmation: z.boolean(),
});

export const missingInfoSchema = z.object({
  cannotJudge: z.string().min(1),
  alreadyKnown: z.array(z.string()),
  missingFields: z.array(z.string()),
  fillAction: todayActionSchema.optional(),
});

export const routeOutputSchema = z.object({
  routeKey: z.enum(ROUTE_KEYS),
  outputType: z.enum(["route_result", "missing_info", "light_review", "friendly_failure"]),
  shortAssessment: z.string().min(1),
  routeResult: z.record(z.string(), z.unknown()).nullable(),
  missingInfo: missingInfoSchema.nullable(),
  todayAction: todayActionSchema,
  recordGuide: recordGuideSchema,
});

export type ParsedRouteOutput = z.infer<typeof routeOutputSchema>;
