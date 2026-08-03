# MVP 输出清晰度与 16 文档合规修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复真实 JD 路线中“来源可追踪但普通应届生仍看不懂、做不了、容易被诱导硬凑经历”的输出，使每次行动明确编辑对象、原句/位置、证据边界、候选表达或补证动作、完成标准和记录字段，并保持四路线与记录复盘闭环不回归。

**Architecture:** 保留现有 Next.js 单体、四路线结构和 provider 编排；在 JD 输入与输出之间增加“材料证据强度”判断，把“具体已发生动作”“只有能力宣称”“没有支撑”分开处理。扩展 JD 输出合同承载修改目标、候选句和证据核对动作；在 Prompt、确定性归一化、语义质量门、UI 与记录页使用同一契约，避免靠前端换词掩盖上游问题。

**Tech Stack:** Next.js 16、React 19、TypeScript、Zod 4、Vitest、Testing Library、Playwright、浏览器本地存储。

## Global Constraints

- 《21天总准则》优先级最高；每次输出必须服务“真实材料 → 唯一今日行动 → 真实记录 → 轻复盘 → 下一轮调整”。
- 不新增账号、岗位抓取、自动投递、完整简历编辑器、CRM、评分、概率或报告兜底。
- 不把能力宣称、岗位要求或 AI 建议当作“用户实际做过”的事实；证据不足时不生成简历候选句。
- 今日行动必须只有一个，预计 15–30 分钟，并明确去哪里、改/查什么、依据什么、何时完成、做完记录什么。
- 不新增付费真实 provider 调用；使用确定性 fixture、单元/集成测试和 production mock E2E。
- 保护现有未跟踪计划、规格和 QA 资产；不 reset、clean、checkout、覆盖或删除。
- 本任务不提交、不推送、不部署；《项目协作准则》§6 的默认提交推送要求被用户本轮明确指令覆盖。

---

## 1. 16 份产品文档完整性证据

目录 `D:\21天\docs\product` 实际恰好 16 份文件，指定文件无缺失、无额外文件、无重命名。2026-08-03 本轮完整读取记录如下：

| # | 文件 | 字节数 | SHA-256 |
|---:|---|---:|---|
| 1 | `21天MVP发展总方向_V1.0.md` | 10883 | `69CA2AC89B8272EBAF69535200F788286D74153096100FD7444BE42B9276E585` |
| 2 | `21天总准则.md` | 15213 | `73D35BC5DF5948B36E5893A8554E23A3F535822B99C76CD45633E000D92A3C78` |
| 3 | `MVP AI工作流与安全边界设计.md` | 18268 | `B08D7EB8EADA6A58D264EE84F023B206CB872323F641146366A9914F1F557351` |
| 4 | `MVP PM决策共识.md` | 52394 | `D90AA52AE5AFFC63B1AA6AA55A14C99CE4A08ABE4E9841122CAD7A8A10ADE63F` |
| 5 | `MVP UI准则.md` | 15614 | `CCBAAEC3D1B87226C88553A85940DB26E6D6B0351520B7751767CBB8E1A81145` |
| 6 | `MVP UX信息架构第一版.md` | 11889 | `1F92AD069835EAAC0BFEED8C31B988A34125C04E3AA8FB81CBE4C4F16B253984` |
| 7 | `MVP UX准则.md` | 23662 | `8FB57642BF33E9D0CD38CCEBDA854A8BD360FCEC080774D9533E976909141204` |
| 8 | `MVP 测试用例与私测观察标准.md` | 21968 | `38961A0F1329847F864FB88D49D964FD270083D45DE72DEADCF2DC31649BD0FB` |
| 9 | `MVP 私测执行记录模板.md` | 10442 | `0C08451F0663B20325A9F73A168D7766C22A104C0F71E0AEE8681A0447A09D16` |
| 10 | `MVP 四路线输入输出数据设计.md` | 20618 | `F025A783AF8C84009BC9712553C195E8C54F697B37CA576C318B3DC1A926E501` |
| 11 | `MVP 研发边界决策.md` | 3855 | `B031F3BA48DED73F7025F0E2C4B89453F8A8015D4D928114A431C63827AC63AF` |
| 12 | `MVP 研发进度记录.md` | 3173 | `D7A2B4C7B14A6A99253DB2BC75E35F887B47127FE00D4C647D26E82867269860` |
| 13 | `MVP 页面低保真线框图.md` | 14400 | `EDFBEDB57B3FFB2B7535BBEB51FE2134B6F633AB31472F4891C6475680838298` |
| 14 | `MVP 页面线框与关键状态设计.md` | 13706 | `E7A0322EECED969BC4F88B6E41DEB9D19ABD3647DC52C87C1118CB179DB5E31C` |
| 15 | `项目协作准则.md` | 3181 | `7C2B6024E0EB7E7B733308441EE4C179B4B8CE4C11074CE5AD9174A21D81562B` |
| 16 | `新MVP PRD.md` | 11105 | `52F4E8519ED4916544E108D905B55D22DE3AF8D7250F52338C8614A891FBE16C` |

