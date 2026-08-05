import type { AiHttpStatusClass } from "@/ai/provider";
import type { RouteKey } from "@/domain/types";

export type AiFailureStage =
  | "provider_transport"
  | "provider_http"
  | "provider_envelope"
  | "provider_content"
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
  failureClass: "machine_unavailable" | "semantic_invalid";
  recoveryDecision: "retry_primary" | "try_fallback" | "stop";
  durationBucket: "lt_100ms" | "100_499ms" | "500_1999ms" | "gte_2000ms";
  schemaPaths?: string[];
  httpStatusClass?: AiHttpStatusClass;
  providerErrorCode?: string;
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
        ...(event.schemaPaths ? { schemaPaths: [...event.schemaPaths] } : {}),
        ...(event.httpStatusClass ? { httpStatusClass: event.httpStatusClass } : {}),
        ...(event.providerErrorCode ? { providerErrorCode: event.providerErrorCode } : {}),
      };
      return logger(safeEvent);
    },
  });
}

export const noopAiFailureReporter: AiFailureReporter = Object.freeze({
  report() {},
});

export const NOOP_AI_FAILURE_REPORTER = noopAiFailureReporter;
