# Health Assessment Funnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a deployed, tested health-assessment funnel with resumable anonymous sessions, protected premium results, and an idempotent mock payment flow.

**Architecture:** Build a Next.js App Router monolith with thin route handlers, Zod contracts, pure domain functions, transactional services, and Prisma/PostgreSQL persistence. Protect anonymous sessions with an HttpOnly recovery cookie and enforce premium access by constructing separate server-side DTOs.

**Tech Stack:** Next.js, React, TypeScript, Prisma, PostgreSQL, Zod, Vitest, Playwright, GitHub Actions, Vercel, Mermaid.

**Spec:** `docs/superpowers/specs/2026-09-04-health-assessment-design.md`

## Global Constraints

- Use Node.js 22 and npm; commit `package-lock.json`.
- Keep route handlers limited to HTTP parsing, service invocation, and response mapping.
- Validate every external value with strict Zod objects and reject unknown fields.
- Use a dedicated PostgreSQL test database; never run reset commands against the development or production URL.
- Treat all health output as educational estimates, not medical advice.
- Do not expose premium properties in preview JSON, including as `null`.
- Complete each task with its focused tests passing before committing.

---

## Planned File Map

```text
src/app/api/sessions/route.ts                         create session
src/app/api/sessions/[id]/route.ts                    restore session
src/app/api/sessions/[id]/steps/[step]/route.ts       save a step
src/app/api/sessions/[id]/submit/route.ts             finish assessment
src/app/api/sessions/[id]/result/route.ts             gated result
src/app/api/payments/mock/route.ts                    mock callback
src/app/quiz/[sessionId]/page.tsx                     resumable funnel
src/app/result/[sessionId]/page.tsx                   preview/premium UI
src/features/assessment/contracts.ts                  Zod request contracts
src/features/assessment/calculator.ts                 pure calculation
src/features/assessment/result-policy.ts              response DTO allowlists
src/features/assessment/session-service.ts            persistence workflow
src/features/payment/payment-service.ts               idempotent activation
src/lib/api-response.ts                               response envelope/errors
src/lib/prisma.ts                                     database client
prisma/schema.prisma                                  relational schema
tests/unit/                                           domain tests
tests/integration/                                    DB/service/API tests
tests/e2e/assessment.spec.ts                          browser journey
```

## Task 1: Project foundation and executable quality gate

**Files:** Create `package.json`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`, `.env.example`, `.gitignore`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `tests/unit/smoke.test.ts`, `.github/workflows/ci.yml`.

**Interfaces:** Produces `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, and `npm run build`.

- [ ] Initialize a Node 22 Next.js TypeScript project with pinned production and test dependencies.
- [ ] Write a smoke test that imports a small exported `APP_NAME` constant and initially fails because the module does not exist.
- [ ] Run `npm test -- tests/unit/smoke.test.ts` and confirm the missing-module failure.
- [ ] Add `src/lib/app-config.ts` exporting `APP_NAME = "Health Path"`; rerun the focused test.
- [ ] Add lint, typecheck, test, build, and CI commands; run all local non-browser checks.
- [ ] Commit as `chore: initialize health assessment application`.

## Task 2: Relational schema and test database harness

**Files:** Create `prisma/schema.prisma`, `prisma/seed.ts`, `src/lib/prisma.ts`, `tests/helpers/database.ts`, `tests/integration/schema.test.ts`; modify `.env.example`, `package.json`.

**Interfaces:** Produces Prisma models `AssessmentSession`, `AssessmentAnswer`, `AssessmentResult`, `Subscription`, and `PaymentEvent`; exports `prisma` and `resetTestDatabase()`.