## 2. 治理冲突与裁决

| 冲突 | 裁决 | 理由 |
|---|---|---|
| 《MVP PM决策共识》§1、§26 写“不写代码/不进入研发”，但研发边界、研发进度、当前代码和主人本轮要求已进入修复阶段 | 作为历史阶段状态保留，不把现存代码判为缺陷；执行本轮修复 | 最高准则之后按适用阶段、较新状态和主人最新明确指令裁决 |
| 《项目协作准则》§6 要求变动后提交推送，但本轮明确“默认不提交、不推送、不部署” | 不提交、不推送、不部署 | 主人本轮直接指令优先 |
| 《新MVP PRD》§6 列出独立状态选择页、21 天进度页；较新的 PM/UX 文档要求问题选择嵌首页、周期合并进轨迹 | 遵循较新 PM/UX，不新增独立页面 | 更具体、更晚且能减少工具集合/课程感 |
| 多处文档写 JD 路线可给 1–2 条修改，但 PM/UX 又要求强约束单行动 | 一次只执行 1 处材料修改；其余要求作为缺口，不并列成任务 | 《21天总准则》§16 第 3 项及主人本轮“今日行动唯一且具体”优先 |
| AI 文档要求主模型重试后再切副模型；当前已验证的最新策略为单次超时后切副模型以守住总预算 | 本任务不改 provider 超时策略，记录为文档治理差异 | 与清晰度根因无关；主人明确该策略是最近已修复状态 |
| 《MVP 研发进度记录》只记 2026-07-21 的 30 个测试，当前仓库远超该状态 | 仅作历史记录，不用于本轮通过结论 | 文档自身与 mandatory-docs 均规定状态记录不能替代最新验证 |

## 3. 需求矩阵：文档章节 → 当前证据 → 状态 → 修复与测试

