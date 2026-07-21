import { afterEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/ai/route";

const originalNodeEnv = process.env.NODE_ENV;
const originalDeepseekKey = process.env.DEEPSEEK_API_KEY;

describe("POST /api/ai", () => {
  afterEach(() => {
    setEnv("NODE_ENV", originalNodeEnv);
    setEnv("DEEPSEEK_API_KEY", originalDeepseekKey);
  });

  it("does not let production requests choose a successful mock scenario when no provider key exists", async () => {
    setEnv("NODE_ENV", "production");
    delete process.env.DEEPSEEK_API_KEY;

    const response = await POST(
      new Request("http://localhost/api/ai", {
        method: "POST",
        body: JSON.stringify({
          routeKey: "jd_to_revision",
          scenario: "success",
          input: {
            targetJobTitle: "产品运营实习",
            jdTextOrRequirements: "负责用户调研、数据整理、活动复盘",
            userMaterial: "社团活动经历",
          },
        }),
      }),
    );
    const output = await response.json();

    expect(output.outputType).toBe("friendly_failure");
    expect(JSON.stringify(output)).not.toMatch(/DeepSeek|Qwen|fallback|prompt|token|API/i);
  });
});

function setEnv(key: "NODE_ENV" | "DEEPSEEK_API_KEY", value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
