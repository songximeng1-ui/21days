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

export interface AiProviderSet extends AiProvider {
  readonly primary: AiProvider;
  readonly fallback?: AiProvider;
}

export type AiProviderErrorKind =
  | "transport"
  | "retryable_http"
  | "non_retryable_http"
  | "envelope_json"
  | "empty_content"
  | "model_json";

export type AiHttpStatusClass = "3xx" | "4xx" | "5xx";

export class AiProviderError extends Error {
  constructor(
    readonly kind: AiProviderErrorKind = "transport",
    readonly httpStatusClass?: AiHttpStatusClass,
  ) {
    super("AI provider request failed");
    this.name = "AiProviderError";
  }
}