| 文档章节 | 当前实现/截图证据 | 状态与问题 | 修复/测试 |
|---|---|---|---|
| 《21天总准则》§4–5、§8、§10–16 | 截图中用户无法复述“补一句真实动作”具体改什么；结果卡重复 | **Critical / 闭环失败**：有行动外形，无清晰行动和可用记录标准 | JD 清晰度负例、完成标准合同、行动页结构和记录预填 E2E |
| 《21天总准则》§7.4、§9 | 输入有 JD 和材料，输出未评价本人/概率，但把能力宣称当事实证据 | **Critical**：来源存在不等于事实已核实 | 材料证据强度分类；能力宣称转补证，不生成候选句 |
| 《21天MVP发展总方向》§0、§3、§10 | 行动缺对象、标准、证据；记录句较泛 | **Critical** | 统一 completionStandard；对象/动作/证据锚点门 |
| 《新MVP PRD》§7.4、§8.4–8.6、§10–14 | JD 结果字段齐全但修改动作不落到原句/候选句 | **Critical** | JD 扩展合同与界面；输入不足/证据不足状态测试 |
| 《MVP PM决策共识》§2–3、§9–11、§18–23 | action_title、reason、steps 可通过结构测试，但对普通学生仍抽象 | **Critical** | 语义质量门直接覆盖截图同型负例；记录修改前后版本 |
| 《MVP UX信息架构第一版》§3.3、§4、§7–9 | 页面有行动、记录入口；Action 页把行动、证据、4 块结果全部铺开 | **Important**：报告感与重复增加认知负担 | JD 结果折叠为“这次依据/证据缺口”，不复述行动 |
| 《MVP UX准则》§6、§7、§8、§12 | `completionStandard` 可选；用时和记录未加明确标签 | **Critical** | 必填/归一化完成标准；元信息加“预计用时/完成后记录”标签 |
| 《MVP UI准则》§5–7、§10、§13–14 | 今日行动视觉最高，但抽象短判断用 H1；多个同权重结果卡 | **Important** | H1 固定为“今天只做这一件事”；短判断降级；移动端/可访问性测试 |
| 《MVP 页面低保真线框图》§6–9 | 完成标准未稳定生成；记录页未预填候选句 | **Critical** | 结构化 `revisionTarget`/`candidateRevision`；记录页预填并要求确认 |
| 《MVP 页面线框与关键状态设计》§5–8 | 页面动作可记录，但证据不足仍是正常 route_result 改写语义 | **Critical** | claim-only route_result 变成明确补证型行动，仍可保存核验记录 |
| 《MVP 四路线输入输出数据设计》§3.3、§6、§9 | JD 合同只有泛化列表，没有明确修改目标与候选句字段 | **Critical** | 扩展 JD schema、Prompt、mock、hard contract、provenance |
| 《MVP AI工作流与安全边界设计》§5.3、§6–9 | 结构/安全门通过；“语法合法但不可执行”未拦 | **Critical** | action clarity gate；候选句须有直接事实，能力宣称不得升级 |
| 《MVP 测试用例与私测观察标准》§4.3、§7–10 | 本轮基线 5 文件 312 测试全过，但截图仍失败 | **Critical / 测试缺口** | 新增截图同型输出的 RED 测试、行为级 UI 与 production E2E |
| 《MVP 私测执行记录模板》§4–8、§12 | 没有 8–12 人真实 7 天数据；截图已给出一条真实负反馈 | **外部阻断**：不能判整体价值 GO | 技术修复后仍保留真实私测阻断；提供受控私测启动建议 |
| 《MVP 研发边界决策》§3–7 | 单编排器+四策略存在，安全检查多为特例正则 | **Important** | 抽出聚焦的 JD 证据/清晰度模块，不做无关重构 |
| 《MVP 研发进度记录》全文 | 历史状态过期 | **Minor / 治理记录** | 不改历史文档；最终仅引用本轮新鲜命令 |
| 《项目协作准则》§5 | 产品主人已明确“看不懂”；当前输出堆抽象词 | **Critical** | 最终说明与 UI 都用普通话；浏览器截图人工复核 |

## 4. 根因与方案选择

### 4.1 已复现的链路

1. `src/app/routes/[routeKey]/input/page.tsx` 只要求“相关经历或简历片段”，不要求原句与证据；`currentQuestion` 可选字段未显示。
2. `src/domain/routes.ts` 只检查 JD、材料为非占位非空字符串，能力宣称也被判充分。
3. `src/ai/chat-completion-provider.ts` 的 JD 契约用通用字符串数组，示例短判断固定为“先完成一个有真实材料支撑的小行动”。
4. `src/domain/provenance.ts` 与 orchestrator grounding 只证明文本来自输入，不区分“已发生事实”和“自我能力宣称”。
5. `src/domain/action-card.ts` 只拦少量空泛词；“查看/回顾/补一句/保存”有具体动词便能通过。
6. `src/app/routes/[routeKey]/action/page.tsx` 用抽象 shortAssessment 作 H1，再展示行动、证据和四块 JD 结果，形成重复报告感。
7. `src/app/routes/[routeKey]/record/page.tsx` 会预填修改前片段和 JD，但没有结构化候选句可预填修改后片段。

### 4.2 方案比较

