# 21天 MVP 文档合规统一修复计划

> 日期：2026-07-31
> 范围：`D:\21天` 当前未提交工作树
> 执行方式：后续续轮使用 `superpowers:test-driven-development` 与 `superpowers:executing-plans`，每一项先得到可解释的 RED，再做最小实现并运行聚焦测试。
> 硬约束：不重置、不清理、不覆盖用户既有改动；不提交、不推送；不调用需要密钥或产生费用的真实 provider；不以模拟数据冒充真实私测或生产多实例证据。

## 1. 裁决基线与本检查点

本计划以已经逐份完整读取的 `D:\21天\docs\product` 下 16 份原文为产品裁决基线。清单完整性为 16/16、总计 250,371 bytes、无缺失、无额外产品原文。

治理冲突需要公开保留：早期 PM/UX 文档包含“只做产品定义/不进入代码”的阶段性限制；后续《MVP 研发边界决策》《MVP 研发进度记录》《21天MVP发展总方向_V1.0》以及本次用户指令已经明确授权实现和审核修复。后续执行以较新的研发边界和本次明确授权为准；这属于治理口径演进，不作为产品缺陷隐藏。

当前工作树是用户资产：35 个已跟踪文件有差异，另有新增源码、测试、计划、Playwright 配置和 QA 证据目录。任何续轮开始前都先运行 `git status --short`，再对本批次列出的每个目标文件运行 `git diff -- 文件路径`，只在现有差异上做增量修改。

必须保留的当前 RED 证据：

- 最近一次全量 Vitest：25 files / 729 tests，其中 1 fail。
- 失败用例：`tests/unit/review-page.test.tsx` 的“does not navigate away or claim success when saving the next action fails”。
- 失败原因：`markReviewSaved` 写入 localStorage 抛出 quota error 后，页面仍沿链接导航；同时出现未处理异常。
- 在该全量运行后，`src/app/review/page.tsx` 已出现半成品保存拦截改动，单文件聚焦测试曾转绿；按本轮限制没有重跑全量，所以全量状态仍记录为 RED，不能写成 729/729 PASS。

历史的 24 files / 701 tests、ESLint、TypeScript、生产 build 通过只可作为旧基线，最终成功结论必须引用修复完成后新跑的证据。

## 2. A–P 需求矩阵与处置分类

| 编号 | 分类 | 当前半成品判断 | 后续退出条件 |
|---|---|---|---|
| A 内部 ID/enum 泄露 | 必须修并复验 | 已新增 `record-presentation.ts`，track/review 已改为白名单投影；仍需防回归与生产截图复验 | UUID、关联 ID、raw enum、未知 payload 字段均不可见；只显示中文人话字段 |
| B 7 天回看 | 必须修并复验 | `local-store.ts` 已有四路线计划、去重和投递计数半成品 | 四路线及混合数据均展示真实行动、记录、线索、信息缺口和唯一下一步；投递已有两条不再要求补第 2 条 |
| C 保存失败分流 | 必须修 | input/record/review 有部分错误状态；track 的保存、合并、删除、清空、周回看仍不完整 | 保存失败不误报 AI 失败；保留页面数据；提供可重试操作；成功前不导航 |
| D 即时复盘等待边界 | 必须修并复验 | review 已有 8 秒、30 秒、abort、`aria-busy` 半成品 | 8 秒提示、30 秒取消、卸载 abort、pending 防重复提交均有聚焦测试 |
| E 投递移动表单 | 必须修 | 岗位/公司已用 input，但日期和反馈仍未形成 date/select 语义 | 岗位/公司为 input，日期为 date，反馈为 select，只有 JD/材料等长文本使用 textarea |
| F 记录页缺项反馈 | 必须修 | 已有必填/选填、摘要和 aria 属性；缺少可靠首个错误焦点策略 | 提交不完整表单时摘要明确、首个缺项获焦、字段 `aria-invalid`/`aria-describedby` 正确 |
| G 方向 constraints 可选 | 必须修并复验 | route contract 与 UI 已改成 optional 半成品 | 无 constraints 的完整方向输入可生成；“暂时没有”不被当作无效必填 |
| H 同源/费用入口 | 必须修 | 已有 JSON、Origin、Sec-Fetch-Site 守卫；仍缺 Host 一致性和无 Cookie 新 session 绕过验证 | 非 JSON 415；不可信 Origin/Host 或 cross-site 403；provider 0 call；无 Cookie 不能无限换 session 绕过预算 |
| I PII 输入与输出 | 必须修 | 服务端已有输入预检和输出扫描；中英标签、空格/连字符等变体覆盖不足 | 手机、身份证、邮箱、病情/健康、婚姻等中英及常见变体在 provider 前或用户可见输出前被拦截 |
| J 方向可搜索真实性 | 必须修，3B 已完成 | 已建立内部版本化岗位族/别名/关键词事实源并接入统一方向质量门 | 第 5 批复验虚构岗位确定性失败；合法方向保持 2–3 个且名称/关键词同族 |
| K 输出长度边界 | 必须修，3B 已完成 | 已集中定义短字段、段落、长文本、数组数量和 route-result 总字符门 | 第 5 批复验单字段/累计超限均在 localStorage 前失败 |
| L 未知异常 HTTP 状态 | 必须修并复验 | API catch 已有友好 5xx 半成品 | HTTP 5xx、稳定友好 body、不泄露堆栈/内部错误、provider 异常测试通过 |
| M 生产 E2E 证据 | 必须修，4B 重跑已完成 | 首轮失败现场保留；修复环境契约后的全新 production run 为 20/20 pass | 第 5 批复核 manifest、截图和事件日志后关闭；真实 provider/设备未验证仍单列 |
| N 真实 7 天私测 | 仓库外阻断 | 8–12 名真实应届生、至少 7 天数据不存在 | 只能由真实脱敏私测补齐；未补齐前整体私测不得 GO，不得伪造 |
| O 多实例成本安全 | 仓库内记录要求 + 仓库外阻断 | 当前预算/限流/熔断是进程内状态 | 仓库写清部署门；上线前必须提供共享原子 KV/Redis、供应商硬额度、告警和多实例压测证据 |
| P 其他体验/真实设备 | 改进建议 + 部分仓库外未验证 | 复制 live 反馈和 `zh-CN` 时间已有半成品；首页实现语气、标点仍需检查 | 仓库内修正文案/标点；暗色主题、真实屏幕阅读器、400%、iOS 标为未验证，不用模拟证据替代 |

