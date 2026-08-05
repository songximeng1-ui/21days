import { describe, expect, it } from "vitest";
import { getRouteContract } from "@/domain/route-contracts";
import { routeRequestSchema } from "@/schemas/route-request";

describe("route request contract", () => {
  it("declares and accepts the existing optional JD currentQuestion field consistently", () => {
    expect(getRouteContract("jd_to_revision").optionalInputFields).toContain("currentQuestion");
    const result = routeRequestSchema.safeParse({
      routeKey: "jd_to_revision",
      requestMetadata: {
        clientRequestId: "11111111-1111-4111-8111-111111111111",
        draftRevision: 3,
        idempotencyKey: "22222222-2222-4222-8222-222222222222",
      },
      input: {
        targetJobTitle: "内容运营实习",
        jdTextOrRequirements: "负责内容整理",
        userMaterial: "整理报名表",
        currentQuestion: "先改哪一句？",
      },
    });

    expect(result.success).toBe(true);
  });

  it("keeps parsing an older client request while new clients always send metadata", () => {
    const result = routeRequestSchema.safeParse({
      routeKey: "jd_to_revision",
      input: {
        targetJobTitle: "内容运营实习",
        jdTextOrRequirements: "负责内容整理",
        userMaterial: "整理报名表",
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects malformed request metadata before it can reach an AI provider", () => {
    const result = routeRequestSchema.safeParse({
      routeKey: "jd_to_revision",
      requestMetadata: {
        clientRequestId: "not-a-uuid",
        draftRevision: -1,
        idempotencyKey: "also-not-a-uuid",
      },
      input: {
        targetJobTitle: "内容运营实习",
        jdTextOrRequirements: "负责内容整理",
        userMaterial: "整理报名表",
      },
    });

    expect(result.success).toBe(false);
  });
});