| 方案 | 优点 | 风险 | 结论 |
|---|---|---|---|
| A. 只改 UI 文案与卡片标题 | 快、影响小 | 根因仍会生成不可执行/不实候选；质量门继续放行 | 不采用 |
| B. 只加强 Prompt | 能改善真实模型平均输出 | provider 漂移时仍会回归，mock/质量门/UI 不知道新契约 | 不单独采用 |
| C. 输入证据分层 + 结构化 JD 契约 + 确定性质量门 + 去重 UI + 记录闭环 | 能从源头区分可改写与需补证；可自动化回归 | 修改面较大，需要全量回归 | **采用** |

## 5. 文件责任边界

| 文件 | 单一责任 |
|---|---|
| `src/domain/jd-action-clarity.ts`（新建） | 分类 JD 材料证据强度、生成/校验清晰行动所需的纯函数 |
| `src/domain/types.ts`、`src/schemas/route-output.ts` | 扩展 JD 结果字段与完成标准解析边界 |
| `src/ai/chat-completion-provider.ts` | 把新字段、证据规则和正反例写进 provider 合同 |
| `src/ai/mock-provider.ts` | 提供四路线确定性合格输出，含完成标准与 JD 新字段 |
| `src/ai/orchestrator.ts` | 在 schema 后统一归一化 claim-only/no-support，并接入语义质量门 |
| `src/domain/action-card.ts` | 所有路线的输出级清晰度底线；不做输入相关事实判断 |
| `src/app/routes/[routeKey]/input/page.tsx` | JD 原句/证据输入引导和可选疑问字段 |
| `src/app/routes/[routeKey]/action/page.tsx` | 行动优先、标签清楚、JD 依据去重呈现 |
| `src/app/routes/[routeKey]/record/page.tsx` | 预填修改前/候选修改后/对应要求，真实性确认后保存 |
| `tests/unit/*`、`tests/integration/*`、`tests/e2e/*` | 负例质量门、合同、UI、记录和四路线回归 |

---

### Task 1: RED — 固定用户截图同型的不可执行输出

**Files:**
- Modify: `tests/unit/action-output.test.ts`
- Modify: `tests/unit/orchestrator.test.ts`
- Modify: `tests/unit/chat-completion-provider.test.ts`
- Modify: `tests/unit/action-page.test.tsx`

**Interfaces:**
- Consumes: 现有 `validateRouteOutput`、`generateRouteOutput`、provider fetch 捕获、真实 ActionPage。
- Produces: 能证明旧实现错误放行的行为级失败测试。

- [ ] **Step 1: 在 `action-output.test.ts` 写普通学生清晰度负例**

构造与截图同型的 `jd_to_revision`：标题“对照数据分析要求补一句真实动作”，步骤“查看 JD / 回忆是否做过 / 若做过补一句 / 保存版本”，无具体修改原句、无候选句、无完成标准。断言 `validateRouteOutput(...).passed === false` 且 issue 指向“缺少明确编辑对象或完成标准”。

- [ ] **Step 2: 在 `orchestrator.test.ts` 写能力宣称不是直接事实的负例**

输入材料使用：`可独立完成产品数据整理、分析与复盘，通过数据挖掘产品问题。`；provider 返回截图同型合法 JSON。期望结果不再让用户“补一句数据分析动作”，而是：`candidateRevision === null`、行动明确核对一个原始记录、完成标准明确“找到证据并记录/找不到则标记证据不足且不改简历”。

- [ ] **Step 3: 在 `chat-completion-provider.test.ts` 固定新合同行为**

通过捕获真实 fetch 请求，断言 provider 合同要求 `revisionTarget`、nullable `candidateRevision`、`evidenceCheck`、`completionStandard`，并明确“能力宣称不能当作已发生动作”。断言行为由最终结构化请求体现，不只 grep 源码。

- [ ] **Step 4: 在 `action-page.test.tsx` 写去重与标签失败测试**

渲染 JD 输出，期望只出现一次核心动作；存在“预计用时”“完成标准”“完成后记录”“这次对照的岗位要求”“当前材料证据”；不再同时显示证据块与“投递前最小修改”重复卡片。

- [ ] **Step 5: 运行 RED 并保存失败证据**

Run: `npm.cmd test -- tests/unit/action-output.test.ts tests/unit/orchestrator.test.ts tests/unit/chat-completion-provider.test.ts tests/unit/action-page.test.tsx`

