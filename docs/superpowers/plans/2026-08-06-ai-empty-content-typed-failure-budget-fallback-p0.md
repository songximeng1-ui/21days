# AI Empty Content Typed Failure and Budget-Aware Fallback P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every expected AI failure typed and non-500, preserve a usable Qwen fallback window after DeepSeek `empty_content`, and make JD candidate assembly return an explicit result instead of throwing.

**Architecture:** Keep the HTTP deadline at 28 seconds, but move orchestration to one typed attempt algebra that separates `machine_unavailable` from `semantic_invalid`. Provider failures and safe envelope observations flow into an allowlisted diagnostic event; the orchestrator decides retry/fallback from failure class plus remaining budget, and emits exactly one terminal event. JD candidate parsing and assembly become total functions: the model returns only `decisions[]`, while the server derives requirement coverage from its signed catalog and converts all invalid references or grounding failures into typed attempt failures.

**Tech Stack:** TypeScript 5, Next.js 16 route handlers, Zod 4, Vitest 4, React Testing Library, Playwright 1.62, deterministic mock providers only.

## Global Constraints

- Highest governance is `docs/product/21天总准则.md`; all 16 files in `docs/product` remain authoritative and unchanged unless a directly affected contract statement requires a minimal synchronized edit.
- Do not call DeepSeek, Qwen, or any paid real provider during development or verification.
- Do not reset, clean, overwrite, or commit user assets from `D:\21天`; all edits stay in this linked worktree and use `apply_patch`.
- Preserve the 28,000 ms whole-request hard deadline and ensure the user receives a terminal response within 30 seconds.
- A normal successful request still makes one primary structured `json_object` call.
- `business_missing_info` is a valid output and never triggers fallback.
- `machine_unavailable` includes transport, timeout, retryable HTTP, `empty_content`, unparseable provider JSON, and missing required envelope/content roots; it may retry primary at most once when the budget predicate passes, then may use fallback.
- `semantic_invalid` includes schema-valid but ungrounded, unsafe, route-invalid, action-invalid, or product-invalid output; it may receive one directed repair on the same primary and must never use fallback.
- Deadline maps to HTTP 504, cancellation to 499, exhausted machine failure to 503, semantic invalidity to 502, and only genuinely unexpected internal faults to 500.
- User copy must not contain provider, schema, fallback, model, prompt, quality-gate, stage, or code terminology.
- Failure paths preserve the submitted draft plus any prior action, record, review, and journey state and do not create duplicates.
- Diagnostics may contain only: `requestId`, `routeKey`, `mode`, `providerRole`, `attempt`, `stage`, `code`, `failureClass`, `recoveryDecision`, `remainingBudgetBucket`, `durationBucket`, allowlisted `finishReason`, `choiceCountBucket`, `contentShape`, `contentLengthBucket`, and `terminalCategory`.
- Every request emits exactly one terminal diagnostic event; fallback emits explicit `started`, `succeeded`, `failed`, or `skipped` state diagnostics.
- Do not add provider-specific response schema features; DeepSeek and Qwen compatible `json_object` behavior remains the capability floor.
- Do not add special cases for a specific JD, company, job title, experience phrase, keyword, or input length.

## File Responsibility Map

