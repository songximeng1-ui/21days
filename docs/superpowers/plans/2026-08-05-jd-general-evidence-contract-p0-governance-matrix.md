# JD 通用证据合同 P0 文档治理与证据矩阵

## 原文完整性

阅读根目录：`D:\21天\docs\product`。2026-08-05 本轮开始时实际文件数 16，强制文件数 16，缺失 0，额外 0。以下为开始修改前的原文字节数与 SHA-256；D 盘原文只读，所有修订只落在独立 worktree。

| # | 精确文件名 | 字节数 | SHA-256 |
|---:|---|---:|---|
| 1 | `21天MVP发展总方向_V1.0.md` | 10883 | `69ca2ac89b8272ebaf69535200f788286d74153096100fd7444be42b9276e585` |
| 2 | `21天总准则.md` | 15213 | `73d35bc5df5948b36e5893a8554e23a3f535822b99c76cd45633e000d92a3c78` |
| 3 | `MVP AI工作流与安全边界设计.md` | 18268 | `b08d7eb8eada6a58d264ee84f023b206cb872323f641146366a9914f1f557351` |
| 4 | `MVP PM决策共识.md` | 52394 | `d90aa52ae5affc63b1aa6aa55a14c99ce4a08abe4e9841122cad7a8a10ade63f` |
| 5 | `MVP UI准则.md` | 15614 | `ccbaaec3d1b87226c88553a85940db26e6d6b0351520b7751767cbb8e1a81145` |
| 6 | `MVP UX信息架构第一版.md` | 11889 | `1f92ad069835eaac0bfeed8c31b988a34125c04e3aa8fb81cbe4c4f16b253984` |
| 7 | `MVP UX准则.md` | 23662 | `8fb57642bf33e9d0cd38ccebda854a8bd360fcec080774d9533e976909141204` |
| 8 | `MVP 测试用例与私测观察标准.md` | 21968 | `38961a0f1329847f864fb88d49d964fd270083d45de72deadcf2dc31649bd0fb` |
| 9 | `MVP 私测执行记录模板.md` | 10442 | `0c08451f0663b20325a9f73a168d7766c22a104c0f71e0aee8681a0447a09d16` |
| 10 | `MVP 四路线输入输出数据设计.md` | 20618 | `f025a783af8c84009bc9712553c195e8c54f697b37ca576c318b3dc1a926e501` |
| 11 | `MVP 研发边界决策.md` | 3855 | `b031f3ba48ded73f7025f0e2c4b89453f8a8015d4d928114a431c63827ac63af` |
| 12 | `MVP 研发进度记录.md` | 3173 | `d7a2b4c7b14a6a99253db2bc75e35f887b47127fe00d4c647d26e82867269860` |
| 13 | `MVP 页面低保真线框图.md` | 14400 | `edfbedb57b3ffb2b7535bbeb51fe2134b6f633ab31472f4891c6475680838298` |
| 14 | `MVP 页面线框与关键状态设计.md` | 13706 | `e7a0322eeced969bc4f88b6e41deb9d19abd3647dc52c87c1118cb179db5e31c` |
| 15 | `项目协作准则.md` | 3181 | `7c2b6024e0eb7e7b733308441ee4c179b4b8ce4c11074ce5ad9174a21d81562b` |
| 16 | `新MVP PRD.md` | 11105 | `52f4e8519ed4916544e108d905b55d22de3af8d7250f52338c8614a891fbe16c` |

## 冲突裁决

| 冲突 | 优先级判断 | 本轮裁决 |
|---|---|---|
| 《21天总准则》§7.4 与多个路线文档固定要求 1–2 个最小修改；诚实裁决需要允许 0 修改。 | 最高准则优先，且主人本次已明确批准修订。 | 显式修订最高准则及受影响文档：必须有一个投递前行动；行动可为实际修改、补证据或严格 all-keep 的确认/保存。 |
| AI 文档把“安全失败”和“机器失败”混入重试/副模型规则。 | 最高准则真实、安全、行动优先；主人本次批准的更具体失败策略优先。 | 语义/grounding/safety/product invalid 只定向 primary 修复一次；机器失败才 primary 技术重试一次后 Qwen；两路互斥。 |
| 原文允许 30 秒，批准方案要求硬截止 28 秒、30 秒内用户看到失败。 | 更具体的新明确指令且不违背原文上限。 | 服务端 28 秒硬截止，浏览器 30 秒取消；caller abort 和 deadline 分离。 |
| 数据/研发文档要求本地保存草稿，批准方案禁止持久化完整 JD/材料/关系矩阵/raw output。 | 用户草稿恢复与服务端内部持久化是不同边界。 | 浏览器本地草稿继续逐字保存；服务端不持久化完整用户文本；local-store 不保存请求级关系矩阵或 raw model output。 |
| PM 文档旧段落仍称“不写代码/不进入研发”。 | 较新研发进度、仓库现状及主人本次明确授权优先。 | 记录为历史治理状态，不阻止本轮研发。 |

## 文档章节 → 实现/证据 → 状态 → 问题 → 修复/测试

