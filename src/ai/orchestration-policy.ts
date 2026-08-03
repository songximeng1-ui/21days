import { AiProviderError, type AiProvider } from "@/ai/provider";

type CircuitState = {
  failures: number;
  openUntilMs: number;
  halfOpenInFlight: boolean;
};

const circuitStates = new WeakMap<AiProvider, CircuitState>();
const FAILURE_THRESHOLD = 2;
const DEFAULT_OPEN_MS = 10_000;

export function beginProviderAttempt(provider: AiProvider, nowMs = Date.now()): boolean {
  const state = circuitStates.get(provider);
  if (!state) return true;
  if (state.openUntilMs > nowMs) return false;
  if (state.openUntilMs > 0) {
    if (state.halfOpenInFlight) return false;
    state.halfOpenInFlight = true;
  }
  return true;
}

export function recordProviderSuccess(provider: AiProvider): void {
  circuitStates.delete(provider);
}

export function recordProviderFailure(provider: AiProvider, error: unknown, nowMs = Date.now()): void {
  const previous = circuitStates.get(provider);
  if (!(error instanceof AiProviderError) || !isCircuitFailure(error)) {
    if (previous?.halfOpenInFlight) previous.halfOpenInFlight = false;
    return;
  }
  const failures = (previous?.failures ?? 0) + 1;
  const retryAfterMs = error.retryAfterMs;
  const shouldOpen = retryAfterMs !== undefined || failures >= FAILURE_THRESHOLD || previous?.halfOpenInFlight;
  circuitStates.set(provider, {
    failures,
    openUntilMs: shouldOpen ? nowMs + (retryAfterMs ?? DEFAULT_OPEN_MS) : 0,
    halfOpenInFlight: false,
  });
}

export function getProviderRetryAfterMs(provider: AiProvider, nowMs = Date.now()): number | undefined {
  const state = circuitStates.get(provider);
  if (!state) return undefined;
  if (state.openUntilMs > nowMs) return state.openUntilMs - nowMs;
  return state.halfOpenInFlight ? 1_000 : undefined;
}

function isCircuitFailure(error: AiProviderError): boolean {
  return error.kind === "transport" ||
    error.kind === "timeout" ||
    error.kind === "response_too_large" ||
    error.kind === "retryable_http" ||
    error.kind === "envelope_json" ||
    error.kind === "empty_content" ||
    error.kind === "model_json";
}