- Create `src/ai/attempt-failure.ts`: the single attempt-failure algebra, processing-category mapping, retry/fallback eligibility, and safe budget/response observation types.
- Create `src/ai/orchestration-budget.ts`: pure remaining-budget calculations and the retry/fallback admission predicate.
- Modify `src/ai/provider.ts`: keep provider error construction backward-compatible while carrying optional safe envelope observations.
- Modify `src/ai/chat-completion-provider.ts`: classify empty/malformed envelope cases without raw content, constrain each provider call to the supplied attempt budget, and emit only safe response observations.
- Modify `src/ai/failure-diagnostics.ts`: enforce the exact allowlist, fallback lifecycle codes, remaining-budget buckets, and terminal category.
- Modify `src/ai/orchestrator.ts`: consume the typed algebra, make machine and semantic recovery mutually exclusive, reserve fallback time, catch all expected JD assembly failures as results, and emit one terminal event.
- Modify `src/schemas/jd-mapping-candidate.ts`: remove redundant `selectedRequirementIds`; require unique `decisions[].requirementId` only.
- Modify `src/domain/jd-route-assembler.ts`: replace `throw`/Zod `.parse()` with a discriminated total result and explicit codes for invalid references, coverage, relations, conflicts, and candidate grounding.
- Modify `src/ai/processing-failure.ts` and `src/app/api/ai/route.ts`: map typed terminal categories to safe status/copy and leave generic 500 only for unexpected internal faults.
- Modify unit/E2E fixtures and tests under `tests/`: prove the algebra, budget, assembler, diagnostics, state preservation, generic corpus, four routes, mobile, and accessibility.
- Create `docs/superpowers/plans/2026-08-06-ai-empty-content-typed-failure-budget-fallback-p0-governance-matrix.md`: bind each affected governance rule to implementation and fresh evidence.

---

### Task 1: Lock the Failure Algebra and Safe Diagnostic Contract

**Files:**
- Create: `src/ai/attempt-failure.ts`
- Modify: `src/ai/failure-diagnostics.ts`
- Modify: `src/ai/provider.ts`
- Test: `tests/unit/processing-failure.test.ts`
- Test: `tests/unit/chat-completion-provider.test.ts`

**Interfaces:**
- Produces: `AttemptFailureClass = "machine_unavailable" | "semantic_invalid"`.
- Produces: `AttemptFailure` with exact `stage`, `code`, `retryPrimary`, `allowFallback`, `failureClass`, timing, optional schema paths, HTTP metadata, and optional safe response observations.
- Produces: `AiSafeProviderObservation` containing only allowlisted `finishReason`, `choiceCountBucket`, `contentShape`, and `contentLengthBucket`.
- Produces: `remainingBudgetBucket(ms)` and `terminalCategory` fields on safe diagnostics.
- Consumes: existing `AiProviderErrorKind`, `AiFailureStage`, and `AiProcessingFailureCategory`.

- [ ] **Step 1: Add RED tests for typed provider content and diagnostic stripping**

  Add table cases proving `empty_content`, `envelope_json`, and `model_json` classify as `machine_unavailable`, while candidate grounding/safety/action failures classify as `semantic_invalid`. Extend the malicious-extra reporter test with `prompt`, `rawOutput`, `userMaterial`, `apiKey`, and an unrecognized `finishReason`; assert the serialized event contains none of them.

- [ ] **Step 2: Run the RED tests**

  Run: `npm test -- tests/unit/processing-failure.test.ts tests/unit/chat-completion-provider.test.ts`

  Expected: FAIL because the shared algebra, observation fields, budget bucket, and terminal category do not exist.

- [ ] **Step 3: Implement the minimal shared types and allowlist**

  Define the failure type and pure classifiers in `src/ai/attempt-failure.ts`. Extend `AiProviderError` with a final optional `observation?: AiSafeProviderObservation` parameter so all existing four-argument call sites remain valid. Update `createSafeAiFailureReporter()` to reconstruct every event field-by-field, copy array values, validate `finishReason` against `stop | length | content_filter | tool_calls | unknown`, and never spread caller data.

- [ ] **Step 4: Run focused tests and typecheck**

  Run: `npm test -- tests/unit/processing-failure.test.ts tests/unit/chat-completion-provider.test.ts`

  Run: `npx tsc --noEmit --incremental false`

  Expected: PASS, and no caller-visible error object contains response bodies or user input.

- [ ] **Step 5: Commit the algebra boundary**

  ```powershell
  git add src/ai/attempt-failure.ts src/ai/failure-diagnostics.ts src/ai/provider.ts tests/unit/processing-failure.test.ts tests/unit/chat-completion-provider.test.ts
  git commit -m "refactor: define typed ai failure algebra"
  ```

