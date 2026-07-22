# Task 2 Report — Route-specific prompt contracts and sanitized corrective retry context

## Status

Implemented and verified. No real model or external provider call was made.

## Implementation

- Extended internal `AiProviderInput` with optional, typed `AiRetryFeedback`.
- Replaced the shared four-route prompt bundle with an active-route prompt builder.
- Each normal route request now contains:
  - the exact active `routeKey`;
  - a complete forced `route_result` contract with non-null `routeResult` and `missingInfo: null`;
  - the route's exact `routeResult` fields;
  - the fixed action/record mapping;
  - `estimatedTime: "15-30 分钟"` and `requiresUserConfirmation: true`;
  - one fictitious active-route positive example only;
  - allow-listed active-route input and evidence sources only.
- Added explicit evidence rules requiring one strict continuous quote from one allow-listed value and prohibiting prefixes/suffixes, cross-field concatenation, and synonym rewrites.
- Kept light-review prompting route-specific so it no longer carries all four route mappings.
- Added defense-in-depth retry-feedback filtering in the chat-completion provider.
- The second primary attempt now receives only sanitized correction metadata:
  - content failures: allow-listed stage/code and sanitized schema paths when applicable;
  - provider-machine failures: `{ "code": "provider_retryable" }` only.
- Previous candidate output, provider identity, credentials, serialized full input, request body/prompt, and internal exception detail are never added to retry feedback.
- Fallback behavior and limits remain two primary attempts plus at most one fallback attempt.
- Tightened direction/experience runtime grounding sources to their route allow-lists; JD and application grounding scopes were already explicit.

## Fixed route mappings

- `direction_to_jobs`: `job_sample / job_sample`
- `experience_to_resume`: `experience_fact / experience_fact`
- `jd_to_revision`: `jd_revision / jd_compare`
- `applications_to_review`: `application_record / application`

## Tests added

- Four-route complete prompt contract assertions.
- Exactly one active-route contract and one active-route example; other route contracts/examples absent.
- Four-route evidence allow-list and quote-transformation prohibitions.
- Retry-block allow-list and sensitive-context exclusion.
- Sanitized second-primary feedback for candidate Zod, route mismatch, unexpected output type, route-result shape, action, safety, and grounding failures.
- Generic provider-machine retry code across all retryable provider failure kinds.
- Direction/experience rejection of evidence sourced from non-allow-listed input fields.

## TDD evidence

### Provider RED

Command: `npm.cmd test -- tests/unit/chat-completion-provider.test.ts`

- Exit code: `1`
- Test files: `1 failed`
- Tests: `13 failed, 14 passed` (`27` total)
- Intended failures: four route contracts, four active-only contract/example cases, four evidence allow-list cases, one retry-feedback sanitization case.

### Provider GREEN

Command: `npm.cmd test -- tests/unit/chat-completion-provider.test.ts`

- Exit code: `0`
- Test files: `1 passed`
- Tests: `27 passed`

### Orchestrator RED

Command: `npm.cmd test -- tests/unit/orchestrator.test.ts`

- Exit code: `1`
- Test files: `1 failed`
- Tests: `12 failed, 39 passed` (`51` total)
- All 12 failures showed the second primary call lacked the required sanitized feedback.

### Orchestrator GREEN

Command: `npm.cmd test -- tests/unit/orchestrator.test.ts`

- Exit code: `0`
- Test files: `1 passed`
- Tests: `51 passed`

### Grounding allow-list RED/GREEN

- RED: `2 failed, 51 passed` (`53` total); direction and experience accepted an extra `privateNotes` evidence source.
- GREEN: `53 passed`; both routes now validate evidence against explicit route fields only.

### Final targeted GREEN

Command: `npm.cmd test -- tests/unit/chat-completion-provider.test.ts tests/unit/orchestrator.test.ts`

- Exit code: `0`
- Test files: `2 passed`
- Tests: `80 passed`

### Full-suite GREEN

Command: `npm.cmd test`

- Exit code: `0`
- Test files: `15 passed`
- Tests: `162 passed`

### Focused lint

Command: `npm.cmd run lint -- src/ai/provider.ts src/ai/chat-completion-provider.ts src/ai/orchestrator.ts tests/unit/chat-completion-provider.test.ts tests/unit/orchestrator.test.ts`

- Exit code: `0`
- ESLint errors/warnings: `0`

## Changed files

- `src/ai/provider.ts`
- `src/ai/chat-completion-provider.ts`
- `src/ai/orchestrator.ts`
- `tests/unit/chat-completion-provider.test.ts`
- `tests/unit/orchestrator.test.ts`
- `.superpowers/sdd/task-2-report.md`

## Scope self-review

- Public API request and public `RouteOutput` shapes are unchanged.
- Four public `routeResult` shapes are unchanged.
- No UI, storage, schema, safety threshold, provider retry limit, or fallback limit changed.
- Grounding was only narrowed to the required route source allow-lists; normalization and quote threshold logic are unchanged.
- No logging platform, unrelated refactor, Task 3 work, `.env.local` read, credential output, or real model call occurred.
- `git diff --check` passed before the report was added; final verification is recorded below the commit step.

## Concerns

- The contracts are covered with deterministic request-capture tests, but model adherence against production model/version/temperature was intentionally not exercised because real model calls were prohibited.
- Fictitious examples are intentionally static; future route-field changes must update the contract/example tests together.
- `npx.cmd tsc --noEmit` is not clean on the repository baseline: four pre-existing errors remain in `tests/unit/action-page.test.tsx` (lines 241, 242, 493) and `tests/unit/api-ai-route.test.ts` (line 44). The initially detected Task 2 test-helper typing errors were fixed; no TypeScript error points to a Task 2-owned file.
