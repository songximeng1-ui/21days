import { AiProviderError, type AiProvider, type AiProviderInput } from "@/ai/provider";
import { MockAiProvider } from "@/ai/mock-provider";
import type { RouteOutput } from "@/domain/types";

type FetchLike = typeof fetch;

type ChatCompletionProviderOptions = {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetchFn?: FetchLike;
};

type ProviderEnv = Record<string, string | undefined>;
type RetryFallbackAiProviderOptions = {
  primary: AiProvider;
  fallback?: AiProvider;
  primaryAttempts?: number;
};

export class ChatCompletionProvider implements AiProvider {
  private readonly fetchFn: FetchLike;
  private readonly completionsUrl: string;

  constructor(private readonly options: ChatCompletionProviderOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.completionsUrl = `${options.baseUrl.replace(/\/$/, "")}/chat/completions`;
  }

  async generate(input: AiProviderInput): Promise<RouteOutput> {
    const response = await this.fetchFn(this.completionsUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.options.model,
        temperature: 0.2,
        max_tokens: 1000,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: buildSystemPrompt(),
          },
          {
            role: "user",
            content: buildUserPrompt(input),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new AiProviderError(`AI provider returned ${response.status}`, "service_unavailable");
    }

    let payload: {
      choices?: Array<{ message?: { content?: string } }>;
    };

    try {
      payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
    } catch {
      throw new AiProviderError("AI provider returned invalid JSON body", "invalid_json");
    }
    const content = payload.choices?.[0]?.message?.content;

    if (!content) {
      throw new AiProviderError("AI provider returned an empty response", "empty_response");
    }

    try {
      return JSON.parse(stripJsonFence(content)) as RouteOutput;
    } catch {
      throw new AiProviderError("AI provider returned invalid JSON", "invalid_json");
    }
  }
}

export class RetryFallbackAiProvider implements AiProvider {
  private readonly primaryAttempts: number;

  constructor(private readonly options: RetryFallbackAiProviderOptions) {
    this.primaryAttempts = options.primaryAttempts ?? 2;
  }

  async generate(input: AiProviderInput): Promise<RouteOutput> {
    let lastError: unknown;

    for (let attempt = 0; attempt < this.primaryAttempts; attempt += 1) {
      try {
        return await this.options.primary.generate(input);
      } catch (error) {
        lastError = error;
      }
    }

    if (this.options.fallback) {
      if (lastError instanceof AiProviderError && lastError.kind !== "service_unavailable") {
        throw lastError;
      }

      return this.options.fallback.generate(input);
    }

    throw lastError instanceof Error ? lastError : new AiProviderError();
  }
}

export function createAiProviderFromEnv(env: ProviderEnv = process.env, fetchFn?: FetchLike): AiProvider {
  if (env.DEEPSEEK_API_KEY) {
    const primary = new ChatCompletionProvider({
      apiKey: env.DEEPSEEK_API_KEY,
      baseUrl: env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
      model: env.DEEPSEEK_MODEL ?? "deepseek-chat",
      fetchFn,
    });

    const fallback = env.QWEN_API_KEY
      ? new ChatCompletionProvider({
          apiKey: env.QWEN_API_KEY,
          baseUrl: env.QWEN_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1",
          model: env.QWEN_MODEL ?? "qwen-plus",
          fetchFn,
        })
      : undefined;

    return new RetryFallbackAiProvider({
      primary,
      fallback,
      primaryAttempts: 2,
    });
  }

  return new MockAiProvider("success");
}

function buildSystemPrompt(): string {
  return [
    "你是“21 天求职行动陪跑”MVP 的结构化输出模块。",
    "只返回 JSON，不要返回 Markdown、解释、代码块或额外文字。",
    "禁止编造用户没有提供的信息。",
    "禁止输出匹配率、录取概率、适合/不适合、职业定论、人格判断。",
    "每次只给一个今天能做的行动，行动必须普通、具体、克制、可执行。",
    "输出必须包含 routeKey、outputType、shortAssessment、routeResult、missingInfo、todayAction、recordGuide。",
    "todayAction.actionSteps 必须是 1 到 4 条。",
    "estimatedTime 优先使用 15-30 分钟。",
  ].join("\n");
}

function buildUserPrompt(input: AiProviderInput): string {
  if (input.input.mode === "light_review") {
    return [
      `路线：${input.routeKey}`,
      "任务：基于用户已确认保存的一条真实记录，生成一次轻复盘。",
      "必须输出 outputType: \"light_review\"。",
      "routeResult 必须包含：reviewBasis、clues、missingInfo、nextAction。",
      "reviewBasis 只能引用 record.actualDone 或 record.payload 中已经存在的事实。",
      "clues 只能写可继续验证的线索，不能写失败原因、公司筛选规则或用户能力判断。",
      "missingInfo 写 1-3 条还缺的信息；没有新缺口时写“暂无新的信息缺口”。",
      "nextAction 只能是 1 个 15-30 分钟内可完成并可记录的小行动。",
      "禁止输出报告、基础版报告、匹配率、匹配度、录取概率、适合/不适合、能投/不能投。",
      "用户记录：",
      JSON.stringify(input.input.record, null, 2),
    ].join("\n");
  }

  return [
    `路线：${input.routeKey}`,
    "请按路线生成结构化 JSON。",
    "四路线边界：",
    "- direction_to_jobs：方向 -> 岗位样本，只给可探索方向和今天保存岗位样本行动。",
    "- experience_to_resume：经历 -> 简历材料，只整理事实、缺口和可保守使用的简历片段。",
    "- jd_to_revision：JD -> 投递前最小修改，只比较 JD 要求与用户材料支撑关系。",
    "- applications_to_review：投递记录 -> 轻复盘，只基于真实记录找一个可验证线索。",
    "用户输入：",
    JSON.stringify(input.input, null, 2),
  ].join("\n");
}

function stripJsonFence(content: string): string {
  return content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
}
