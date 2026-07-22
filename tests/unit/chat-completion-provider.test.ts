import { describe, expect, it, vi } from "vitest";
import {
  ChatCompletionProvider,
  RetryFallbackAiProvider,
  createAiProviderFromEnv,
} from "@/ai/chat-completion-provider";
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
  });

  it("uses DeepSeek env config before falling back to mock provider", () => {
    const provider = createAiProviderFromEnv({
      DEEPSEEK_API_KEY: "deepseek-key",
      DEEPSEEK_MODEL: "deepseek-chat",
    });

    expect(provider).toBeInstanceOf(RetryFallbackAiProvider);
  });

  it("calls Qwen only after the DeepSeek primary model fails after retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("primary failure", { status: 500 }))
      .mockResolvedValueOnce(new Response("primary retry failure", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(validOutput) } }],
          }),
          { status: 200 },
        ),
      );
    const provider = createAiProviderFromEnv(
      {
        DEEPSEEK_API_KEY: "deepseek-key",
        DEEPSEEK_BASE_URL: "https://deepseek.example.com",
        DEEPSEEK_MODEL: "deepseek-chat",
        QWEN_API_KEY: "qwen-key",
        QWEN_BASE_URL: "https://qwen.example.com/compatible-mode/v1",
        QWEN_MODEL: "qwen-plus",
      },
      fetchMock,
    );

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
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe("https://deepseek.example.com/chat/completions");
    expect(fetchMock.mock.calls[1][0]).toBe("https://deepseek.example.com/chat/completions");
    expect(fetchMock.mock.calls[2][0]).toBe("https://qwen.example.com/compatible-mode/v1/chat/completions");
  });

  it("does not call Qwen for primary model bad request responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("bad request", { status: 400 }))
      .mockResolvedValueOnce(new Response("bad request again", { status: 400 }));
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
    ).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every((call) => String(call[0]).includes("deepseek.example.com"))).toBe(true);
  });

  it("does not call fallback for unexpected primary errors that are not service availability failures", async () => {
    const primary = {
      generate: vi.fn().mockRejectedValue(new Error("unexpected primary bug")),
    };
    const fallback = {
      generate: vi.fn().mockResolvedValue(validOutput),
    };
    const provider = new RetryFallbackAiProvider({
      primary,
      fallback,
      primaryAttempts: 2,
    });

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
    ).rejects.toThrow("unexpected primary bug");

    expect(primary.generate).toHaveBeenCalledTimes(2);
    expect(fallback.generate).not.toHaveBeenCalled();
  });

  it("calls Qwen after the primary model returns invalid JSON twice", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "not json" } }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "still not json" } }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(validOutput) } }],
          }),
          { status: 200 },
        ),
      );
    const provider = createAiProviderFromEnv(
      {
        DEEPSEEK_API_KEY: "deepseek-key",
        DEEPSEEK_BASE_URL: "https://deepseek.example.com",
        QWEN_API_KEY: "qwen-key",
        QWEN_BASE_URL: "https://qwen.example.com/compatible-mode/v1",
      },
      fetchMock,
    );

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
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toBe("https://qwen.example.com/compatible-mode/v1/chat/completions");
  });

  it("calls Qwen after the primary provider returns an invalid JSON response body twice", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("not a json body", { status: 200 }))
      .mockResolvedValueOnce(new Response("still not a json body", { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(validOutput) } }],
          }),
          { status: 200 },
        ),
      );
    const provider = createAiProviderFromEnv(
      {
        DEEPSEEK_API_KEY: "deepseek-key",
        DEEPSEEK_BASE_URL: "https://deepseek.example.com",
        QWEN_API_KEY: "qwen-key",
        QWEN_BASE_URL: "https://qwen.example.com/compatible-mode/v1",
      },
      fetchMock,
    );

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
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toBe("https://qwen.example.com/compatible-mode/v1/chat/completions");
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
