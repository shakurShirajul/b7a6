# Blood Donation Platform API

A role-based backend for coordinating verified blood requests with eligible donors, hospitals, administrators, notifications, and auditable support payments. The API is designed to reduce the unsafe, manual coordination that often happens during urgent blood searches: patients submit a hospital-backed request, administrators verify it, background matching ranks compatible donors, donors accept a time-limited assignment, and an administrator records the completed donation.

## Documentation and evaluator links

- [API workflow and endpoint reference](docs/api-workflows.md)
- [Entity relationship diagram](docs/erd.md)
- [Postman collection](postman/Blood-Donation-Platform.postman_collection.json)
- [Local Postman environment](postman/Local.postman_environment.json)
- [Submission checklist and video script](docs/submission-checklist.md)
- Live API: **`<SET_LIVE_API_URL_AFTER_DEPLOYMENT>`**
- Published API documentation: **`<SET_PUBLISHED_POSTMAN_OR_OPENAPI_URL>`**
- Admin demo email: `admin.demo@blood.local`
- Admin demo password: **`<SET_TO_THE_VALUE_YOU_CHOSE_FOR_DEMO_PASSWORD>`**

The live URL, published API-documentation URL, and demo password are deliberate placeholders. Before sharing a deployment, set `DEMO_PASSWORD` yourself, seed only the intended demo database, and replace the three placeholders above. Never commit the password or production credentials.

## Architecture

```text
HTTP client
  -> Express security / rate limiting / validation / RBAC
  -> domain services and serializable transactions
  -> Prisma Client -> PostgreSQL
  -> transactional outbox -> BullMQ / Redis workers
       -> donor matching
       -> invitation and status email delivery
       -> invitation, reservation, and request expiration

Stripe -> raw-body webhook -> signature verification -> idempotent reconciliation
Google -> OAuth 2.0 + PKCE callback -> local refresh session
```

The application is a modular Express service. Controllers own HTTP response semantics, Zod schemas normalize all route input, services enforce ownership and state transitions, and Prisma transactions protect multi-record workflows. Audit logs are append-only. Matching and email work is written to an outbox in the same database transaction as the domain change, then published to BullMQ when Redis is configured.

## Stack

- Node.js, TypeScript, Express 5
- PostgreSQL, Prisma ORM 7, `@prisma/adapter-pg`
- Zod validation, JWT access/refresh tokens, bcrypt
- BullMQ and Redis for background work
- Stripe Checkout, refunds, and signed webhooks
- Google OAuth 2.0 with PKCE
- Nodemailer/SMTP
- Vitest, ESLint, and Prettier

## Prerequisites

- Node.js `^20.19`, `^22.12`, or `>=24` (the ranges supported by Prisma 7.10)
- pnpm 10 or newer (Corepack is recommended)
- PostgreSQL reachable through `DATABASE_URL`
- Redis for matching, email, and expiry workers
- Stripe test-mode API and webhook credentials for payment flows
- Optional Google OAuth client for Google sign-in
- Optional SMTP server for email delivery

## Local setup

1. Install dependencies.

   ```bash
   corepack enable
   pnpm install --frozen-lockfile
   ```

2. Copy the environment template and fill every required value.

   ```bash
   cp .env.example .env
   ```

3. Validate the Prisma schema and generate the client.

   ```bash
   pnpm exec prisma validate
   pnpm exec prisma generate
   ```

4. Apply already-reviewed migrations. This is the safe command for shared, staging, and production databases because it never creates a migration interactively.

   ```bash
   pnpm db:deploy
   ```

   Use `pnpm exec prisma migrate dev --name <descriptive_name>` only while intentionally developing a new schema migration against a disposable/local development database. Review the generated SQL before applying it elsewhere. Never use `prisma migrate reset` on a database you need to keep.