| 文档章节 | 实现/证据 | 当前状态 | 问题 | 修复/测试 |
|---|---|---|---|---|
| 《21天总准则》§5、§8、§16 | `/api/ai`、行动/记录/复盘/调整链 | 部分满足 | JD 正常 200 可合法但只分析 1 项、选错目标，不能证明真实推进。 | 精确 AI 产品运营 RED；服务端高价值选择；失败不创建/覆盖闭环对象。 |
| 《21天总准则》§7.4、§9 | JD 路线结果与 AI 边界 | 必须修订 | “必须修改”排斥诚实 0 修改；现有 `暂不改写` 又未形成严格 all-keep。 | 文档加入三闭环；服务端 all-keep 前置检查与 0 修改行动测试。 |
| 《21天MVP发展总方向》§6、§8、§10 | 真实岗位来源版本、模型接口与 P0 数据链 | 部分满足 | 现有 provenance 不是单一 `sourceId + hash/version + fieldPath + quote/span` 合同。 | 请求级来源目录、hash/span 校验、无持久化/无日志泄漏测试。 |
| 《MVP AI工作流与安全边界设计》§2.1–2.3 | `orchestrator.ts`、provider set | 部分满足 | 模型窄合同仍允许只返回 1 个 mapping；机器/产品失败分类需要收紧互斥性。 | 一次正常调用；两条互斥修复路径；attempt 数、fallback 与 28 秒预算测试。 |
| 同文 §3、§5.3、§6 | JD 请求与 `missing_info` | 部分满足 | 完整输入虽为 route_result，仍可能选错高价值证据；缺信息和 collect_evidence 尚未分清。 | 3–5 条要求、direct/partial/unsupported、collect_evidence 三闭环测试。 |
| 同文 §7–9 | 单行动、输出安全与用户确认 | 部分满足 | 候选验证只覆盖部分角色/工具/数字；未覆盖每个事实、结果和强度词。 | 原子事实验证；quote 与 candidate 安全分离；确认前不保存。 |
| 同文 §10–12 | 等待、失败、隐私与 reporter | 已有基础，需强化 | 没有 draftRevision/stale/idempotency；服务端 28 秒与浏览器 30 秒需系统性验证。 | requestId/revision、迟到忽略、allowlist reporter、caller abort/deadline 测试。 |
| 《MVP PM决策共识》§9–11、§17–21 | 单行动、记录、路线定制结果 | 必须修订/回归 | 多处把 JD 行动固定为 1–2 条修改；all-keep 无记录闭环。 | 统一成“一个投递前行动、0–2 修改”；三闭环分别保存与轻复盘。 |
| 《MVP UX信息架构第一版》§3.3、§4、§7 | JD 输出+行动页、缺信息页 | 必须修订/回归 | 线框只覆盖修改/补信息，未覆盖严格 all-keep；解释不是可展开短引用。 | 不新增页面；结果页 0–2 修改、展开为什么、all-keep 行动。 |
| 《MVP UX准则》§5.3、§6–8、§11–12 | 输入页、行动页、草稿和失败状态 | 必须修订/回归 | 固定 1–2 修改；并发迟到响应可能覆盖新草稿/旧行动。 | revision/idempotency 状态机；失败不变式；移动/可访问性测试。 |
| 《MVP UI准则》§7、§10、§12–14 | 主行动卡、错误态、a11y | 部分满足 | JD 证据区不是按修改项展开；缺 `aria-expanded`；320px/44px 需新鲜证据。 | 可展开“为什么改这一处”、短双引用、320px/44px/AA/aria 回归。 |
| 《MVP 四路线输入输出数据设计》§3、§6、§8–10 | route schema、JD assembler、provenance | 必须修订 | 通用 `Record<string, unknown>` 与 mapping 不表达关系/处置；source quote 最长 12 字不能承担精确合同。 | typed envelope 与 exact refs；关系只在请求级；0–2 外部结果 schema。 |
| 《MVP 测试用例与私测观察标准》§3–10 | Vitest/Integration/Playwright/value gate | 必须扩充 | 现有好 mapping fixture 不能复现真实模型错选；缺 all-keep、关系基数和行为负例。 | 16–20 锚定样例、≥20% hidden-set 机制、硬约束 100%、红线 0。 |
| 《MVP 私测执行记录模板》§4–12 | 7 天真实用户证据 | 外部未验证 | 本轮没有 8–12 名普通应届生、2–3 天回访、两次真实推进。 | 最终明确未验证；技术通过只判私测候选，不宣称整体价值/发布 GO。 |
| 《MVP 研发边界决策》§2–6 | Next 单体、本地存储、mock、四路线 | 部分满足 | 当前 orchestrator/provider 文件过大，但本轮禁止无关重构；request-level contract 需最小独立模块。 | 新建聚焦 JD contract/validator 模块；保持四路线/API/本地隐私边界。 |
| 《MVP 研发进度记录》已完成/当前验证 | c7 基线与既有 26/26 production E2E 证据 | 已过时 | 既有“可私测”结论被生产 AI 产品运营反例推翻。 | 追加本轮反例、修复、验证、部署与新裁决；不覆盖旧证据。 |
| 《MVP 页面低保真线框图》§4–9、§13–14 | JD 输入、输出、记录、复盘 | 必须修订/回归 | 固定一个修改；失败/保存分离已有但 stale/idempotency 和 all-keep 未表现。 | 修订 JD 低保真三状态；保留单一主 CTA；E2E 截图。 |
| 《MVP 页面线框与关键状态设计》§4–8、§11 | 页面关键状态 | 必须修订/回归 | 固定 1–2 修改，未定义 0 修改与展开解释。 | 加 all-keep/collect_evidence/actual-change 状态；aria-live/expanded。 |
| 《项目协作准则》§3、§6 | 理解确认、提交推送/tag | 已满足前提 | 需要在最终验证后才提交，且当前 worktree detached。 | 以 c7 为基线工作；验证后提交并推送目标分支，创建新 tag，报告精确哈希。 |
| 《新MVP PRD》§7.4、§8–14 | JD 产品需求、关键页面、测试/私测 | 必须修订/回归 | 把“先改 1–2 条”写死；无严格 all-keep。 | 改为一个投递前行动与 0–2 修改；三闭环验收与最终 value gate。 |