### Task 2: Make the JD Decision Contract Minimal and Assembly Total

**Files:**
- Modify: `src/schemas/jd-mapping-candidate.ts`
- Modify: `src/domain/jd-route-assembler.ts`
- Modify: `src/ai/chat-completion-provider.ts`
- Modify: `src/ai/orchestrator.ts`
- Modify: `tests/fixtures/jd-evidence-contract-cases.ts`
- Modify: `tests/fixtures/jd-evidence-contract-layered-cases.ts`
- Test: `tests/unit/jd-mapping-contract.test.ts`
- Test: `tests/unit/jd-evidence-layered-corpus.test.ts`
- Test: `tests/unit/chat-completion-provider.test.ts`

**Interfaces:**
- Produces: `JdAssemblyFailureCode = "candidate_schema" | "requirement_coverage" | "unknown_requirement_id" | "unknown_material_id" | "unknown_conflict_id" | "unsupported_relation" | "ungrounded_candidate"`.
- Produces: `JdAssemblyResult = { ok: true; output: RouteOutput } | { ok: false; code: JdAssemblyFailureCode; schemaPaths?: string[] }`.
- Changes: `JdMappingCandidate` becomes `{ routeKey: "jd_to_revision"; decisions: JdMappingDecision[] }` and has no `selectedRequirementIds`.
- Consumes: the server-built signed requirement/material catalog and its source hashes, field paths, exact quotes, and optional spans.

- [ ] **Step 1: Write RED tests for every formerly throwing path**

  Add deterministic tests that call `assembleJdRouteOutput()` with: an unknown requirement ID, incomplete/duplicate coverage, unknown evidence ID, unknown conflict ID, direct/partial with no valid source relation, and a candidate containing a fact absent from cited sources. Each test must assert `{ ok: false, code: ... }` and must not use `.rejects` or catch a plain `Error`.

- [ ] **Step 2: Add RED corpus cases without production-specific phrases**

  Add synthetic short, long, bilingual, repeated, noisy, and injection-laced inputs covering 1×1, 1×many, many×1, and many×many relationships plus partial, unsupported, conflict, and all-keep outcomes. Assert unknown/ungrounded cases fail typed and valid cases still produce source-verifiable actions.

- [ ] **Step 3: Run the assembler RED suite**

  Run: `npm test -- tests/unit/jd-mapping-contract.test.ts tests/unit/jd-evidence-layered-corpus.test.ts tests/unit/chat-completion-provider.test.ts`

  Expected: FAIL because assembly throws and the schema/prompt still requires `selectedRequirementIds`.

- [ ] **Step 4: Replace parser throws with a total result**

  Use `jdMappingCandidateSchema.safeParse(rawCandidate)`. Derive required coverage from `catalog.requirements.map(sourceId)` and compare it directly with the unique decision requirement IDs. Resolve every source through verified catalog maps; return the exact failure code before building any route output. Treat an unsupported declared relation or ungrounded change candidate as typed semantic failure, not as a successful `collect_evidence` downgrade.

- [ ] **Step 5: Minimize the provider prompt**

  Remove `selectedRequirementIds` from the narrow contract and example. Send the server-issued 3–5 requirement entries and limited material entries once, with only source metadata, exact quotes, decision union rules, and one short legal example. Keep `response_format: { type: "json_object" }`; do not add vendor-specific schema APIs.

- [ ] **Step 6: Adapt the orchestrator to the result**

  Change the JD repair/assembly boundary to return `JdAssemblyResult`. Map all `ok: false` results to a semantic `AttemptFailure` with stage `candidate_schema` or `grounding`, so no expected candidate defect can escape as an ordinary exception.

