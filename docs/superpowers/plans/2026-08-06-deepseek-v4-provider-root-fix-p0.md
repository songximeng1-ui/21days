# DeepSeek V4 Provider Root Fix P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the structured-output primary provider onto a supported DeepSeek V4 non-thinking request contract while automatically recovering existing `deepseek-chat` configuration and preserving Qwen compatibility.

**Architecture:** Add one pure runtime-profile resolver at the provider construction boundary. `ChatCompletionProvider` stores the resolved canonical model and optional provider-specific request capability once, then emits `thinking: { type: "disabled" }` only for supported DeepSeek V4 requests; response parsing, typed failures, orchestration budgets, and fallback transitions stay unchanged.

**Tech Stack:** TypeScript 5, Next.js 16, native Fetch API, Vitest 4, Zod 4.

## Global Constraints

- Follow `docs/superpowers/specs/2026-08-06-deepseek-v4-provider-root-fix-design.md`.
- Do not call DeepSeek, Qwen, or any paid real provider.
- Preserve the 28,000 ms whole-request deadline, 12,000 ms default provider timeout, 900-token JD output limit, and current fallback budget.
- Preserve `response_format: { type: "json_object" }`, `temperature: 0.2`, non-streaming requests, and current prompts.
- Map legacy `deepseek-chat` to `deepseek-v4-flash`; reject `deepseek-reasoner`.
- Send `thinking` only to supported DeepSeek V4 models on the official DeepSeek endpoint; never send it to Qwen.
- Do not expand diagnostics or expose model names, prompts, raw provider content, user material, environment values, or API keys.
- Do not modify the JD evidence catalog, candidate schema, assembler, route output, UI copy, local stores, or API status mapping.

## File Responsibility Map

- Create `src/ai/provider-runtime-profile.ts`: pure model normalization and request-capability selection.
- Create `tests/unit/provider-runtime-profile.test.ts`: unit contract for alias migration, V4 non-thinking, reasoner rejection, and Qwen neutrality.
- Modify `src/ai/chat-completion-provider.ts`: resolve once, use the canonical model in requests and circuit keys, and conditionally add `thinking`.
- Modify `tests/unit/chat-completion-provider.test.ts`: verify direct and environment-built request bodies.
- Modify `.env.example`: document `deepseek-v4-flash` as the default.
- Create `docs/superpowers/plans/2026-08-06-deepseek-v4-provider-root-fix-p0-governance-matrix.md`: record offline evidence and the real-provider `PARTIAL` boundary.

---

### Task 1: Define the Pure Provider Runtime Profile

**Files:**
- Create: `src/ai/provider-runtime-profile.ts`
- Create: `tests/unit/provider-runtime-profile.test.ts`

**Interfaces:**
- Produces: `ProviderRuntimeProfile = Readonly<{ model: string; thinking?: Readonly<{ type: "disabled" }> }>`.
- Produces: `resolveProviderRuntimeProfile(normalizedBaseUrl: string, configuredModel: string): ProviderRuntimeProfile`.
- Consumes: the normalized URL returned by `normalizeProviderBaseUrl()`.

- [ ] **Step 1: Write the failing runtime-profile tests**

Create `tests/unit/provider-runtime-profile.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveProviderRuntimeProfile } from "@/ai/provider-runtime-profile";

describe("resolveProviderRuntimeProfile", () => {
  it("migrates the retired chat alias to V4 Flash non-thinking", () => {
    expect(resolveProviderRuntimeProfile(
      "https://api.deepseek.com",
      "deepseek-chat",
    )).toEqual({
      model: "deepseek-v4-flash",
      thinking: { type: "disabled" },
    });
  });

  it.each(["deepseek-v4-flash", "deepseek-v4-pro"])(
    "keeps %s and disables thinking",
    (model) => {
      expect(resolveProviderRuntimeProfile(
        "https://api.deepseek.com",
        model,
      )).toEqual({ model, thinking: { type: "disabled" } });
    },
  );

  it("rejects the reasoning alias without echoing it", () => {
    expect(() => resolveProviderRuntimeProfile(
      "https://api.deepseek.com",
      "deepseek-reasoner",
    )).toThrow("Invalid AI provider model configuration");
    try {
      resolveProviderRuntimeProfile("https://api.deepseek.com", "deepseek-reasoner");
    } catch (error) {
      expect(String(error)).not.toContain("deepseek-reasoner");
    }
  });

  it("leaves Qwen provider-neutral", () => {
    expect(resolveProviderRuntimeProfile(
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "qwen-plus",
    )).toEqual({ model: "qwen-plus" });
  });

  it("preserves an unrecognized test model without capabilities", () => {
    expect(resolveProviderRuntimeProfile(
      "https://api.deepseek.com",
      "test-model",
    )).toEqual({ model: "test-model" });
  });
});
```

