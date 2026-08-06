# DeepSeek V4 provider 根因修复 P0 设计

日期：2026-08-06

## 目标

消除 JD 路线仍依赖已停用 DeepSeek 旧模型名、且未明确关闭 V4 思考模式的配置根因，使结构化 JSON 请求在现有 12 秒单次调用窗口和 900-token JD 输出预算内使用受支持的非思考模型。同时保留上一轮已经完成的 typed failure、预算感知重试与 Qwen fallback 行为。

本轮只修 provider 选择与请求能力合同，不改变 JD 产品合同、用户输入输出、证据目录、assembler、HTTP 失败语义或本地状态闭环。

## 已确认根因

1. 项目默认配置和 `.env.example` 仍使用 `deepseek-chat`。
2. DeepSeek 官方已公告 `deepseek-chat` 与 `deepseek-reasoner` 于 2026-07-24 15:59 UTC 停用，当前正式模型名为 `deepseek-v4-flash` 与 `deepseek-v4-pro`。
3. DeepSeek V4 的 OpenAI Chat Completions 默认启用思考模式；关闭方式是请求体顶层 `thinking: { type: "disabled" }`。
4. 当前 JD 路线只给 900 个输出 token，单次 provider 窗口默认 12 秒。思考模式会先生成 `reasoning_content`，与短时、窄 JSON 决策合同不匹配。
5. DeepSeek 官方同时说明 JSON Output 偶发返回空 `content`，因此 provider 配置修正不能替代上一轮的 typed retry/fallback；两层必须同时存在。
6. 2026-08-05 的生产反例表现为两个 primary 请求返回成功 envelope 但 `content` 为空，之后耗尽原有预算。现有证据与上述配置漂移一致，但本轮不把没有重新执行的真实调用描述为已验证修复。

官方依据：

- DeepSeek Models & Pricing：<https://api-docs.deepseek.com/quick_start/pricing/>
- DeepSeek Thinking Mode：<https://api-docs.deepseek.com/guides/thinking_mode>
- DeepSeek JSON Output：<https://api-docs.deepseek.com/guides/json_mode/>

## 方案选择

采用最小兼容修复：

- 旧 `deepseek-chat` 配置在应用内规范化为 `deepseek-v4-flash`。
- DeepSeek V4 结构化请求显式关闭思考模式。
- 代码默认值和 `.env.example` 改为 `deepseek-v4-flash`。
- Qwen 和其他 OpenAI-compatible provider 不接收 DeepSeek 专属 `thinking` 参数。
- 暂不扩大 JD 的 900-token 上限；先移除思考 token 竞争，避免同时改变成本、时延和输出长度三个变量。

不采用以下方案：

- 仅要求人工修改生产环境变量：部署顺序容易造成继续故障，也无法保护旧配置的其他环境。
- 建立通用 provider capability registry：当前只有一个 DeepSeek 专属差异，完整能力系统超出 P0 范围。
- 删除 `response_format: { type: "json_object" }`：会削弱现有解析合同，且官方仍支持 JSON Output。

## 架构与组件边界

### DeepSeek 配置规范化

在 provider 构造边界增加一个纯函数，用于把 DeepSeek 模型配置规范化为受支持的运行时合同。

输入：

- provider base URL
- 配置的模型名

输出：

- 最终请求模型名
- 是否附加 `thinking: { type: "disabled" }`

规则：

- DeepSeek 官方域名上的 `deepseek-chat` 自动映射为 `deepseek-v4-flash`。
- DeepSeek 官方域名上的 `deepseek-v4-flash` 和 `deepseek-v4-pro` 保持原模型名，并显式关闭思考。
- DeepSeek 官方域名上的 `deepseek-reasoner` 不作为本产品的合法结构化运行模型；构造时抛出安全配置错误，避免静默把明确的推理配置改成非推理语义。
- Qwen 官方兼容地址及其他受当前 URL policy 允许的非 DeepSeek 地址保持模型名，不附加 `thinking`。

规范化只处理允许的公开模型标识，不读取、记录或返回 API key。

### 请求体生成

`ChatCompletionProvider` 保持现有公共职责：构造一次非流式 Chat Completions 请求、读取受限响应、返回 parsed JSON 或 typed provider failure。

请求体公共字段保持不变：

