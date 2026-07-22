import { describe, expect, it, vi } from "vitest";
import { ChatCompletionProvider, createAiProviderFromEnv } from "@/ai/chat-completion-provider";
import { AiProviderError } from "@/ai/provider";
import { MockAiProvider } from "@/ai/mock-provider";

const validOutput = {
  routeKey: "experience_to_resume",
  outputType: "route_result",
  shortAssessment: "先把这段经历整理成真实动作。",
  routeResult: {
    confirmedFacts: ["组织过报名信息"],
    missingFacts: ["还缺交付物数量"],
    doNotExaggerate: ["不要写成独立负责"],
    resumeSnippetDraft: "协助整理活动报名信息。",
    supportingFacts: ["报名表整理"],
  },
  missingInfo: null,
  todayAction: {
    actionTitle: "今天先确认这段经历的 3 个真实动作",
    actionReason: "事实边界清楚后，简历表述才可靠。",
    actionSteps: ["列出动作", "标出交付物", "删掉没做过的表述"],
    estimatedTime: "15-30 分钟",
    recordAfterDone: "记录动作、交付物和不确定信息。",
    actionType: "experience_fact",
  },
  recordGuide: {
    recordType: "experience_fact",
    fieldsToRecord: ["actualActions", "deliverable", "missingFacts"],
    requiresUserConfirmation: true,
  },
};

