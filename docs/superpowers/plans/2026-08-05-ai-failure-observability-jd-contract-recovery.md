# AI Failure Observability and JD Contract Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 AI 产品运营 JD 路线把处理失败伪装为成功行动的问题，并用窄模型合同加确定性服务端组装稳定产出真实、可执行的投递前最小修改。

**Architecture:** API 只把 `route_result`、`missing_info`、`light_review` 作为成功合同；AI 处理失败由独立 `AiProcessingFailure` 与 `AiProcessingError` 表达并映射非 200。编排器保留 DeepSeek 主模型、一次定向修复、文档允许时 Qwen 兜底，但在 30 秒总预算内区分 caller abort 与 deadline。JD 模型只返回 requirement/material 映射候选，服务端从真实输入确定性组装完整 `RouteOutput`、行动、记录和 provenance。

**Tech Stack:** Next.js 16、React 19、TypeScript 5、Zod 4、Vitest、Testing Library、Playwright、Vercel。

## Global Constraints

- 基线必须是 `codex/mvp-private-beta-readiness` 的 `fca016a320f3028c28a6eb2a874d4c5ba9a9d41a`；工作分支为 `codex/ai-failure-observability-jd-contract-recovery`。
- 不 reset、clean、checkout、删除或覆盖 `D:\21天` 的未跟踪 `docs/qa` 用户资产；旧证据目录 `D:\21天\qa\manual-live-run\20260805-111526-jd-ai-product-ops` 只读。
- 不做付费真实 provider 回归；自动化与生产构建 E2E 使用 deterministic mock/fixture，线上只读复核。
- 通过 `apply_patch` 修改；不做无关重构；不自动执行破坏性 `npm audit fix --force`。
- 用户可见文案不得出现 provider、schema、grounding、prompt、token、fallback、内部路线、错误栈或原始模型输出。
- reporter 只允许 requestId、routeKey、mode、providerRole、attempt、stage、code、durationBucket、schemaPaths、httpStatusClass、providerErrorCode；不得记录 JD/材料全文、prompt、raw model output 或密钥。
- HTTP 200 只用于 `route_result`、`missing_info`、`light_review`；422 用于敏感输入；503 用于 transport/rate/circuit；504 用于 timeout/deadline；502 用于 model JSON/schema/grounding/safety exhausted；caller abort 使用 499。
- 总编排预算小于 30 秒并留余量；DeepSeek 首次调用后最多一次同模型定向修复；Qwen 只处理文档允许的机器、解析或必要结构失败，安全、grounding 和输入不足不得借 fallback 绕过。
- JD 的 `revisionTarget` 必须是 `userMaterial` 的精确原文；候选句只能来自映射证据；无证据时允许明确证据不足，不得硬塞数据分析工具或虚构用户数、迭代次数、跨团队协作、PRD。
- 技术通过不等于整体用户价值 GO；8–12 名普通应届生 7 天私测、2–3 天回访、两次真实推进仍是独立外部价值证据。

---

## 16 份产品文档完整性

目录 `docs/product` 实际文件数为 16，与强制清单逐项一致，无多文件、少文件或重命名。以下字节数与 SHA-256 在本任务 worktree 上于实施前只读计算：