5. Seed optional demo data. Point `DATABASE_URL` at the intended demo database and choose the password explicitly.

   ```bash
   DEMO_PASSWORD='<CHOOSE_A_STRONG_DEMO_PASSWORD>' pnpm db:seed
   ```

   On a fresh database, the seed creates one admin, one patient, three verified donors, two verified hospitals, and two sample requests using `.local` identities. A collision at any demo email must already have the expected role; otherwise the entire transaction aborts. Reruns refresh only credentials, clear reset tokens, and delete those identities' refresh sessions. They preserve account status/deletion, profile evidence and verification, availability, assessments, donation dates, counters, request status/fulfilled units, and all assignment/donation history. Password login and refresh coordinate with credential rotation through the user row lock. Already-issued access tokens remain valid until their normal short expiry.

   Missing fixtures are created without resetting existing ones. Append-only `DEMO_FIXTURE_BOUND` audit entries keep hospitals and requests attached to stable fixture identities after later edits; the seed refuses to recreate a missing bound record or create an active request under a demoted hospital. Outside production there is a local fallback password, but evaluators and all deployed environments must set `DEMO_PASSWORD`; production seeding refuses to run without it. Requests have fixed September 2026 deadlines and initial donor assessments expire in March 2027. Use the admin workflow to renew assessments and create fresh requests after those dates. The Postman collection supplies future dates dynamically.

6. Run the API and, in a second terminal, the workers.

   ```bash
   pnpm dev
   pnpm dev:workers
   ```

   The default Postman environment expects `http://localhost:5000`. Change its `baseUrl` if `PORT` differs. The API can start without Redis, but queued outbox publication is deferred; workers require `REDIS_URL`.

## Environment variables

All runtime variables are validated at startup. Empty optional values are treated as unset.

Database connections use connection and client query timeouts. The adapter does not send a server `statement_timeout` startup parameter because it causes upstream connection failures with Prisma Postgres pooling. `DATABASE_STATEMENT_TIMEOUT_MS` is no longer used; existing environment entries can be removed. The client query timeout bounds the caller's wait but does not guarantee server-side query cancellation.

