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
    const fetchMock = vi.fn(async () =>
      new Response(
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
      ),
    );
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
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe("test-model");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(JSON.stringify(body.messages)).toContain("只返回 JSON");
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

  it("falls back to mock provider when DeepSeek is not configured", () => {
    const provider = createAiProviderFromEnv({});

    expect(provider).toBeInstanceOf(MockAiProvider);
  });
});
