# JD 通用证据合同与失败恢复 P0 设计

**批准状态：** 主人已批准 8 角色审核后的 P0 设计；本文件把批准内容固化为实施边界，不扩大范围。

**基线：** `c7c879e82d1c5e35343cb6cb4de44b512da76810`，来源分支 `codex/ai-failure-observability-jd-contract-recovery`。

## 1. 目标与非目标

本轮只修复 JD → 投递前最小行动路线的证据合同、诚实 all-keep、失败恢复和用户可见解释，同时回归四路线闭环。所有受支持的文本输入都必须进入 `route_result`、`missing_info` 或产品化非 200 失败之一，不能以合法但无价值的输出冒充成功。

P0 输入仍是一个目标岗位、一份真实 JD 或 3–5 条岗位要求、粘贴文本材料或用户已确认的本地记录。不新增 PDF、Word、OCR、网页抓取、批量多 JD、简历管理器、CRM、图数据库、关系图或新页面。

## 2. 治理裁决

《21天总准则》§7.4 的“必须给出投递前最小修改动作”与“材料已经诚实覆盖岗位要求时允许 0 修改”冲突。已批准的裁决是显式修订最高准则及所有受影响的 tracked 产品文档：JD 路线必须给一个投递前最小行动；该行动可以是实际修改、补证据，或在严格 all-keep 条件成立时确认并保存当前版本。对外仍只有一个行动和 0–2 个相关修改项。

all-keep 只有在服务端完成以下检查后才能成立：已检查前 3–5 条关键要求；每个 `keep` 都引用真实来源；没有 `unsupported` 的关键要求；候选材料不存在夸大、事实错误或角色/工具/结果升级。all-keep 的行动是确认并保存当前版本，记录是否投递与待观察反馈，不生成虚假修改。

三条闭环分别是：

- `collect_evidence`：明确缺哪个来源，只给补证据行动，不给可直接粘贴的假设句。
- 实际修改：只允许 `replace` 或 `insert`，每项逐条绑定 JD 与材料来源；最多 2 项。
- all-keep：0 修改，确认/保存当前版本并记录投递状态与观察点。

## 3. 请求级证据合同

服务端从 `jdTextOrRequirements` 与 `userMaterial` 生成请求级、不可持久化的来源目录。每个来源引用具有统一合同：

```ts
type ExactSourceRef = {
  sourceId: string;
  contentHash: string;
  version: 1;
  fieldPath: "jdTextOrRequirements" | "userMaterial";
  exactQuote: string;
  span?: { start: number; end: number };
};
```

`sourceId`、`contentHash`、`fieldPath`、`exactQuote` 和可选 span 均由服务端签发。模型只能引用已签发 ID；服务端验证 ID 存在、hash/version 与本请求一致、quote 是对应字段精确子串、span 与 quote 一致。完整 JD、材料、关系矩阵和 raw model output 不写服务端存储或日志；浏览器本地草稿仍按既有用户控制边界逐字保存，以满足失败恢复。

服务端将来源目录传给一次正常 DeepSeek 结构化调用。模型在同一返回中完成内部 A（选择 3–5 条要求与相关材料）和 B（关系及候选行动），但不生成完整 UI 文案：

```ts
type JdRelation = "direct" | "partial" | "unsupported";
type JdDisposition = "replace" | "insert" | "collect_evidence" | "keep";

type JdDecisionCandidate = {
  requirementSourceId: string;
  evidenceSourceIds: string[];
  relation: JdRelation;
  transferableClue?: string;
  conflictSourceIds?: [string, string];
  disposition: JdDisposition;
  targetSourceId?: string;
  candidateText?: string;
  reason: string;
};

type JdDecisionEnvelope = {
  routeKey: "jd_to_revision";
  selectedRequirementSourceIds: string[];
  decisions: JdDecisionCandidate[];
};
```

`transferableClue` 只能作为内部候选线索，不能单独支持改写。`explicit_conflict` 只有 `conflictSourceIds` 同时指向两个明确原文 span 时成立。`replace` 只允许澄清或重排已有事实；`insert` 只允许插入用户已提供或确认、但目标片段缺失的事实；`keep` 是 disposition，不是行动。

## 4. 服务端确定性验证与组装

服务端按以下顺序处理模型结果：

