import { describe, expect, it } from "vitest";
import { routeOutputSchema } from "@/schemas/route-output";
import { validateRouteOutput } from "@/domain/action-card";

describe("route output contract", () => {
  it("accepts one grounded today action", () => {
    const output = routeOutputSchema.parse({
      routeKey: "experience_to_resume",
      outputType: "route_result",
      shortAssessment: "The experience has enough concrete actions to organize first.",
      routeResult: {
        confirmedFacts: ["planned topics and edited posts"],
        missingFacts: ["audience is still unclear"],
        doNotExaggerate: ["do not claim ownership of the whole account"],
        resumeSnippetDraft: "Supported student club content work by planning topics, editing, and publishing posts.",
        supportingFacts: ["planned topics", "edited posts", "published posts"],
      },
      missingInfo: null,
      todayAction: {
        actionTitle: "Confirm 3 actions you actually did in this experience",
        actionReason: "The facts need clear boundaries before saving a resume snippet.",
        actionSteps: ["Open the original material", "List 3 real actions", "Remove claims you did not do"],
        estimatedTime: "15-30 minutes",
        recordAfterDone: "Record the actions, deliverable, and remaining uncertainty.",
        actionType: "experience_fact",
      },
      recordGuide: {
        recordType: "experience_fact",
        fieldsToRecord: ["actualActions", "deliverable", "missingFacts"],
        requiresUserConfirmation: true,
      },
    });

    expect(validateRouteOutput(output)).toEqual({ passed: true, issues: [] });
  });

  it("rejects an action framed as multiple separate tasks", () => {
    const output = routeOutputSchema.parse({
      routeKey: "direction_to_jobs",
      outputType: "route_result",
      shortAssessment: "Several directions can be explored.",
      routeResult: {
        explorableDirections: [],
      },
      missingInfo: null,
      todayAction: {
        actionTitle: "Finish three job-search tasks today",
        actionReason: "Direction, resume, and applications all matter.",
        actionSteps: ["Find 3 jobs", "Rewrite the full resume", "Apply to 10 jobs"],
        estimatedTime: "15-30 minutes",
        recordAfterDone: "Record the jobs.",
        actionType: "job_sample",
      },
      recordGuide: {
        recordType: "job_sample",
        fieldsToRecord: ["jobTitle"],
        requiresUserConfirmation: true,
      },
    });

    expect(validateRouteOutput(output).passed).toBe(false);
  });
});