## 3. 五个可独立续轮的执行批次

每个批次都能在一个后续短续轮中独立完成并停在明确检查点。批次内禁止无关重构；若目标文件在续轮开始后又发生变化，先重新查看该文件差异，再决定最小补丁。

### 批次 1：用户可见内容、7 天回看与移动表单

**必须修：A、B、E、F、G。改进建议：P 的首页语气和中文标点。**

**执行状态：已完成（2026-07-31）。**

- [x] A：track/review 统一使用用户可见字段白名单；展示层遍历白名单而非 payload，未知字段、关联 ID、UUID 和 raw enum 继续由回归测试拦截。
- [x] B：四条单路线测试继续通过；新增混合路线测试，明确五块结构齐全并只采用最新真实行动所属路线的一个下一步。
- [x] E：两条投递的岗位/公司使用 `input[type=text]`，日期使用 `input[type=date]`，反馈使用 `select`，长文本保留 textarea。
- [x] F：记录页保留具体缺项摘要，为必填控件设置 `aria-invalid`/`aria-describedby`；普通缺项提交时聚焦首个错误，事实支撑或两条投递安全门仍保持禁用。
- [x] G：constraints 可选测试与 route contract 测试继续通过。
- [x] P：复制成功/失败 live 反馈和 `zh-CN` 时间测试继续通过；首页改为“正在找回上次进度”；多项回看统一清理“。；”碰撞。

执行记录：

- GREEN 基线：原计划 8 个聚焦文件，`8 passed / 129 tests passed`。
- RED：新增行为测试后，`5` 个测试文件中 `3` 个失败，分别锁定投递控件类型、记录缺项描述/焦点、首页加载语气；标点随后由专门格式化测试锁定。
- GREEN：修复后扩展聚焦命令为 11 个文件，结果 `11 passed / 169 tests passed`。
- GREEN：`npm.cmd run lint`，退出码 0。
- GREEN：`npx.cmd tsc --noEmit --pretty false --incremental false`，退出码 0。
- 本批未运行全量 Vitest、生产 build、npm audit 或 Playwright；这些仍由批次 5 和批次 4 负责。

目标文件：

- `src/domain/record-presentation.ts`
- `src/domain/record-rules.ts`
- `src/domain/route-contracts.ts`
- `src/domain/routes.ts`
- `src/lib/local-store.ts`
- `src/app/page.tsx`
- `src/app/routes/[routeKey]/input/page.tsx`
- `src/app/routes/[routeKey]/record/page.tsx`
- `src/app/review/page.tsx`
- `src/app/track/page.tsx`
- `src/app/globals.css`
- `tests/unit/track-page.test.tsx`
- `tests/unit/review-page.test.tsx`
- `tests/unit/local-store.test.ts`
- `tests/unit/input-page.test.tsx`
- `tests/unit/action-page.test.tsx`
- `tests/unit/home-page.test.tsx`
- `tests/unit/record-presentation.test.ts`（新增）
- `tests/unit/record-rules.test.ts`
- `tests/unit/route-contracts.test.ts`
- `tests/unit/routes.test.ts`
- `tests/integration/mvp-state-flow.test.tsx`

TDD 顺序：

1. 在 track/review 测试中加入固定 UUID、`sourceExperienceId`、`resume_snippet`、`experience_fact`、`application` 和未知字段负例；先确认任一仍可见时测试 RED，再仅通过共享白名单投影修复，禁止恢复 `Object.entries(payload)` 通用渲染。
2. 在 `local-store.test.ts` 以方向、经历、JD、投递四条单路线和至少一组混合记录分别断言五块内容：真实行动、记录、线索、信息缺口、唯一下一步；加入同 action 多版本去重与两条完整投递不再提示补第 2 条。
3. 在 `input-page.test.tsx` 明确断言投递字段控件类型：岗位/公司 `input[type=text]`、日期 `input[type=date]`、反馈 `select`、JD/材料摘要 textarea；再最小改 UI 与 CSS。
4. 在记录页测试中先模拟点击缺项保存，断言缺项摘要、`aria-invalid`、`aria-describedby` 和首个缺项焦点；实现时保留页面已填数据，不依赖单纯禁用按钮隐藏问题。
5. 复验方向 constraints 缺省仍可生成；把首页“正在读取本地进度”改为面向用户的“正在找回上次进度”，并清理 7 天回看中的“。；”组合。

聚焦验收：

```powershell
npm.cmd test -- tests/unit/track-page.test.tsx tests/unit/review-page.test.tsx tests/unit/local-store.test.ts tests/unit/input-page.test.tsx tests/unit/record-rules.test.ts tests/unit/route-contracts.test.ts tests/unit/routes.test.ts tests/integration/mvp-state-flow.test.tsx
```

完成条件：上述测试全绿；页面源码不存在用户可见的 raw record enum/UUID 通用渲染；方向可选约束和投递紧凑控件与文档一致。

### 批次 2：保存可靠性与即时复盘等待边界

**必须修：C、D，并首先关闭当前 review RED。**

**执行状态：已完成（2026-07-31）。**