1. Zod 校验必要根字段、枚举、数量与 ID 形状。
2. 验证全部来源 ID、hash/version、fieldPath、exactQuote 与 span。
3. 把候选句拆成事实、数字、工具、角色、结果和强度词，逐项要求被选中材料来源支持。
4. 关系只允许 `direct`、`partial`、`unsupported`；不把相似任务自动当作直接证据。
5. 按可行动性和用户价值排序，选择 1–2 个高价值修改；不由模型决定页面标题、主行动、完成标准、记录字段或时间。
6. 若关键要求缺来源，组装 `collect_evidence`；若满足严格条件，组装 all-keep；否则组装实际修改。
7. 重新运行 schema、grounding、safety、产品语义和普通学生可理解/可执行检查。

引用字段可以保留 JD 原文中的“主导”等词；候选文本若无材料原文支持，不得出现“主导”“负责”“独立完成”“协同研发设计”、数据工具、PRD、用户数、迭代次数或跨团队协作。服务端只输出一个主行动和 0–2 个修改项；每个修改项只带一个短 JD 引用、一个或两个短材料引用、候选文本与普通话理由。

## 5. 失败分类与互斥恢复

正常路径只调用一次 DeepSeek。两条失败路径互斥：

- 语义、grounding、safety、产品合同或普通学生可理解/可执行检查失败：同一 primary 带定向错误信息修复一次；仍失败则非 200 friendly failure，禁止 Qwen 绕过。
- 机器不可用：transport、timeout、empty、unparseable、必要根字段缺失；primary 技术重试一次，仍失败且剩余预算允许时调用 Qwen 一次，并经过完全相同的验证门。

编排硬截止为 28 秒。caller abort 与内部 deadline 分离：caller abort 返回 499；内部 deadline/timeout 返回 504；transport/rate/circuit 返回 503；JSON、schema、grounding、safety 或产品合同耗尽返回 502；敏感输入保持 422。任何非 200 体都不包含 `todayAction`、记录指引、用户全文、prompt、raw output 或内部错误。

reporter 只允许 `requestId`、`routeKey`、`mode`、`providerRole`、`attempt`、`stage`、`code`、`durationBucket`、`schemaPaths`、`httpStatusClass`、`providerErrorCode`。禁止用户全文、prompt、raw output 与密钥。

## 6. 前端并发、恢复与持久化

每次提交生成 `clientRequestId`，并携带当前 `draftRevision`。输入任一字段变化都会递增 revision；响应只在 requestId 对应当前活动请求且响应 revision 等于当前 draft revision 时可接受。取消、超时、较旧 revision 或较旧 requestId 的迟到响应全部忽略。

AI 失败只更新输入页的 `aria-live` 状态，不覆盖旧 action、draft、record、review、journey；保存失败与 AI 失败使用不同文案；复盘失败保留已确认记录且不伪造复盘。`missing_info` 仍是独立 200 业务态。local-store 对 current action/record/review 的创建使用请求 ID 或记录 ID 做幂等保护，重试不得重复创建。

AI 生成的修改内容必须由用户确认后才能保存或推进。请求级 requirement/evidence/relation 矩阵、完整 raw model output 不进入 local-store；只保存用户需要继续行动的 0–2 个短修改项、确认状态和既有本地草稿。

## 7. 用户可见 UI

不新增页面。JD 结果页保持现有 IA：边界说明、一个主行动卡、0–2 个修改项、记录 CTA。修改项提供可展开的“为什么改这一处”，展开内容只显示短 JD 引用和短材料引用；使用原生 button，带 `aria-expanded` 与关联 region。all-keep 显示 0 修改和确认/保存行动；collect-evidence 显示补来源行动，不显示假设句。

页面禁止矩阵、关系图、分数、覆盖率、内部关系/质量门标签。移动端纵向排列，320px 无横滚，触控目标至少 44px，状态使用 `aria-live`，颜色对比满足 WCAG AA。

## 8. 验证设计

规则锚定集先建立 16–20 条公开样例，覆盖精确 AI 产品运营反例、1×1、1×many、many×1、many×many、重复、partial、unsupported、conflict、all-keep、prompt injection、中英双语、噪声和长文本。私测前扩充到 40–60 条分层样例，至少 20% 冻结隐藏；本轮只实现公开锚定集与 hidden-set 装载/分层机制，不伪造尚未完成的私测结果。

硬安全、来源和行动约束必须 100% 通过，红线为 0。技术/离线通过只能形成受控私测候选，不能替代 8–12 名普通应届生 7 天私测、第 2–3 天回访和至少两次真实推进。
