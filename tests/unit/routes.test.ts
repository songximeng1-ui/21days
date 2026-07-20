import { describe, expect, it } from "vitest";
import {
  ROUTE_KEYS,
  getRouteStrategy,
  isRouteInputSufficient,
} from "@/domain/routes";

describe("route strategies", () => {
  it("keeps four independent route strategies", () => {
    expect(ROUTE_KEYS).toEqual([
      "direction_to_jobs",
      "experience_to_resume",
      "jd_to_revision",
      "applications_to_review",
    ]);

    const recordTypes = ROUTE_KEYS.map((routeKey) => getRouteStrategy(routeKey).recordType);
    expect(new Set(recordTypes).size).toBe(4);
  });

  it("marks complete experience input sufficient", () => {
    expect(
      isRouteInputSufficient("experience_to_resume", {
        targetDirection: "operations",
        rawExperience: "student club account",
        actualActions: "planned topics, edited posts, published content",
        deliverableOrResult: "published 6 posts",
      })
    ).toBe(true);
  });

  it("marks missing JD input insufficient for JD revision", () => {
    expect(
      isRouteInputSufficient("jd_to_revision", {
        targetJobTitle: "operations intern",
        userMaterial: "managed a student club account",
      })
    ).toBe(false);
  });
});