- [ ] Write integration assertions for default `DRAFT`/`INACTIVE` state, the unique `(sessionId, step)` constraint, and unique `PaymentEvent.eventId`.
- [ ] Run the focused schema test against `TEST_DATABASE_URL` and confirm failure before models exist.
- [ ] Implement enums, relations, unique constraints, indexes, timestamps, version field, and migration.
- [ ] Add a guard in `resetTestDatabase()` that refuses URLs without an explicit test-database marker.
- [ ] Run migration and schema tests; inspect generated SQL for foreign keys and unique indexes.
- [ ] Commit as `feat: add assessment persistence schema`.

## Task 3: Validation contracts and health calculation

**Files:** Create `src/features/assessment/types.ts`, `contracts.ts`, `calculator.ts`, `tests/unit/contracts.test.ts`, `tests/unit/calculator.test.ts`.

**Interfaces:** Produces `StepName`, `AssessmentInput`, `AssessmentCalculation`, `parseStepPayload(step, value)`, and `calculateAssessment(input, today)`.

- [ ] Write table-driven validation tests for valid inputs plus missing, string, zero, negative, non-finite, over-range, unknown-field, and implausible-target inputs.
- [ ] Write deterministic formula tests for BMI, category, BMR/TDEE, calorie recommendation, maintain-weight behavior, and target date using a fixed date.
- [ ] Run focused tests and confirm missing-export failures.
- [ ] Implement strict step-specific Zod schemas with age 18-80, height 120-230 cm, weight/target 35-300 kg, and target-change limit of 40%.
- [ ] Implement the pure calculator with named constants, explicit rounding, activity multipliers, and bounded calorie adjustment.
- [ ] Run unit tests, mutation-check representative boundary values manually, then commit as `feat: implement validated health assessment calculation`.

## Task 4: Session creation, secure recovery, and consistent API errors

**Files:** Create `src/lib/api-response.ts`, `src/lib/session-token.ts`, `src/features/assessment/session-service.ts`, `src/app/api/sessions/route.ts`, `tests/unit/session-token.test.ts`, `tests/integration/session-create.test.ts`.

**Interfaces:** Produces `createSession()`, `hashSessionToken(token)`, `requireSessionAccess(request, sessionId)`, `ok(data, status?)`, and `fail(error)`.

- [ ] Write tests proving tokens are random, only token hashes persist, cookies are HttpOnly/SameSite=Lax/Secure in production, and API errors use the documented envelope.
- [ ] Run focused tests and confirm failures.
- [ ] Implement token generation with `crypto.randomBytes`, SHA-256 hashing, request IDs, typed application errors, and `POST /api/sessions`.
- [ ] Verify the route returns `201`, public session metadata, and no secret/hash in JSON.
- [ ] Run unit and integration tests; commit as `feat: create secure anonymous assessment sessions`.

## Task 5: Idempotent step saving and progress recovery

**Files:** Create `src/features/assessment/progress.ts`, `src/app/api/sessions/[id]/route.ts`, `src/app/api/sessions/[id]/steps/[step]/route.ts`, `tests/unit/progress.test.ts`, `tests/integration/session-progress.test.ts`.

**Interfaces:** Produces `deriveProgress(completedSteps)`, `saveStep({sessionId, step, payload, expectedVersion})`, and `getSessionProgress(sessionId)`.

- [ ] Write progress tests for no answers, contiguous answers, gaps, out-of-order answers, and all steps complete.
- [ ] Write integration tests for interruption recovery, same-step upsert, historical edits, invalid payload rollback, out-of-order progress, and two updates sharing one expected version.
- [ ] Run focused tests and confirm failures.
- [ ] Implement transactional upsert and atomic optimistic-version update; map stale updates to `409 VERSION_CONFLICT`.
- [ ] Implement authenticated restore output using an explicit answer DTO.
- [ ] Run tests repeatedly to detect concurrency flakiness; commit as `feat: support resumable versioned assessment progress`.

## Task 6: Submission and immutable result persistence

**Files:** Modify `src/features/assessment/session-service.ts`; create `src/app/api/sessions/[id]/submit/route.ts`, `tests/integration/assessment-submit.test.ts`.