| Name                               | Required | Purpose / example guidance                                                                                                                    |
| ---------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                             | Yes      | HTTP port, for example `5000`.                                                                                                                |
| `DATABASE_URL`                     | Yes      | PostgreSQL connection URL.                                                                                                                    |
| `DATABASE_CONNECTION_TIMEOUT_MS`   | No       | PostgreSQL pool connection deadline, `100..60000`; defaults to `5000`.                                                                        |
| `DATABASE_QUERY_TIMEOUT_MS`        | No       | PostgreSQL client query deadline, `100..60000`; defaults to `15000`.                                                                          |
| `APP_URL`                          | Yes      | Public application origin used for Stripe success/cancel return URLs.                                                                         |
| `CORS_ORIGINS`                     | Yes      | Comma-separated exact HTTP(S) browser origins. Paths, trailing slashes, duplicates, and wildcards are rejected.                               |
| `TRUST_PROXY_HOPS`                 | No       | Trusted reverse-proxy hop count, `0..3`; use `1` on Render and `0` for direct local traffic.                                                  |
| `BCRYPT_SALT_ROUNDS`               | Yes      | Integer `4..31`; `12` is appropriate locally.                                                                                                 |
| `JWT_ACCESS_TOKEN_SECRET`          | Yes      | Random secret of at least 32 characters.                                                                                                      |
| `JWT_REFRESH_TOKEN_SECRET`         | Yes      | Different random secret of at least 32 characters.                                                                                            |
| `JWT_ACCESS_TOKEN_EXPIRATION`      | Yes      | `jsonwebtoken` duration such as `15m`.                                                                                                        |
| `JWT_REFRESH_TOKEN_EXPIRATION`     | Yes      | Duration such as `7d`.                                                                                                                        |
| `GOOGLE_CLIENT_ID`                 | No       | Google OAuth client ID; required as a group for Google login.                                                                                 |
| `GOOGLE_CLIENT_SECRET`             | No       | Google OAuth client secret.                                                                                                                   |
| `GOOGLE_CALLBACK_URL`              | No       | Exact callback, locally `http://localhost:5000/api/v1/auth/google/callback`.                                                                  |
| `GOOGLE_OAUTH_STATE_SECRET`        | No       | Random 32+ character state/session signing secret; falls back to the refresh-token secret.                                                    |
| `REDIS_URL`                        | No*      | Redis URL; required to start workers or publish/process jobs.                                                                                 |
| `REDIS_COMMAND_TIMEOUT_MS`         | No       | Nonblocking Redis command/producer deadline, `100..10000` ms; defaults to `1500`.                                                             |
| `READINESS_TIMEOUT_MS`             | No       | Warm `/ready` wait deadline in milliseconds; defaults to `1500`. |
| `READINESS_STARTUP_TIMEOUT_MS`     | No       | Initial `/ready` wait deadline, `100..60000` ms; defaults to `10000`, and is never shorter than the warm deadline. |
| `SMTP_HOST`                        | No*      | Required with `EMAIL_FROM` to deliver emails.                                                                                                 |
| `SMTP_PORT`                        | No       | Defaults to `587`.                                                                                                                            |
| `SMTP_SECURE`                      | No       | `true` or `false`; defaults to `false`.                                                                                                       |
| `SMTP_USER`                        | No       | SMTP username.                                                                                                                                |
| `SMTP_PASSWORD`                    | No       | SMTP password.                                                                                                                                |
| `EMAIL_FROM`                       | No*      | Sender used by the notification worker.                                                                                                       |
| `DONOR_MIN_AGE_YEARS`              | No       | Defaults to `18`.                                                                                                                             |
| `DONOR_MAX_AGE_YEARS`              | No       | Defaults to `65`, and cannot be below the minimum.                                                                                            |
| `DONOR_MIN_WEIGHT_KG`              | No       | Defaults to `50`.                                                                                                                             |
| `DONOR_MIN_DONATION_INTERVAL_DAYS` | No       | Defaults to `120`.                                                                                                                            |
| `MATCHING_EXECUTION_MODE` | No | `INLINE` (default) runs matching during admin verification; `WORKER` requires a deployed BullMQ worker. |
| `MATCHING_DEFAULT_RADIUS_KM`       | No       | Defaults to `25`.                                                                                                                             |
| `MATCHING_MAX_RADIUS_KM`           | No       | Defaults to `50` and cannot be below the default.                                                                                             |
| `MATCHING_MAX_CANDIDATES`          | No       | Eligible donor cap; defaults to `500`. Raw scans advance in pages of at most 200.                                                             |
| `MATCHING_MAX_INVITATIONS`         | No       | Defaults to `50`.                                                                                                                             |
| `DONOR_INVITATION_TTL_MINUTES`     | No       | Defaults to `60`; also bounds accepted reservations.                                                                                          |
| `EXPIRATION_BATCH_SIZE`            | No       | Defaults to `100`.                                                                                                                            |
| `STRIPE_SECRET_KEY`                | Yes      | Stripe `sk_test_...` locally; never expose or commit it.                                                                                      |
| `STRIPE_WEBHOOK_SECRET`            | Yes      | Endpoint signing secret beginning `whsec_`.                                                                                                   |
| `STRIPE_CURRENCY`                  | Yes      | Three-letter currency; the sample configuration uses `BDT`.                                                                                   |
| `PAYMENT_MIN_MINOR_UNITS`          | Yes      | Smallest accepted amount after exact minor-unit conversion.                                                                                   |
| `PAYMENT_MAX_MINOR_UNITS`          | Yes      | Largest accepted amount; must be at least the minimum.                                                                                        |
| `DEMO_PASSWORD`                    | Seed     | Chosen demo-account password. Required by production seeding.                                                                                 |
| `NODE_ENV`                         | No       | Validated as `development`, `test`, or `production`; defaults to `development`. It affects secure cookies, stack visibility, and seed safety. |

## Vercel matching and donation completion

