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
  durationBucket: "lt_100ms" | "100_499ms" | "500_1999ms" | "gte_2000ms";
  schemaPaths?: string[];
  httpStatusClass?: AiHttpStatusClass;
};

export interface AiFailureReporter {
  report(event: AiFailureEvent): void | Promise<void>;
}

export const noopAiFailureReporter: AiFailureReporter = Object.freeze({
  report() {},
});

export const NOOP_AI_FAILURE_REPORTER = noopAiFailureReporter;
