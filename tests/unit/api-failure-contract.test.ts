import { describe, expect, it, vi } from "vitest";
import { createAiRouteHandler } from "@/app/api/ai/route";
import { AiProviderError, type AiProvider } from "@/ai/provider";

const requestBody = {
  routeKey: "experience_to_resume",
  input: {
    targetDirection: "内容运营",
    rawExperience: "参与社团公众号推文发布",
    actualActions: "整理活动信息、排版、发布并记录阅读量",
    deliverableOrResult: "保存了 5 篇推文链接，无明确增长数据",
  },
};

function makeRequest(signal?: AbortSignal): Request {
  return new Request("http://localhost/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
    signal,
  });
}

describe("POST /api/ai processing-failure contract", () => {
  it.each([
    ["transport", 503],
    ["timeout", 504],
  ] as const)("maps provider %s to %i without a fake action", async (kind, status) => {
    const provider: AiProvider = {
      generate: vi.fn().mockRejectedValue(new AiProviderError(kind)),
    };
    const response = await createAiRouteHandler({ providerFactory: () => provider })(
      makeRequest(),
    );
    const body = await response.json();

    expect(response.status).toBe(status);
    expect(body).toMatchObject({ error: "ai_processing_failure" });
    expect(body).not.toHaveProperty("todayAction");
    expect(body).not.toHaveProperty("recordGuide");
    expect(body.requestId).toBe(response.headers.get("X-Request-Id"));
  });

  it("maps exhausted invalid model output to 502", async () => {
    const provider: AiProvider = {
      generate: vi.fn().mockResolvedValue({} as never),
    };
    const response = await createAiRouteHandler({ providerFactory: () => provider })(
      makeRequest(),
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      error: "ai_processing_failure",
      category: "invalid_output",
    });
    expect(body).not.toHaveProperty("todayAction");
  });

  it("returns 504 for the orchestration deadline and does not label it caller abort", async () => {
    const provider: AiProvider = {
      generate: vi.fn(() => new Promise(() => undefined)),
    };
    const response = await createAiRouteHandler({
      providerFactory: () => provider,
      deadlineMs: 20,
    })(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(504);
    expect(body).toMatchObject({ category: "deadline" });
  });

  it("returns 499 for caller abort instead of deadline", async () => {
    const controller = new AbortController();
    const provider: AiProvider = {
      generate: vi.fn(() => new Promise(() => undefined)),
    };
    const pending = createAiRouteHandler({
      providerFactory: () => provider,
      deadlineMs: 1_000,
    })(makeRequest(controller.signal));
    controller.abort("caller_navigation");

    const response = await pending;
    expect(response.status).toBe(499);
  });

  it("returns 422 sensitive-input failure without a fake action", async () => {
    const response = await createAiRouteHandler({
      providerFactory: () => ({ generate: vi.fn() }),
    })(new Request("http://localhost/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...requestBody,
        input: { ...requestBody.input, rawExperience: "手机号 13812345678" },
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body).not.toHaveProperty("todayAction");
    expect(body).not.toHaveProperty("recordGuide");
  });
});