The API defaults to `MATCHING_EXECUTION_MODE=INLINE`. Admin verification commits the verified request, then awaits donor matching and returns `matching.status`: `COMPLETED`, `DEFERRED` on a recoverable matching failure, or `QUEUED` in explicit `WORKER` mode. `COMPLETED` means the matching pass finished; there may be no eligible donors. Successful matching acknowledges the captured matching outbox events. Failed work remains durable for a worker or the admin rematch endpoint. Rematching does not create duplicate donor invitations.

Inline matching adds database latency to verification. Ensure the Vercel function duration accommodates the full request. Email delivery, automatic expiration, and deferred outbox recovery still require a separately deployed `pnpm start:workers` process with the same database and Redis configuration; this HTTP deployment does not start that process.

`DATABASE_TRANSACTION_TIMEOUT_MS` defaults to `20000` and accepts `100..60000`. This is the total interactive transaction deadline, separate from the individual SQL query deadline. Donation completion performs several atomic writes; cross-region database latency can exceed Prisma's original five-second default. The larger bounded budget preserves rollback, counters, audit records, and idempotency.

To recover only the existing active demo administrator, set a private strong `DEMO_PASSWORD` (at least 12 characters) and run `pnpm admin:recover-demo`. This rotates that account's password and revokes refresh sessions without rerunning the full seed or changing other accounts.

Redeploy the changed API to activate these defaults. An existing explicit `MATCHING_EXECUTION_MODE=WORKER` setting must be changed to `INLINE` if no matching worker is deployed. No schema migration is required for this change.

## Health and readiness

`GET /health` is a process-only liveness check. It does not open or verify PostgreSQL, Redis, Stripe, Google, or SMTP connections. Render uses this endpoint to determine whether the HTTP process is alive.

`GET /ready` is the traffic-readiness check and, like `/health`, is mounted outside `/api/v1`. Until the instance first reports ready, each HTTP wait uses `READINESS_STARTUP_TIMEOUT_MS` (10 seconds by default) to allow lazy database and Redis connections to establish. After the first success, waits use `READINESS_TIMEOUT_MS` (1.5 seconds by default). Both budgets remain bounded; failed dependencies still return 503, and successful results are never cached. PostgreSQL retains separate connection and client query deadlines. Concurrent requests share a single underlying dependency probe so an outage cannot create an unbounded backlog of database work. The endpoint returns the normal success envelope with `data.status: "ready"` only after PostgreSQL responds and, when configured or in production, Redis reaches its ready state and responds to `PING`. Any missing, failed, or timed-out required dependency produces a redacted `503` response with `data.status: "not_ready"`; provider errors, connection URLs, credentials, and stack traces are never returned. The Redis probe connection is created lazily on the first readiness request.

Browser CORS is credentialed and allowlist-only. Set `CORS_ORIGINS` to exact frontend origins, separated by commas; server-to-server requests without an `Origin` header remain valid. Never use `*` with cookies or dynamically reflect arbitrary origins. The application trusts a bounded number of proxy hops before rate limiting and audit IP capture: Render uses `TRUST_PROXY_HOPS=1`, while a directly reached local process uses `0`. Do not increase it unless the network topology contains that exact number of trusted proxies.

## Render deployment

[`render.yaml`](render.yaml) provisions the API, background worker, private PostgreSQL database, and private Render Key Value instance in Singapore. It pins Node 22.14 and pnpm 10.20, installs from the lockfile, generates Prisma Client during the build, applies committed migrations with `pnpm db:deploy` in each service's pre-deploy step, starts the compiled entrypoints at `dist/src/server.js` and `dist/src/jobs/worker.js`, and gates automatic deploys on passing repository checks. The declared plans are billable; review current Render pricing and capacity before creating the Blueprint.

