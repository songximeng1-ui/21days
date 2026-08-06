export const ORCHESTRATION_RESPONSE_RESERVE_MS = 1_000;
export const ORCHESTRATION_FALLBACK_MIN_MS = 5_000;
export const ORCHESTRATION_RETRY_MIN_MS = 3_000;
export const ORCHESTRATION_SCHEDULING_MARGIN_MS = 250;

export type RemainingBudgetBucket =
  | "exhausted"
  | "lt_3s"
  | "3_5s"
  | "5_9s"
  | "gte_9s";

export function remainingBudgetMs(deadlineAtMs: number, nowMs = Date.now()): number {
  return Math.max(0, deadlineAtMs - nowMs);
}

export function remainingBudgetBucket(remainingMs: number): RemainingBudgetBucket {
  if (remainingMs <= 0) return "exhausted";
  if (remainingMs < 3_000) return "lt_3s";
  if (remainingMs < 5_000) return "3_5s";
  if (remainingMs < 9_000) return "5_9s";
  return "gte_9s";
}

export function canRetryPrimary(remainingMs: number, hasFallback: boolean): boolean {
  const downstreamReserve = ORCHESTRATION_RESPONSE_RESERVE_MS
    + (hasFallback
      ? ORCHESTRATION_FALLBACK_MIN_MS + ORCHESTRATION_SCHEDULING_MARGIN_MS
      : 0);
  return remainingMs >= ORCHESTRATION_RETRY_MIN_MS + downstreamReserve;
}

export function canStartFallback(remainingMs: number): boolean {
  return remainingMs >= ORCHESTRATION_FALLBACK_MIN_MS + ORCHESTRATION_RESPONSE_RESERVE_MS;
}

export function providerAttemptDeadlineAtMs(
  requestDeadlineAtMs: number,
  downstreamReserveMs: number,
  nowMs = Date.now(),
): number {
  return Math.max(nowMs + 1, requestDeadlineAtMs - downstreamReserveMs);
}
