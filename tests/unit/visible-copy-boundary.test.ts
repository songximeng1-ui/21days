import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const userFacingFiles = [
  "src/app/page.tsx",
  "src/app/review/page.tsx",
  "src/app/routes/[routeKey]/action/page.tsx",
  "src/app/routes/[routeKey]/input/page.tsx",
  "src/app/routes/[routeKey]/record/page.tsx",
  "src/app/track/page.tsx",
];

const forbiddenCopy = [
  "匹配度",
  "录取概率",
  "适合你",
  "不适合你",
  "能力不行",
  "生成报告",
  "路线轻输入",
  "系统才能",
  "DeepSeek",
  "Qwen",
  "API key",
];

describe("visible product copy boundaries", () => {
  it("keeps user-facing pages away from scoring, model, report, and internal-flow wording", () => {
    const visibleCopy = userFacingFiles
      .map((file) => readFileSync(join(process.cwd(), file), "utf8"))
      .join("\n");

    for (const forbidden of forbiddenCopy) {
      expect(visibleCopy).not.toContain(forbidden);
    }
  });
});
