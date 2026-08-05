import { describe, expect, it, vi } from "vitest";
import { createAiRouteHandler } from "@/app/api/ai/route";
import { AiProviderError, type AiProvider } from "@/ai/provider";

const requestBody = {
  routeKey: "experience_to_resume",
  requestMetadata: {
    clientRequestId: "11111111-1111-4111-8111-111111111111",
    draftRevision: 7,
    idempotencyKey: "22222222-2222-4222-8222-222222222222",
  },
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
    expect(response.headers.get("X-Client-Request-Id")).toBe(
      requestBody.requestMetadata.clientRequestId,
    );
    expect(response.headers.get("X-Draft-Revision")).toBe("7");
    expect(response.headers.get("X-Idempotency-Key")).toBe(
      requestBody.requestMetadata.idempotencyKey,
    );
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

  it("applies the same deadline while reading a stalled request body", async () => {
    const provider: AiProvider = { generate: vi.fn() };
    const stalledBody = new ReadableStream<Uint8Array>({
      start() {
        // Deliberately never enqueue or close: the whole-handler deadline must win.
      },
    });
    const request = new Request("http://localhost/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stalledBody,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const startedAt = Date.now();
    const response = await createAiRouteHandler({
      providerFactory: () => provider,
      deadlineMs: 20,
    })(request);
    const body = await response.json();

    expect(Date.now() - startedAt).toBeLessThan(250);
    expect(response.status).toBe(504);
    expect(body).toMatchObject({ category: "deadline" });
    expect(provider.generate).not.toHaveBeenCalled();
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