| # | 精确文件名 | 字节数 | SHA-256 |
|---:|---|---:|---|
| 1 | `21天MVP发展总方向_V1.0.md` | 10883 | `69ca2ac89b8272ebaf69535200f788286d74153096100fd7444be42b9276e585` |
| 2 | `21天总准则.md` | 15213 | `73d35bc5df5948b36e5893a8554e23a3f535822b99c76cd45633e000d92a3c78` |
| 3 | `MVP AI工作流与安全边界设计.md` | 18905 | `041d0cc83256e526e92a02b68e6ac369789f30c561c361e0e674c0c7df33a3ef` |
| 4 | `MVP PM决策共识.md` | 52394 | `d90aa52ae5affc63b1aa6aa55a14c99ce4a08abe4e9841122cad7a8a10ade63f` |
| 5 | `MVP UI准则.md` | 16313 | `0388a955f67e83859be7a4cdab1904f33ad915e9c63a7bd6be627103ffd8b56d` |
| 6 | `MVP UX信息架构第一版.md` | 12227 | `b017ed0a880154ab2b90eab013676ed82a95d0fa7cbe6379bd5e43aef8d1f8f7` |
| 7 | `MVP UX准则.md` | 23662 | `8fb57642bf33e9d0cd38ccebda854a8bd360fcec080774d9533e976909141204` |
| 8 | `MVP 测试用例与私测观察标准.md` | 22051 | `f7ff54e64bfcb162de310d461664f136e27b87f8c17644cd51815499f148aa7a` |
| 9 | `MVP 私测执行记录模板.md` | 10771 | `7632c4166b42b18a2b4188340451686d728b94a0338a5cf473579fc86de7be05` |
| 10 | `MVP 四路线输入输出数据设计.md` | 21369 | `ef14681a407a391f5fba623bdfbd6a4e46f2164f58a93bc18c4280ab18c18053` |
| 11 | `MVP 研发边界决策.md` | 3855 | `b031f3ba48ded73f7025f0e2c4b89453f8a8015d4d928114a431c63827ac63af` |
| 12 | `MVP 研发进度记录.md` | 3260 | `5c2498c09fca0380cbda075e4e5368d1f2f10d6f9e57282410154679f1aec6cb` |
| 13 | `MVP 页面低保真线框图.md` | 15067 | `ed482994ab04b69bff9a4f70ca765a8e9e09067b1f1b97b7d9fd5b7b4e32434d` |
| 14 | `MVP 页面线框与关键状态设计.md` | 14312 | `b1c5ef2b8bdeb2cef7504157658cda6aaa6c2f6a0b5e5043974fd0505a7363c2` |
| 15 | `项目协作准则.md` | 3256 | `a32de701d3d83e092c1b350d9a9bf4e5c9ba4ad993ccb46c215d3b1787faa1da` |
| 16 | `新MVP PRD.md` | 11560 | `44bcd2551038fc98a658d670fab1627a6e27fb23c49971bbce0a69bffccd4dd3` |

## 治理冲突与裁决

| 冲突 | 裁决 |
|---|---|
| `MVP PM决策共识` §1、§26 仍写“产品定义阶段、不写代码、不进入研发”，但 `MVP 研发边界决策`、`MVP 研发进度记录`、发展总方向、当前仓库代码与主人本次明确指令均要求研发和发布。 | 按最高准则、适用范围、较新状态与主人最新明确指令，当前任务进入研发；把旧文字作为治理冲突，不把现存代码判成产品缺陷。 |
| `MVP AI工作流与安全边界设计` §2.2 允许 timeout 重试，§2.3 要求主模型重试后才可 Qwen；现有实现 timeout 后直接 Qwen。 | 按原文采用 DeepSeek 首次调用 + 最多一次同模型定向修复；机器/解析/必要结构仍失败且预算足够才 Qwen。安全、grounding、缺信息不得 Qwen。 |
| 线框旧失败页允许“回到输入”和“稍后再试”两个操作，而已批准方案要求失败停留输入页且只有一个主 CTA。 | 最新主人批准方案在不破坏草稿保存的前提下更具体，采用输入页内错误状态与唯一主 CTA“再整理一次”。 |
| 数据文档把 `friendly_failure` 放进通用 RouteOutput，而最高准则要求每次成功结果必须有真实行动/记录，AI 失败不应伪装行动。 | 将 AI 处理失败从 RouteOutput 分离；产品化失败文案保留，但不生成 todayAction/recordGuide、不进入行动/记录/复盘。 |

## 文档章节 → 实现/证据 → 状态 → 问题 → 修复/测试矩阵

