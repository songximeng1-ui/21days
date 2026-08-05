# JD General Evidence Contract and Failure Recovery P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` task by task. In this session the primary agent executes the plan directly because the approved release authorization requires verification before the single release commit.

**Goal:** Make every supported JD text input reach an honest, useful state by enforcing a request-scoped exact-source contract, three explicit decision loops, mutually exclusive failure recovery, and stale-response-safe client persistence.

**Architecture:** The server signs immutable requirement and evidence fragments before the model call. The model may return only signed IDs in a complete 3–5 requirement decision envelope. The server validates source identity, relations, dispositions, atomic claims, grounding, and safety before assembling one public action with zero to two modifications. Machine-unavailable failures and semantic/product-invalid failures use separate recovery paths under one 28-second deadline. The browser binds every response to a client request ID and draft revision and persists actions atomically and idempotently.

**Tech Stack:** Next.js 16, React 19, TypeScript, Zod, Vitest/Testing Library, Playwright, localStorage, DeepSeek primary and Qwen fallback through the existing OpenAI-compatible adapter.

## Global constraints

- Work only in `C:\Users\宋熙萌\.codex\worktrees\629c\21天`; never modify or clean `D:\21天`.
- Use `apply_patch` for every source, test, product-document, and evidence-record edit.
- Do not add PDF/Word/OCR, URL fetching, multi-JD batching, a resume manager, graph persistence/UI, or new pages.
- Do not persist complete JD text, complete material text, the internal relation matrix, prompts, or raw model output.
- Do not make a paid real-provider call. All executable verification uses deterministic providers; post-deploy checks are read-only.
- Keep the public IA `READY`/`MISSING_INFO`/`FRIENDLY_FAILURE` (or existing equivalent), with one action and zero to two changes.
- Every RED test must fail for the named missing behavior, not because of setup, typing, or a stale fixture.
- Release evidence uses a fresh run ID and a directory that does not already exist.

## Task 1: Resolve the all-keep governance conflict explicitly

**Files:**

- Modify: `docs/product/MVP AI工作流与安全边界设计.md`
- Modify: `docs/product/MVP PM决策共识.md`
- Modify: `docs/product/MVP UX信息架构第一版.md`
- Modify: `docs/product/MVP UX准则.md`
- Modify: `docs/product/MVP 测试用例与私测观察标准.md`
- Modify: `docs/product/MVP 四路线输入输出数据设计.md`
- Modify: `docs/product/MVP 页面低保真线框图.md`
- Modify: `docs/product/MVP 页面线框与关键状态设计.md`
- Modify: `docs/product/新MVP PRD.md`
- Modify: `docs/product/MVP 研发进度记录.md`
- Reference: `docs/product/21天总准则.md`
- Reference: `docs/superpowers/plans/2026-08-05-jd-general-evidence-contract-p0-governance-matrix.md`

**Step 1 — RED governance review:** Record every statement that forces one or two modifications even when all checked requirements already have exact support. Confirm the conflict against the highest-level principles: real evidence, no fabricated action, one 15–30 minute action, user confirmation before persistence.

**Step 2 — GREEN document changes:** Add a dated P0 decision stating that normal modification results contain one or two changes, while strict all-keep contains zero changes and one executable confirmation/save/record action. Define all-keep as: service checks the first 3–5 key requirements; every `keep` has exact evidence; no selected key requirement is unsupported; no candidate contains exaggeration, factual error, or an ungrounded fact/tool/role/result/strength claim. Define and distinguish the `collect_evidence`, actual-change, and all-keep loops. Keep all internal labels out of user-facing copy.

**Step 3 — REFACTOR consistency review:** Re-read the nine changed documents around each edit, then search all 16 product documents for remaining unconditional `1–2`/`一处修改` wording. Update the progress log with reason, affected documents, implementation/tests, and the fact that no original in `D:\21天` was changed.

**Verification:**

```powershell
git diff --check
git diff -- docs/product
```

## Task 2: Establish request-scoped exact sources and a complete JD decision schema