- [ ] **Step 7: Run focused tests and typecheck**

  Run: `npm test -- tests/unit/jd-mapping-contract.test.ts tests/unit/jd-evidence-layered-corpus.test.ts tests/unit/chat-completion-provider.test.ts tests/unit/orchestrator.test.ts`

  Run: `npx tsc --noEmit --incremental false`

  Expected: PASS; `Select-String -Path src/domain/jd-route-assembler.ts -Pattern 'throw new Error|\.parse\('` returns no production assembly throw/parse path.

- [ ] **Step 8: Commit the total JD contract**

  ```powershell
  git add src/schemas/jd-mapping-candidate.ts src/domain/jd-route-assembler.ts src/ai/chat-completion-provider.ts src/ai/orchestrator.ts tests/fixtures/jd-evidence-contract-cases.ts tests/fixtures/jd-evidence-contract-layered-cases.ts tests/unit/jd-mapping-contract.test.ts tests/unit/jd-evidence-layered-corpus.test.ts tests/unit/chat-completion-provider.test.ts tests/unit/orchestrator.test.ts
  git commit -m "fix: make jd assembly total and minimal"
  ```

### Task 3: Add Budget-Aware Retry and a Reserved Fallback Window

**Files:**
- Create: `src/ai/orchestration-budget.ts`
- Modify: `src/ai/chat-completion-provider.ts`
- Modify: `src/ai/orchestrator.ts`
- Test: `tests/unit/orchestrator.test.ts`
- Test: `tests/unit/processing-failure.test.ts`
- Test: `tests/unit/chat-completion-provider.test.ts`

**Interfaces:**
- Produces: `OrchestrationBudget` with `deadlineAtMs`, `remainingMs()`, `providerDeadlineAtMs(role, attempt)`, `canRetryPrimary(failureClass, hasFallback)`, and `canStartFallback()`.
- Fixed constants: 28,000 ms total default, 1,000 ms response/assembly reserve, 5,000 ms fallback minimum window, and 3,000 ms retry minimum window.
- Consumes: a caller deadline shorter than 28,000 ms without extending it.

- [ ] **Step 1: Write RED tests with a controlled clock**

  Add tests for: primary `empty_content` twice then valid fallback returns `route_result`; a slow first primary leaves less than retry+fallback reserve so the second primary is skipped and fallback starts; no fallback means at most one budget-permitted retry; deadline abort during primary, repair, fallback, or assembly returns `deadline`; caller cancellation returns `cancelled`; and no attempt starts after its provider deadline.

- [ ] **Step 2: Run the budget RED suite**

  Run: `npm test -- tests/unit/orchestrator.test.ts tests/unit/processing-failure.test.ts tests/unit/chat-completion-provider.test.ts`

  Expected: FAIL because the current loop always starts the second primary and gives every provider its independent 12-second cap.

- [ ] **Step 3: Implement pure budget admission**

  Build `createOrchestrationBudget({ deadlineAtMs, now })`. For a machine failure with fallback, permit primary retry only when `remainingMs >= 3_000 + 5_000 + 1_000`. For semantic failure, permit one directed repair when `remainingMs >= 3_000 + 1_000`; fallback reserve is irrelevant because fallback is forbidden. Start fallback only when `remainingMs >= 5_000 + 1_000`. Clamp each provider `deadlineAtMs` to leave the required downstream reserve.

- [ ] **Step 4: Replace the generic for-loop with class-specific transitions**

  Keep primary attempt one. On machine failure, select exactly one of `retry_primary`, `primary_retry_skipped_budget`, `try_fallback`, or `stop`. On semantic failure, select exactly one of `retry_primary` or `stop` and set `allowFallback: false`. Remove `allowLegacyThirdAttempt`; no branch may exceed two primary calls plus one fallback call.

- [ ] **Step 5: Run focused tests and typecheck**

  Run: `npm test -- tests/unit/orchestrator.test.ts tests/unit/processing-failure.test.ts tests/unit/chat-completion-provider.test.ts`

  Run: `npx tsc --noEmit --incremental false`

  Expected: PASS; slow-primary tests prove fallback receives at least its reserved window without real timers longer than 250 ms.