- [x] 历史 review RED 已关闭：`markReviewSaved` 失败会阻止链接导航，不显示保存成功，并保留当前回看和下一步供重试。
- [x] input 将 AI 请求失败、草稿保存失败和已生成行动的本地保存失败分开；只有 `saveCurrentAction` 成功后才导航。
- [x] 首页继续较小行动或回看行动时，本地保存失败会阻止导航并显示独立错误，同一链接可再次重试。
- [x] record 的多步 save/merge 使用 `runLocalStoreTransaction`；任一步失败恢复事务前本地状态，保留表单并停留原页，成功前不导航。
- [x] track 的编辑、删除、清空和 7 天回看写入均捕获持久化异常；编辑值、记录、确认面板和重试按钮继续保留，成功后才刷新 UI。
- [x] 即时复盘测试覆盖 0–7999ms 普通等待、8 秒延迟提示、30 秒 abort 友好失败、卸载 abort、`aria-busy` 和 pending 禁用。

执行记录：

- GREEN 基线：6 个第 2 批页面/集成测试文件，`6 passed / 88 tests passed`。
- RED：新增首页、record 合并事务和 track 四类写失败测试后，目标失败被复现；同时发现 RecordPage 新事务依赖未加入测试 mock，修正测试隔离后再验证真实行为。
- GREEN：最终聚焦命令纳入 `local-store.test.ts`，结果 `7 passed / 111 tests passed`。
- GREEN：`npm.cmd run lint`，退出码 0。
- GREEN：`npx.cmd tsc --noEmit --pretty false --incremental false`，退出码 0。
- 本批未运行全量 Vitest、生产 build、npm audit 或 Playwright；这些仍由批次 5 和批次 4 负责。

目标文件：

- `src/app/page.tsx`
- `src/app/routes/[routeKey]/input/page.tsx`
- `src/app/routes/[routeKey]/record/page.tsx`
- `src/app/review/page.tsx`
- `src/app/track/page.tsx`
- `src/lib/local-store.ts`
- `tests/unit/home-page.test.tsx`
- `tests/unit/input-page.test.tsx`
- `tests/unit/review-page.test.tsx`
- `tests/unit/track-page.test.tsx`
- `tests/integration/mvp-state-flow.test.tsx`

TDD 顺序：

1. 保留并复跑当前 review 保存失败用例，验证 `markReviewSaved` 抛错时不导航、不宣称成功、错误进入 live region，且用户选择的下一步仍在页面。
2. 分别为 input 保存当前行动、record 保存/合并草稿、review 保存即时复盘、track 更新/删除/清空/生成周回看制造 localStorage 异常；每条失败路径先得到 RED。
3. 用操作级错误状态区分“AI 生成失败”和“本地保存失败”；仅在保存成功后导航。成功路径清除对应错误，失败路径保留表单/草稿，并保留同一按钮作为重试入口。
4. 对“记录已保存但合并草稿失败”的部分成功给出诚实状态，禁止笼统声称记录未保存；不要用清空或回滚覆盖已成功的数据。
5. 用 fake timers 验证即时复盘：8 秒出现长等待提示，30 秒 AbortController 取消并展示友好错误，卸载 abort，pending 状态 `aria-busy=true` 且防重复提交。

聚焦验收：

```powershell
npm.cmd test -- tests/unit/home-page.test.tsx tests/unit/input-page.test.tsx tests/unit/review-page.test.tsx tests/unit/track-page.test.tsx tests/integration/mvp-state-flow.test.tsx
```

完成条件：历史失败用例转绿；所有关键本地写操作都有独立失败状态和可重试入口；保存失败前不导航；8 秒/30 秒/abort/aria-busy 均由行为测试证明。

### 批次 3：API 成本防线、PII、岗位事实源与输出上限

**必须修：H、I、J、K、L。仓库内记录要求：O。**

#### 3A：H、I、L 执行状态

**执行状态：已完成（2026-07-31）；批次 3 的 O 尚未执行。**

- [x] H：只接受 `application/json`；非 JSON 为 415。拒绝 cross-site、非法 Origin、Host/Origin 不一致、协议不一致，以及无 Origin 但 Host 与请求 URL 不一致的请求，拒绝路径 provider 0 call。
- [x] H：无 Origin 服务端客户端只有两种允许形式：不发送 Host 覆盖，或 Host 与请求 URL 完全一致。开发环境只允许 `localhost`、`127.0.0.0/8`、`::1` 之间同协议的显式 Origin/Host 别名。
- [x] I：provider 前输入扫描覆盖中英文手机号、身份证、邮箱、明确病情/诊断、婚育状态及常见空格/连字符变体；422 正文明确要求删除敏感信息后重试。
- [x] I：`scanRouteSafety` 扫描整个嵌套输出；新增 provider 在 `todayAction.actionSteps`、`recordAfterDone` 或记录指导中建议把敏感字段写入简历、记录、投递/对外材料的负例。
- [x] I：纯粹的“不披露敏感信息”安全提醒不会被误伤；带转折的后续肯定披露建议仍保留给安全门判断。
- [x] L：未知服务端异常返回 500 和稳定 `friendly_failure` 正文，不暴露异常消息、stack、provider 工厂或内部错误信息。

执行记录：

- GREEN 基线：3A 原有 5 个聚焦文件，`5 passed / 488 tests passed`。
- RED：新增 Host+Origin 联合伪造、协议错配、英文病情/婚育/电话、敏感字段写入材料及嵌套 action 测试后，`13` 个目标断言失败；协议错配另单独复现为 `1 failed / 37 passed`。
- GREEN：最终 3A 聚焦测试 `5 passed / 505 tests passed`。
- GREEN：3A 目标文件 ESLint 命令退出码 0。
- GREEN：`npx.cmd tsc --noEmit --pretty false --incremental false`，退出码 0。
- 全仓 `npm.cmd run lint` 本轮退出码 1：执行期间外部流程新生成 `qa/private-beta-audit-final/20260731-191657-a8283fa-a6c594f6/report/trace/assets`，全仓 ESLint 扫描了其中的 Playwright 打包产物。本轮不删除、不改写该证据目录，也不在 3A 越界修改全仓忽略规则；第 5 批需在稳定证据状态下重新运行并裁决。
- 本批未处理 taxonomy、输出长度、共享 Redis、生产 E2E、生产 build 或 npm audit。

#### 3B：J、K 执行状态

