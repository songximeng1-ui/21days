import type { AiFailureStage } from "@/ai/failure-diagnostics";
import {
  AiProviderError,
  type AiProviderErrorKind,
} from "@/ai/provider";
import type { AiProcessingFailureCategory } from "@/ai/processing-failure";

export type AttemptFailure = {
  stage: AiFailureStage;
  code: string;
  retryPrimary: boolean;
  allowFallback: boolean;
  failureClass: "machine_unavailable" | "semantic_invalid";
  durationMs: number;
  schemaPaths?: string[];
  httpStatusClass?: AiProviderError["httpStatusClass"];
  providerErrorCode?: AiProviderError["providerErrorCode"];
  retryAfterMs?: number;
  observation?: AiProviderError["observation"];
};

export function providerFailure(error: unknown, durationMs: number): AttemptFailure {
  if (!(error instanceof AiProviderError)) {
    throw error;
  }
  const eligible = isProviderFailureRetryable(error.kind);
  return {
    stage: providerStage(error.kind),
    code: error.kind,
    retryPrimary: eligible,
    allowFallback: eligible,
    failureClass: "machine_unavailable",
    durationMs,
    httpStatusClass: error.httpStatusClass,
    providerErrorCode: error.providerErrorCode,
    retryAfterMs: error.retryAfterMs,
    observation: error.observation,
  };
}

export function semanticFailure(
  stage: AiFailureStage,
  code: string,
  durationMs: number,
): AttemptFailure {
  return {
    stage,
    code,
    retryPrimary: true,
    allowFallback: false,
    failureClass: "semantic_invalid",
    durationMs,
  };
}

export function processingFailureCategory(
  failure: AttemptFailure,
): AiProcessingFailureCategory {
  if (failure.code === "timeout") return "machine_unavailable";
  if (failure.code === "cancelled") return "cancelled";
  if (failure.code === "circuit_open") return "circuit_open";
  if (failure.stage === "safety") return "safety";
  if (
    failure.stage === "provider_http"
    && (failure.providerErrorCode?.toLowerCase().includes("rate")
      || failure.httpStatusClass === "4xx")
  ) return "rate_limit";
  if (failure.stage === "provider_transport" || failure.stage === "provider_http") {
    return "transport";
  }
  return failure.failureClass === "machine_unavailable"
    ? "machine_unavailable"
    : "invalid_output";
}

function isProviderFailureRetryable(kind: AiProviderErrorKind): boolean {
  return kind !== "non_retryable_http" && kind !== "cancelled" && kind !== "circuit_open";
}

function providerStage(kind: AiProviderErrorKind): AiFailureStage {
  if (kind === "transport" || kind === "timeout" || kind === "cancelled" || kind === "circuit_open") {
    return "provider_transport";
  }
  if (kind === "retryable_http" || kind === "non_retryable_http") return "provider_http";
  if (kind === "envelope_json") return "provider_envelope";
  return "provider_content";
}