- [ ] **Step 2: Run the test to prove RED**

Run:

```powershell
npm.cmd test -- tests/unit/provider-runtime-profile.test.ts
```

Expected: FAIL because `@/ai/provider-runtime-profile` does not exist.

- [ ] **Step 3: Implement the minimal resolver**

Create `src/ai/provider-runtime-profile.ts`:

```ts
export type ProviderRuntimeProfile = Readonly<{
  model: string;
  thinking?: Readonly<{ type: "disabled" }>;
}>;

const DEEPSEEK_HOST = "api.deepseek.com";
const DEEPSEEK_V4_MODELS = new Set([
  "deepseek-v4-flash",
  "deepseek-v4-pro",
]);

export function resolveProviderRuntimeProfile(
  normalizedBaseUrl: string,
  configuredModel: string,
): ProviderRuntimeProfile {
  const host = new URL(normalizedBaseUrl).hostname.toLowerCase();
  if (host !== DEEPSEEK_HOST) return { model: configuredModel };
  if (configuredModel === "deepseek-reasoner") {
    throw new Error("Invalid AI provider model configuration");
  }
  const model = configuredModel === "deepseek-chat"
    ? "deepseek-v4-flash"
    : configuredModel;
  return DEEPSEEK_V4_MODELS.has(model)
    ? { model, thinking: { type: "disabled" } }
    : { model };
}
```

- [ ] **Step 4: Run focused verification**

```powershell
npm.cmd test -- tests/unit/provider-runtime-profile.test.ts
npx.cmd tsc --noEmit --incremental false
```

Expected: all runtime-profile cases pass and TypeScript exits 0.

- [ ] **Step 5: Commit the pure provider contract**

```powershell
git add -- src/ai/provider-runtime-profile.ts tests/unit/provider-runtime-profile.test.ts
git commit -m "refactor: define provider runtime profile"
```

### Task 2: Apply the Canonical Model and Non-Thinking Request Contract

**Files:**
- Modify: `src/ai/chat-completion-provider.ts`
- Modify: `tests/unit/chat-completion-provider.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `resolveProviderRuntimeProfile()` from Task 1.
- Produces: canonical `model` and an optional stored `thinking` field in each Chat Completion request.
- Preserves: `AiProvider`, `AiProviderSet`, `AiProviderError`, timeouts, parsing, observations, and circuit-breaker behavior.

- [ ] **Step 1: Add a request-body capture helper and RED request tests**

Add beside `capturePrompt` in `tests/unit/chat-completion-provider.test.ts`:

```ts
async function captureRequestBody(options: {
  baseUrl: string;
  model: string;
  routeKey?: RouteKey;
}): Promise<Record<string, unknown>> {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(validOutput) } }],
  }), { status: 200 }));
  const provider = new ChatCompletionProvider({
    apiKey: "test-key",
    baseUrl: options.baseUrl,
    model: options.model,
    fetchFn: fetchMock,
  });
  const routeKey = options.routeKey ?? "experience_to_resume";
  const input = routeKey === "jd_to_revision"
    ? {
        targetJobTitle: "AI 产品运营",
        jdTextOrRequirements: "维护产品\n分析复盘\n梳理流程",
        userMaterial: "运营公众号并发布 13 条内容。",
      }
    : {
        targetDirection: "运营",
        rawExperience: "社团活动",
        actualActions: "整理报名表",
        deliverableOrResult: "报名名单",
      };
  await provider.generate({ routeKey, input });
  const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
  return JSON.parse(requestInit.body as string) as Record<string, unknown>;
}
```

Add:

```ts
it.each(["deepseek-v4-flash", "deepseek-v4-pro"])(
  "sends %s as an explicit non-thinking JSON request",
  async (model) => {
    const body = await captureRequestBody({
      baseUrl: "https://api.deepseek.com",
      model,
    });
    expect(body).toMatchObject({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
    });
  },
);