**执行状态：已完成（2026-07-31）；仅完成本轮授权的 J、K，O 保持后续仓库记录要求。**

- [x] J：新增 `src/domain/job-taxonomy.ts`，内部事实源版本为 `2026-07-31.v1`；包含常见初级岗位族、受控方向别名、搜索关键词根和 mock 的确定性候选选择，不把版本或内部族标识写入用户可见输出。
- [x] J：方向质量门要求 2–3 个候选；每个方向名必须是受控别名，全部搜索关键词必须映射到同一岗位族。“火星殖民客户成功官”即使借用真实岗位词也会确定性失败。
- [x] K：`ROUTE_OUTPUT_LIMITS` 集中定义 240 字短字段、2,000 字段落、6,000 字长文本、12 项列表和 16,000 字 route-result 总可见字符门；事实和材料不截断，超限候选进入友好失败。
- [x] K：typed schema 与 orchestrator 预解析 envelope 共用总字符门；浏览器收到超限 route result 时 schema 拒绝，既不写 current action/localStorage，也不导航。

执行记录：

- RED：`npm.cmd test -- tests/unit/job-taxonomy.test.ts tests/unit/route-output.test.ts tests/unit/orchestrator.test.ts`，退出码 1；`2 failed / 1 passed` test files，新增短字段边界和累计字符预算 2 个断言失败，taxonomy 模块尚不存在导致 suite 无法加载；既有 orchestrator 239 tests 保持通过。
- GREEN：`npm.cmd test -- tests/unit/job-taxonomy.test.ts tests/unit/route-output.test.ts tests/unit/mock-provider.test.ts tests/unit/orchestrator.test.ts tests/unit/input-page.test.tsx`，退出码 0，`5 passed / 258 tests passed`。
- GREEN：`npx.cmd eslint src/domain/job-taxonomy.ts src/schemas/route-output.ts src/ai/orchestrator.ts src/ai/mock-provider.ts tests/unit/job-taxonomy.test.ts tests/unit/route-output.test.ts tests/unit/orchestrator.test.ts tests/unit/input-page.test.tsx`，退出码 0。
- GREEN：`npx.cmd tsc --noEmit --pretty false --incremental false`，退出码 0。
- GREEN：`git diff --check --` 对本批 8 个目标文件退出码 0；仅出现工作区既有 LF/CRLF 提示，无空白错误。
- 本轮按授权未运行全量 Vitest、全仓 lint、build、audit、生产 E2E 或真实 provider；这些仍归第 5 批统一复验。未处理共享 Redis/KV 与 O 的部署证据门。

目标文件：

- `src/app/api/ai/route.ts`
- `src/ai/request-guard.ts`
- `src/ai/orchestrator.ts`
- `src/ai/mock-provider.ts`
- `src/ai/chat-completion-provider.ts`
- `src/domain/safety.ts`
- `src/domain/job-taxonomy.ts`（新增版本化事实源）
- `src/schemas/route-request.ts`
- `src/schemas/route-output.ts`
- `docs/operations/private-beta-deployment-gates.md`（新增部署证据门）
- `tests/unit/api-ai-route.test.ts`
- `tests/unit/request-guard.test.ts`
- `tests/unit/safety.test.ts`
- `tests/unit/orchestrator.test.ts`
- `tests/unit/mock-provider.test.ts`
- `tests/unit/chat-completion-provider.test.ts`
- `tests/unit/route-request.test.ts`
- `tests/unit/route-output.test.ts`（新增长度边界测试）

TDD 顺序：

1. API 测试先断言：非 `application/json` 返回 415；不可信 Origin、Origin/Host 不一致、`Sec-Fetch-Site: cross-site` 返回 403；这些拒绝路径 provider 调用数为 0。保留无 Origin 的可信服务端测试，但其 Host 必须与请求 URL 一致。
2. 加入连续无 Cookie 请求测试，证明反复丢弃 Cookie 不能获得无限新 session；实现共享“未建立可信 session”原子预算键，只有客户端带回服务器签发的合法 Cookie 后才进入其稳定 session 配额。
3. 输入 PII 测试覆盖中文和英文标签，以及空格/连字符变体：手机号、居民身份证、邮箱、病情/健康信息、婚姻状态；断言在 provider 前返回 422 且 provider 为 0 call。
4. 输出 PII 测试覆盖 action、文案片段和方向输出中的相同变体；在任何用户可见输出解析成功后、返回和持久化前统一扫描。提示用户删除敏感信息后重试，不回显完整敏感值。
5. 在 `job-taxonomy.ts` 定义显式版本号、受控岗位族、标准方向名和可搜索关键词；先写虚构“火星占卜师/量子运势运营”负例使 orchestrator RED，再让 mock 与真实 provider 输出都经过同一确定性门。合法结果仍须为 2–3 个方向，名称和关键词必须属于同一岗位族。
6. 为 route output 添加短字段、长字段、数组数量和总用户可见字符上限；用单字段超长和多字段累计超长两个 RED 用例证明在 localStorage 写入前失败。上限常量集中定义并由 schema 和 orchestrator 共用。
7. 未知服务端异常测试断言 HTTP 5xx、友好稳定 body、无堆栈和内部错误文本。
8. 新增部署门文档，明确当前 `Map`/`WeakMap` 预算、熔断和限流仅单进程有效；生产私测公开地址前必须收集共享 KV/Redis 原子计数、IP/设备组合限流、供应商硬额度、告警、熔断和多实例压测证据。此文档不把本地实现表述为生产安全。

聚焦验收：

```powershell
npm.cmd test -- tests/unit/api-ai-route.test.ts tests/unit/request-guard.test.ts tests/unit/safety.test.ts tests/unit/orchestrator.test.ts tests/unit/mock-provider.test.ts tests/unit/chat-completion-provider.test.ts tests/unit/route-request.test.ts tests/unit/route-output.test.ts
```