- [ ] **Step 6: Commit budget-aware orchestration**

  ```powershell
  git add src/ai/orchestration-budget.ts src/ai/chat-completion-provider.ts src/ai/orchestrator.ts tests/unit/orchestrator.test.ts tests/unit/processing-failure.test.ts tests/unit/chat-completion-provider.test.ts
  git commit -m "fix: reserve ai fallback budget"
  ```

### Task 4: Emit Fallback Lifecycle and Exactly One Terminal Event

**Files:**
- Modify: `src/ai/failure-diagnostics.ts`
- Modify: `src/ai/orchestrator.ts`
- Modify: `src/app/api/ai/route.ts`
- Test: `tests/unit/processing-failure.test.ts`
- Test: `tests/unit/api-ai-route.test.ts`

**Interfaces:**
- Produces fallback codes: `fallback_started`, `fallback_succeeded`, `fallback_failed`, `fallback_skipped_budget`, and `fallback_skipped_policy`.
- Produces terminal categories: `success`, `business_missing_info`, `machine_unavailable`, `semantic_invalid`, `deadline`, `cancelled`, and `unexpected_internal`.
- Produces exactly one event with `stage: "terminal"` and a `terminalCategory` per request.

- [ ] **Step 1: Write RED lifecycle tests**

  For four isolated requests, capture safe events and prove fallback `started/succeeded`, `started/failed`, `skipped_budget`, and `skipped_policy`. Add success, missing-info, semantic-failure, exhausted-machine, deadline, cancellation, and unexpected-internal cases; each event list must contain exactly one terminal event.

- [ ] **Step 2: Run the diagnostic RED suite**

  Run: `npm test -- tests/unit/processing-failure.test.ts tests/unit/api-ai-route.test.ts`

  Expected: FAIL because current diagnostics report attempt failures only and do not carry remaining budget or terminal state.

- [ ] **Step 3: Implement non-blocking lifecycle reporting**

  Centralize `reportSafeEvent()` so reporter throw/reject/hang never changes orchestration. Emit fallback start before calling it and success/failure immediately after validation. Emit skipped state whenever a configured fallback is not called due to policy, budget, cancellation, or deadline. Terminal emission is guarded by a request-local boolean and happens once on every normal return or typed throw.

- [ ] **Step 4: Add safe provider response observations**

  In `readEnvelopeContent()`, calculate choice-count, content shape, trimmed UTF-8 length bucket, and allowlisted finish reason without storing or reporting content. Attach those observations only to typed provider errors and propagate them into safe events.

- [ ] **Step 5: Run focused tests**

  Run: `npm test -- tests/unit/processing-failure.test.ts tests/unit/api-ai-route.test.ts tests/unit/chat-completion-provider.test.ts`

  Expected: PASS; serialized diagnostics contain no synthetic secret strings, full input, prompt, raw model content, header, URL query, or stack.

- [ ] **Step 6: Commit lifecycle observability**

  ```powershell
  git add src/ai/failure-diagnostics.ts src/ai/orchestrator.ts src/ai/chat-completion-provider.ts src/app/api/ai/route.ts tests/unit/processing-failure.test.ts tests/unit/api-ai-route.test.ts tests/unit/chat-completion-provider.test.ts
  git commit -m "feat: report safe ai fallback lifecycle"
  ```

### Task 5: Map Typed Failures to Safe HTTP Status and User Copy

**Files:**
- Modify: `src/ai/processing-failure.ts`
- Modify: `src/ai/orchestrator.ts`
- Modify: `src/app/api/ai/route.ts`
- Test: `tests/unit/api-failure-contract.test.ts`
- Test: `tests/unit/api-ai-route.test.ts`
- Test: `tests/unit/input-page.test.tsx`

**Interfaces:**
- Produces machine copy: `服务暂时没有返回结果。你的草稿已保存，请稍后再试。`
- Produces semantic copy: `这次没有生成足够可靠的建议。你的草稿已保存，可以稍后再试。`
- Keeps missing-info output route-specific and does not route it through the error response.