it("does not send DeepSeek thinking to Qwen", async () => {
  const body = await captureRequestBody({
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
  });
  expect(body.model).toBe("qwen-plus");
  expect(body).not.toHaveProperty("thinking");
});

it("keeps the 900-token JD JSON contract", async () => {
  const body = await captureRequestBody({
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    routeKey: "jd_to_revision",
  });
  expect(body.max_tokens).toBe(900);
  expect(body.response_format).toEqual({ type: "json_object" });
  expect(body.thinking).toEqual({ type: "disabled" });
});
```

- [ ] **Step 2: Add RED environment migration and rejection tests**

Add near existing `createAiProviderFromEnv` tests:

```ts
it.each([undefined, "deepseek-chat"])(
  "uses V4 Flash non-thinking for configured model %s",
  async (configuredModel) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(validOutput) } }],
    }), { status: 200 }));
    const provider = createAiProviderFromEnv({
      DEEPSEEK_API_KEY: "secret-test-key",
      ...(configuredModel ? { DEEPSEEK_MODEL: configuredModel } : {}),
    }, fetchMock);
    await provider.generate({
      routeKey: "experience_to_resume",
      input: {
        targetDirection: "运营",
        rawExperience: "社团活动",
        actualActions: "整理报名表",
        deliverableOrResult: "报名名单",
      },
    });
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(requestInit.body as string) as Record<string, unknown>;
    expect(body.model).toBe("deepseek-v4-flash");
    expect(body.thinking).toEqual({ type: "disabled" });
  },
);

it("rejects deepseek-reasoner without exposing the API key", () => {
  let caught: unknown;
  try {
    createAiProviderFromEnv({
      DEEPSEEK_API_KEY: "secret-test-key",
      DEEPSEEK_MODEL: "deepseek-reasoner",
    });
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect(String(caught)).toContain("Invalid AI provider model configuration");
  expect(JSON.stringify(caught)).not.toContain("secret-test-key");
});
```

- [ ] **Step 3: Run the provider suite to prove RED**

```powershell
npm.cmd test -- tests/unit/provider-runtime-profile.test.ts tests/unit/chat-completion-provider.test.ts
```

Expected: V4 bodies lack `thinking`, the default still sends `deepseek-chat`, the legacy alias is not canonicalized, and reasoner construction succeeds unexpectedly.

- [ ] **Step 4: Integrate the runtime profile in the constructor**

In `src/ai/chat-completion-provider.ts`, import:

```ts
import {
  resolveProviderRuntimeProfile,
  type ProviderRuntimeProfile,
} from "@/ai/provider-runtime-profile";
```

Store and resolve the profile once:

```ts
private readonly runtimeProfile: ProviderRuntimeProfile;

constructor(private readonly options: ChatCompletionProviderOptions) {
  this.fetchFn = options.fetchFn ?? fetch;
  const normalizedBaseUrl = normalizeProviderBaseUrl(options.baseUrl);
  this.runtimeProfile = resolveProviderRuntimeProfile(
    normalizedBaseUrl,
    options.model,
  );
  this.completionsUrl = `${normalizedBaseUrl}/chat/completions`;
  this.circuitKey = `chat-completion:${normalizedBaseUrl}:${this.runtimeProfile.model}`;
  this.timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? 12_000, 30_000));
  this.maxResponseBytes = Math.max(64, Math.min(
    options.maxResponseBytes ?? 512 * 1024,
    1024 * 1024,
  ));
}
```

Use the profile in the request body:

```ts
const requestBody = JSON.stringify({
  model: this.runtimeProfile.model,
  temperature: 0.2,
  max_tokens: maxTokensForRoute(input.routeKey),
  response_format: { type: "json_object" },
  ...(this.runtimeProfile.thinking
    ? { thinking: this.runtimeProfile.thinking }
    : {}),
  messages: [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: buildUserPrompt(input) },
  ],
});
```

Do not modify response parsing or failure classification.

- [ ] **Step 5: Update the default and `.env.example`**

In `createAiProviderFromEnv()` use:

```ts
model: env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
```

In `.env.example` use:

```dotenv
# Main model: DeepSeek V4 Flash in explicit non-thinking mode for short structured JSON requests.
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
```

Keep the Qwen block unchanged.

- [ ] **Step 6: Run focused regression verification**

```powershell
npm.cmd test -- tests/unit/provider-runtime-profile.test.ts tests/unit/chat-completion-provider.test.ts tests/unit/orchestrator.test.ts tests/unit/api-ai-route.test.ts tests/unit/api-failure-contract.test.ts
npx.cmd tsc --noEmit --incremental false
```

Expected: all focused tests pass and TypeScript exits 0 without network calls.

- [ ] **Step 7: Commit provider integration**

```powershell
git add -- .env.example src/ai/chat-completion-provider.ts tests/unit/chat-completion-provider.test.ts
git commit -m "fix: move structured AI requests to DeepSeek V4"
```

### Task 3: Record Governance Evidence and Run Completion Gates

**Files:**
- Create: `docs/superpowers/plans/2026-08-06-deepseek-v4-provider-root-fix-p0-governance-matrix.md`
- Verify: all tracked source, tests, configuration, and lockfile

**Interfaces:**
- Consumes: final Task 1 and Task 2 commits.
- Produces: offline evidence without claiming an unrun real-provider canary.

- [ ] **Step 1: Run complete offline verification**

Run separately and stop at the first failure:

```powershell
npm.cmd test
npm.cmd run lint
npx.cmd tsc --noEmit --incremental false
npm.cmd run build
npm.cmd audit --audit-level=high
git diff --check
git status --short
```

Expected: all non-skipped tests pass; lint, TypeScript, build, audit high gate, and diff check exit 0; the working tree is clean before the governance matrix is created.

- [ ] **Step 2: Write the governance matrix after the gates pass**

Create `docs/superpowers/plans/2026-08-06-deepseek-v4-provider-root-fix-p0-governance-matrix.md`:

```markdown
# DeepSeek V4 provider 根因修复 P0 治理矩阵