完成条件：所有入口拒绝测试明确 provider 0 call；PII 中英/变体输入输出均被挡；虚构岗位确定性失败；输出大小有双层边界；未知异常使用 5xx；部署门文档明确外部证据责任。

### 批次 4：不可覆盖的生产 Playwright 证据

**必须修：M。仓库外未验证项只记录，不伪造：P 的真实屏幕阅读器、400%、暗色主题、iOS。**

#### 4A：production 配置与证据设计

**执行状态：已完成（2026-07-31）；本子批未运行 build、`next start` 或任何浏览器 E2E，实际证据运行保留给 4B。**

- [x] 新增 `playwright.production.config.ts`；web server 明确使用 `npm.cmd run start -- --hostname 127.0.0.1 --port 3100`，不使用 `next dev`。`test:e2e:production` runner 先执行 `npm run build`，仅 build 成功才运行该 production 配置。
- [x] runner 要求调用方提供新 `E2E_RUN_ID`，最终目录名自动绑定 `run-id--HEAD--patchHash`；目录用独占创建，已存在即失败，不清理、不复用旧 `qa` 目录。
- [x] `manifest.json` 记录 HEAD、dirty 状态和文件清单、dirty patch SHA-256、`package-lock.json` SHA-256、Node/npm/Playwright/平台/浏览器目标、UTC 与带时区本地时间、确定性 mock provider 声明、实际命令、开始/结束时间和退出码。
- [x] 每个测试的 console warning/error、pageerror、失败请求及 HTTP 4xx/5xx 写入独立 JSONL 和 summary JSON；URL query、邮箱、手机号、Authorization/token/API key/secret 经过脱敏，不记录请求/响应正文或完整 headers。
- [x] 成功截图使用 `project--route--state.png`，循环内逐路线保存；已规划并绑定四路线 input、完整 action、缺信息、保存失败，以及经历路线 record/review/track 和投递 track。失败截图由 Playwright `only-on-failure` 保存。
- [x] trace 策略为成功不保留、失败 `retain-on-failure`；HTML report、test-results、events 和 screenshots 都位于本次独占证据根。
- [x] production 项目为 `desktop-chromium` 和 Pixel 7 的 `pixel-7`；`--list` 确认同一 10 个场景在两个项目下共 20 个用例。
- [x] `eslint.config.mjs` 的 `qa/**` global ignore 阻止 trace/HTML 打包产物进入 lint；本批新增配置、runner、helper、spec 和测试源码仍由全仓 ESLint 扫描并通过。

执行记录：

- RED 1：`npm.cmd test -- tests/unit/e2e-evidence.test.ts`，helper 不存在导致 `1 failed` test file、0 tests；失败原因与缺少独占目录/manifest/脱敏实现一致。
- RED 2：首次 production `--list` 报 `PLAYWRIGHT_EVIDENCE_DIR must be assigned`，0 tests；修复验证模式的证据根注入后再运行。
- RED 3：新增目录绑定 HEAD/patchHash 和 UTC/本地双时间契约后，`2 failed / 3 passed`；缺少两个 helper。
- RED 4：配置验证模式最初把 reporter/output 指向固定 `qa/private-beta-production/_config-validation`，`--list` 会创建该目录；根因是 validation output 与正式证据根共用。新增测试后为 `1 failed / 6 passed`，随后改为进程唯一的系统临时目录。
- GREEN：`npm.cmd test -- tests/unit/e2e-evidence.test.ts`，退出码 0，`1 passed / 7 tests passed`。
- GREEN：`E2E_CONFIG_VALIDATE_ONLY=1 npx.cmd playwright test --config=playwright.production.config.ts --list`，退出码 0，`20 tests in 1 file`；未启动 web server 或浏览器。
- GREEN：`npm.cmd run lint`，退出码 0；证明 `qa/**` 产物被忽略且本批源码仍参与 lint。
- GREEN：`npx.cmd tsc --noEmit --pretty false --incremental false`，退出码 0。
- GREEN：本批目标文件 `git diff --check --`，退出码 0；仅有工作区既有 LF/CRLF 提示。
- 本子批未运行全量 Vitest、build、生产 Playwright、真实 provider、真实屏幕阅读器、400%、暗色主题或 iOS；没有覆盖旧 QA 证据。首次 RED `--list` 留下了新建的 `_config-validation` 目录，本轮遵守资产保护要求未删除；它不是正式生产证据，修复后的验证命令不会再写入该固定目录。

#### 4B：实际生产证据运行

**执行状态：已运行但失败（2026-07-31）；完整失败现场保留，禁止作为通过证据。**

- 证据根：`qa/private-beta-production/20260731-prod-193904--a8283fa72ab3--ff60441b7bdf/`。运行前精确停止了占用 3100 的遗留 `next start`（node PID 34892），并确认端口空闲；runner 退出后再次确认端口空闲。
- `npm.cmd run build` 退出码 0；Next.js 16.2.12 production build 编译、TypeScript、静态页面生成均成功。
- production Playwright 实际运行 20 个场景，结果 `14 passed / 6 failed`，总退出码 1；Desktop Chromium 与 Pixel 7 的失败模式完全一致。
- 失败集中在三个完整闭环场景：四路线完整 action、经历 action-record-review-track、投递 action-record-review-track；两个项目各失败一次。输入/缺信息、两条投递门、等待/429、30 秒 abort、保存失败、缺信息保存等 14 个场景通过。
- manifest 已记录 HEAD、dirty/implementation/lock hash、UTC/本地时间、环境、build/test 命令和退出码；失败截图、6 份 trace、HTML report、error-context、逐测试脱敏 JSONL/summary 均保留，未覆盖旧 QA。

首个共同根因定位：