- `model`
- `temperature: 0.2`
- route-specific `max_tokens`
- `response_format: { type: "json_object" }`
- system/user messages

只有 DeepSeek V4 请求额外包含：

```json
{
  "thinking": {
    "type": "disabled"
  }
}
```

该字段由构造时确定的 capability 决定，不在每次请求时通过 hostname 字符串临时猜测。

### 环境配置

- `DEEPSEEK_MODEL` 缺省值改为 `deepseek-v4-flash`。
- `.env.example` 同步改为 `deepseek-v4-flash`，并注明本产品的结构化短任务使用非思考模式。
- 已存在的 `DEEPSEEK_MODEL=deepseek-chat` 无需先人工修改即可安全迁移。
- 不自动更改 Vercel 环境变量，不下载或显示生产 API key。

## 数据流

1. API route 从环境构造 provider set。
2. DeepSeek 配置规范化函数验证 base URL 与模型名，产出 canonical model 与请求 capability。
3. `ChatCompletionProvider.generate()` 使用 canonical model 构造请求体。
4. DeepSeek V4 请求显式关闭思考；Qwen 请求保持当前兼容格式。
5. 正常 JSON 继续进入现有 schema、grounding、safety 与 assembler 流程。
6. 空 `content`、截断、provider JSON 或 HTTP 故障继续进入上一轮的 typed failure、预算感知 retry/fallback，不增加新的普通 `Error` 逃逸路径。

## 错误处理与安全

- 已停用且语义明确冲突的 `deepseek-reasoner` 在 provider 构造阶段失败，错误文案只说明 provider 配置无效，不包含 key 或请求内容。
- `deepseek-chat` 是允许自动迁移的唯一旧 chat 别名。
- 不把模型名加入当前用户可见错误体。
- 不扩大 diagnostics allowlist，不记录模型、prompt、原始响应、用户材料或环境变量值。
- DeepSeek JSON Output 的偶发空响应继续归类为 `machine_unavailable`，不伪装为语义失败或成功。
- 不新增真实/付费 provider 调用。真实验证必须另行获得授权，并使用新 requestId 与安全日志证据。

## 测试设计

先写失败测试，再实现最小修复。

单元测试必须证明：

1. 默认 DeepSeek 模型为 `deepseek-v4-flash`。
2. 显式 `deepseek-chat` 被规范化为 `deepseek-v4-flash`。
3. `deepseek-v4-flash` 与 `deepseek-v4-pro` 请求包含 `thinking: { type: "disabled" }`。
4. `deepseek-reasoner` 被拒绝，且错误不泄漏 key。
5. Qwen 请求不包含 `thinking`，模型名保持 `qwen-plus` 或配置值。
6. JD 请求仍使用 `max_tokens: 900` 与 `response_format: { type: "json_object" }`。
7. 现有空内容 observation、typed failure、retry/fallback 与 HTTP 状态测试继续通过。
8. 环境缺 key 时的 production fail-closed mock 行为不变。

验证门：

- provider 与 orchestrator 聚焦测试
- 全量 Vitest
- ESLint
- TypeScript noEmit
- production build
- `npm audit --audit-level=high`
- `git diff --check`

## 发布与验收边界

技术完成条件：

- 代码、示例配置和测试一致使用受支持的 DeepSeek V4 合同。
- 旧 `deepseek-chat` 配置无需运维先改即可生成 canonical 请求。
- Qwen 请求体无回归。
- 所有离线门通过，且没有真实 provider 调用。

发布后只读验证可以确认部署 SHA、页面和静态路由，但不能证明真实 JD provider 已恢复。只有另行授权的生产 canary 返回非空、通过 server-side 合同的 JD 结果，才能把真实 provider 状态从 `PARTIAL` 提升为技术通过；普通应届生用户价值仍需独立私测证据。

## 非目标

- 不修改 JD evidence catalog、决策 schema 或 assembler。
- 不改变 28 秒请求 deadline、12 秒 provider timeout、900-token JD 上限或 fallback 预算。
- 不升级 Qwen 模型。
- 不新增 provider、流式响应、工具调用或 JSON Schema API。
- 不修改用户界面与用户可见文案。
- 不执行真实/付费模型请求，不宣称真实 provider 已修复。
