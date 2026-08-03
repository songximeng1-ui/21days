import { describe, expect, it } from "vitest";
import {
  beginProviderAttempt,
  recordProviderFailure,
} from "@/ai/orchestration-policy";
import { AiProviderError, type AiProvider } from "@/ai/provider";

describe("orchestration policy", () => {
  it("opens the circuit after repeated oversized provider responses", () => {
    const provider: AiProvider = {
      generate: async () => {
        throw new Error("not used");
      },
    };

    recordProviderFailure(provider, new AiProviderError("response_too_large"), 0);
    expect(beginProviderAttempt(provider, 0)).toBe(true);
    recordProviderFailure(provider, new AiProviderError("response_too_large"), 1);

    expect(beginProviderAttempt(provider, 2)).toBe(false);
  });

  it("releases a half-open probe when caller cancellation ends the attempt", () => {
    const provider: AiProvider = {
      generate: async () => {
        throw new Error("not used");
      },
    };

    recordProviderFailure(
      provider,
      new AiProviderError("retryable_http", "5xx", undefined, 10),
      0,
    );
    expect(beginProviderAttempt(provider, 11)).toBe(true);

    recordProviderFailure(provider, new AiProviderError("cancelled"), 11);

    expect(beginProviderAttempt(provider, 12)).toBe(true);
  });
});