**Interfaces:** Produces `submitAssessment({sessionId, today})` returning a stored `AssessmentResult` with `algorithmVersion: "1.0.0"`.

- [ ] Write tests for complete submission, missing-step rejection, calculated-value persistence, transaction rollback, duplicate submit behavior, and completed-session immutability.
- [ ] Run the focused test and confirm missing behavior.
- [ ] Implement one transaction that loads answers, revalidates assembled input, calculates, creates the result, and marks the session completed.
- [ ] Make duplicate submission return the existing result rather than recalculating with a later date.
- [ ] Run unit and integration suites; commit as `feat: finalize assessments with persisted results`.

## Task 7: Preview and premium access policy

**Files:** Create `src/features/assessment/result-policy.ts`, `src/app/api/sessions/[id]/result/route.ts`, `tests/unit/result-policy.test.ts`, `tests/integration/result-access.test.ts`.

**Interfaces:** Produces `buildPreviewResult(result)`, `buildPremiumResult(result)`, and `getAuthorizedResult(sessionId, now)`.

- [ ] Define a protected-key list and tests that recursively prove every key is absent from preview JSON.
- [ ] Write integration tests for inactive, active, expired, missing-result, and forged-query-parameter cases.
- [ ] Run tests and confirm failures.
- [ ] Implement separate DTO builders using explicit allowlists; choose access from server-read subscription state only.
- [ ] Run focused and complete test suites; commit as `feat: enforce subscription result access`.

## Task 8: Authenticated, idempotent mock payment callback

**Files:** Create `src/features/payment/contracts.ts`, `payment-service.ts`, `src/app/api/payments/mock/route.ts`, `tests/integration/mock-payment.test.ts`, `tests/e2e/payment-flow.api.test.ts`; modify `.env.example`.

**Interfaces:** Produces `activateMockSubscription({eventId, sessionId, status})` and authenticated `POST /api/payments/mock`.

- [ ] Write tests for a valid callback, invalid bearer secret, missing session, incomplete assessment, duplicate event replay, conflicting event reuse, and transaction rollback.
- [ ] Write an API journey asserting protected fields are absent before payment and present afterward.
- [ ] Run tests and confirm failures.
- [ ] Implement strict callback validation, constant-time secret comparison, unique event insertion, and subscription activation in one transaction.
- [ ] Verify a replay returns the original successful outcome without duplicate rows.
- [ ] Run integration and API journey suites; commit as `feat: add idempotent mock payment activation`.

## Task 9: Mobile-first resumable funnel UI

**Files:** Create `src/app/quiz/[sessionId]/page.tsx`, `src/features/assessment/quiz-client.tsx`, `src/features/assessment/quiz-copy.ts`, `src/components/progress-bar.tsx`, `src/components/option-card.tsx`; modify `src/app/page.tsx`, `src/app/globals.css`; create component tests under `tests/unit/ui/`.

**Interfaces:** Consumes session and step APIs; produces an accessible four-step browser flow.

- [ ] Write component tests for progress rendering, keyboard-selectable cards, validation messages, save-state feedback, and restored answers.
- [ ] Run component tests and confirm missing components.
- [ ] Implement mobile-first design tokens, start-session CTA, one-question-per-screen flow, optimistic UI with conflict recovery, and accessible focus/error states.
- [ ] Verify refresh returns to server-derived progress and no medical claims appear.
- [ ] Run component tests and production build; commit as `feat: build resumable assessment funnel`.

## Task 10: Result, upgrade, and mock purchase experience

**Files:** Create `src/app/result/[sessionId]/page.tsx`, `src/features/assessment/result-client.tsx`, `src/components/result-preview.tsx`, `src/components/upgrade-dialog.tsx`, `src/components/premium-result.tsx`, tests under `tests/unit/ui/`.

**Interfaces:** Consumes result and payment APIs; produces preview, mock upgrade, and premium states.