1. Create a Render Blueprint from this repository and review the proposed resources. Do not deploy from an unreviewed branch.
2. At the initial Blueprint prompt, enter the exact frontend `CORS_ORIGINS` allowlist and the Google/Stripe variables marked `sync: false`. Never paste secrets into `render.yaml`, repository settings visible to untrusted users, or build logs. Render generates the JWT and Google state secrets and wires the private database/Redis URLs.
3. Keep Stripe in test mode for validation. `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` must come from the same Stripe mode and account. Add SMTP variables directly to both services if email delivery is part of the deployment acceptance criteria.
4. Deploy the API and worker. They are independently deployable services, so each runs `pnpm db:deploy` and gates its own startup on successful migrations instead of assuming the other service deployed first. Keep schema changes backward-compatible across the rollout window. A failed migration cancels that service's release; do not replace `pnpm db:deploy` with `prisma migrate dev` or `migrate reset`.
5. Confirm `GET https://<api-host>/health` returns `200`, then confirm `GET https://<api-host>/ready` returns `200`. A `503` from `/ready` means PostgreSQL or required Redis is unavailable; inspect private Render logs rather than exposing the provider error to the client.

### Live provider URLs

After Render assigns the public HTTPS API origin, configure providers with exact URLs (no localhost and no trailing-path substitutions):

| Setting                                                  | Production/test deployment value                                                                                                                                                   |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google authorized redirect URI and `GOOGLE_CALLBACK_URL` | `https://<api-host>/api/v1/auth/google/callback`                                                                                                                                   |
| Stripe webhook endpoint                                  | `https://<api-host>/api/v1/payments/webhook`                                                                                                                                       |
| `APP_URL`                                                | Public HTTPS browser-facing application origin. The Blueprint defaults it to `https://<api-host>`; point it at the frontend origin when a separate frontend owns the return pages. |
| Stripe Checkout success URL                              | `${APP_URL}/payments/success` (constructed by the server)                                                                                                                          |
| Stripe Checkout cancel URL                               | `${APP_URL}/payments/cancel` (constructed by the server)                                                                                                                           |

Create separate Stripe webhook endpoints and signing secrets for test and live mode. Subscribe only to the event types handled by the payment service, including Checkout completion/expiry, asynchronous payment results, PaymentIntent results, charges refunded, and refund lifecycle events. A frontend must serve the two Checkout return paths; redirects are informational and never authorize a payment state change—the signed webhook remains authoritative.

## CI

