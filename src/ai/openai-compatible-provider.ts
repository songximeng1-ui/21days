import { AiProviderError, type AiProvider, type AiProviderInput } from "@/ai/provider";
import { MockAiProvider } from "@/ai/mock-provider";
import type { RouteOutput } from "@/domain/types";

type FetchLike = typeof fetch;

type OpenAiCompatibleProviderOptions = {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetchFn?: FetchLike;
};

type ProviderEnv = Record<string, string | undefined>;

export class OpenAiCompatibleProvider implements AiProvider {
  private readonly fetchFn: FetchLike;
  private readonly completionsUrl: string;

  constructor(private readonly options: OpenAiCompatibleProviderOptions) {
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
      throw new AiProviderError(`AI provider returned ${response.status}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;

    if (!content) {
      throw new AiProviderError("AI provider returned an empty response");
    }

    try {
      return JSON.parse(stripJsonFence(content)) as RouteOutput;
    } catch {
      throw new AiProviderError("AI provider returned invalid JSON");
    }
  }
}

export function createAiProviderFromEnv(env: ProviderEnv = process.env): AiProvider {
  if (env.DEEPSEEK_API_KEY) {
    return new OpenAiCompatibleProvider({
      apiKey: env.DEEPSEEK_API_KEY,
      baseUrl: env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
      model: env.DEEPSEEK_MODEL ?? "deepseek-chat",
    });
  }

  if (env.OPENAI_API_KEY) {
    return new OpenAiCompatibleProvider({
      apiKey: env.OPENAI_API_KEY,
      baseUrl: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      model: env.OPENAI_MODEL ?? "gpt-4.1-mini",
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
