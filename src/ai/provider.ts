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
  retryFeedback?: AiRetryFeedback;
  signal?: AbortSignal;
  deadlineAtMs?: number;
};

export type AiRetryFeedback = {
  stage?:
    | "candidate_schema"
    | "route_mismatch"
    | "route_shape"
    | "action"
    | "safety"
    | "grounding";
  code:
    | "candidate_zod"
    | "route_mismatch"
    | "unexpected_output_type"
    | "route_shape"
    | "action_contract"
    | "safety_boundary"
    | "grounding_failure"
    | "provider_retryable";
  schemaPaths?: string[];
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
  | "timeout"
  | "cancelled"
  | "circuit_open"
  | "response_too_large"
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
    readonly providerErrorCode?: string,
    readonly retryAfterMs?: number,
  ) {
    super("AI provider request failed");
    this.name = "AiProviderError";
  }
}
