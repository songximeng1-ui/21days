# AI Quality Gate Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Block the P0/P1 failures found in the 2026-07-23 DeepSeek/Qwen QA gate without expanding product scope.

**Architecture:** Keep the fix at the generation boundary. Remove the generic action example that Qwen copied, then add deterministic post-generation guards for internal field leaks, generic action cards, and ungrounded resume revision instructions.

**Tech Stack:** TypeScript, Vitest, Next.js app code under `src/`.

## Global Constraints

- Do not commit, push, deploy, or create a new worktree.
- Do not print API keys or environment values.
- Keep edits limited to AI output quality gates and their tests.
- Preserve the current MVP scope: one small action, grounded in user-provided material, no fabrication, no internal implementation terms.

---

### Task 1: Add Regression Tests For Output Guardrails

**Files:**
- Modify: `tests/unit/orchestrator.test.ts`
- Modify: `tests/unit/chat-completion-provider.test.ts`

**Interfaces:**
- Consumes: `generateRouteOutput`, `ChatCompletionProvider`
- Produces: failing coverage for generic action cards, internal field leaks, and prompt example wording

- [ ] Add a test that rejects a provider output whose `todayAction` copies the generic "打开对应材料 / 完成一个小修改 / 保存记录" template.
- [ ] Add a test that rejects user-visible output containing internal terms such as `recordGuide`.
- [ ] Add a test that rejects JD revision output that suggests adding or front-loading material not present in `userMaterial`.
- [ ] Add a test proving the chat-completion prompt no longer includes the generic action example.
- [ ] Run the targeted tests and confirm they fail before production edits.

### Task 2: Implement Minimal Guardrails

**Files:**
- Modify: `src/ai/orchestrator.ts`
- Modify: `src/ai/chat-completion-provider.ts`

**Interfaces:**
- Consumes: validated `RouteOutput`
- Produces: `grounding_failure` or `safety_boundary` friendly failure when model output is unsafe or too generic

- [ ] Remove the fixed generic action wording from the prompt example and replace it with route-specific anchored placeholders.
- [ ] Add deterministic detection for generic action cards in `todayAction` and `routeResult.nextAction`.
- [ ] Add deterministic detection for internal implementation terms in user-visible output.
- [ ] Add JD/application grounding checks for unsupported resume modification verbs.
- [ ] Run the targeted tests and confirm they pass.

### Task 3: Verify Candidate Gate

**Files:**
- No production file changes unless a test exposes a directly related miss.

**Interfaces:**
- Consumes: updated implementation and tests
- Produces: verification evidence for the user

- [ ] Run `npm.cmd test`.
- [ ] Run `npm.cmd run lint`.
- [ ] Run `git diff --check`.
- [ ] Run `git status --short --branch`.
- [ ] Report changed files, verification output, and remaining NO-GO status.
