export type AiProcessingFailureCategory =
  | "machine_unavailable"
  | "transport"
  | "rate_limit"
  | "circuit_open"
  | "timeout"
  | "deadline"
  | "cancelled"
  | "invalid_output"
  | "safety"
  | "sensitive_input";

export type AiProcessingFailure = {
  error: "ai_processing_failure";
  category: AiProcessingFailureCategory;
  message: string;
  requestId: string;
  retryable: boolean;
};

export class AiProcessingError extends Error {
  constructor(
    readonly category: AiProcessingFailureCategory,
    readonly requestId: string,
    readonly retryAfterMs?: number,
  ) {
    super("AI processing did not produce a usable result");
    this.name = "AiProcessingError";
  }
}

export function toAiProcessingFailure(
  error: AiProcessingError,
): AiProcessingFailure {
  const message = error.category === "machine_unavailable"
    ? "服务暂时没有返回结果。你的草稿已保存，请稍后再试。"
    : error.category === "invalid_output" || error.category === "safety"
      ? "这次没有生成足够可靠的建议。你的草稿已保存，可以稍后再试。"
      : "这次暂时没整理出来。你填写的内容还保留在本页，可以再整理一次。";
  return {
    error: "ai_processing_failure",
    category: error.category,
    message,
    requestId: error.requestId,
    retryable: error.category !== "safety" && error.category !== "cancelled",
  };
}
