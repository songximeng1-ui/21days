# AI empty_content typed failure 与预算感知 fallback P0 治理矩阵

日期：2026-08-06

## 已确认生产反例

- 只读请求证据：`requestId=6ec1c27f-05d6-48e8-b255-f8c67d382310`。
- 生产结果：HTTP 500，约 27.891 秒，外部错误为 `invalid_output`。
- 安全日志显示 primary attempt 1/2 均为 `provider_content / empty_content`；虽然决策写成 `try_fallback`，但没有 fallback 生命周期事件，最终落入通用 500。
- 根因：JD assembler 在受控语义失败边界之外抛普通 `Error`；固定第二次 primary 消耗了 fallback 预算；provider 内容耗尽被误归类为 semantic invalid。
- 价值裁决：该证据证明原生产版本为 `NO-GO`。本轮未获授权进行新的真实/付费模型 canary，因此技术修复不能单独推翻此价值结论。

## 产品规则到实现与证据

| 要求 | 实现 | 自动化证据 | 状态 |
|---|---|---|---|
| 单一 typed failure algebra | `src/ai/attempt-failure.ts` 统一 provider 与 semantic attempt failure；`processingFailureCategory` 只在边界映射用户分类 | orchestrator、processing failure、API failure contract 单测 | 技术通过 |
| 业务缺信息不调用模型 | 服务端输入充分性与方向证据门直接返回 `missing_info` | missing-info provider 调用次数为 0；terminal category 为 `business_missing_info` | 技术通过 |
| deadline/cancelled/machine/semantic HTTP 映射 | deadline 504、cancelled 499、machine 503、semantic 502；未知内部错误保留 500 | API route 与 failure contract 单测 | 技术通过 |
| empty_content 属于机器不可用 | `AiProviderError("empty_content")` 耗尽后映射 `machine_unavailable` | API 断言 503 与机器失败文案 | 技术通过 |
| JD assembler 为 total result | `assembleJdRouteOutputResult` 对 schema、覆盖、未知 ID、不支持关系、无来源候选返回 typed code，不抛普通 Error | JD mapping contract 与语料分层单测 | 技术通过 |
| 服务端拥有 requirement/source/coverage | 模型最小契约只返回 decisions；移除 `selectedRequirementIds`；coverage 从服务端目录和 decisions 推导 | provider contract、schema、assembler 单测 | 技术通过 |
| 主模型最多两次且预算感知 | `orchestration-budget.ts` 预留响应、fallback 窗口与 250ms 调度余量；每次 provider 的绝对 deadline 截断到下游保留线，只有预算同时容纳 retry 与 fallback 才做第二次 primary | 短 7 秒 deadline、9/9.25 秒准入边界、真实 attempt-deadline settle、两次上限单测 | 技术通过 |
| fallback 生命周期完整 | started/succeeded/failed/skipped_budget/skipped_policy 均为 allowlisted orchestration event | orchestrator 生命周期顺序与事件数单测 | 技术通过 |
| semantic 与 fallback 互斥 | semantic invalid 只允许定向 primary 修复，不进入 fallback；记录 skipped_policy | semantic invalid fallback 调用次数为 0 | 技术通过 |
| 安全诊断不泄漏输入/输出/密钥 | observation 只保留 finish reason、choice/content shape 和 UTF-8 字节长度桶；safe reporter 运行时再次验证枚举白名单 | raw envelope、prompt、API key、schema path/provider code 与伪造 observation 值泄漏负例 | 技术通过 |
| 每个有效 AI API 请求恰好一个 terminal | success、business missing、machine、semantic、deadline、cancelled、unexpected 在 API 请求边界缓冲后最终裁决；providerFactory、provider 编程错误、编排后校验、预检失败与无 provider 均有受控终态 | terminal 数量、light review 预检、无 provider、providerFactory/TypeError 单测 | 技术通过 |
| 用户看到可行动且不暴露内部术语的失败 | machine：`服务暂时没有返回结果。你的草稿已保存，请稍后再试。`；semantic：`这次没有生成足够可靠的建议。你的草稿已保存，可以稍后再试。` | API/UI failure copy 与内部 code 不外显断言 | 技术通过 |
| 失败不破坏行动闭环 | 失败不创建记录/复盘，不覆盖草稿和旧行动；重试不产生重复对象 | `mvp-state-flow`、input/action/local-store 既有回归 | 技术通过 |

## 新鲜离线验收

- Vitest：34 个文件通过、1 个按预期跳过；958 tests passed、1 skipped。
- ESLint：通过，零 warning/error。
- TypeScript：`tsc --noEmit --incremental false` 通过。
- Production build：Next.js 16.2.12 build 通过，`/api/ai` 动态路由成功生成。
- `npm audit --audit-level=high`：无 high/critical；保留 PostCSS 依赖链 4 个 moderate。`--force` 会把 Next 升至声明范围外版本，本轮不做破坏性依赖升级。
- `git diff --check`：通过。

## 尚未满足

- 尚未执行提交后、clean HEAD 的 production Playwright 证据；将在本轮发布前补齐。
- 尚未执行新的真实 DeepSeek/Qwen canary，因为没有新的付费调用授权。
- 尚无 8–12 名普通应届生、7 天使用、2–3 天回访与至少两次真实推进证据。
- 因此当前只能判定为“离线技术候选通过”，不能宣称真实 provider 修复已被生产验证，也不能给出整体用户价值 `GO`。