| 文档章节 | 实现或证据 | 当前状态 | 问题 | 修复与测试 |
|---|---|---|---|---|
| `21天总准则` §5、§8、§16 | `/api/ai`、输入页、行动/记录链路 | 必须修 | HTTP 200 `friendly_failure` 让失败看起来像今日行动并推进状态 | API 非 200 + 独立失败体；输入页原地恢复；测试失败不写 action/record/review/journey |
| `21天总准则` §7.4、§9 | JD 路线 prompt、normalizer、schema | 必须修 | 完整 RouteOutput 让模型承担固定字段、顺序、时间、记录和 provenance，合同漂移面过大 | 窄 `requirementId/materialId/candidate/reason/risk` 合同 + 服务端确定性组装；精确 fixture 测试无编造 |
| `MVP AI工作流与安全边界设计` §2.1–2.3 | `orchestrator.ts`、provider set | 必须修 | timeout 直接 fallback；schema fallback 与 safety/grounding 边界混杂；预算耗尽不分类 | 显式 failure category、一次定向主模型修复、受限 fallback、<30s 预算测试 |
| 同文 §2.4、§11–12 | reporter、API 错误体、UI 文案 | 必须修 | 生产 noop reporter、无 requestId；失败体含伪 todayAction | 安全 allowlist console reporter + `X-Request-Id`；用户失败体无内部词、无用户正文 |
| 同文 §6 | `makeMissingInfoOutput`、输入充分判断 | 已有基础，需回归 | 不能把本次完整输入归咎用户；`friendly_failure.missingInfo=null` 不能继续冒充缺信息 | 独立 missing_info 200 测试；完整 AI 产品运营 fixture 必须进入 route_result |
| 同文 §7 | 服务端 action assembler | 必须修 | 模型控制 estimatedTime、字段顺序、completionStandard，普通学生可能看不懂或不可执行 | 固定 15–30 分钟、单行动、记录字段；行为负例拦截抽象任务 |
| 同文 §8 | JD quote 与生成安全扫描 | 必须修 | 引用字段中的“主导”可能被全局禁词误杀；候选文本又可能无证据升级角色 | quote allowlist 与 candidate safety 分离；测试引用允许、候选禁止 |
| `MVP UX准则` §6–8、§11.1 | 输入页/行动页/local-store | 必须修 | 任何 200 保存 current action；AI 失败会覆盖旧行动，用户离开输入页 | 只接受三类成功输出；失败停留输入页，草稿逐字保留，旧 action 不覆盖 |
| `MVP UI准则` §12.6 | 输入页错误态 | 必须修 | AI失败与保存失败文案混合；旧行动页标题仍承诺“今天只做这一件事” | 两类错误状态独立，失败只有“再整理一次”，不渲染行动卡 |
| `MVP 四路线输入输出数据设计` §3–7 | RouteOutput schema、JD assembler、其他路线回归 | 必须修/回归 | 单一路线修复不能破坏四路线、missing_info、light_review | 聚焦 + 全量 Vitest + production E2E 四路线 |
| `MVP 测试用例与私测观察标准` §3–10 | 单元、集成、E2E、证据目录 | 必须新增证据 | 技术测试不能代替普通学生价值验证 | 保存新 run-id 日志/截图；最终逐路线 value gate；真实 7 天私测列外部阻断 |
| `MVP 私测执行记录模板` §4–12 | 真实用户观察 | 外部未验证 | 尚无 8–12 人、7 天、第2–3天回访、两次推进证据 | 不宣称整体价值 GO 或发布 GO；只裁决受控私测技术资格 |
| `MVP 研发边界决策` §2、§4、§6 | 本地存储、mock provider、API | 回归 | 不能为可诊断性记录用户原文；无 key 不应阻塞测试 | reporter allowlist 测试；deterministic mock E2E；不调用付费 provider |
| 两份页面线框 §5–7 与 UX 信息架构 §7 | 输入、失败、缺信息页面 | 必须修/回归 | friendly failure 误跳行动页；缺信息仍应正常进入行动 | 输入失败原地、missing_info 正常跳转的组件/集成测试 |
| `新MVP PRD` §7.4、§9–10、§13–14 | JD 输出、安全、私测判断 | 必须修/回归 | AI 产品运营完整输入没得到指导；无法证明真实推进 | 精确 fixture、浏览器截图、网络证据、value gate 合同 |

## 已证实与推测根因

### 已证实

- `orchestrator.ts` 在没有 `retryAfterMs` 时，把 provider transport/timeout/model JSON/schema/grounding/safety exhausted 全部返回 `makeFriendlyFailureOutput()`；该对象仍有 `todayAction` 和 `recordGuide`。
- `route.ts` 只在 `AiUpstreamUnavailableError`（依赖 `retryAfterMs`）时返回 503；其余 orchestrator 失败可作为 HTTP 200 通过 provenance schema。
- production handler 没有传 reporter 和 requestId，默认 reporter 是 noop，旧生产无法证明精确失败阶段。
- `input/page.tsx` 对任意 HTTP 200 RouteOutput 执行 `saveCurrentAction()` 并跳到行动页；可覆盖旧有效行动并推进 journey。
- JD 固定合同散落于 `route-contracts.ts`、`route-output.ts`、provider prompt config 和 `orchestrator.ts` 的 `HARD_ROUTE_CONTRACTS`/normalizer，存在 exact keys/order/time/provenance 漂移面。
- 旧生产截图显示完整输入提交后到了 `friendly_failure` 行动页，用户没有得到任何真实指导；旧证据路径保持只读。