1. 首个失败 trace 证明完整方向输入的 `/api/ai` 返回 HTTP 200，但正文是 `friendly_failure`；行动页因此诚实显示“这次暂时没整理出来”，并非页面导航或选择器故障。
2. 用完全相同输入直接调用当前 `MockAiProvider("success")` + orchestrator，得到 `route_result` 且 failure reporter 无事件；因此 taxonomy、该输入的 grounding 和 action contract 不是首个共同根因。
3. production 编译产物仍保留运行时 `MVP_PRODUCTION_E2E_ALLOW_MOCK` 判断，配置与 runner 源码也声明传入该变量；但实际生产 API 行为与“无真实 key 且该开关未在 next start 进程中有效生效”一致，导致 provider factory 走 `provider_failure`，所有需要正常 action 的闭环共同失败。
4. 本轮未绕过执行策略做第二次后台诊断启动，未修改实现、未重跑、未删除失败证据。下一续轮必须先为 production server 的 mock 环境传播/可观察性写 RED，并证明启动进程实际读取到显式 E2E 开关，再创建全新 run-id 重跑；不得复用本目录。

#### 4B 修复与全新证据重跑

**执行状态：已完成（2026-07-31）；首轮失败目录保持不变，全绿证据写入全新目录。**

- 调试结论补充：首轮 19:39 启动后，runner/config/API 目标文件在 19:41 被并发流程修改，已启动的 Playwright 使用的是修改前环境语义。新修复不依赖单点配置：`productionE2eEnvironment` 统一强制清空真实 provider key，并仅在显式 E2E runner 中设置 `MVP_PRODUCTION_E2E_ALLOW_MOCK=1`。
- RED：`npm.cmd test -- tests/unit/e2e-evidence.test.ts`，`1 failed / 7 passed`；缺少统一 production E2E 环境 helper，证明 build 与 `next start` 尚未共享同一显式 mock-only 契约。
- 最小修复：runner 的 build 和 Playwright 命令均使用同一 `e2eEnvironment`；production Playwright webServer 也从同一 helper 获得环境。普通 production API 仍只有显式开关等于 `1` 才允许 mock，无 key 且无开关继续走安全失败。
- 聚焦 GREEN：`npm.cmd test -- tests/unit/e2e-evidence.test.ts tests/unit/api-ai-route.test.ts`，退出码 0，`2 files / 47 tests passed`；目标 ESLint 和 `npx.cmd tsc --noEmit --pretty false --incremental false` 均退出码 0。
- 全新证据根：`qa/private-beta-production/20260731-prod-rerun-195034--a8283fa72ab3--af27d9112f3f/`，未复用或覆盖 `20260731-prod-193904--a8283fa72ab3--ff60441b7bdf/`。
- Production build：退出码 0；Playwright：Desktop Chromium 与 Pixel 7 共 `20 passed`，退出码 0，总运行退出码 0。
- 新目录包含有效 `manifest.json`、HTML report、34 张不重名成功截图、33 个脱敏事件/summary 文件；由于 20/20 无失败且策略是 `retain-on-failure`，trace 数为 0，符合 manifest 策略而非证据缺失。
- manifest 明确记录 build/test 命令各自退出码 0、HEAD/implementation/patch/lock hash、UTC/本地时间、环境和“只有显式 E2E 开关启用 mock；真实 key 禁用”。runner 结束后 3100 端口空闲。

目标文件：

- `playwright.config.ts`
- `playwright.production.config.ts`（新增）
- `tests/e2e/private-beta-readiness.spec.ts`
- `tests/e2e/evidence.ts`（新增证据写入助手）
- `package.json`
- `qa/private-beta-production/$env:E2E_RUN_ID/`（只由执行命令新建，绝不覆盖旧目录）

实现和验收顺序：

1. 先写配置级测试或用 `npx.cmd playwright test --config=playwright.production.config.ts --list` 验证配置只指向 `next start`，不是 `next dev`。
2. 让证据根目录由 `E2E_RUN_ID` 决定；若目录已存在则立即失败，禁止清理或复用 `qa/private-beta-readiness-e2e`。
3. manifest 保存 UTC/本地时间、Node/npm/浏览器版本、Git HEAD、`git status --short`、dirty diff SHA-256、build 命令和测试命令。每个项目/路线/状态的截图文件名包含 route、state、project，循环不得覆盖上一条路线。
4. 对每个测试保存浏览器 console error、pageerror、失败请求和非预期 4xx/5xx 到 JSONL；测试结束写汇总 JSON。
5. Desktop Chromium 与 Pixel 7 都覆盖：四路线完整输入、四路线缺信息、action、record、review、track；至少方向和 JD 完成 action-record-review-track 全闭环。关键页运行 Axe serious/critical 检查并检查横向溢出。
6. 不配置、不调用真实 provider；生产 E2E 使用确定性 mock，并在 manifest 明确标注。

具体运行命令：

```powershell
npm.cmd run build
$runId = "2026-07-31-prod-" + (Get-Date -Format "HHmmss")
$env:E2E_RUN_ID = $runId
npx.cmd playwright test --config=playwright.production.config.ts
Remove-Item Env:E2E_RUN_ID
```

完成条件：命令实际创建的 `D:\21天\qa\private-beta-production\$env:E2E_RUN_ID` 包含 manifest、HTML 报告、逐测试 console/network 日志、Desktop 和 Pixel 7 不重名截图；旧证据目录未发生修改。真实 provider、真实屏幕阅读器、400%、暗色主题和 iOS 仍在最终结论中明确为未验证。

### 批次 5：全量验证、差异复核与价值门裁决

**必须执行：全量技术复验和 A–P 需求矩阵复核。仓库外阻断：N、O 的生产部分。**

开始前先确认批次 1–4 的聚焦测试和生产证据均已有本轮日志。随后依次运行：

```powershell
npm.cmd test
npm.cmd run lint
npx.cmd tsc --noEmit --pretty false --incremental false
npm.cmd run build
npm.cmd audit --omit=dev --audit-level=low
npm.cmd audit --audit-level=low
git diff --check
git status --short
git diff --stat
git diff
```

复核动作：

