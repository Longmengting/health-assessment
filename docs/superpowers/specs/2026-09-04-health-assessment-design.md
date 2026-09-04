# Health Assessment Funnel Design

## Goal

Build a publicly deployable health-assessment funnel that supports anonymous progress recovery, server-side health calculations, preview-versus-premium result access, an idempotent mock payment callback, and automated proof of the critical paths.

## Scope

The deliverable is a mobile-first Next.js application with one-question-per-screen data entry, a PostgreSQL-backed API, a preview result, and a clearly labelled mock purchase flow. It does not include real accounts, real payment processing, medical diagnosis, administration screens, localization, or analytics infrastructure.

## Architecture

Use a Next.js App Router TypeScript monolith. Route handlers own HTTP concerns; Zod schemas own input validation; focused services coordinate transactions; domain modules contain pure calculation and access-policy functions; Prisma owns persistence. Production runs on Vercel with a managed PostgreSQL database.

## Domain Model

- `AssessmentSession`: anonymous assessment identity, status, current step, optimistic-lock version, timestamps.
- `AssessmentAnswer`: one validated JSON payload per session and step, protected by `UNIQUE(sessionId, step)`.
- `AssessmentResult`: immutable computed snapshot with `algorithmVersion`, public summary fields, and protected premium detail.
- `Subscription`: `INACTIVE`, `ACTIVE`, or `EXPIRED` access state for one session.
- `PaymentEvent`: unique callback event ID used to make mock payment replays idempotent.

The session token is generated with cryptographically secure randomness, stored only as a hash, and sent to the browser as an HttpOnly cookie. API access requires both the public session ID and matching cookie, so knowing a session ID alone is insufficient.

## Assessment Flow

Steps are `gender`, `goal`, `body`, and `activity`. A session begins in `DRAFT`. `PUT /api/sessions/:id/steps/:step` validates the step-specific payload, upserts it, recalculates the highest contiguous completed step, and increments `version` in one transaction. Clients send `expectedVersion`; stale updates receive `409 VERSION_CONFLICT`. Repeated requests with the current representation are safe because the endpoint is idempotent.

`POST /api/sessions/:id/submit` verifies all required answers, computes the result, persists it, and moves the session to `COMPLETED` in one transaction. Completed sessions are immutable. The UI may start a new assessment instead of mutating a completed one.

## Calculation Rules

The calculation module is a pure function accepting validated inputs and an explicit clock date. It calculates BMI, BMI category, Mifflin-St Jeor BMR, activity-adjusted TDEE, a goal-dependent calorie recommendation, and an estimated target date. The implementation clamps calorie adjustment to a safe demonstration range and rejects implausible targets. The UI and README state that results are educational estimates and not medical advice.

Accepted demo ranges are: age 18-80, height 120-230 cm, weight 35-300 kg, and target weight 35-300 kg. Target loss or gain may not exceed 40% of current weight. Decimal values must be finite; strings, `NaN`, infinities, unknown fields, and missing required values are rejected.

## Access Control

`GET /api/sessions/:id/result` reads subscription state on the server. Preview and premium responses use separate DTO constructors. The preview DTO contains BMI, category, a broad summary, `lockedFeatures`, and `upgradeRequired`; it never serializes calories, target date, prediction curve, or the stored protected payload. Query parameters and client-provided subscription fields never influence authorization.

## Mock Payment

`POST /api/payments/mock` requires `Authorization: Bearer <MOCK_PAYMENT_SECRET>`, a completed session, a unique `eventId`, and `status: paid`. A transaction records `PaymentEvent` and activates the subscription. Replaying the same event returns the existing successful outcome without duplicating records. The interface is explicitly marked as demonstration-only.

## API Contract

- `POST /api/sessions` creates a session and secure recovery cookie.
- `GET /api/sessions/:id` restores progress and validated answers.
- `PUT /api/sessions/:id/steps/:step` saves one step using optimistic concurrency.
- `POST /api/sessions/:id/submit` validates completeness and creates the result.
- `GET /api/sessions/:id/result` returns preview or premium DTO.
- `POST /api/payments/mock` activates mock access idempotently.

Success responses use `{ data, meta: { requestId } }`. Errors use `{ error: { code, message, fields? }, meta: { requestId } }`. Expected statuses include 400 for malformed input, 401 for invalid session credentials, 404 for absent resources, 409 for version conflicts, and 422 for validly shaped but impossible business input.

## UI

Use a mobile-first, single-column funnel with one decision per page, a visible progress bar, large option cards, automatic save feedback, refresh recovery, a short result-generation transition, and a useful free preview before the mock upgrade prompt. Avoid copied trademarks, fake urgency, fabricated endorsements, and medical claims.

## Testing

- Unit: validation boundaries, calculation formulas and categories, deterministic dates, impossible targets, and DTO field allowlists.
- Integration: session creation, step upsert, interrupted recovery, repeat/乱序 submissions, stale-version conflicts, completion immutability, and database constraints.
- API/E2E: free result contains no protected keys; mock payment changes access; callback replay is idempotent; invalid secret and incomplete sessions fail.
- Browser: one critical journey from new session through mock payment to premium result.

CI runs lint, formatting check, TypeScript, unit/integration tests, and production build. Tests use a dedicated PostgreSQL database and reset only test-owned rows.

## Deployment and Submission

Deploy the app and database, apply migrations, seed one unpaid and one paid assessment, and verify the production funnel. README leads with the live URL, CI badge, both test session IDs, payment cURL, local setup, API documentation, schema diagram, test coverage rationale, limitations, and AI collaboration retrospective.

## Acceptance Criteria

The live app completes the funnel end to end; refresh resumes draft progress; stale concurrent writes are rejected; invalid values never persist; calculations are stored server-side; unpaid responses contain no premium fields; a signed mock callback unlocks premium data; callback replay is safe; `npm test` passes; CI and production build pass; and all required submission artifacts are present.