### 仍是推测

- 约 26 秒总耗时与 primary/fallback 各约 12 秒 timeout 相容，但旧生产无 requestId/阶段日志，不能写成事实。
- 也可能是模型输出连续被 JSON、schema、grounding 或 safety 合同拒绝；旧生产同样无观测，不能在修复前区分。

---

### Task 1: 独立 AI 失败合同与安全诊断

**Files:**
- Create: `src/ai/processing-failure.ts`
- Modify: `src/ai/failure-diagnostics.ts`
- Modify: `src/ai/orchestrator.ts`
- Test: `tests/unit/processing-failure.test.ts`
- Test: `tests/unit/orchestrator.test.ts`

**Interfaces:**
- Produces: `AiProcessingFailureCategory`, `AiProcessingError`, `AiProcessingFailure`, `toAiProcessingFailure(error, requestId)`。
- Produces: `createSafeAiFailureReporter(logger)`，只输出 `AiFailureEvent` allowlist。

- [ ] **Step 1: Write failing tests**

```ts
it("keeps processing failure separate from RouteOutput", async () => {
  await expect(generateRouteOutput({ routeKey, input, primary: failingProvider }))
    .rejects.toMatchObject({ name: "AiProcessingError", category: "transport" });
});

it("reports only allowlisted diagnostics", async () => {
  const events: unknown[] = [];
  const reporter = createSafeAiFailureReporter((event) => events.push(event));
  reporter.report({ ...safeEvent, userMaterial: "SECRET" } as never);
  expect(JSON.stringify(events)).not.toContain("SECRET");
});
```

- [ ] **Step 2: Run RED**

Run: `npm.cmd test -- tests/unit/processing-failure.test.ts tests/unit/orchestrator.test.ts`

Expected: FAIL because `processing-failure.ts` and `AiProcessingError` do not exist and exhausted failures still return `friendly_failure`.

- [ ] **Step 3: Implement minimal failure domain**

```ts
export type AiProcessingFailure = {
  error: "ai_processing_failure";
  category: "transport" | "rate_limit" | "circuit_open" | "timeout" |
    "deadline" | "invalid_output" | "safety";
  message: string;
  requestId: string;
  retryable: boolean;
};
```

Replace exhausted `makeFriendlyFailureOutput()` branches with `AiProcessingError`; keep `missing_info` as a legal RouteOutput.

- [ ] **Step 4: Run GREEN**

Run: `npm.cmd test -- tests/unit/processing-failure.test.ts tests/unit/orchestrator.test.ts`

Expected: PASS; timeout/transport/schema/grounding/safety exhaustion are distinguishable and diagnostic events contain no user content.

### Task 2: HTTP status、requestId、deadline/caller abort

**Files:**
- Modify: `src/app/api/ai/route.ts`
- Modify: `src/ai/orchestrator.ts`
- Test: `tests/unit/api-ai-route.test.ts`
- Test: `tests/unit/orchestrator.test.ts`

**Interfaces:**
- Consumes: `AiProcessingError`, `toAiProcessingFailure`。
- Produces: `X-Request-Id` header and failure status mapping。

- [ ] **Step 1: Write failing route tests**

```ts
it.each([
  ["transport", 503], ["rate_limit", 503], ["circuit_open", 503],
  ["timeout", 504], ["deadline", 504],
  ["invalid_output", 502], ["safety", 502],
])("maps %s to %i without a fake action", async (category, status) => {
  const response = await handler(request);
  expect(response.status).toBe(status);
  const body = await response.json();
  expect(body).not.toHaveProperty("todayAction");
  expect(body.requestId).toBe(response.headers.get("X-Request-Id"));
});
```

Add separate tests that caller abort returns 499 while orchestration deadline returns 504 and that sensitive input remains 422.

- [ ] **Step 2: Run RED**

Run: `npm.cmd test -- tests/unit/api-ai-route.test.ts tests/unit/orchestrator.test.ts`

Expected: FAIL because failure categories are not mapped and requestId is not surfaced.

- [ ] **Step 3: Implement request boundary**