- [ ] **Step 1: Write RED status/copy matrix tests**

  Assert primary/fallback `empty_content` exhaustion returns 503 and machine copy; provider JSON/envelope/transport exhaustion returns 503; semantic/safety/product failures return 502 with semantic copy; deadline returns 504; cancellation returns 499; and one deliberately thrown unexpected `Error` returns 500. Assert all expected typed cases return zero HTTP 500 responses.

- [ ] **Step 2: Run the HTTP RED suite**

  Run: `npm test -- tests/unit/api-failure-contract.test.ts tests/unit/api-ai-route.test.ts tests/unit/input-page.test.tsx`

  Expected: FAIL because `provider_content` maps to `invalid_output` and all typed failures share one generic message.

- [ ] **Step 3: Implement terminal mapping**

  Add a machine-unavailable processing category or a lossless terminal-class field and map it to 503. Keep invalid semantic output at 502 and unknown exceptions at 500. Select copy from the typed class only; retain `requestId`, `retryable`, safe `Retry-After`, and response metadata headers.

- [ ] **Step 4: Run focused tests**

  Run: `npm test -- tests/unit/api-failure-contract.test.ts tests/unit/api-ai-route.test.ts tests/unit/input-page.test.tsx tests/unit/processing-failure.test.ts`

  Expected: PASS; no user body contains `DeepSeek`, `Qwen`, `fallback`, `provider`, `schema`, `prompt`, `stage`, `code`, or `quality gate`.

- [ ] **Step 5: Commit HTTP failure semantics**

  ```powershell
  git add src/ai/processing-failure.ts src/ai/orchestrator.ts src/app/api/ai/route.ts tests/unit/api-failure-contract.test.ts tests/unit/api-ai-route.test.ts tests/unit/input-page.test.tsx
  git commit -m "fix: map typed ai failures to safe responses"
  ```

### Task 6: Prove Failure State Preservation and Cross-Route Regression

**Files:**
- Modify: `tests/unit/input-page.test.tsx`
- Modify: `tests/unit/action-page.test.tsx`
- Modify: `tests/unit/local-store.test.ts`
- Modify: `tests/unit/review-page.test.tsx`
- Modify: `tests/unit/orchestrator.test.ts`
- Modify: `tests/e2e/private-beta-readiness.spec.ts`

**Interfaces:**
- Consumes: existing local draft/action/record/review/journey stores and current retry UI.
- Produces: regression evidence that a failed request does not mutate or duplicate any of those stores.

- [ ] **Step 1: Add RED state-preservation tests**

  Seed a prior confirmed action, record, review, journey entry, and a newer draft. Trigger machine, semantic, deadline, and cancellation failures. Assert the draft text and revision remain, prior entities are byte-for-byte unchanged, and counts do not increase. Repeat the retry and assert no duplicate request-state record is created.

- [ ] **Step 2: Add four-route and non-AI regression cases**

  Cover normal and missing-info flows for `direction_to_jobs`, `experience_to_resume`, `jd_to_revision`, and `applications_to_review`; action confirmation/save failure; light review; seven-day review; mobile viewport; keyboard focus; touch targets; and axe accessibility checks.

- [ ] **Step 3: Run the regression RED suite**

  Run: `npm test -- tests/unit/input-page.test.tsx tests/unit/action-page.test.tsx tests/unit/local-store.test.ts tests/unit/review-page.test.tsx tests/unit/orchestrator.test.ts`

  Expected: any failure identifies a concrete preservation or copy gap; no production provider is constructed.

- [ ] **Step 4: Apply only minimal state/copy fixes required by RED tests**

  Keep existing store keys and version semantics. Failure handling may update transient request UI state only; it must not call action, record, review, or journey creation functions.