日期：2026-08-06

## 根因与修复

- 旧默认模型 `deepseek-chat` 已由兼容层规范化为 `deepseek-v4-flash`。
- DeepSeek V4 结构化请求显式发送 `thinking: { type: "disabled" }`。
- Qwen 请求不发送 DeepSeek 专属字段。
- JD 保持 900-token 上限；typed retry、预算感知 fallback 与 HTTP 失败语义不变。

## 离线证据

- provider runtime profile 单测：通过。
- 请求体、旧配置迁移、reasoner 拒绝与 Qwen 中立性单测：通过。
- 全量 Vitest：通过，所有非跳过用例成功。
- ESLint：通过。
- TypeScript noEmit：通过。
- Next.js production build：通过。
- npm audit high gate：通过，无 high/critical。
- git diff check：通过。

## 验收边界

- 本轮真实 DeepSeek/Qwen 调用数：0。
- 生产真实 provider 恢复状态：PARTIAL；需要另行授权的 canary。
- 普通应届生用户价值状态：PARTIAL；仍需真实私测证据。
```

If audit reports only moderate findings, add one sentence naming the dependency chain and explaining why no forced major upgrade is included; do not weaken the high gate.

- [ ] **Step 3: Re-run repository checks**

```powershell
git diff --check
git status --short --branch
git log -5 --oneline --decorate
```

Expected: only the governance matrix is uncommitted; no production evidence directory or secret file exists.

- [ ] **Step 4: Commit governance evidence**

```powershell
git add -- docs/superpowers/plans/2026-08-06-deepseek-v4-provider-root-fix-p0-governance-matrix.md
git commit -m "docs: record DeepSeek V4 provider evidence"
```

- [ ] **Step 5: Perform final read-only handoff checks**

```powershell
git status --short --branch
git log -5 --oneline --decorate
```

Expected: clean `codex/jd-provider-root-fix-p0`; final reporting distinguishes offline configuration success from unrun real-provider verification.
