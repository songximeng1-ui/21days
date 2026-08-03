import type { OutputProvenance } from "@/domain/provenance";
import type { RouteOutput } from "@/domain/types";

export function withTestProvenance<T extends RouteOutput>(output: T): T {
  const provenance: OutputProvenance = {};
  const visit = (value: unknown, path: string) => {
    if (typeof value === "string" && value.trim()) {
      provenance[path] = {
        kind: "fact",
        sources: [{
          sourceType: "user_input",
          path: "testFixture",
          quote: value.trim().slice(0, 12),
        }],
      };
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}.${index}`));
      return;
    }
    if (typeof value === "object" && value !== null) {
      Object.entries(value).forEach(([key, child]) =>
        visit(child, path ? `${path}.${key}` : key),
      );
    }
  };

  visit({
    shortAssessment: output.shortAssessment,
    routeResult: output.routeResult,
    missingInfo: output.missingInfo,
    todayAction: output.todayAction,
    recordGuide: output.recordGuide,
  }, "");
  return { ...output, provenance };
}
