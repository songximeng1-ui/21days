import { describe, expect, it } from "vitest";
import { resolveProviderRuntimeProfile } from "@/ai/provider-runtime-profile";

describe("resolveProviderRuntimeProfile", () => {
  it("migrates the retired chat alias to V4 Flash non-thinking", () => {
    expect(resolveProviderRuntimeProfile(
      "https://api.deepseek.com",
      "deepseek-chat",
    )).toEqual({
      model: "deepseek-v4-flash",
      thinking: { type: "disabled" },
    });
  });

  it.each(["deepseek-v4-flash", "deepseek-v4-pro"])(
    "keeps %s and disables thinking",
    (model) => {
      expect(resolveProviderRuntimeProfile(
        "https://api.deepseek.com",
        model,
      )).toEqual({ model, thinking: { type: "disabled" } });
    },
  );

  it("rejects the reasoning alias without echoing it", () => {
    expect(() => resolveProviderRuntimeProfile(
      "https://api.deepseek.com",
      "deepseek-reasoner",
    )).toThrow("Invalid AI provider model configuration");
    try {
      resolveProviderRuntimeProfile("https://api.deepseek.com", "deepseek-reasoner");
    } catch (error) {
      expect(String(error)).not.toContain("deepseek-reasoner");
    }
  });

  it("leaves Qwen provider-neutral", () => {
    expect(resolveProviderRuntimeProfile(
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "qwen-plus",
    )).toEqual({ model: "qwen-plus" });
  });

  it("preserves an unrecognized test model without capabilities", () => {
    expect(resolveProviderRuntimeProfile(
      "https://api.deepseek.com",
      "test-model",
    )).toEqual({ model: "test-model" });
  });
});
