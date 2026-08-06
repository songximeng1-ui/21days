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
- 审计仅发现 `next` → `postcss` 依赖链中的 moderate 问题；修复需强制升级到当前声明范围外的 Next.js 16.3.0（minor 版本升级），故本 P0 不纳入该升级。
- git diff check：通过。

## 验收边界

- 本轮真实 DeepSeek/Qwen 调用数：0。
- 生产真实 provider 恢复状态：PARTIAL；需要另行授权的 canary。
- 普通应届生用户价值状态：PARTIAL；仍需真实私测证据。