describe("ChatCompletionProvider", () => {
  it("sends a JSON-only chat completion request and parses the model response", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      void _url;
      void _init;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(validOutput),
              },
            },
          ],
        }),
        { status: 200 },
      );
    });
    const provider = new ChatCompletionProvider({
      apiKey: "test-key",
      baseUrl: "https://api.example.com",
      model: "test-model",
      fetchFn: fetchMock,
    });

    const result = await provider.generate({
      routeKey: "experience_to_resume",
      input: {
        targetDirection: "运营",
        rawExperience: "社团活动",
        actualActions: "整理报名表",
        deliverableOrResult: "报名名单",
      },
    });

    expect(result.todayAction.actionType).toBe("experience_fact");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
        }),
      }),
    );
    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const requestInit = firstCall?.[1] as RequestInit;
    const body = JSON.parse(requestInit.body as string);
    expect(body.model).toBe("test-model");
    expect(body.max_tokens).toBe(1000);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(JSON.stringify(body.messages)).toContain("只返回 JSON");
    expect(JSON.stringify(body.messages)).toContain("confirmedFacts");
    expect(JSON.stringify(body.messages)).toContain("resumeSnippetDraft");
    expect(JSON.stringify(body.messages)).toContain("supportingFacts");
    expect(JSON.stringify(body.messages)).toContain("只能逐字引用用户输入中的事实");
  });

  it("adds dedicated light review constraints to light review requests", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      void _url;
      void _init;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ...validOutput,
                  outputType: "light_review",
                  routeResult: {
                    reviewBasis: ["用户记录了一个真实行动"],
                    clues: ["这条记录可以继续补材料版本"],
                    missingInfo: ["还缺材料版本"],
                    nextAction: "下次先补材料版本",
                  },
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    });
    const provider = new ChatCompletionProvider({
      apiKey: "test-key",
      baseUrl: "https://api.example.com",
      model: "test-model",
      fetchFn: fetchMock,
    });

    await provider.generate({
      routeKey: "applications_to_review",
      input: {
        mode: "light_review",
        record: {
          actualDone: "补了内容运营实习、A 公司、7 月 1 日投递、暂无反馈。",
          payload: { jobTitle: "内容运营实习" },
        },
      },
    });

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(requestInit.body as string);
    const messages = JSON.stringify(body.messages);
    expect(messages).toContain("light_review");
    expect(messages).toContain("真实记录");
    expect(messages).toContain("reviewBasis");
    expect(messages).toContain("application_record");
    expect(messages).toContain("recordType: application");
  });

  it.each([
    {
      name: "transport",
      response: () => Promise.reject(new Error("network includes secret-test-key")),
      kind: "transport",
    },
    {
      name: "retryable HTTP",
      response: () => Promise.resolve(new Response("sensitive response body", { status: 503 })),
      kind: "retryable_http",
    },
    {
      name: "non-retryable HTTP",
      response: () => Promise.resolve(new Response("sensitive response body", { status: 400 })),
      kind: "non_retryable_http",
    },
    {
      name: "provider-envelope JSON",
      response: () => Promise.resolve(new Response("sensitive response body", { status: 200 })),
      kind: "envelope_json",
    },
    {
      name: "null provider envelope",
      response: () => Promise.resolve(new Response("null", { status: 200 })),
      kind: "envelope_json",
    },
    {
      name: "object content",
      response: () =>
        Promise.resolve(
          new Response(JSON.stringify({ choices: [{ message: { content: { unsafe: "shape" } } }] }), {
            status: 200,
          }),
        ),
      kind: "envelope_json",
    },
    {
      name: "numeric content",
      response: () =>
        Promise.resolve(
          new Response(JSON.stringify({ choices: [{ message: { content: 42 } }] }), { status: 200 }),
        ),
      kind: "envelope_json",
    },
    {
      name: "empty content",
      response: () =>
        Promise.resolve(
          new Response(JSON.stringify({ choices: [{ message: { content: "   " } }] }), { status: 200 }),
        ),
      kind: "empty_content",
    },
    {
      name: "model-content JSON",
      response: () =>
        Promise.resolve(
          new Response(JSON.stringify({ choices: [{ message: { content: "sensitive response body" } }] }), {
            status: 200,
          }),
        ),
      kind: "model_json",
    },
  ])("makes one HTTP request and exposes a sanitized $name error", async ({ response, kind }) => {
    const fetchMock = vi.fn(response);
    const provider = new ChatCompletionProvider({
      apiKey: "secret-test-key",
      baseUrl: "https://api.example.com?secret=query-value",
      model: "test-model",
      fetchFn: fetchMock,
    });
    const sensitiveInput = "sensitive user input";

    const error = await provider
      .generate({
        routeKey: "experience_to_resume",
        input: {
          targetDirection: sensitiveInput,
          rawExperience: "sensitive prompt material",
          actualActions: "整理报名表",
          deliverableOrResult: "报名名单",
        },
      })
      .catch((caught: unknown) => caught);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(AiProviderError);
    expect((error as AiProviderError).kind).toBe(kind);
    const serialized = JSON.stringify({
      ...(error as object),
      name: (error as Error).name,
      message: (error as Error).message,
    });
    expect(serialized).not.toMatch(
      /secret-test-key|sensitive user input|sensitive prompt material|Authorization|sensitive response body|query-value/i,
    );
  });

  it("returns an explicit primary/fallback provider set whose generate call is single-attempt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("primary failure", { status: 503 }));
    const provider = createAiProviderFromEnv(
      {
        DEEPSEEK_API_KEY: "deepseek-key",
        DEEPSEEK_BASE_URL: "https://deepseek.example.com",
        QWEN_API_KEY: "qwen-key",
        QWEN_BASE_URL: "https://qwen.example.com/compatible-mode/v1",
      },
      fetchMock,
    );

    await expect(
      provider.generate({
        routeKey: "experience_to_resume",
        input: {
          targetDirection: "运营",
          rawExperience: "社团活动",
          actualActions: "整理报名表",
          deliverableOrResult: "报名名单",
        },
      }),
    ).rejects.toMatchObject({ kind: "retryable_http" });

    expect(provider).toMatchObject({ primary: expect.anything(), fallback: expect.anything() });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to mock provider in non-production when DeepSeek is not configured", () => {
    const provider = createAiProviderFromEnv({ NODE_ENV: "development" });

    expect(provider).toBeInstanceOf(MockAiProvider);
  });

  it("returns provider failure in production when DeepSeek is not configured", async () => {
    const provider = createAiProviderFromEnv({ NODE_ENV: "production" });

    await expect(
      provider.generate({
        routeKey: "experience_to_resume",
        input: {},
      }),
    ).rejects.toThrow();
  });
});