Generate one UUID at request start, pass it to orchestrator/reporter, set `X-Request-Id`, map only legal success outputs to 200, and map caller signal independently from deadline signal.

- [ ] **Step 4: Run GREEN**

Run: `npm.cmd test -- tests/unit/api-ai-route.test.ts tests/unit/orchestrator.test.ts`

Expected: PASS with distinct statuses and no fake action fields.

### Task 3: 输入页失败恢复与状态不变式

**Files:**
- Modify: `src/app/routes/[routeKey]/input/page.tsx`
- Modify: `src/lib/local-store.ts`
- Modify: `src/app/routes/[routeKey]/action/page.tsx`
- Test: `tests/unit/input-page.test.tsx`
- Test: `tests/unit/action-page.test.tsx`
- Test: `tests/integration/mvp-state-flow.test.tsx`

**Interfaces:**
- Consumes: `AiProcessingFailure` response body。
- Produces: input-page retry state with one CTA `再整理一次` and unchanged stored state on failure。

- [ ] **Step 1: Write failing UI/state tests**

```ts
it("preserves the exact draft and previous action after AI failure", async () => {
  const previous = saveCurrentAction(validOutput);
  render(<RouteInputPage />);
  await user.click(screen.getByRole("button", { name: "生成今天先做的一步" }));
  expect(loadDraft(routeKey)).toEqual(exactDraft);
  expect(loadCurrentAction()).toEqual(previous);
  expect(loadRecords()).toEqual([]);
  expect(screen.getByRole("button", { name: "再整理一次" })).toBeInTheDocument();
  expect(push).not.toHaveBeenCalled();
});
```

Add assertions that journey day/start state, review list and records are unchanged, missing_info still saves and navigates, and draft-save failure copy is different from AI failure copy.

- [ ] **Step 2: Run RED**

Run: `npm.cmd test -- tests/unit/input-page.test.tsx tests/unit/action-page.test.tsx tests/integration/mvp-state-flow.test.tsx`

Expected: FAIL because non-200 is handled generically and the retry CTA/state invariants are not explicit.

- [ ] **Step 3: Implement minimal recovery UI**

Parse success only with `routeOutputWithProvenanceSchema`; parse non-200 with `aiProcessingFailureSchema`; never call `saveCurrentAction` or `router.push` for failure; keep textarea values untouched; render one primary retry CTA and distinct save-failure status.

- [ ] **Step 4: Run GREEN**

Run: `npm.cmd test -- tests/unit/input-page.test.tsx tests/unit/action-page.test.tsx tests/integration/mvp-state-flow.test.tsx`

Expected: PASS with no action/record/review/journey mutation on failure.

### Task 4: JD 窄模型合同与确定性组装

**Files:**
- Create: `src/schemas/jd-mapping-candidate.ts`
- Create: `src/domain/jd-route-assembler.ts`
- Modify: `src/ai/provider.ts`
- Modify: `src/ai/chat-completion-provider.ts`
- Modify: `src/ai/mock-provider.ts`
- Modify: `src/ai/orchestrator.ts`
- Modify: `src/schemas/route-output.ts`
- Modify: `src/domain/route-contracts.ts`
- Test: `tests/unit/jd-route-assembler.test.ts`
- Test: `tests/unit/chat-completion-provider.test.ts`
- Test: `tests/unit/orchestrator.test.ts`

**Interfaces:**
- Produces: `JdMappingCandidate = { requirements: [{ requirementId, quote }], mappings: [{ requirementId, materialId, candidate, reason, risk }] }`。
- Produces: `assembleJdRouteOutput(input, candidate): RouteOutput`。

- [ ] **Step 1: Write exact AI 产品运营 fixture tests**

```ts
expect(output.outputType).toBe("route_result");
expect(output.routeResult?.revisionTarget).toBe(exactOriginalMaterial);
expect(JSON.stringify(output)).not.toMatch(/数据分析工具|用户数|迭代次数|跨团队协作/);
expect(output.routeResult?.candidateRevision).not.toMatch(/主导|负责|独立完成|协同研发设计/);
```

Fixture facts are limited to Tesla sales/customer/live-stream metrics and the Codex-built fresh-graduate job-map MVP from the approved input; no new facts are added.

Add quote-safety split test: JD exact quote containing `主导` remains allowed in `jdKeyRequirements`, while an unsupported candidate containing `主导` is rejected.