Expected: 新测试因旧实现放行抽象动作、缺新字段、UI 重复而失败；既有测试保持运行，无语法错误。

### Task 2: GREEN — 建立 JD 材料证据强度与清晰度纯函数

**Files:**
- Create: `src/domain/jd-action-clarity.ts`
- Create: `tests/unit/jd-action-clarity.test.ts`

**Interfaces:**
- Produces: `classifyJdMaterialEvidence(text): "direct" | "claim_only" | "none"`、`hasConcreteJdAction(output): boolean`、安全裁剪锚点函数。
- Consumes: 纯字符串与 `RouteOutput`，无 React、provider 或存储依赖。

- [ ] **Step 1: 写表驱动 RED 测试**

手工字面量覆盖：具体事实“独立使用 Codex 完成 MVP，从需求梳理到测试上线”为 `direct`；能力宣称“可独立完成数据整理、分析与复盘”为 `claim_only`；空串为 `none`；“协助排版并发布 5 篇推文”仍为 `direct`。

- [ ] **Step 2: 运行单文件 RED**

Run: `npm.cmd test -- tests/unit/jd-action-clarity.test.ts`

Expected: FAIL，因为模块或导出尚不存在。

- [ ] **Step 3: 最小实现并运行 GREEN**

实现只识别本任务需要的能力宣称前缀（`可/能够/具备/熟悉/掌握/擅长/有能力`）与已发生动作/交付物标记；不建设通用 NLP 系统。

Run: `npm.cmd test -- tests/unit/jd-action-clarity.test.ts`

Expected: PASS。

