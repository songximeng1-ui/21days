import type { RemainingBudgetBucket } from "@/ai/orchestration-budget";
import type { RouteKey } from "@/domain/types";

export type AiFailureStage =
  | "provider_transport"
  | "provider_http"
  | "provider_envelope"
  | "provider_content"
  | "orchestration"
  | "terminal"
  | "candidate_schema"
  | "route_mismatch"
  | "route_shape"
  | "action"
  | "safety"
  | "grounding";

export type AiFailureEvent = {
  requestId: string;
  routeKey: RouteKey;
  mode: "route" | "light_review";
  providerRole: "primary" | "fallback";
  attempt: number;
  stage: AiFailureStage;
  code: string;
  failureClass: "business_missing_info" | "machine_unavailable" | "semantic_invalid";
  recoveryDecision: "retry_primary" | "try_fallback" | "stop";
  durationBucket: "lt_100ms" | "100_499ms" | "500_1999ms" | "gte_2000ms";
  remainingBudgetBucket?: RemainingBudgetBucket;
  terminalCategory?:
    | "success"
    | "business_missing_info"
    | "machine_unavailable"
    | "semantic_invalid"
    | "deadline"
    | "cancelled"
    | "unexpected_internal";
  finishReason?: "stop" | "length" | "content_filter" | "tool_calls" | "unknown";
  choiceCountBucket?: "zero" | "one" | "many" | "unknown";
  contentShape?: "missing" | "string" | "array" | "other" | "unknown";
  contentLengthBucket?: "empty" | "1_255" | "256_2047" | "gte_2048" | "unknown";
};

export interface AiFailureReporter {
  report(event: AiFailureEvent): void | Promise<void>;
}

type SafeAiFailureLogger = (event: AiFailureEvent) => void | Promise<void>;

export function createSafeAiFailureReporter(
  logger: SafeAiFailureLogger,
): AiFailureReporter {
  return Object.freeze({
    report(event: AiFailureEvent) {
      const safeEvent: AiFailureEvent = {
        requestId: event.requestId,
        routeKey: event.routeKey,
        mode: event.mode,
        providerRole: event.providerRole,
        attempt: event.attempt,
        stage: event.stage,
        code: event.code,
        failureClass: event.failureClass,
        recoveryDecision: event.recoveryDecision,
        durationBucket: event.durationBucket,
        ...(event.remainingBudgetBucket ? { remainingBudgetBucket: event.remainingBudgetBucket } : {}),
        ...(event.terminalCategory ? { terminalCategory: event.terminalCategory } : {}),
        ...(isAllowedValue(event.finishReason, FINISH_REASONS) ? { finishReason: event.finishReason } : {}),
        ...(isAllowedValue(event.choiceCountBucket, CHOICE_COUNT_BUCKETS)
          ? { choiceCountBucket: event.choiceCountBucket }
          : {}),
        ...(isAllowedValue(event.contentShape, CONTENT_SHAPES) ? { contentShape: event.contentShape } : {}),
        ...(isAllowedValue(event.contentLengthBucket, CONTENT_LENGTH_BUCKETS)
          ? { contentLengthBucket: event.contentLengthBucket }
          : {}),
      };
      return logger(safeEvent);
    },
  });
}

const FINISH_REASONS = ["stop", "length", "content_filter", "tool_calls", "unknown"] as const;
const CHOICE_COUNT_BUCKETS = ["zero", "one", "many", "unknown"] as const;
const CONTENT_SHAPES = ["missing", "string", "array", "other", "unknown"] as const;
const CONTENT_LENGTH_BUCKETS = ["empty", "1_255", "256_2047", "gte_2048", "unknown"] as const;

function isAllowedValue<const T extends readonly string[]>(
  value: unknown,
  allowlist: T,
): value is T[number] {
  return typeof value === "string" && (allowlist as readonly string[]).includes(value);
}

export const noopAiFailureReporter: AiFailureReporter = Object.freeze({
  report() {},
});

export const NOOP_AI_FAILURE_REPORTER = noopAiFailureReporter;