**Files:**

- Create: `src/domain/jd-evidence-contract.ts`
- Modify: `src/schemas/jd-mapping-candidate.ts`
- Modify: `src/domain/jd-route-assembler.ts`
- Modify: `src/schemas/route-output.ts`
- Modify: `src/domain/route-contracts.ts`
- Create: `tests/fixtures/jd-evidence-contract-cases.ts`
- Replace/extend: `tests/unit/jd-mapping-contract.test.ts`

**Public internal types:**

```ts
type ExactSourceRef = {
  sourceId: string;
  contentHash: string;
  version: 1;
  fieldPath: "input.jdTextOrRequirements" | "input.userMaterial";
  exactQuote: string;
  span?: { start: number; end: number };
};

type JdRelation = "direct" | "partial" | "unsupported";
type JdDisposition = "replace" | "insert" | "collect_evidence" | "keep";

type JdDecision = {
  requirementSourceId: string;
  evidenceSourceIds: string[];
  relation: JdRelation;
  disposition: JdDisposition;
  targetSourceId?: string;
  candidateText?: string;
  reason: string;
  transferableClueSourceIds?: string[];
  conflictSourceIds?: [string, string];
};
```

**Step 1 — RED exact-source tests:** Add literal assertions proving an altered quote, hash, span, field path, unknown ID, duplicate selected ID, missing decision, duplicate decision, or decision outside the 3–5 selected set is rejected. Prove identical text in different fields cannot be cross-referenced.

**Step 2 — RED relation/disposition tests:** Table-drive `direct`, `partial`, `unsupported`, `replace`, `insert`, `collect_evidence`, and `keep`. Require evidence for direct/partial/keep; prohibit candidates for collect/keep/unsupported; require a grounded target and candidate for replace/insert; allow `transferable_clue` only as optional non-supporting context; allow conflict only when both exact source IDs exist.

**Step 3 — RED 18-anchor behavior suite:** Freeze literal cases for exact AI-product-operations, 1×1, 1×many, many×1, many×many, duplicate references, partial, unsupported, conflict, valid all-keep, invalid all-keep, prompt injection in JD, prompt injection in material, bilingual, bullet/blank-line noise, long input near the accepted bound, JD quote containing `主导`, and syntactically valid but incomprehensible/unexecutable output. At least four cases remain fixture-only and are not quoted in prompts, establishing a 22.2% hidden layer. Hard source/action/safety rules must pass 100% with zero red-line violations.

**Step 4 — Observe RED:** Run only the new JD tests. The intended failures are absence of exact refs, absence of complete 3–5 decisions, wrong first-material fallback, and inability to represent all-keep/collect-evidence. Any import/fixture error is repaired before production code.

```powershell
npm.cmd test -- tests/unit/jd-mapping-contract.test.ts
```

**Step 5 — GREEN source catalog:** Split supported text into stable, bounded fragments while retaining exact spans. Sign every fragment with a deterministic request-level ID and SHA-256 of the original field value. Validate ID/hash/version/path/quote/span as one unit. Treat all input as inert data.

**Step 6 — GREEN decision contract:** Replace the one-or-more loose mappings schema with the complete envelope. Use Zod `superRefine` for uniqueness, exact coverage, and relation/disposition invariants. Never accept a singleton result as a successful JD route result.

**Step 7 — GREEN assembler:** Remove the `catalog.materials[0]` fallback. Validate atomic numbers, tools, roles, facts, results, deliverables, and strength claims against selected evidence. Preserve strength terms in JD quotes but forbid them in candidates without evidence. Score valid supported candidates generically, select at most two high-value distinct changes, and produce one of exactly three loops:

- actual change: one action, one or two grounded modifications, optional short evidence gap;
- collect evidence: zero paste-ready hypothetical changes and one concrete evidence collection action;
- all-keep: zero changes and one confirm/save/record action after the strict service gate.

**Step 8 — REFACTOR:** Keep validation pure and request-scoped. Delete obsolete loose-mapping branches and first-material fallback. Do not persist the catalog or model envelope.

