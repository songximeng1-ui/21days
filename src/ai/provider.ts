import type { RouteKey, RouteOutput } from "@/domain/types";

export type AiProviderScenario =
  | "success"
  | "missing_info"
  | "invalid_structure"
  | "unsafe_output"
  | "provider_failure";

export type AiProviderInput = {
  routeKey: RouteKey;
  input: Record<string, unknown>;
};

export interface AiProvider {
  generate(input: AiProviderInput): Promise<RouteOutput>;
}

export class AiProviderError extends Error {
  constructor(
    message = "AI provider unavailable",
    readonly kind: "service_unavailable" | "invalid_json" | "empty_response" | "invalid_request" =
      "service_unavailable",
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}