The GitHub Actions workflow at [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs lockfile-frozen installation, Prisma validation/generation, migrations against an ephemeral PostgreSQL service, lint, the standard `pnpm test` command, and the TypeScript build. It also starts an ephemeral Redis service for future integration coverage. This repository currently contains no committed test cases, so `pnpm test` invokes Vitest with `--passWithNoTests`; a zero-test success proves only that the runner starts and finds no failing tests. It is **not test coverage**, does not satisfy the planned test matrix, and the flag should be removed after real tests are added. CI values are non-secret test placeholders and must never be reused in a deployment.

## Production smoke procedure

Run this procedure manually only after an approved deployment. Use disposable demo accounts/data, Stripe **test mode**, and a private Postman environment copied from `postman/Local.postman_environment.json`; never export populated current values or commit access tokens, passwords, cookies, provider secrets, or resource IDs.

1. Set `baseUrl` to `https://<api-host>`. Verify `/health` returns process-only `200` and `/ready` returns dependency-aware `200`; save status/timing evidence without response headers that may contain cookies.
2. Log in as the seeded patient, donor, and admin. Refresh one session and verify refresh-token rotation, then confirm the old cookie no longer refreshes. Keep tokens only in Postman's local current values.
3. Run the three role-boundary samples: donor calling an admin endpoint, patient calling a donor-only endpoint, and an unauthenticated protected request. Expect `403`, `403`, and `401` respectively; confirm no protected record is returned.
4. Run the happy-path folder sequence: patient lists a verified hospital and creates a fresh future-dated request; admin verifies it; check `matching.status` (wait for the worker in `WORKER` mode); donor lists and accepts the invitation; admin completes the assignment. Confirm the request, reservation, donation, and counters reach the documented states.
5. Create a Stripe test-mode Checkout Session, open its returned URL, pay with a Stripe test method, and let Stripe send a genuine signed event to the live HTTPS webhook. Poll the payment until it is `PAID`. Optionally validate cancellation/refund only with separate payment IDs as described in [the workflow guide](docs/api-workflows.md#payments).
6. Review API, worker, PostgreSQL, Redis, and provider logs. Search for and fail the smoke review on any JWT/cookie, password, authorization header, database/Redis URL, Stripe/Google/SMTP secret, raw webhook body, precise donor coordinates/address, eligibility evidence/reason, or stack trace in production HTTP responses. Expected operational logs should contain only stable event names and non-sensitive internal IDs/counts.
7. Record timestamps, status codes, sanitized resource IDs, Stripe test event IDs, and reviewer sign-off outside the repository. Delete disposable data through approved application/administrative workflows; do not run destructive database commands.

## Commands

| Command                                      | Purpose                                        |
| -------------------------------------------- | ---------------------------------------------- |
| `pnpm dev`                                   | Run the API with TypeScript watch mode.        |
| `pnpm dev:workers`                           | Run all workers with watch mode.               |
| `pnpm build`                                 | Generate Prisma Client and compile TypeScript. |
| `pnpm start`                                 | Run the compiled API.                          |
| `pnpm start:workers`                         | Run compiled workers.                          |
| `pnpm seed`                                  | Run `src/scripts/seed.ts` directly.            |
| `pnpm db:deploy`                             | Apply committed migrations non-interactively.  |
| `pnpm db:migrate -- --name <name>`           | Package-script form of development migration.  |
| `pnpm exec prisma migrate dev --name <name>` | Create/apply a development migration.          |
| `pnpm db:seed`                               | Run the repeatable demo seed.                  |
| `pnpm exec prisma validate`                  | Validate the composed Prisma schema.           |
| `pnpm lint`                                  | Run ESLint.                                    |
| `pnpm format`                                | Check configured source files with Prettier.   |
| `pnpm test`                                  | Run Vitest; currently permits zero test files. |
| `pnpm test:watch`                            | Run Vitest in watch mode.                      |
| `pnpm test:coverage`                         | Run Vitest with coverage.                      |
| `pnpm seed:admin`                            | Alias the repeatable full demo seed.           |

`pnpm seed:admin` now resolves to the same deterministic full demo seed as `pnpm seed`. Prefer `pnpm db:seed` in deployment runbooks because it uses the seed command declared in `prisma.config.ts`; neither command is an admin-only mutation.

## Authentication and roles

Password login returns a short-lived access token in JSON and a rotating refresh token in an HTTP-only `refreshToken` cookie scoped to `/api/v1/auth`. Send protected requests with `Authorization: Bearer <access-token>`. Postman retains the cookie automatically when requests use the same `baseUrl`.

Self-registration accepts only `PATIENT` or `DONOR`; clients cannot register administrators. Admin users are created by the controlled seed or another trusted operational process. All authenticated users must remain `ACTIVE` and not soft-deleted. Role violations return `403`; missing, invalid, or expired access tokens return `401`.

Google sign-in starts at `GET /api/v1/auth/google`. Register the exact `GOOGLE_CALLBACK_URL` with Google. Public login works for an already linked provider account. First-time linking requires signing in with email/password and sending that account's Bearer token on the start request. Its authenticated user ID is bound into both signed, 10-minute state/session values alongside nonce and PKCE. At callback, the user must still be active and Google's verified email must match that user. A public first-time callback returns `409` with linking instructions; email equality alone never merges accounts. Invalid supplied tokens return `401`, and cross-user provider links return `409`. No Google auto-registration occurs. See the [explicit linking and Postman flow](docs/api-workflows.md#google-login-and-explicit-linking); reserved `.local` demo emails cannot demonstrate real Google login.

## Core business and medical rules

- Blood-request input starts as `PENDING_VERIFICATION`. Only the owning patient can edit it, and only while pending. Patient/admin cancellation and soft deletion follow explicit state-transition rules.
- Requests may target only active, verified hospitals. Non-admin hospital reads expose only active verified hospitals. Verification-sensitive hospital edits, rejection, and deletion return `409` while any pending/verified/matching/partially fulfilled request exists. Matching persistence and assignment acceptance also lock and check the current hospital.
- An admin verifies or rejects a request. Verification queues matching; if Redis is unavailable, the outbox safely retains deferred work.
- Compatibility is for packed red cells, not plasma: O− can donate to every recipient; AB+ can receive from every packed-red-cell type. The full matrix and eligibility reason codes are in [the workflow guide](docs/api-workflows.md#matching-and-eligibility).
- A donor must be active, verified, marked available, within the configured age/weight/donation-interval policy, covered by a current eligible assessment, compatible with the recipient, and free of an active reservation. Admin verification locks and rereads user/profile evidence before evaluation and leaves availability off. Evidence edits share the same lock order: earlier edits are reviewed, later edits revoke verification to `PENDING`; the donor must opt in after successful review.
- Matching prefers configured geographic radius when coordinates exist; otherwise it falls back deterministically through area, district, then division. Bounded pages of at most 200 advance by donor ID until `MATCHING_MAX_CANDIDATES` eligible donors are found or the captured finite ID range is exhausted. Compatibility and location filters precede scanning; live eligibility precedes the cap and is checked again inside the persistence transaction. Urgency, deadline, distance, time since last donation, and recent invitation count determine donor rank.
- Invitation acceptance is capacity-safe and creates one reservation. Invitations and reservations expire; a donor cannot reserve multiple requests concurrently.
- One completed assignment records exactly one unit. Completion increments donor/patient totals, updates the donor's last donation date, makes the donor unavailable, and moves the request to `PARTIALLY_FULFILLED` or `FULFILLED`.
- Personal data and precise donor location are not placed in public notifications. Normal reads are ownership- and role-scoped.

## Durable jobs and Redis timeouts

Every matching/email job carries its `outboxEventId`. `processedAt` records publication; the new `completedAt` records matching/worker acknowledgement only after successful or idempotently skipped domain processing. Apply the `20260906_final_outbox_acknowledgement` migration before running the updated API/worker. Older published rows are reconciled against retained jobs or safely replayed through the domain handlers.

The publisher selects bounded due batches, claims each row with a conditional 15-minute lease, and leaves unacknowledged work durable. Waiting/active/delayed jobs retain their stable `outbox-<id>` deduplication ID. Terminal failure clears publication state and schedules a cooldown starting at two minutes and growing to one hour; a missed failure callback is recovered by the next due lease scan with at least a one-minute cooldown. A retained failed job is removed only after that cooldown, then the same durable ID is republished. This also recovers missing Redis jobs. Restore the dependency and keep the worker running; there is no need to delete durable outbox rows or reset workflow data. Persistent failures remain visible via controlled `lastError` codes and should be investigated. SMTP remains at-least-once: a crash after server acceptance but before recording `SENT` can duplicate an email.

Due matching events are selected by current request urgency (`EMERGENCY`, `HIGH`, `NORMAL`), then exact deadline and event ID before the batch limit. BullMQ receives explicit lower-number priorities using those authoritative values. Deadlines use absolute UTC-hour buckets, comparable across publication/retry times, within separate urgency bands covering 2000–2079 (outside dates clamp); tied priorities use queue order and running work is not preempted. Donor ranking within a request is separate. Priority behavior follows [BullMQ's priority contract](https://docs.bullmq.io/guide/jobs/prioritized).

`REDIS_COMMAND_TIMEOUT_MS` defaults to `1500` and validates `100..10000`. Cache, readiness, and producer clients use ioredis `commandTimeout`; producer connection/publication chains also have an overall deadline and disconnect on timeout. A publication batch stops after failure instead of spending one timeout per event, retaining deferred work for a later sweep. Dashboard invalidation clears local state immediately and falls back after the Redis deadline. Readiness allows Redis connection setup within its startup/warm readiness budget; individual Redis commands retain the smaller Redis/warm-readiness deadline. Connections stay lazy; blocking worker consumers use their separate BullMQ-required connection settings. PostgreSQL waits retain their own configured bounds. The option is supported by [ioredis](https://github.com/redis/ioredis/blob/main/lib/redis/RedisOptions.ts).

## Payment rules and Stripe webhook

Payments are optional contributions (`EMERGENCY_SUPPORT` or `PLATFORM_SUPPORT`), not purchases of blood. Patient and donor users create Stripe Checkout Sessions; a contribution may link only to a blood request visible to that payer. Amounts are accepted in major-unit decimal form, converted exactly to integer minor units, constrained by the configured minimum/maximum, and must use `STRIPE_CURRENCY`. The local BDT example uses the normal two-decimal exponent, so `500` becomes `50000` minor units.

Only an open, not-yet-completed Checkout Session can be cancelled. Only admins can request a refund, and only a paid payment with a PaymentIntent can be refunded. Stripe webhooks are authoritative, signature-verified, idempotent by event ID, correlated through payment metadata/provider IDs, mode/currency/amount checked, and prevented from regressing terminal payment state.

The webhook route is:

```text
POST /api/v1/payments/webhook
Content-Type: application/json
Stripe-Signature: <generated by Stripe>
```

It is intentionally mounted **before** `express.json()` and uses `express.raw()`. Do not proxy it through middleware that parses, reformats, or reserializes JSON before signature verification. For local development, forward Stripe CLI events and copy its signing secret into `.env`:

```bash
stripe listen --forward-to localhost:5000/api/v1/payments/webhook
```

The Postman webhook request contains signature/payload placeholders for documentation only; an arbitrary signature cannot exercise successful reconciliation. Use Stripe CLI or Stripe's dashboard to produce a genuine signed event.

## Postman quick start

1. Import both files from `postman/` into a clean workspace.
2. Select **Blood Donation Platform - Local**.
3. Enter the same `demoPassword` value used for `DEMO_PASSWORD`. Do not save secrets to shared initial values or commit exported current values.
4. Start the API and workers, then run requests in folder order. Login scripts save role-specific access tokens; list/create scripts save resource IDs as collection variables. Non-linear alternatives and external callback/webhook examples are skipped by default, so they cannot consume happy-path state.
5. A complete lifecycle needs a fresh future-dated request. Verification runs matching inline by default. In `WORKER` mode, wait for worker processing before listing donor assignments.

To run a non-linear alternative, prepare a separate resource ID, set it in the collection variable named by that request, and temporarily set `runAlternativeBranches` to `true`. `Reject assignment` needs a distinct `INVITED` assignment in `rejectAssignmentId`; `Cancel payment` needs a distinct `OPEN` Checkout in `cancelPaymentId`; and `Refund payment` needs a distinct `PAID` payment in `refundPaymentId`. Run the individual request, then return the flag to `false`. Google OAuth and the signed Stripe webhook have separate opt-in flags because they require real provider state; see the workflow guide.

The collection intentionally contains no real JWT, password, Stripe key, webhook secret, personal account, or live endpoint.

## Response and error shape

Successful JSON responses use `{ success, statusCode, message, data }`, with `{ page, limit, total }` in `meta` for paginated lists. Errors use `{ success: false, statusCode, message, errors }`; validation details contain `path` and `message`. Malformed JSON returns `400`; bodies exceeding 1 MB return `413`. Unknown routes return `404`, authentication failures `401`, role/ownership failures `403`, invalid transitions and Prisma `P2034` serialization conflicts `409`, rate limits `429`, and upstream payment failures normally `502`. Request creation and Checkout creation each have a separate limit of 10 attempts per authenticated account per 15 minutes, in addition to the global IP limit. These counters are process-local; deployments with multiple API replicas need a shared limiter or equivalent ingress limits.

See [docs/api-workflows.md](docs/api-workflows.md) for every route, exact input examples, success examples, common error examples, and end-to-end role workflows.