### Task 3: GREEN — 扩展输出合同、Prompt 与 mock

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/schemas/route-output.ts`
- Modify: `src/domain/route-contracts.ts`
- Modify: `src/ai/chat-completion-provider.ts`
- Modify: `src/ai/mock-provider.ts`
- Modify: `tests/unit/route-output.test.ts`
- Modify: `tests/unit/route-contracts.test.ts`
- Modify: `tests/unit/mock-provider.test.ts`

**Interfaces:**
- Produces JD routeResult fields: `revisionTarget: string`（用户材料原句）、`candidateRevision: string | null`、`evidenceCheck: string`。
- Produces every non-failure `todayAction.completionStandard: string` at runtime; TypeScript remains compatible only where migration requires fixture updates.

- [ ] **Step 1: 写 schema/contract RED**

断言 JD 正常结果接受有原句/候选/核验的新结构；能力宣称结果只接受 `candidateRevision: null`；所有非失败输出缺 `completionStandard` 时被质量验证拒绝。

- [ ] **Step 2: 运行 RED**

Run: `npm.cmd test -- tests/unit/route-output.test.ts tests/unit/route-contracts.test.ts tests/unit/mock-provider.test.ts`

Expected: FAIL，缺新字段与完成标准。

- [ ] **Step 3: 修改合同和 provider 示例**

JD 直证据示例必须给出：原句 `整理社团推文并完成排版`、候选句仍只含排版事实、核验提醒；claim-only 规则明确不给候选句。删除通用示例短判断“先完成一个有真实材料支撑的小行动”，替换为路线可复述的判断。

- [ ] **Step 4: 更新 mock 并运行 GREEN**

Run: `npm.cmd test -- tests/unit/route-output.test.ts tests/unit/route-contracts.test.ts tests/unit/mock-provider.test.ts tests/unit/chat-completion-provider.test.ts`

Expected: PASS。

### Task 4: GREEN — 编排归一化与语义质量门

**Files:**
- Modify: `src/ai/orchestrator.ts`
- Modify: `src/domain/action-card.ts`
- Modify: `tests/unit/orchestrator.test.ts`
- Modify: `tests/unit/action-output.test.ts`
- Modify: `tests/unit/provenance.test.ts`

**Interfaces:**
- Consumes: `classifyJdMaterialEvidence` 与扩展 JD routeResult。
- Produces: direct → 只允许基于原句的单处候选改写；claim_only/none → 候选为空、改为补证/记录缺口行动；所有路线补齐可观察完成标准。

- [ ] **Step 1: 接入 claim-only 归一化**

当 `supportedByMaterial` 只是能力宣称时，不将其当直接支撑；行动固定为核对一个项目原始记录（文档、截图、版本记录或交付物），写明找不到证据时“不改简历并记录证据不足”。不得硬编码“求职地图 MVP”之外的虚构对象；锚点从原材料安全裁剪。

- [ ] **Step 2: 强化输出级清晰度门**

非友好失败输出必须有完成标准；JD 修改行动必须同时包含原句锚点、具体动作、保存前后版本；JD 补证行动必须包含核验对象、证据存在/不存在两个完成分支和记录动作。只出现“对照要求/补一句/真实动作/真实材料支撑”而没有锚点时拒绝。

- [ ] **Step 3: 校验 provenance**

`revisionTarget` 必须引用 `userMaterial`；候选句作为 inference 必须由直接事实 claim 派生；`candidateRevision === null` 不需要可见 claim。确保能力宣称本身不会升级为候选句事实。

- [ ] **Step 4: 运行聚焦 GREEN**

Run: `npm.cmd test -- tests/unit/orchestrator.test.ts tests/unit/action-output.test.ts tests/unit/provenance.test.ts`

Expected: PASS；截图同型负例被拦/归一化，旧编造、角色升级、工具升级测试不回归。

### Task 5: RED/GREEN — 输入引导、行动呈现与记录预填

**Files:**
- Modify: `src/app/routes/[routeKey]/input/page.tsx`
- Modify: `src/app/routes/[routeKey]/action/page.tsx`
- Modify: `src/app/routes/[routeKey]/record/page.tsx`
- Modify: `tests/unit/input-page.test.tsx`
- Modify: `tests/unit/action-page.test.tsx`
- Modify: `tests/integration/mvp-state-flow.test.tsx`

**Interfaces:**
- Input produces exact JD/material/currentQuestion fields.
- Action consumes new JD routeResult and labels action metadata.
- Record consumes `revisionTarget`/`candidateRevision` for before/after prefill but still requires user confirmation.

- [ ] **Step 1: 写输入与记录 RED**

断言 JD 输入问“贴上准备修改的原句或一小段材料”，展示可选问题；对能力总结提示补原始记录。断言 direct 候选预填 afterSnippet，claim-only 不预填 afterSnippet 且说明先核验证据。

- [ ] **Step 2: 运行 RED**

Run: `npm.cmd test -- tests/unit/input-page.test.tsx tests/unit/action-page.test.tsx tests/integration/mvp-state-flow.test.tsx`

Expected: FAIL，旧标签、重复卡片和空 afterSnippet 不满足。

- [ ] **Step 3: 实现最小 UI**

Action 页使用稳定 H1“今天只做这一件事”，generated shortAssessment 降为正文；行动元信息加文本标签；JD 上下文只显示“这次对照的岗位要求 / 当前材料证据 / 仍需核验”，不重复“投递前最小修改”和 EvidenceBlock。按钮与 aria 文本保持清楚。

- [ ] **Step 4: 实现记录预填并运行 GREEN**

Run: `npm.cmd test -- tests/unit/input-page.test.tsx tests/unit/action-page.test.tsx tests/integration/mvp-state-flow.test.tsx`

Expected: PASS。

### Task 6: 四路线、缺信息、失败、复盘与可访问性回归

**Files:**
- Modify: `tests/unit/quality-gate.test.ts`
- Modify: `tests/unit/record-rules.test.ts`
- Modify: `tests/unit/review-page.test.tsx`（仅在新必填字段影响 fixture 时）
- Modify: `tests/e2e/private-beta-readiness.spec.ts`

**Interfaces:**
- Produces: 四路线正常/缺信息/友好失败/保存失败/轻复盘/移动端/axe 回归证据。

- [ ] **Step 1: 增加普通学生负例矩阵**

至少覆盖：抽象行动、无编辑对象、无候选且声称可以改、无完成标准、证据不足却要求润色、同一内容重复四卡；以及 direct evidence 合格候选。

- [ ] **Step 2: 运行聚焦单元与集成测试**

Run: `npm.cmd test -- tests/unit/quality-gate.test.ts tests/unit/record-rules.test.ts tests/unit/review-page.test.tsx tests/integration/mvp-state-flow.test.tsx`

Expected: PASS。

- [ ] **Step 3: 更新 production E2E 行为断言**

在 desktop 和 Pixel 7 上验证 JD direct 与 claim-only 两种路径：首屏只见一个主行动、完成标准可见、候选句只在有直接事实时出现、记录页前后片段行为正确、axe 无 serious/critical 问题；保留四路线、缺信息、保存失败和轻复盘现有场景。

### Task 7: 全量技术验收与新浏览器证据

**Files:**
- Evidence only: 新目录 `D:\21天\qa\private-beta-production\20260803-output-clarity-remediation-v1--<head>--<implementation-hash>`（脚本自动补后缀，绝不复用旧目录）。

- [ ] **Step 1: 聚焦测试**

Run: `npm.cmd test -- tests/unit/jd-action-clarity.test.ts tests/unit/orchestrator.test.ts tests/unit/action-output.test.ts tests/unit/chat-completion-provider.test.ts tests/unit/input-page.test.tsx tests/unit/action-page.test.tsx tests/integration/mvp-state-flow.test.tsx`

- [ ] **Step 2: 全量测试**

Run: `npm.cmd test`

- [ ] **Step 3: 静态与构建检查**

Run: `npm.cmd run lint`

Run: `npx.cmd tsc --noEmit --incremental false`

Run: `npm.cmd run build`

Run: `npm.cmd audit --audit-level=high`

Run: `git diff --check`

- [ ] **Step 4: production build + mock E2E**

Run: `$env:E2E_RUN_ID='20260803-output-clarity-remediation-v1'; npm.cmd run test:e2e:production`

Expected: build exit 0；desktop + Pixel 7 全场景通过；manifest 的 implementationStable 为 true；providerMode 明确真实 key 关闭、deterministic mock 开启；截图写入新 run-id 目录。

- [ ] **Step 5: 人工查看新截图**

逐张打开 JD direct、JD claim-only、记录页、移动端、缺信息和保存失败截图，确认没有截断、重复、内部术语或不可见完成标准。

### Task 8: 代码复核、矩阵回归与价值门裁决

**Files:**
- Review: 本计划、`git diff`、新 QA manifest/截图/日志。

- [ ] **Step 1: 需求矩阵逐行复核**

每一行标记“通过/不足/失败/无法验证”，技术测试通过不能替代真实用户行为。

- [ ] **Step 2: 代码复核**

检查：是否出现仅为截图特例的硬编码、是否把能力宣称当事实、候选句是否绕过 provenance、保存是否仍需用户确认、四路线/缺信息/失败/复盘是否回归、移动端和可访问性是否通过。

- [ ] **Step 3: 按 `mvp21-student-value-gate` 固定中文契约逐路线裁决**

先裁决方向、经历、JD、投递记录四路线的本轮可观察状态，再聚合“最新状态 MVP / 整体私测”。明确区分：技术可启动受控私测、整体用户价值 GO、发布 GO。

- [ ] **Step 4: 保留真实私测外部阻断**

没有 8–12 名普通应届生至少 7 天、2–3 天回访和两次真实推进证据时，整体私测用户价值不得判 GO；只能说明是否建议启动受控私测，以及需要收集哪些证据。

## 6. 最终交付证据清单

- 16 文档：文件名、字节数、SHA-256 与完整读取声明。
- 治理冲突：本计划 §2 的公开裁决。
- 计划：`D:\21天\docs\superpowers\plans\2026-08-03-mvp-output-clarity-document-compliance-remediation.md`。
- RED/GREEN：聚焦测试命令与本轮输出。
- 全量：test、lint、tsc、build、audit、diff-check 的本轮输出。
- 浏览器：新 production E2E run-id 的 manifest、HTML report、desktop/mobile 截图和失败 trace（若有）。
- 价值门：逐路线固定契约 + 整体私测聚合；真实 7 天证据不足单列未验证项。
