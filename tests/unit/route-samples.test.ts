import { describe, expect, it } from "vitest";
import { isRouteInputSufficient, ROUTE_KEYS } from "@/domain/routes";
import { ROUTE_SAMPLES } from "@/domain/route-samples";

describe("route AI tuning samples", () => {
  it("includes complete samples for every route", () => {
    for (const routeKey of ROUTE_KEYS) {
      const completeSamples = ROUTE_SAMPLES.filter(
        (sample) => sample.routeKey === routeKey && sample.kind === "complete",
      );

      expect(completeSamples.length).toBeGreaterThanOrEqual(1);
      expect(completeSamples.every((sample) => isRouteInputSufficient(routeKey, sample.input))).toBe(true);
    }
  });

  it("includes missing-info and safety-trap samples for real model tuning", () => {
    expect(ROUTE_SAMPLES.some((sample) => sample.kind === "missing_info")).toBe(true);
    expect(ROUTE_SAMPLES.filter((sample) => sample.kind === "safety_trap").length).toBeGreaterThanOrEqual(3);
  });

  it("keeps samples grounded in inputs instead of report expectations", () => {
    const serialized = JSON.stringify(ROUTE_SAMPLES);

    expect(serialized).not.toMatch(/基础版报告|完整报告|录取概率|通过率/);
  });
});