- [ ] **Step 2: Run RED**

Run: `npm.cmd test -- tests/unit/jd-route-assembler.test.ts tests/unit/chat-completion-provider.test.ts tests/unit/orchestrator.test.ts`

Expected: FAIL because the narrow schema and deterministic assembler do not exist and the provider still requests the full RouteOutput.

- [ ] **Step 3: Implement the narrow contract and assembler**

The provider prompt sends stable requirement/material IDs and asks only for mappings. The assembler derives `revisionTarget` from the exact material, limits candidate text to mapped source evidence, creates `minimalRevisionActions`, `todayAction`, `completionStandard`, `recordGuide`, fixed field order and provenance without model control.

- [ ] **Step 4: Run GREEN and refactor duplicate contracts**

Run: `npm.cmd test -- tests/unit/jd-route-assembler.test.ts tests/unit/chat-completion-provider.test.ts tests/unit/orchestrator.test.ts tests/unit/route-output.test.ts tests/unit/route-contracts.test.ts tests/unit/provenance.test.ts tests/unit/safety.test.ts`

Expected: PASS; JD schema has one authoritative definition and output contains no unsupported tools or facts.

### Task 5: Provider routing and total budget

**Files:**
- Modify: `src/ai/chat-completion-provider.ts`
- Modify: `src/ai/orchestrator.ts`
- Test: `tests/unit/chat-completion-provider.test.ts`
- Test: `tests/unit/orchestrator.test.ts`

**Interfaces:**
- Produces: bounded per-attempt deadlines inside an overall budget below 30 seconds。

- [ ] **Step 1: Write failing routing/budget tests**

```ts
it("retries primary once then times out fallback under the total budget", async () => {
  const started = performance.now();
  await expect(generateRouteOutput({ ...fixture, primary, fallback, deadlineMs: 120 }))
    .rejects.toMatchObject({ category: "deadline" });
  expect(performance.now() - started).toBeLessThan(300);
  expect(primary.generate).toHaveBeenCalledTimes(2);
  expect(fallback.generate).toHaveBeenCalledTimes(1);
});
```

Add table cases: invalid JSON/schema/necessary structure may reach fallback after primary repair; grounding/safety never reaches fallback; caller abort cancels immediately and is not classified as deadline.

- [ ] **Step 2: Run RED**

Run: `npm.cmd test -- tests/unit/chat-completion-provider.test.ts tests/unit/orchestrator.test.ts`

Expected: FAIL because timeout currently skips primary retry and deadline becomes a generic friendly failure.

- [ ] **Step 3: Implement documented routing**

Allocate bounded attempt windows with remaining-budget checks, keep one targeted primary repair, and gate fallback to provider machine/parse/required-structure categories only.

- [ ] **Step 4: Run GREEN**

Run: `npm.cmd test -- tests/unit/chat-completion-provider.test.ts tests/unit/orchestrator.test.ts`

Expected: PASS with observed elapsed time below the test budget and correct attempt counts.

### Task 6: Four-route regression, behavior negatives, browser evidence

**Files:**
- Modify: `tests/e2e/private-beta-readiness.spec.ts`
- Modify: `tests/unit/visible-copy-boundary.test.ts`
- Modify: `tests/integration/mvp-state-flow.test.tsx`
- Create: `qa/private-beta-production/<new-run-id>/...` through the existing evidence runner

**Interfaces:**
- Produces: non-overwriting production-build browser evidence for four routes, missing info, AI failure, save failure, review, mobile and accessibility。

- [ ] **Step 1: Add E2E assertions**

Add a deterministic AI 产品运营 success case and a forced failure case that verifies exact draft preservation, no navigation, one retry CTA, old action preservation, no record/review creation and no internal terms. Add the semantic negative “语法合法但普通学生看不懂/不可执行” and require rejection before UI display.

- [ ] **Step 2: Run focused E2E RED/GREEN**

Run production build + `next start` through the repository production E2E runner with a fresh run-id.

Expected: all assertions pass; screenshots/network/console evidence are written under a new directory and the old manual-live-run directory is unchanged.

### Task 7: Fresh verification, review, value gate, publish and production read-only E2E

**Files:**
- Update: this plan checkboxes and final evidence paths only after commands finish
- Create: release tag and Vercel deployment metadata through Git/Vercel tooling