**Verification:**

```powershell
npm.cmd test -- tests/unit/jd-mapping-contract.test.ts tests/unit/schemas.test.ts tests/unit/route-contracts.test.ts
```

## Task 3: Make the model contract narrow, hostile-input-safe, and useful

**Files:**

- Modify: `src/ai/chat-completion-provider.ts`
- Modify: `src/ai/mock-provider.ts`
- Modify: `tests/unit/chat-completion-provider.test.ts`
- Modify: `tests/unit/mock-provider.test.ts`

**Step 1 — RED prompt-boundary tests:** Assert observable parsed behavior from a deterministic OpenAI-compatible response: only signed IDs are accepted; a complete 3–5 decision envelope is required; injection-like text stays quoted data; malformed examples cannot pass; the exact AI-product-operations case can express both Tesla quantified operations evidence and the Codex end-to-end product evidence without inventing data tools, users, iteration counts, cross-team work, or a written PRD.

**Step 2 — Observe RED:**

```powershell
npm.cmd test -- tests/unit/chat-completion-provider.test.ts tests/unit/mock-provider.test.ts
```

**Step 3 — GREEN prompt:** Send only the service-issued compact source catalog and decision schema. Tell the model to extract/map and propose candidates, never to write UI copy or declare itself grounded/safe. Include one legal example covering partial support and one legal all-keep example; keep the hidden anchors out of the prompt.

**Step 4 — GREEN deterministic provider:** Update the mock so normal JD submission exercises the same narrow envelope and assembler as production. Keep all non-JD routes behaviorally unchanged.

**Step 5 — REFACTOR:** Centralize schema serialization and remove legacy prose such as `mat-1 or null`. Ensure no prompt or raw output enters diagnostics.

## Task 4: Separate semantic repair from machine recovery under one deadline

**Files:**

- Modify: `src/ai/orchestrator.ts`
- Modify: `src/ai/orchestration-policy.ts`
- Modify: `src/ai/failure-diagnostics.ts`
- Modify: `src/app/api/ai/route.ts`
- Modify: `tests/unit/orchestrator.test.ts`
- Modify: `tests/unit/processing-failure.test.ts`
- Modify: `tests/unit/api-failure-contract.test.ts`

**Step 1 — RED mutually exclusive paths:** Use deterministic providers and fake timers to prove:

- semantic, grounding, safety, and product-invalid output receives exactly one directed primary repair and never reaches Qwen;
- a second semantic failure is non-200;
- timeout, empty output, unparseable JSON, missing required root fields, and transport failure receive one primary technical retry and then Qwen;
- a fallback result passes the identical schema/source/grounding/safety/product gates;
- fallback exhaustion is non-200;
- caller abort is 499 and never starts another attempt;
- service deadline is 504, distinct from caller abort, and completes within 28 seconds even if a reporter stalls;
- semantic failures do not poison the provider circuit breaker.

**Step 2 — Observe RED:**

```powershell
npm.cmd test -- tests/unit/orchestrator.test.ts tests/unit/processing-failure.test.ts tests/unit/api-failure-contract.test.ts
```

**Step 3 — GREEN state machine:** Classify each attempt as `machine_unavailable` or `semantic_invalid` once. Normal path starts with one DeepSeek call. Machine path is DeepSeek technical retry then Qwen. Semantic path is one directed DeepSeek repair then friendly non-200 failure. Never switch categories mid-recovery. Reserve enough remaining budget before starting an attempt and apply the 28-second deadline to the complete handler outcome.

**Step 4 — GREEN diagnostics:** Report only request ID, provider, attempt, category, recovery decision, route, elapsed bucket, and safe error code. Record final outcome and caller-abort/deadline distinction. Never record input fragments, full text, prompt, raw output, authorization headers, or keys.

**Step 5 — REFACTOR:** Keep failure mapping in one place. Make reporting non-blocking/budget-bounded. Remove legacy fallback branches that can bypass semantic gates.

## Task 5: Bind responses to draft revisions and make persistence atomic