## 已确认生产反例

只读证据目录：`C:\Users\宋熙萌\.codex\visualizations\2026\08\05\019fd0c4-11f8-71e2-b721-8a3ff5f1a1b7\20260805-actual-ai-product-ops-live-run`。

- `01-input-filled.png`
- `02-api-response.json`
- `03-final-page.png`
- 请求约 22.246 秒、HTTP 200 `route_result`、requestId `f731256f-a8f8-481c-8242-04fba4a96429`。
- 结果错选公司/岗位标题行为作为 `revisionTarget`，只处理一项要求，忽略特斯拉运营量化证据与求职地图 MVP 全流程证据，并给出“暂不改写”。
- 结论：当前部署 JD 路线用户价值门 `NO-GO`；旧“可启动受控私测”结论已被该反例推翻。

## 2026-08-05 实施后矩阵回归（提交前）

| 治理要求 | 实现/证据 | 状态 | 尚未满足 |
|---|---|---|---|
| 单一请求级来源合同 | `src/domain/jd-evidence-contract.ts` 签发并验证 `sourceId + contentHash + version + fieldPath + exactQuote + span`；模型只能返回来源 ID | 技术通过 | 未做付费真实 provider 新调用 |
| 3–5 条要求完整裁决 | `jd-mapping-candidate` + assembler 强制覆盖服务端目录中的全部前 3–5 条要求 | 技术通过 | 真实模型在生产中的质量仍待授权后复验 |
| 原子关系与事实边界 | 服务端按动作、工具、流程、项目、风险、数据、分析、复盘等分离原子验证；粗桶混淆、能力总结、注入和无来源强度词均进入安全补证据态 | 技术通过 | 语义覆盖仍需普通应届生私测观察 |
| 三条诚实闭环 | `modify` 保存修改前后；`collect_evidence` 保存缺口，正向确认的证据逐字合并本地草稿后重判，明确未找到不合并；`all_keep` 保存当前版本、投递状态和观察点 | 技术通过 | 真实投递反馈尚未产生 |
| 失败恢复互斥 | 语义/grounding/safety/product invalid 仅 primary 定向修复一次；机器不可用才 primary 技术重试一次后 Qwen；28 秒覆盖 body read，caller abort 与 deadline 分离 | 技术通过 | 未进行新的付费 provider 超时调用 |
| 失败不破坏旧状态 | requestId + draftRevision + idempotency；迟到响应忽略；AI、保存、复盘失败分离；事务失败回滚 | 技术通过 | 需 7 天私测中的设备/浏览器多样性观察 |
| UI 与可访问性 | 单行动卡、0–2 修改、短双引用展开；内部术语不外显；320px 无横滚；实际按钮、链接、checkbox 标签触控目标检查；`aria-live`/`aria-expanded` | 浏览器聚焦通过 | 最终 production E2E 证据待提交后生成 |
| 分层样例 | 40 条规则样例，其中 8 条（20%）冻结隐藏；另有精确 AI 产品运营 fixture 与关系拓扑、冲突、注入、双语、长文本测试 | 技术通过 | 真实私测样本尚未达到 8–12 人 × 7 天 |

提交前新鲜验证：最终聚焦后端 `78/78`、前端单元 `39/39`；全量 Vitest `942/942`（另 1 skipped）；浏览器定向 desktop/mobile 通过；lint、`tsc --noEmit --incremental false`、production build、`git diff --check` 均通过；`npm audit --audit-level=high` 无 high/critical，保留依赖链 4 个 moderate（强制自动修复会升级到声明范围外的 Next 版本）。后端安全与前端治理最终只读复核均明确“可放行”，未发现剩余 P0/P1。

价值裁决仍不变：这组证据只证明离线/确定性技术候选，不推翻既有生产真实 AI 反例，也不能替代 8–12 名普通应届生 7 天私测、2–3 天回访与两次真实推进。
