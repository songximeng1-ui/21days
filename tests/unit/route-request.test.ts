import { describe, expect, it } from "vitest";
import { getRouteContract } from "@/domain/route-contracts";
import { routeRequestSchema } from "@/schemas/route-request";

describe("route request contract", () => {
  it("declares and accepts the existing optional JD currentQuestion field consistently", () => {
    expect(getRouteContract("jd_to_revision").optionalInputFields).toContain("currentQuestion");
    const result = routeRequestSchema.safeParse({
      routeKey: "jd_to_revision",
      input: {
        targetJobTitle: "内容运营实习",
        jdTextOrRequirements: "负责内容整理",
        userMaterial: "整理报名表",
        currentQuestion: "先改哪一句？",
      },
    });

    expect(result.success).toBe(true);
  });
});
