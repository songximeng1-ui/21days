import { describe, expect, it } from "vitest";
import { MockAiProvider } from "@/ai/mock-provider";
import { generateRouteOutput } from "@/ai/orchestrator";

describe("generateRouteOutput", () => {
  it("returns missing info action for incomplete JD route input", async () => {
    const result = await generateRouteOutput({
      routeKey: "jd_to_revision",
      input: { targetJobTitle: "operations intern" },
      provider: new MockAiProvider("success"),
    });

    expect(result.outputType).toBe("missing_info");
    expect(result.todayAction.actionType).toBe("fill_info");
    expect(result.todayAction.actionTitle).toContain("JD");
  });

  it("hides provider failures behind friendly failure copy", async () => {
    const result = await generateRouteOutput({
      routeKey: "experience_to_resume",
      input: {
        targetDirection: "operations",
        rawExperience: "student club event",
        actualActions: "organized sign-up sheet",
        deliverableOrResult: "no clear result",
      },
      provider: new MockAiProvider("provider_failure"),
    });

    expect(result.outputType).toBe("friendly_failure");
    expect(JSON.stringify(result)).not.toMatch(/DeepSeek|Qwen|fallback|token|prompt|API/i);
    expect(result.shortAssessment).toContain("暂时没整理出来");
  });

  it("keeps route-specific mock outputs for every route", async () => {
    const cases = [
      ["direction_to_jobs", "job_sample"],
      ["experience_to_resume", "experience_fact"],
      ["jd_to_revision", "jd_revision"],
      ["applications_to_review", "application_record"],
    ] as const;

    for (const [routeKey, actionType] of cases) {
      const result = await generateRouteOutput({
        routeKey,
        input:
          routeKey === "applications_to_review"
            ? { applications: "job/company/date/status" }
            : {
                educationBackground: "major",
                realExperiences: "project",
                interestsOrAcceptables: "content",
                targetDirection: "operations",
                rawExperience: "club",
                actualActions: "organized",
                deliverableOrResult: "no clear result",
                targetJobTitle: "intern",
                jdTextOrRequirements: "content work",
                userMaterial: "club content",
              },
        provider: new MockAiProvider("success"),
      });

      expect(result.outputType).toBe("route_result");
      expect(result.todayAction.actionType).toBe(actionType);
    }
  });
});