**Files:**

- Modify: `src/schemas/route-request.ts`
- Modify: `src/app/api/ai/route.ts`
- Modify: `src/app/routes/[routeKey]/input/page.tsx`
- Modify: `src/app/review/page.tsx`
- Modify: `src/lib/local-store.ts`
- Modify: `tests/unit/route-request.test.ts`
- Modify: `tests/unit/api-ai-route.test.ts`
- Modify: `tests/unit/input-page.test.tsx`
- Modify: `tests/unit/review-page.test.tsx`
- Modify: `tests/unit/local-store.test.ts`

**Request metadata:**

```ts
requestContext: {
  clientRequestId: string;
  draftRevision: number;
  idempotencyKey: string;
}
```

**Step 1 — RED concurrency/persistence tests:** Prove a synchronous double submit starts one request; editing during a request makes its response stale; an aborted or unmounted response cannot save or navigate; mismatched echoed request metadata cannot save; retrying the same accepted response cannot create a second action/journey entry; AI failure, action save failure, and review save failure preserve the previous draft/action/record/review/journey byte-for-byte; action-save failure does not create a journey; review output stays bound to the record version used in its request.

**Step 2 — Observe RED:**

```powershell
npm.cmd test -- tests/unit/route-request.test.ts tests/unit/api-ai-route.test.ts tests/unit/input-page.test.tsx tests/unit/review-page.test.tsx tests/unit/local-store.test.ts
```

**Step 3 — GREEN request gate:** Add strict request metadata, echo it in safe response headers, and bind server idempotency to the key plus payload/revision hash for the in-flight request. A repeated identical in-flight key reuses the result; a key reused for another payload is a conflict.

**Step 4 — GREEN client gate:** Keep the current request token and monotonically increasing draft revision in refs. Capture them at submit, ignore any late/mismatched response, and never replace a newer draft or action. Preserve generated output in memory when only local persistence fails so retry repeats only the local save.

**Step 5 — GREEN atomic store:** Make action+journal initialization one transaction and attach safe origin metadata only (request ID/key/revision, never input content). Make saves idempotent. Bind review save to the captured record ID/version.

**Step 6 — REFACTOR:** Represent AI processing and persistence errors as distinct typed phases while retaining current concise user-facing language.

## Task 6: Render one action, zero to two changes, and an accessible explanation

**Files:**

- Modify: `src/app/routes/[routeKey]/action/page.tsx`
- Modify: `src/app/routes/[routeKey]/input/page.tsx`
- Modify: `src/app/track/page.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/unit/action-page.test.tsx`
- Modify: `tests/unit/input-page.test.tsx`
- Modify: `tests/unit/track-page.test.tsx`
- Modify: `tests/unit/visible-copy-boundary.test.ts`
- Modify: `tests/e2e/private-beta-readiness.spec.ts`

**Step 1 — RED public-boundary tests:** Assert the JD action page shows one primary action, at most two modification cards, and no matrix, graph, score, coverage, relation/disposition, or gate terminology. Each modification has a collapsed `为什么改这一处` control with `aria-expanded`, `aria-controls`, a short JD quote, and exact material quotes. Collect-evidence shows no paste-ready candidate. All-keep shows zero modifications plus confirm/save and a record observation prompt.

**Step 2 — RED mobile/a11y tests:** At 320px, cover home, all four input pages, JD action/record, review, and track with no horizontal overflow. Assert interactive hit areas are at least 44px including checkbox labels. Add `aria-expanded`/`aria-controls` to disclosure controls and retain `aria-live` for status.

**Step 3 — Observe RED:**

```powershell
npm.cmd test -- tests/unit/action-page.test.tsx tests/unit/input-page.test.tsx tests/unit/track-page.test.tsx tests/unit/visible-copy-boundary.test.ts
```

**Step 4 — GREEN UI:** Implement the three approved loops on existing pages only. Keep the mobile layout vertical, explanations optional, user confirmation explicit before record persistence, and public copy understandable to an ordinary fresh graduate.

