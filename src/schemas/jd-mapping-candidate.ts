import { z } from "zod";

const sourceIdSchema = z.string().regex(/^src_[a-f0-9]{16}_\d+$/);
const relationSchema = z.enum(["direct", "partial", "unsupported"]);
const dispositionSchema = z.enum(["replace", "insert", "collect_evidence", "keep"]);

const decisionSchema = z.object({
  requirementId: sourceIdSchema,
  evidenceIds: z.array(sourceIdSchema).max(3),
  relation: relationSchema,
  disposition: dispositionSchema,
  revisionTargetId: sourceIdSchema.nullable(),
  candidate: z.string().min(1).max(1_000).nullable(),
  reason: z.string().min(1).max(1_000),
  conflictSourceIds: z.tuple([sourceIdSchema, sourceIdSchema]).nullable(),
}).strict().superRefine((decision, context) => {
  const hasEvidence = decision.evidenceIds.length > 0;
  if (new Set(decision.evidenceIds).size !== decision.evidenceIds.length) {
    context.addIssue({ code: "custom", path: ["evidenceIds"], message: "Evidence IDs must be unique." });
  }
  if (decision.relation === "unsupported" && hasEvidence) {
    context.addIssue({ code: "custom", path: ["evidenceIds"], message: "Unsupported requirements cannot cite supporting evidence." });
  }
  if (decision.relation !== "unsupported" && !hasEvidence) {
    context.addIssue({ code: "custom", path: ["evidenceIds"], message: "Direct and partial relations require exact evidence IDs." });
  }
  if (decision.relation === "unsupported" && decision.disposition !== "collect_evidence") {
    context.addIssue({ code: "custom", path: ["disposition"], message: "Unsupported requirements must collect evidence." });
  }
  if (decision.disposition === "keep" && decision.relation !== "direct") {
    context.addIssue({ code: "custom", path: ["disposition"], message: "Keep requires direct evidence." });
  }
  const changesMaterial = decision.disposition === "replace" || decision.disposition === "insert";
  if (changesMaterial && (!decision.candidate || !decision.revisionTargetId)) {
    context.addIssue({ code: "custom", message: "Replace and insert require a candidate and an exact revision target ID." });
  }
  if (!changesMaterial && (decision.candidate !== null || decision.revisionTargetId !== null)) {
    context.addIssue({ code: "custom", message: "Keep and collect_evidence cannot carry material changes." });
  }
  if (decision.revisionTargetId && !decision.evidenceIds.includes(decision.revisionTargetId)) {
    context.addIssue({ code: "custom", path: ["revisionTargetId"], message: "Revision target must be one of the cited exact evidence IDs." });
  }
  if (
    decision.conflictSourceIds
    && decision.conflictSourceIds[0] === decision.conflictSourceIds[1]
  ) {
    context.addIssue({ code: "custom", path: ["conflictSourceIds"], message: "A conflict requires two distinct exact source IDs." });
  }
});

export const jdMappingCandidateSchema = z.object({
  routeKey: z.literal("jd_to_revision"),
  selectedRequirementIds: z.array(sourceIdSchema).min(1).max(5),
  decisions: z.array(decisionSchema).min(1).max(5),
}).strict().superRefine((candidate, context) => {
  const selected = new Set(candidate.selectedRequirementIds);
  const decided = new Set(candidate.decisions.map((decision) => decision.requirementId));
  if (selected.size !== candidate.selectedRequirementIds.length) {
    context.addIssue({ code: "custom", path: ["selectedRequirementIds"], message: "Selected requirement IDs must be unique." });
  }
  if (decided.size !== candidate.decisions.length) {
    context.addIssue({ code: "custom", path: ["decisions"], message: "Each selected requirement must have one decision." });
  }
  if (selected.size !== decided.size || [...selected].some((id) => !decided.has(id))) {
    context.addIssue({ code: "custom", path: ["decisions"], message: "Decisions must completely cover the selected requirement IDs." });
  }
});

export type JdMappingCandidate = z.infer<typeof jdMappingCandidateSchema>;
export type JdMappingDecision = JdMappingCandidate["decisions"][number];