- [ ] **Step 1: Run fresh verification**

Run in this order and preserve logs:

```text
npm.cmd test -- <focused files>
npm.cmd test
npm.cmd run lint
npx.cmd tsc --noEmit --incremental false
npm.cmd run build
npm.cmd audit --json
git diff --check
```

- [ ] **Step 2: Review the diff and matrix**

Confirm no user assets, secrets, raw inputs, prompt/raw output logs or unrelated refactors entered the diff. Re-read this plan and map each requirement to a passing test or an explicit external blocker.

- [ ] **Step 3: Commit, push, tag and deploy**

Create a traceable commit, push `codex/ai-failure-observability-jd-contract-recovery`, create an annotated evidence tag, deploy the verified snapshot, and record deployment ID/domain. No paid provider call is performed.

- [ ] **Step 4: Read-only production E2E**

Re-check current `beta.jobmapai.cn` deployment, run a new non-destructive browser evidence session, and save network/status/screenshots under a fresh run-id. The known old deployment `dpl_CQ98Cjv3CxsU6VP745y52HJkJZZz` is treated as background until current status is verified.

- [ ] **Step 5: Final mvp21-student-value-gate judgment**

Use the fixed Chinese output contract route-by-route, then aggregate. Report technical readiness separately from overall value/release gates; 8–12 real students, 7 days, day 2–3 return and two real advances remain unverified unless new evidence exists.

## Plan self-review

- Spec coverage: all approved A/B requirements, eight mandatory test groups, observability, provider policy, release, deployment, evidence and value-gate separation map to Tasks 1–7.
- Placeholder scan: no `TBD`, `TODO`, “implement later”, unspecified error handling or “similar to” steps remain.
- Type consistency: `AiProcessingFailure` is the API failure body; `AiProcessingError` is the internal thrown error; `RouteOutput` carries only legal product states; `JdMappingCandidate` is provider-internal; `assembleJdRouteOutput` is the sole JD full-output assembler.
- Scope check: observability/failure recovery and JD contract stabilization are coupled by the same production failure and API boundary, but remain independently testable in Tasks 1–3 and 4–5.

## 2026-08-05 execution record

| Workstream | Status | Evidence |
|---|---|---|
| Task 1 safe diagnostics/requestId | completed | `tests/unit/processing-failure.test.ts`; production reporter reconstructs an allowlisted event and logs no input/prompt/raw output/key |
| Task 2 HTTP failure contract | completed | `tests/unit/api-failure-contract.test.ts`: 503 transport, 504 timeout/deadline, 502 invalid output, 499 caller abort, 422 sensitive input |
| Task 3 failure recovery | completed | `tests/unit/input-page.test.tsx` and production E2E: stays on input, exact draft retained, old action/stores unchanged, single primary retry CTA |
| Task 4 JD narrow contract | completed | `tests/unit/jd-mapping-contract.test.ts`: ID mapping only, deterministic assembly, exact quotes, unsupported role/tool/PRD/user-scale/iteration claims rejected |
| Task 5 routing/budget | completed | primary timeout is retried once before fallback; production mode is capped at two primary attempts plus one fallback inside the 28-second orchestration deadline |
| Task 6 route/mobile/a11y regression | completed | `C:\Users\宋熙萌\.codex\worktrees\a68a\21天\qa\private-beta-production\20260805-1600-ai-failure-jd-contract-final--fca016a320f3--dbe92b840a30`; implementation hash `dbe92b840a30c2edb76a7c53ed2094ab5ab7a976dbcfb98e803a94cea2952ca2`; 26/26 production-build E2E passed on desktop Edge and Pixel 7 |
| Task 7 local verification/review | completed | 853 passed / 1 skipped; lint, `tsc --noEmit --incremental false`, build, high-level audit and `git diff --check` passed |
| Paid real-provider regression | not run by policy | no fresh user authorization for a paid provider call; deterministic provider and production E2E used |
| Real-student value evidence | external blocker for overall GO | still requires 8–12 ordinary fresh graduates, seven days, day 2–3 return, and at least two real advances |

Review result: no Critical or Important code issue remained after the final diff audit. The high-severity `undici` advisory was removed with a compatible lockfile update. Four moderate `postcss` advisories remain because the only automated fix requires a forced Next.js upgrade outside the declared range; this is recorded as a release-risk follow-up rather than silently forcing an unrelated framework upgrade.