- [ ] **Step 5: Run the regression suite again**

  Run: `npm test -- tests/unit/input-page.test.tsx tests/unit/action-page.test.tsx tests/unit/local-store.test.ts tests/unit/review-page.test.tsx tests/unit/orchestrator.test.ts`

  Expected: PASS.

- [ ] **Step 6: Commit preservation coverage**

  ```powershell
  git add src tests/unit tests/e2e/private-beta-readiness.spec.ts
  git commit -m "test: preserve mvp state across ai failures"
  ```

### Task 7: Governance Matrix and Fresh Offline Verification

**Files:**
- Create: `docs/superpowers/plans/2026-08-06-ai-empty-content-typed-failure-budget-fallback-p0-governance-matrix.md`
- Verify: all tracked source, tests, product contracts, and lockfile

**Interfaces:**
- Produces: a rule-to-code-to-test-to-evidence matrix with `PASS`, `PARTIAL`, or `BLOCKED` and no claim based on an unrun real provider canary.

- [ ] **Step 1: Write the governance matrix**

  Map the 16 product documents' affected clauses to: typed missing/machine/semantic states; 30-second user limit; one action; evidence grounding; safety; copy; local-state preservation; review/journey preservation; mobile/a11y; deterministic verification; and the no-paid-call boundary. Mark real-provider behavior `PARTIAL` until separately authorized canary evidence exists.

- [ ] **Step 2: Run focused and full unit validation**

  ```powershell
  npm test -- tests/unit/processing-failure.test.ts tests/unit/chat-completion-provider.test.ts tests/unit/jd-mapping-contract.test.ts tests/unit/jd-evidence-layered-corpus.test.ts tests/unit/orchestrator.test.ts tests/unit/api-failure-contract.test.ts tests/unit/api-ai-route.test.ts tests/unit/input-page.test.tsx tests/unit/action-page.test.tsx tests/unit/local-store.test.ts tests/unit/review-page.test.tsx
  npm test
  ```

  Expected: every non-skipped test passes; any intentional skip is listed in the matrix with its reason.

- [ ] **Step 3: Run static and dependency gates**

  ```powershell
  npm run lint
  npx tsc --noEmit --incremental false
  npm run build
  npm audit --audit-level=high
  git diff --check
  git status --short
  ```

  Expected: all commands exit 0; `npm audit` reports zero high or critical vulnerabilities; status contains only intended plan, source, test, and evidence changes.

- [ ] **Step 4: Commit governance and final offline fixes**

  ```powershell
  git add docs/superpowers/plans/2026-08-06-ai-empty-content-typed-failure-budget-fallback-p0.md docs/superpowers/plans/2026-08-06-ai-empty-content-typed-failure-budget-fallback-p0-governance-matrix.md src tests package-lock.json
  git commit -m "docs: record typed fallback governance evidence"
  ```

### Task 8: Production Build E2E in a Fresh Evidence Directory

**Files:**
- Generate only: a newly reserved child of `qa/private-beta-production/` whose basename starts with `20260806-ai-empty-content-typed-fallback-p0--`; `scripts/run-production-e2e.mjs` appends the exact 12-character HEAD and implementation hash and records both in `manifest.json`.
- Verify: `scripts/run-production-e2e.mjs`
- Verify: `playwright.production.config.ts`
- Verify: `tests/e2e/private-beta-readiness.spec.ts`

**Interfaces:**
- Consumes: deterministic production mock identity reserved by the evidence runner.
- Produces: immutable manifest, command logs, browser screenshots, Playwright report, and implementation hash under a newly reserved directory.

- [ ] **Step 1: Confirm no evidence directory collision**

  Run: `Get-ChildItem -LiteralPath qa/private-beta-production -Directory | Where-Object Name -Like '20260806-ai-empty-content-typed-fallback-p0*'`

  Expected: no existing directory. If one exists, use the exact new run ID `20260806-ai-empty-content-typed-fallback-p0-r2`; never overwrite or delete prior evidence.