1. 将最终 Vitest 文件数/用例数、每条命令退出码和执行时间写入生产证据目录的 `verification-summary.md`；不得沿用 24/701 或当前 25/729 RED 作为新成功证据。
2. 按 A–P 矩阵逐项引用源码、测试、日志或截图；没有直接证据的项目只能标为“未验证”。
3. 人工检查 Desktop 与 Pixel 7 关键截图：不含 UUID/raw enum；四路线内容可理解；缺信息状态诚实；记录/回看/轨迹闭环清楚；错误提示不覆盖用户输入。
4. 复查 `git diff`，确认没有无关重构、没有误改 16 份产品原文、没有覆盖用户已有证据、没有密钥/PII/真实个人数据进入仓库。
5. 最终严格按 `mvp21-student-value-gate` 输出“整体私测”固定中文契约，技术状态和用户价值分开。

价值门退出规则：

- 即使所有仓库内测试和生产模拟 E2E 通过，也只能证明“技术上可进入受控私测”，不能证明“整体私测用户价值 GO”。
- 没有 8–12 名真实应届生、至少 7 天、覆盖四路线的脱敏执行记录与第 7 天回看证据时，整体私测证据完整性只能写“部分”，不得发布 GO，不得用 mock/E2E 代替。
- 没有共享原子配额、供应商硬额度、告警和多实例压测的部署证据时，不得把公开生产私测描述为成本安全。
- 若仓库内仍有 P0/P1 红线或生产 E2E 失败，技术状态直接保持 NO-GO；若仓库内全部关闭但外部证据缺失，必须分别写“技术条件通过、整体私测价值未完成裁决/不得 GO”。

## 4. 计划自检清单

- [x] 每个必须修事项 A–M（N/O 外部部分除外）均绑定了具体源码或测试文件。
- [x] 五个执行批次都有明确 TDD 顺序、聚焦命令和完成条件，可在独立续轮结束。
- [x] N 与 O 的仓库外证据没有被安排为伪造数据或本地模拟替代。
- [x] P 已区分仓库内可修文案与真实设备/辅助技术未验证项。
- [x] 当前 25 files / 729 tests / 1 fail 的 RED 被保留，未误报成通过。
- [x] 最终验收包含全量测试、lint、TypeScript、生产 build、生产与完整 audit、`git diff --check`、完整 diff 复核和生产 Playwright。
- [x] 计划不要求 commit、push、reset、clean、删除旧证据或真实付费 provider 调用。
- [x] 文中所有步骤均已绑定文件、测试、命令与完成条件。

## 5A 执行记录：全量验证与只读代码复核（2026-07-31）

**状态：全量命令均 GREEN；代码复核发现 1 个 Important，按本子批约束仅记录后续 TDD，不修改实现、不做最终用户价值门裁决。**

本次独占证据目录：`qa/final-verification/20260731-5a-195351/`。`summary.json` 记录每条命令、UTC 开始/结束时间、退出码和对应日志；没有覆盖 production E2E 目录。

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| `git status --short` | exit 0；确认工作树仍包含大量用户未提交资产 | `01-git-status-short.log` |
| `git diff --check` | exit 0；只有既有 LF/CRLF 警告，无 whitespace error | `02-git-diff-check.log` |
| `npm.cmd test` | exit 0；29 files / 783 tests passed | `03-npm-test.log` |
| `npm.cmd run lint` | exit 0 | `04-npm-run-lint.log` |
| `npx.cmd tsc --noEmit --incremental false` | exit 0 | `05-tsc.log` |
| `npm.cmd run build` | exit 0；Next.js 16.2.12 production build、类型检查和静态页面生成通过 | `06-npm-run-build.log` |
| `npm.cmd audit --omit=dev --audit-level=low` | exit 0；0 vulnerabilities | `07-npm-audit-production.log` |
| `npm.cmd audit --audit-level=low` | exit 0；0 vulnerabilities | `08-npm-audit-full.log` |

### 5A 代码复核结论

- **Critical：0。** 未发现新增内部字段通用渲染、保存错误被当作成功、普通 production 默认启用 mock、未知异常泄露内部信息等 Critical 回归。
- **Important：1 — 无 Cookie 轮换仍绕过单 session 配额。** `src/ai/request-guard.ts` 的 `readSession()` 在没有 Cookie 时签发新值，并直接把新值作为本次 `sessionId`；连续丢弃响应 Cookie 的客户端因此每次获得新的 session rate/daily bucket。`tests/unit/request-guard.test.ts` 当前还用 “gives separate first-time visitors separate server-issued session buckets” 明确断言两个无 Cookie 请求可以绕过 `sessionDailyLimit: 1`。进程内 `globalRateLimit`/`globalDailyLimit` 只限制总量，不能满足本计划 H 的“未建立可信 session 共享预算键，回传合法 Cookie 后才进入稳定配额”验收条件；多实例时还受 O 的外部部署阻断影响。
- **Minor：0。** 本子批未新增 Minor。

需求矩阵抽查记录：A 的轨迹/回看记录字段通过 `record-presentation.ts` 白名单与人话类型标签渲染；C/D 的页面 catch 分支保留数据并写入独立用户可见状态；H/I/J/K/L 的入口、PII、taxonomy、长度和 5xx 测试均纳入本次全量 783 tests；production mock 必须同时具备显式开关、reserved 标记、安全 run-id 和证据目录，普通 production 负例存在且全量通过。N 的真实 7 天私测和 O 的共享原子配额/供应商硬额度仍是既有仓库外阻断，不在 5A 裁决或伪造。

### Important 后续 TDD（修复续轮已完成，2026-07-31）

