import { z } from "zod";

const mappingSchema = z.object({
  requirementId: z.string().regex(/^req-[1-5]$/),
  materialId: z.string().regex(/^mat-[1-5]$/).nullable(),
  candidate: z.string().min(1).max(1_000).nullable(),
  reason: z.string().min(1).max(1_000),
  risk: z.string().min(1).max(1_000).nullable(),
}).strict().superRefine((mapping, context) => {
  if (mapping.materialId === null && mapping.candidate !== null) {
    context.addIssue({
      code: "custom",
      path: ["candidate"],
      message: "A candidate requires mapped material evidence.",
    });
  }
});

export const jdMappingCandidateSchema = z.object({
  routeKey: z.literal("jd_to_revision"),
  mappings: z.array(mappingSchema).min(1).max(5),
}).strict();

export type JdMappingCandidate = z.infer<typeof jdMappingCandidateSchema>;