- [ ] **Step 2: Run production build plus Next start plus Playwright**

  ```powershell
  $env:E2E_RUN_ID='20260806-ai-empty-content-typed-fallback-p0'
  npm run test:e2e:production
  Remove-Item Env:E2E_RUN_ID
  ```

  Expected: runner builds production, starts Next on its configured loopback port, runs Playwright with the reserved deterministic mock, shuts down cleanly, and prints the unique evidence directory.

- [ ] **Step 3: Inspect fresh browser evidence**

  Read the new `manifest.json`, `summary.md`, command logs, and HTML report. Inspect screenshots for failure draft preservation, no stale/duplicate action, four routes, light review, seven-day review, 390×844 mobile layout, keyboard focus, touch targets, and axe results.

- [ ] **Step 4: Record exact evidence path and rerun final diff checks**

  Add the generated directory's exact basename and implementation hash to the governance matrix. Run `git diff --check`, `git status --short`, and `git log -8 --oneline --decorate`.

- [ ] **Step 5: Commit immutable E2E evidence**

  ```powershell
  git add qa/private-beta-production docs/superpowers/plans/2026-08-06-ai-empty-content-typed-failure-budget-fallback-p0-governance-matrix.md
  git commit -m "test: record typed fallback production smoke"
  ```

### Task 9: Review, Publish, Tag, Deploy, and Read-Only Verify

**Files:**
- Review: all commits from `3b7317fc2fd928fb782f01d4169580a0e0f35c37..HEAD`
- No new real-provider evidence unless the owner separately authorizes a paid canary.

**Interfaces:**
- Produces remote branch `codex/ai-empty-content-typed-failure-budget-fallback-p0`.
- Produces annotated tag `ai-empty-content-typed-fallback-p0-20260806` on the final verified commit.
- Produces a deployment whose source commit equals the tagged commit.

- [ ] **Step 1: Perform a fresh code and governance review**

  Inspect `git diff --stat 3b7317f..HEAD`, `git diff 3b7317f..HEAD`, every new diagnostic field, all ordinary-error boundaries, all retry/fallback transitions, state-write call sites, and the governance matrix. Reject unrelated refactors or any raw content logging.

- [ ] **Step 2: Repeat completion verification on final HEAD**

  Run: `npm test`, `npm run lint`, `npx tsc --noEmit --incremental false`, `npm run build`, `npm audit --audit-level=high`, and `git diff --check` after the last code/test change.

  Expected: all gates pass on the exact commit to publish.

- [ ] **Step 3: Push the verified branch**

  ```powershell
  git push -u origin codex/ai-empty-content-typed-failure-budget-fallback-p0
  ```

- [ ] **Step 4: Create and push the annotated evidence tag**

  ```powershell
  git tag -a ai-empty-content-typed-fallback-p0-20260806 -m "AI empty content typed fallback P0 verified"
  git push origin ai-empty-content-typed-fallback-p0-20260806
  git rev-parse HEAD
  git rev-parse ai-empty-content-typed-fallback-p0-20260806^{}
  ```

  Expected: both hashes are identical.

- [ ] **Step 5: Deploy the exact tagged commit through the repository's existing Vercel path**

  Use the already configured project/deployment mechanism; do not introduce a new hosting target or change production environment variables. Confirm deployment metadata reports the exact tagged SHA before treating deployment as complete.

- [ ] **Step 6: Perform read-only production verification**

  Verify `https://beta.jobmapai.cn` loads, static assets and primary routes return successful statuses, and deployment metadata/logs identify the tagged commit. Do not submit a real DeepSeek/Qwen request. Record that technical deployment is verified but real-provider recovery and JD user value remain `PARTIAL` pending separately authorized canary evidence.

- [ ] **Step 7: Final handoff**

  Report: root cause; exact typed state transitions; tests and counts; fresh E2E evidence path; commit/branch/tag/deployment identifiers; read-only production result; zero new paid calls; and the explicit distinction between technical deployment success and the still-unproven real-AI/JD user-value gate.