1. 在 `tests/unit/request-guard.test.ts` 把当前允许无 Cookie 请求获得独立配额的用例改为 RED：连续丢弃 Cookie 的请求必须使用同一“未建立可信 session”预算键；在 `sessionRateLimit` 或 `sessionDailyLimit` 达限后抛出 429。
2. 在 `tests/unit/api-ai-route.test.ts` 加路由级 RED：连续无 Cookie 请求达限后返回 429，`providerFactory`/provider 调用数不再增加；首个响应仍可签发 `Set-Cookie`。
3. 最小修改 `src/ai/request-guard.ts`：无 Cookie 与伪造/过期 Cookie 的本次请求均计入共享 bootstrap/untrusted 桶；仅下一次请求回传服务器仍认可的 Cookie 时，才使用该合法 Cookie 的稳定 session 桶。保留全局分钟/日预算和会话表上限。
4. 聚焦验收：`npm.cmd test -- tests/unit/request-guard.test.ts tests/unit/api-ai-route.test.ts`、目标 ESLint、`npx.cmd tsc --noEmit --incremental false`；再由后续完整复验确认没有误伤首次访问和正常 Cookie 回传。

执行记录：

- RED：`npm.cmd test -- tests/unit/request-guard.test.ts tests/unit/api-ai-route.test.ts`，退出码 1；`3 failed / 44 passed`。旧实现的第二个无 Cookie 请求仍返回 200，两个无 Cookie 请求得到不同 session bucket，且 session 在预算检查前已经签发。
- 根因：`readSession()` 在同源/JSON/PII 与预算检查前创建可回传的已知 session。仅把未知请求改用共享键仍不够，因为被 429、PII 或畸形请求拒绝时若继续发新 Cookie，客户端仍可带回该 Cookie 获得新稳定配额。
- 最小修复：`readSession()` 对无 Cookie、伪造 Cookie 和过期 Cookie 只返回共享 bootstrap session，不签发 Cookie；API 在合法请求成功 `acquire()` 预算后调用 `establishSession()`。首次合法请求仍在本次完成 provider 调用并返回结果，同时签发 HttpOnly/SameSite Cookie；input 与 review 都使用同源 `/api/ai` fetch，浏览器下次自动带回 Cookie，无需新增客户端重试或信任转发 IP 头。429 和所有预算检查前拒绝路径不再发新 Cookie。
- GREEN 1：`npm.cmd test -- tests/unit/request-guard.test.ts tests/unit/api-ai-route.test.ts`，退出码 0；`2 files / 47 tests passed`。
- GREEN 2（安全与两个 AI 调用面）：`npm.cmd test -- tests/unit/request-guard.test.ts tests/unit/api-ai-route.test.ts tests/unit/safety.test.ts tests/unit/input-page.test.tsx tests/unit/review-page.test.tsx tests/unit/e2e-evidence.test.ts`，退出码 0；`6 files / 219 tests passed`。同一 API suite 同时复验非 JSON 415、跨站/Host 403、PII 422、provider 0 call、未知异常 5xx 与普通 production mock 禁用边界。
- GREEN：`npm.cmd run lint` 与 `npx.cmd tsc --noEmit --incremental false` 均退出码 0。
- 本续轮未运行 production E2E、全量 Vitest 或 production build；按用户要求留给下一轮完整复验。未提交、未推送，也未使用可伪造的 `X-Forwarded-For` 等请求头作为身份。

## 5B 执行记录：最终稳定态技术复验（2026-07-31）

**状态：批次 1–4 的仓库内修复和批次 5 的稳定态技术复验均已完成；本节不作用户价值门正文或整体发布裁决。**

- 独占 final verification 根：`qa/final-verification/20260731-5b-retry-200616/`。首次包装尝试 `20260731-5b-200548/` 因 PowerShell 把 Git 的 CRLF stderr warning 当作异常而提前终止，已保留但不作为成功证据；重试使用新 run-id 并从 `git diff --check` 重新开始。
- `git diff --check`、全量 Vitest、全仓 ESLint、TypeScript、production build、生产依赖 audit 和完整 audit 均 exit 0。最新全量基线为 `29 files / 787 tests passed`，两类 audit 均为 `0 vulnerabilities`。
- 普通 production mock 边界另以 `npm.cmd test -- tests/unit/api-ai-route.test.ts -t production` 复验，`4 passed`、exit 0；reserved production E2E 以外仍不会默认启用成功 mock。
- 全新 production 证据根：`qa/private-beta-production/20260731-prod-5b-200717--a8283fa72ab3--657a95c714f6/`，没有复用或覆盖旧目录。runner 内 production build exit 0；Desktop Chromium 与 Pixel 7 共 `20/20 passed`，Playwright exit 0；manifest 总 exit 0 且 `implementationStable=true`。
- 本次 production 目录包含 34 张命名截图、20 份逐测试脱敏事件 summary、13 份包含实际事件的 JSONL 和 HTML report；20/20 成功时按既定策略不保留 trace。运行前后 TCP 3100 均为空闲。
- 人工抽查 Desktop 轨迹和 Pixel 7 保存失败截图：未见 UUID/raw enum、横向溢出或失败时丢失当前输入。完整技术摘要见 `qa/final-verification/20260731-5b-retry-200616/verification-summary.md`。

仓库内批次状态：

- [x] 批次 1：用户可见内容、7 天回看、移动表单、缺项反馈和 constraints 可选。
- [x] 批次 2：保存可靠性与即时复盘等待/超时/取消。
- [x] 批次 3A：API 同源与 JSON 门、PII 输入输出、未知异常 5xx。
- [x] 批次 3B：方向 taxonomy 与输出长度门。
- [x] 批次 4：不可覆盖的 production Playwright 配置、证据设计与 20 场景生产运行。
- [x] 批次 5：完整稳定态命令复验、5A Important 修复复验、普通 production mock 负例和最终 production runner。

仍未验证或受仓库外阻断：

- [ ] N：8–12 名真实应届生、至少 7 天、覆盖四路线的脱敏私测记录和第 7 天回看证据不存在；不得用 mock/E2E 替代。
- [ ] O：共享原子 KV/Redis、供应商硬额度、告警和多实例压测缺少部署证据；当前进程内实现不得表述为生产成本安全。
- [ ] P 外部部分：真实 provider、真实屏幕阅读器、400%、暗色主题、iOS 与真实移动设备未验证。
- 本轮只完成仓库内技术证据收口；技术通过不等于用户价值或整体发布 GO，价值门正文留给明确授权的后续裁决。