- [ ] Write UI tests that preview omits protected detail, the dialog labels payment as simulated, failed callbacks remain recoverable, and successful activation refreshes server data.
- [ ] Run tests and confirm missing components.
- [ ] Implement a valuable preview, transparent lock labels, educational disclaimer, mock purchase action, success state, and premium detail view.
- [ ] Confirm protected information is not present in initial HTML or serialized client props for unpaid sessions.
- [ ] Run UI tests and build; commit as `feat: add gated assessment results experience`.

## Task 11: Browser E2E and CI hardening

**Files:** Create `playwright.config.ts`, `tests/e2e/assessment.spec.ts`, `tests/e2e/recovery.spec.ts`; modify `.github/workflows/ci.yml`, `package.json`.

**Interfaces:** Produces repeatable browser coverage and CI artifacts on failure.

- [ ] Write one complete journey: start, fill, submit, verify preview, mock pay, verify premium.
- [ ] Write a recovery journey that refreshes mid-flow and a validation journey that cannot advance with bad data.
- [ ] Run E2E tests and confirm failures before selectors/fixtures are finalized.
- [ ] Add stable accessible selectors, isolated seeded sessions, screenshots/traces on failure, and CI PostgreSQL service configuration.
- [ ] Run lint, typecheck, all tests, E2E, and build from a clean environment.
- [ ] Commit as `test: cover assessment funnel end to end`.

## Task 12: Documentation, production seed, and submission package

**Files:** Create `README.md`, `docs/api.md`, `docs/schema.md`, `docs/ai-retrospective.md`, `scripts/create-demo-sessions.ts`; modify `package.json`, `.env.example`.

**Interfaces:** Produces `npm run demo:seed`, two test session IDs, Mermaid ERD, payment cURL, API examples, and submission checklist.

- [ ] Write README acceptance checks first as a reviewer checklist covering every requested deliverable.
- [ ] Document setup, environment variables, migrations, one-command tests, API requests/responses, error codes, protected fields, test coverage rationale, omissions, and deployment steps.
- [ ] Add Mermaid ERD for all five tables and explain JSONB/optimistic-lock/idempotency decisions.
- [ ] Add a deterministic production-safe seed command that creates one unpaid and one paid completed session without printing secrets.
- [ ] Write the AI retrospective, including one rejected AI suggestion: trusting a client-side `isPaid` flag was rejected because authorization must be derived from server state.
- [ ] Deploy to Vercel and managed PostgreSQL, apply migrations, configure secrets, create demo sessions, and execute the README cURL against production.
- [ ] Run the entire reviewer journey in a fresh browser and record the live URL, CI badge, commit SHA, unpaid session ID, and paid session ID in README.
- [ ] Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, and `npm run build`; commit as `docs: complete deployment and submission guide`.

## Final Acceptance Gate

- [ ] A fresh visitor can finish the deployed funnel.
- [ ] Refresh restores a draft without losing or inventing progress.
- [ ] Invalid, repeated, out-of-order, and stale concurrent writes behave as documented.
- [ ] Preview responses recursively contain none of the protected keys.
- [ ] The signed mock callback unlocks premium access and replay stays idempotent.
- [ ] Unit, integration, API, browser, type, lint, and build checks pass locally and in CI.
- [ ] README exposes every required evaluator artifact in its first section.
- [ ] Repository, live deployment, schema diagram, API documentation, test evidence, and AI retrospective are ready for email submission.

## Three-Day Execution Schedule

- **Day 1:** Tasks 1-5. Exit criterion: deployed or locally demonstrated create/save/refresh/recover flow with DB integration tests passing.
- **Day 2:** Tasks 6-10. Exit criterion: end-to-end submit → preview → mock pay → premium flow with unit/integration tests passing.
- **Day 3:** Tasks 11-12 and final gate. Exit criterion: CI green, production verified from a fresh browser, evaluator README complete, and submission email assets ready.