**Step 5 — REFACTOR:** Reuse the existing card/button/status styles and add only small disclosure and 320px safeguards. Do not expose internal IDs, hashes, relation labels, or raw model reasoning.

## Task 7: Full regression, production-build evidence, and review

**Files:**

- Modify: `docs/superpowers/plans/2026-08-05-jd-general-evidence-contract-p0-governance-matrix.md`
- Modify: `docs/product/MVP 研发进度记录.md`
- Create through existing runner: `qa/private-beta-production/20260805-jd-general-evidence-contract-p0--<head>--<implementation-hash>/...`

**Step 1 — Focused GREEN:** Run every focused command listed above until all pass. Record exact counts and elapsed times in the implementation evidence section.

**Step 2 — Full static and unit/integration verification:**

```powershell
npm.cmd test
npm.cmd run lint
npx.cmd tsc --noEmit --incremental false
npm.cmd run build
npm.cmd audit --audit-level=high
git diff --check
```

**Step 3 — Production build E2E:**

```powershell
$env:E2E_RUN_ID = "20260805-jd-general-evidence-contract-p0"
npm.cmd run test:e2e:production
```

The expected evidence path is the fresh directory generated beneath `qa/private-beta-production/`. It must contain a manifest, desktop/mobile screenshots, console/network metadata, four-route complete and missing-info flows, distinct AI/save/review failures, exact JD fixture, collect-evidence, actual-change, all-keep, stale response/idempotency, 320px overflow, 44px target, and accessibility evidence. No old QA directory may be overwritten.

**Step 4 — Matrix regression:** Update every row in the 16-document matrix with implementation file, test/evidence, status, remaining issue, and disposition. Keep unapproved real-provider validation explicitly unexecuted.

**Step 5 — Code review:** Invoke a fresh reviewer after all local checks. Verify every finding before changing code, fix confirmed P0/P1 findings with RED→GREEN, and rerun the affected focused test plus the full required suite. A second reviewer confirms the fixes and absence of release-blocking findings.

## Task 8: Commit, push, tag, deploy, and read-only production proof

**Prerequisite:** Tasks 1–7 pass freshly, the worktree contains only intended changes, and no release-blocking review finding remains.

**Step 1 — Release commit:** Create one intentional commit on the detached worktree after verification:

```powershell
git status --short
git diff --stat
git add -- <explicit intended paths>
git commit -m "fix: enforce JD evidence contract and failure recovery"
```

**Step 2 — Push branch:** Confirm the remote branch has not moved from the verified ancestor, then push without force:

```powershell
git fetch origin codex/ai-failure-observability-jd-contract-recovery
git merge-base --is-ancestor origin/codex/ai-failure-observability-jd-contract-recovery HEAD
git push origin HEAD:codex/ai-failure-observability-jd-contract-recovery
```

**Step 3 — Annotated release tag:** Create `jd-general-evidence-contract-p0-20260805` at the release commit. The message records the production E2E evidence path and manifest SHA-256. Push only after dereferencing the tag confirms it targets the release commit.

**Step 4 — Deploy:** Use the repository's authenticated Vercel path or its push-triggered production deployment. Capture deployment ID, Git SHA, project/environment, created/ready timestamps, aliases, and the stable domain. Do not install or use an unrelated deployment plugin.

**Step 5 — Read-only production verification:** Without submitting the AI form, verify the stable domain and route pages return 200, response headers/commit-deployment binding match, desktop and mobile pages load, there is no immediate console/network error, and approved boundary copy is present. Store a new post-deploy manifest and screenshots without overwriting prior evidence. The paid-provider JD path remains explicitly unexecuted.

**Step 6 — Product-value verdict:** Apply the `mvp21-student-value-gate` fixed Chinese contract route by route and overall. Distinguish deterministic technical/private-test candidacy from ordinary-graduate value evidence. Without 8–12 ordinary graduates over seven days, day-2/3 return visits, and two real advances, do not label the product an overall value GO, release GO, or completed private-test success.
