# Hono + Drizzle example API: specification and implementation plan

Status: Local development and Gate 6 schema/push are verified. The user requested narrower database tests; the 19 trimmed tests await integration verification. Pause for review before Gate 7 seeds.

## Spec summary

### S1. Scope and sources

Build a **personal finance tracker API**: accounts, categories, immutable income/expense transactions, tags, monthly budgets, and balance/spending reports. This demonstrates foreign keys, many-to-many relationships, constraints, atomic writes, filtering, and aggregation. There is no frontend, bank integration, payment processing, investment accounting, or foreign exchange. Savings goals and transfers are future extensions.

The requirements come from `setup.md`, including manual commits, review gates, tests, PostgreSQL containers, environment files, persistent storage, Drizzle Studio, seeding, and schema pushes rather than migration files. Authentication is optional follow-up work.

Local design references:

- `./docs/archive/API_design.md`: HTTP Methods (39–65), Status Codes (67–110), Naming/Hierarchy/Filtering (112–201), JSON/Side Effects/Versioning (262–314), Validation/Error Handling (407–454), Logging/Security (456–493), and Connection Pooling/N+1 (516–536).
- `./docs/archive/database_design.md`: Relationships and Keys (90–103), Constraints (105–117), Normalization/Values (119–187), Time/Transactions/Tenancy/Schema Change (189–209), Schema Review Checklist (211–220), and Personal Finance Tracker (449–502).
- Design rationale follows `~/.opencode/docs/design_questions.md`, sections 1–9 (Data & Query Modeling through Operational & Maintainability Concerns).

The current host-development workflow supersedes the original container-only setup. Earlier gate verification notes are historical.

The approved project rules are recorded in `docs/PROJECT_MAP.md`. Every gate below must follow its stack, security, and persistence rules.

### S2. Stack and organization

- TypeScript in strict mode, Bun 1.3.14, Hono using Bun's native HTTP server, a committed `bun.lock`, and Bun's built-in test runner.
- PostgreSQL, Drizzle ORM with `pg` and a bounded connection pool, Drizzle Kit, `drizzle-seed`, and Zod for configuration/request validation.
- Resolve compatible stable versions in Gate 1 and record the chosen runtime/PostgreSQL versions. Pin container versions; avoid floating `latest` tags.
- Export an application factory separately from the server listener so Bun tests can use Hono's request interface without opening a port.
- Organize by feature: `src/modules/{accounts,categories,transactions,tags,budgets,reports}`; shared HTTP/configuration code in `src/lib`; database client/schema/seed in `src/db`; process startup in `src/server.ts`.
- Keep handlers thin. Put multi-query business operations in services; query code stays close to the feature. Avoid a generic repository framework.

### S3. Runtime, secrets, and persistence

- Approved local workflow: run the API, Drizzle, and checks in host Bun 1.3.14. Docker runs PostgreSQL only during development/testing. Keep the production API image for separate CI/deployment checks.
- Default addresses: local API `127.0.0.1:3000`; PostgreSQL `127.0.0.1:5433`, published from container port `5432`. Local tools use these host addresses. The production API binds to `0.0.0.0` inside its container.
- Local commands explicitly select `.env.local` using Bun. Automatic file loading stays disabled. Production examples explicitly select `.env.production` or inject settings. Validation reads supplied values only; never merge both files or guess a database target.
- Commit `.env.example` with placeholders and descriptions. Ignore actual environment files and exclude them from image build contexts. Never put credentials in Docker build arguments or image layers.
- One set of database credentials per selected environment: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`. Bun supplies them to local commands and Compose supplies them to PostgreSQL; build connection options from validated fields to avoid password URL-escaping bugs.
- `POSTGRES_HOST` and `POSTGRES_PORT` are actual client connection settings, defaulting to `127.0.0.1:5433`. Deployment Compose explicitly overrides the API connection to `db:5432`. Do not infer addresses from APP_ENV or Docker detection.
- Use a named PostgreSQL volume at the correct data path for the selected image major. Local and production Compose project names/volumes must be distinct.
- `db:up` waits for the database health check before the developer starts the local API. `/health/live` tests the process; `/health/ready` performs a bounded database query and returns `503` on failure. Health checks do not require seeded business records.
- `db:up` starts PostgreSQL without pushes/seeds. Start the API separately with `dev`. `db:down` preserves volumes and does not stop local Bun processes.
- Development uses local dependencies and Bun watch mode. Production uses built code in a non-root runtime image, verified separately.
- Close the HTTP server and connection pool on termination. Bound body size, database pool size, and database query/connection timeouts.
- Production environment support is configuration/build support; public deployment and TLS provisioning are outside this exercise. The unauthenticated core remains a local demo.

### S4. Data model and invariants

Start with one seeded demo user and server-selected owner context. Clients cannot choose their owner using headers, body fields, or query parameters. This is a local demo convenience, not authentication. All owner-scoped service functions take an explicit owner ID, making later session integration a contained change.

| Table              | Purpose and important rules                                                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`            | UUID primary key, unique normalized email, timestamps; one demo identity initially; no public user CRUD.                                                                                |
| `accounts`         | Owner FK, name, checking/savings/cash type, USD currency, optional `archived_at`; names unique per owner ignoring case.                                                                 |
| `categories`       | Owner FK, name, archive timestamp; names unique per owner ignoring case; all categories private rather than nullable global defaults.                                                   |
| `transactions`     | Owner, account, optional category, nonzero signed exact numeric amount with whole-cent/range checks, bounded description, `occurred_at`, `created_at`, optional unique `reversal_of_id`; immutable after creation. |
| `tags`             | Owner FK, case-insensitive unique name per owner.                                                                                                                                       |
| `transaction_tags` | Owner, transaction, tag; composite primary key prevents duplicate associations.                                                                                                         |
| `budgets`          | Owner, category, month as first-of-month `date`, positive exact numeric `limit_amount` with whole-cent/range checks; unique owner/category/month.                                                                           |

Money uses plain `numeric` with explicit whole-cent and range checks, allowing magnitudes through `999999999999.99`. This refines the original `numeric(14,2)` plan because PostgreSQL rounds excess decimal places before checks; the chosen representation rejects fractional cents instead. Drizzle returns strings, and future JSON output must format two decimals.

Use UUIDs for standalone resources, snake_case SQL identifiers, camelCase JSON, and `timestamptz` for instants. Represent money as two-decimal strings in JSON; never calculate money using JavaScript floating point. This first version accepts USD only, with a database constraint, so reports cannot accidentally sum currencies.

Positive transactions are income; negative transactions are expenses. Account balance is the sum of its transactions, including opening balances recorded as transactions. No mutable balance cache. Budget usage is net category expense, including corrections, within a UTC calendar month; expose a nonnegative spent amount and define refunds as positive category entries. Use half-open report windows `[from, to)` and deterministic decimal serialization.

Enforce same-owner relationships using composite foreign keys to unique `(owner_id, id)` pairs, including account/category/tag associations and reversals. Index referencing columns and owner/date/ID paths used by transaction queries. Keep business limits in database `CHECK`/`UNIQUE` constraints as well as request validation where possible.

Archive accounts/categories instead of deleting referenced history. Reject new transactions on archived accounts/categories. Referenced tags cannot be deleted; return `409`. Budgets may be updated/deleted. Financial entries cannot be patched/deleted: `POST /transactions/:id/reversals` atomically inserts the exact opposite amount and copies the account, category, tags, and original business timestamp. Its creation timestamp records when the correction was made. A unique reference prevents double reversal; reject reversing a reversal. Lock the original row during reversal and parent rows when coordinating archive/create operations. Repeating a reversal request returns the existing reversal.

This preserves original financial entries but is not a complete audit system. Category renames and budget edits have timestamps, not a full revision history. Direct SQL administration is outside the API's immutability boundary; credentials must not be exposed to clients.

### S5. HTTP contract and security

- Resources live under `/api/v1`. Health routes are unversioned. Paths use plural kebab-case nouns and shallow nesting.
- Accounts/categories: list, create, get, and patch (including archive). Transactions: list, create, get, reverse; no update/delete. Tags: list/create/get/patch/delete plus `PUT`/`DELETE /transactions/:id/tags/:tagId`. Budgets: list/create/get/patch/delete. Reports: `GET /reports/account-balances` and `GET /reports/monthly-spending`.
- Lists use bounded offset pagination (`page`, default 1; `limit`, default 25, maximum 100), stable ordering with an ID tie-breaker, and `{ data, pagination: { page, limit, hasMore } }`. Use a lookahead row rather than an automatic total count. Arbitrary page jumps are useful for this small dataset; cursor pagination is deferred.
- Transaction filters: account, category, tag, UTC date range, and bounded literal substring search on description. Allowlist sort keys/directions. Avoid unbounded relationship expansion and N+1 tag queries.
- Validate path/query/body values, decimal precision/range, unknown mutation fields, and timestamps with explicit offsets. Parameterize SQL. Enforce body limits before JSON parsing.
- Single-resource success uses `{ data }`; creation returns `201` and `Location`; deletion/unlinking returns bodyless `204`. Malformed JSON is `400`, invalid values `422`, missing or other-owner resources `404`, uniqueness/state/FK conflicts `409`, unexpected failures sanitized `500`, unavailable database `503`.
- All failures use `{ error: { code, message, status, requestId, details? } }`; validation details contain field paths and safe messages. Do not expose SQL, stack traces, credentials, or constraint internals.
- Request IDs, secure headers, bounded requests, and structured method/path/status/duration logs are baseline. Do not log bodies, query strings, cookies, authorization headers, or connection strings. CORS is disabled unless an explicit origin allowlist is configured; it does not provide authentication.
- Ordinary transaction creation is not retry-idempotent: document that clients must not blindly retry a timed-out POST. Financial-provider integrations and durable general idempotency keys are deferred together.

### S6. Tooling and verification

Current commands are documented in README. Use `dev`, `check`, `db:up`, `db:down`, `db:logs`, `db:push`, `db:studio`, and `test:integration` for daily work. `docker:build` prepares the deployment image. Seed commands arrive in Gate 7. No Docker dispatcher, development-tooling containers, or duplicate editor/runtime installs are needed.

Use Bun's test runner throughout. Fast request tests do not open a port or need a database. Integration tests run locally against real PostgreSQL in a uniquely named temporary Docker project on an available loopback port. The runner creates its own database, verifies connection identity before cleanup, and removes its Docker resources. Never use demo/production storage. Cover constraints, rollback, exact decimal reporting, owner isolation, and concurrent reversals with independent connections.

## Design rationale

Answers below correspond to the design-question framework sections cited in S1. These are proposed choices for review.

1. **Data and queries — relevant.** Primary reads are account balances, transactions filtered by owner/account/date/category/tag, and monthly category spending versus budget. Expect hundreds to tens of thousands of demo transactions, predominantly reads; no promised production latency/load target. Normalize tags and categories; derive balances in SQL to avoid synchronization bugs. Index owner/date/ID and FK paths; use bounded literal search initially rather than speculative full-text infrastructure.
2. **Mutation and concurrency — relevant.** Transaction plus initial tags and reversal plus copied tags are atomic. Database constraints arbitrate duplicates and ownership races. Row locks serialize reversal and archive conflicts. Metadata/budget edits use documented last-write-wins semantics. Bulk imports/offline replay are not relevant because no such clients exist. General POST retry deduplication is deferred until an integration needs it.
3. **History — relevant.** Entries are immutable and reversed rather than silently rewritten; reversal dates restate the original period, while creation timestamps preserve correction timing. No point-in-time report reconstruction, tamper-evident audit, restore UI, legal retention program, or event sourcing: this uses synthetic local demo data. Volume persistence and backup/restore guidance address accidental operational loss, not regulatory guarantees.
4. **Lifecycle — relevant.** Accounts/categories transition active → archived; unarchive via patch is allowed. Archived parents retain history but reject new entries. Transactions are original or reversal, with at most one reversal per original. No schedulers, pending payment states, timeout transitions, or job retries because no external payment workflow exists.
5. **Ownership/security — relevant.** All records are scoped to the server's demo owner initially, with composite FKs preventing cross-owner links and service filters preventing cross-owner reads. Test with a second owner. Never accept a caller-supplied owner. Optional authentication replaces demo context; it must not leave a production fallback to demo identity. Field-level roles/ownership transfer are not relevant to a personal tracker.
6. **Scale/caching — relevant, capacity targets deferred.** Bounded pool, input/page sizes, SQL aggregation, explicit projections, and batched tag reads fit the exercise. No Redis, queues, denormalized balance cache, or background jobs: there is no measured need. Measure on a documented fixture before setting a performance claim; large imports/load testing are future scope.
7. **Integrations — PostgreSQL only.** All consistency stays within one database transaction. Database failures produce bounded sanitized errors, not infinite retries. Provider webhooks, external synchronization, distributed consistency, and upstream retry/backoff are not relevant until a bank/payment integration is approved.
8. **Frontend — not relevant.** There is no UI, optimistic client cache, offline state, live transport, multi-step form, or client history view. Curl examples and HTTP contracts are the consumer interface.
9. **Operations — relevant.** Health/readiness, sanitized request logs, environment validation, explicit schema pushes, seed guards, volume persistence, and restore instructions support debugging. Automated paging/tracing and deployment orchestration are deferred because hosting is outside scope. Back up before destructive pushes; code rollback cannot restore dropped data.

## Review and commit workflow

Each gate is one small suggested commit. Implement only the next approved gate, run its checks, show the resulting diff summary and limitations, then pause. The user reviews, requests adjustments, and commits manually; never create commits on their behalf. Approval of the plan permits Gate 1 only unless the user explicitly authorizes more. Update checkboxes only after actual completion.

The user has initialized Git since the initial planning pass. Commits remain manual. See `discoveries.md` for environment observations.

### Gate 0 — approve scope and contract

- [x] Review the domain, immutable transaction/reversal model, USD/UTC limits, and optional auth boundary.
- [x] Approve this plan or request edits before implementation.

Acceptance: S1–S6 reflect the desired exercise. Suggested planning commit: `docs: define phased Hono and Drizzle API plan`.

**PAUSE — user must approve before continuing to next batch.**

### Gate 1 — TypeScript/Hono foundation

- [x] Create `package.json`, lockfile, strict TypeScript, lint configuration, and runtime version declarations.
- [x] Add `src/app.ts` application factory and `src/server.ts` entrypoint with a liveness route.
- [x] Add Vitest request coverage for liveness and JSON unknown-route handling; add build/check scripts.
- [x] Create `docs/PROJECT_MAP.md` with approved S1–S2 constraints and remaining S3–S6 boundaries; add a short README linking this plan.

Gate 1 verification: the user ran the Docker commands after the temporary mount fix. Type checking and linting passed before all three request tests passed; the build produced `dist/server.js` with no reported errors. The refreshed lockfile matches `package.json` and resolves ESLint 10.13.0. Compose configuration validation and Git whitespace checks also passed. Docker runtime checks were user-run because this session cannot access the Docker socket.

Acceptance: build/typecheck/lint/test pass; app imports without listening. S2/S5; API reference HTTP Methods/Error Handling. Commit: `chore: scaffold typed Hono API and Vitest`.

**PAUSE — user must approve before continuing to next batch.**

### Gate 2 — environment configuration

- [x] Add `.env.example`, `.gitignore`, and `.dockerignore` rules for actual secrets.
- [x] Implement validated configuration and explicit local/production environment selection with context-aware database fields.
- [x] Add meaningful tests for missing credentials, environment isolation, invalid ports, and passwords containing URL-reserved characters.

Gate 2 verification: the user refreshed the lockfile and ran Docker checks. Type checking, linting, all 25 tests, and the build passed. The lockfile matches the manifest and resolves Zod 4.6.7. Compose configuration, Git ignore rules, and whitespace checks also passed. After the approved simplification, Compose alone reads the selected file. The application validates container-supplied values with a matching `APP_ENV`; it has no file-reading path. Container database connections always use `db:5432`; there is no host connection mode in this Docker-only project.

Acceptance: no secrets in source/build context; production never falls back to local. S3; API Security. Commit: `feat: validate environment-specific API and database configuration`.

**PAUSE — user must approve before continuing to next batch.**

### Gate 3 — containers and persistent PostgreSQL

- [x] Add Dockerfile development/build/runtime stages and Compose API/database services with health dependency.
- [x] Add loopback port bindings, separate named volumes/projects, development source watch, and compiled production command.
- [x] Add Docker up/down/log scripts and initial README startup instructions.

Gate 3 verification: the user ran `sh scripts/verify-docker.sh` successfully. Type checking, linting, 26 tests, and compilation passed. Both local services became healthy; the published API responded before and after shutdown/restart; the database retained its probe row. The production image built successfully and passed checks for a non-root user and absence of TypeScript and environment files. Both Compose configurations also validate with loopback port bindings, the database health dependency, and distinct volume names. Shell syntax, dependency-lock consistency, and whitespace checks pass. Runtime results were user-run because this session cannot access Docker's socket. The full production stack has not been started.

Acceptance: Compose validates without exposing resolved credentials; both containers start; API is reachable; a temporary database probe survives down/up; local and production volumes differ. S3 and PROJECT_MAP persistence rules. Commit: `feat: run Hono and persistent Postgres with Docker Compose`.

**PAUSE — user must approve before continuing to next batch.**

### Gate 4 — database connection and Drizzle tools

- [x] Add pooled database client, Drizzle configuration, explicit push/Studio tooling commands, and production push variant.
- [x] Add bounded database readiness and graceful HTTP/pool shutdown.
- [x] Verify actual container connectivity, readiness failure/recovery, shutdown, and local-only Studio reachability.
- [x] Update `docs/docker-guide.md` to explain the new connection, readiness checks, and database-tool commands.

Verification: the user ran `scripts/verify-docker.sh` successfully. Type checking, linting, all 41 tests, and compilation passed. Database persistence, readiness failure and recovery, temporary loopback Studio access, runtime image contents, and compiled server shutdown passed. The Studio check now requests an available host port so an existing Studio session can stay running. Schema push execution and the full production stack remain unverified.

Acceptance: no migration files/startup push; tools and API share selected credentials; unavailable DB yields `503`. S2/S3/S6; API Connection Pooling. Commit: `feat: connect Drizzle and add database tooling`.

**PAUSE — user must approve before continuing to next batch.**

### Approved correction after Gate 4: Bun migration

The user approved replacing Node/npm with Bun and explicitly selected Bun's built-in test runner. Earlier gate verification entries remain historical records.

- [x] Replace the Hono Node adapter with `Bun.serve`; preserve database readiness and bounded pool shutdown.
- [x] Use Bun 1.3.14 in development, production, and tooling images. Replace the npm lockfile with `bun.lock`; keep editor dependencies separate.
- [x] Migrate all 41 tests to `bun:test`, with fake timers, mocks, and isolated environment changes.
- [x] Use Bun's bundler for production output; keep TypeScript checking separate. Remove the old build and Vitest configuration files.
- [x] Disable automatic environment-file loading so Compose remains responsible for settings. Preserve schema-push review and Studio settings.
- [x] Update commands, project instructions, and the detailed Docker walkthrough.
- [x] Verify watched-server shutdown after removing the startup wrapper and explicitly exiting after cleanup.

Verification: the final user-run Docker smoke check passed type checking, lint, 41 Bun tests, bundling, persistence, outage recovery, production image contents, and Studio port access. Both the watched development server and built server exited cleanly on SIGTERM. The watched server stopped in about 0.3 seconds after removing the startup wrapper and explicitly exiting after cleanup. Local, production, and helper Compose files validate; lockfile declarations, documentation links, shell syntax, and whitespace checks pass. The user also confirmed that Studio opens the database and the local schema push command runs successfully. The full production stack has not been started.

Suggested commit: `refactor: migrate runtime and tooling to Bun`.

Pause for review before Gate 5.

### Gate 5 — owners and reference schema

- [x] Define users, accounts, categories, and tags with owner-aware uniqueness, archive fields, checks, and FK targets.
- [x] Add isolated test-database lifecycle and guarded cleanup for Bun integration tests.
- [x] Push schema and verify case-insensitive uniqueness, invalid values, and owner relationships with PostgreSQL tests.

Implementation: `src/db/schema.ts` defines users and the three owner-scoped reference tables. Names are 1–100 characters, trimmed, and unique per owner ignoring case. Emails are stored lowercase and trimmed. Accounts accept checking/savings/cash and USD only. Accounts/categories can be archived without releasing their names. Unique `(owner_id, id)` pairs support the future finance foreign keys; their indexes also cover owner lookups. `updated_at` must be set by future application updates.

Verification: the user confirmed Docker type checking, lint, fast tests, bundling, and the local `db:push` passed. All 57 integration tests passed against PostgreSQL 18.6, including direct invalid inserts, duplicate updates, different owners sharing names, protected owner deletion, and valid/invalid composite owner links. Each run creates and removes a generated database in a separate test Compose project. Cleanup also ran after the initial assertion failures. Static Compose, documentation-link, lockfile-consistency, and whitespace checks pass. No new business routes, seeds, migration files, or production pushes were added. See [database-guide.md](database-guide.md) for schema and test isolation details.

Acceptance: database rejects invalid direct inserts, not only HTTP payloads. S4/S6; database Relationships/Constraints/Tenancy. Commit: `feat: define owner-scoped finance reference schema`.

**PAUSE — user must approve before continuing to next batch.**

### Approved workflow correction after Gate 5

The user approved host development with Bun, keeping PostgreSQL in Docker and the production API image for CI/deployment. Earlier gate verification entries describe the previous container-development workflow.

- [x] Run API, Drizzle, and checks locally; remove development tooling services, dispatcher-style helpers, and rebuild shortcuts.
- [x] Validate explicit database host/port settings and preserve local database project/volume names.
- [x] Run integration tests in local Bun with automatically provisioned, isolated PostgreSQL and guarded cleanup.
- [x] Keep a production-only Dockerfile and optional deployment Compose example.
- [x] Update application scaffolding, commands, project instructions, and guides.
- [x] Verify the local API, Studio, push, integration lifecycle, and production image build through the user's Docker-enabled terminal.

Verification: type checking, lint, 66 fast tests, and bundling passed locally. After fixing Bun environment-file password escaping, the user confirmed the local workflow worked and approved proceeding to Gate 6. Docker-dependent verification was user-run because this session cannot access its socket.

Suggested commit: `refactor: develop locally with Dockerized PostgreSQL`.

Pause for workflow review before Gate 6.

### Gate 6 — financial schema

- [x] Define transactions, transaction tags, and budgets with decimal/date checks, composite owner FKs, reversal uniqueness, and deletion policies.
- [x] Add query-driven indexes and integration coverage for ownership violations, duplicate links/budgets/reversals, precision, and protected history.
- [x] Apply the financial schema locally through Drizzle Kit and verify the PostgreSQL suite. The user deferred the original repeat-push/no-change requirement after reviewing stable Drizzle Kit's unnecessary key/index rebuilds.

Implementation: transaction amounts and budget limits use exact numeric strings with whole-cent/range checks. Transactions are nonzero; budget limits are positive. Budget dates must be finite first-of-month dates, and transaction business timestamps must be finite. Transactions have a 1–500 character trimmed description. Composite owner foreign keys cover accounts, categories, reversals, and tag links. Unique rules prevent duplicate monthly budgets, links, and reversals; restricted deletes protect referenced rows. Indexes support owner/date, account/category/date, tag filters, and budget-month lookups. See [database-guide.md](database-guide.md).

Verification: local type checking, lint, 66 fast tests, and bundling passed. The user ran all 109 PostgreSQL integration tests successfully and confirmed the local `db:push` applied. Tests include fractional-cent/zero/nonfinite/range rejection, exact SQL sums, cross-owner references, duplicate insert/update rejection, competing reversals, date rules, archive preservation, and protected deletion. The test runner removes its temporary database/container normally. No seeds, API routes, migration files, dependency patch, or dependency upgrade were added.

Deferred tooling issue: repeated pushes can propose rebuilding unchanged composite keys/indexes in the installed stable Drizzle Kit. The user explicitly asked to move on without fixing it; the extra repeat-push guard was removed. Keep normal push review. Opposite-amount/copy/no-chain reversal behavior and archived-parent write coordination belong to later service gates, not this schema gate.

Acceptance: schema satisfies S4's database rules, using Drizzle pushes only. The repeat-push acceptance condition is waived by the user. S4/S6; database Normalization/Transactions/Schema Review Checklist. Commit: `feat: model transactions tags and monthly budgets`.

**PAUSE — user must approve before continuing to next batch.**

### Gate 7 — reproducible demo seeds

- [ ] Add `drizzle-seed` fixture generation with fixed identity/date inputs and realistic related income, expenses, tags, and budgets.
- [ ] Add `db:seed`, production guards, repeat-run detection, and clear rejection of partial/conflicting fixtures.
- [ ] Verify fresh seed relationships, repeat no-op without losing edits, and production rejection.

Acceptance: fresh push + seed gives useful report data; repeat seed preserves data. S4/S6. Commit: `feat: seed reproducible finance demo data`.

**PAUSE — user must approve before continuing to next batch.**

### Gate 8 — shared HTTP behavior

- [ ] Add request IDs, sanitized errors/logs, secure headers, body limits, validation helpers, and explicit CORS allowlist configuration.
- [ ] Add server-owned demo identity context, owner lookup failures, pagination parsing, and allowlisted sorting helpers.
- [ ] Cover malformed/oversized requests, validation details, unexpected errors, and rejection of caller-supplied owner fields.

Acceptance: response/status/log contracts match S5 and PROJECT_MAP security rules; secret data does not reach logs/errors. API Validation/Error Handling/Logging/Security. Commit: `feat: standardize API validation errors and owner context`.

**PAUSE — user must approve before continuing to next batch.**

### Gate 9 — account and category APIs

- [ ] Implement owner-scoped list/create/get/patch endpoints with archive behavior and bounded pagination.
- [ ] Map uniqueness and missing/other-owner resources to the specified HTTP errors.
- [ ] Add request/database tests for duplicate names, archive/unarchive, isolation, and pagination boundaries.

Acceptance: S4/S5 behaviors work against real PostgreSQL; no public user CRUD. API Naming/Status Codes; database Constraints/Tenancy. Commit: `feat: expose accounts and categories API`.

**PAUSE — user must approve before continuing to next batch.**

### Gate 10 — transaction API and reversal integrity

- [ ] Implement create/list/get with exact money validation, date/filter/search/sort rules, and batched tag reads.
- [ ] Atomically create entries with initial tags; lock parents to coordinate archive races; reject archived parents and foreign owners.
- [ ] Implement locked atomic reversal with copied tags, original business date, retry reuse, and no reverse-of-reversal.
- [ ] Test rollback, decimal limits, negative/positive values, filtering, deterministic ordering, isolation, and simultaneous reversal requests.

Acceptance: no patch/delete route mutates financial history; failed relationships leave no partial entry. S4–S6; database Transactions/Time and API Side Effects. Commit: `feat: add immutable transactions and atomic reversals`.

**PAUSE — user must approve before continuing to next batch.**

### Gate 11 — tag API and associations

- [ ] Implement tag list/create/get/patch/delete and idempotent transaction-tag PUT/DELETE endpoints.
- [ ] Protect referenced tags and verify both association endpoints enforce ownership in one atomic operation.
- [ ] Add coverage for duplicate links, repeated unlinking, other-owner links, and tag filtering without duplicate transaction results.

Acceptance: many-to-many changes preserve financial values and ownership. S4/S5; database Relationships/Constraints. Commit: `feat: manage transaction tags and associations`.

**PAUSE — user must approve before continuing to next batch.**

### Gate 12 — monthly budget API

- [ ] Implement owner-scoped budget CRUD with positive decimal limits and first-of-month validation.
- [ ] Reject duplicate category/month budgets and archived categories on creation; keep historical budgets readable.
- [ ] Test invalid months, duplicate periods, ownership, update/delete behavior, and concurrent uniqueness conflicts.

Acceptance: S4/S5 budget rules are enforced through HTTP and database constraints. API Status Codes; database Constraints. Commit: `feat: add monthly category budgets`.

**PAUSE — user must approve before continuing to next batch.**

### Gate 13 — balance and spending reports

- [ ] Add SQL-derived account balance and monthly category spending/budget endpoints, including empty accounts and budget-only categories.
- [ ] Implement UTC half-open periods, exact decimal response strings, refund handling, and original-period reversal corrections.
- [ ] Test manually calculable fixtures, zero activity, month boundaries, reversals, refunds, budget remainder, and owner isolation.

Acceptance: sums match independent expected values, never mix currencies, and avoid per-row queries. S4–S6; database Normalization/Time and API N+1. Commit: `feat: report account balances and monthly spending`.

**PAUSE — user must approve before continuing to next batch.**

### Gate 14 — clean-checkout walkthrough and documentation

- [ ] Complete README: prerequisites, `.env.example` → `.env.local`, startup → push → seed → curl walkthrough, Studio, tests, and production env selection.
- [ ] Document all scripts/routes, error/pagination/money/time conventions, demo-owner limitation, and non-idempotent POST behavior.
- [ ] Document down/up persistence, credential changes on initialized volumes, backup/restore, explicit destructive reset, and schema-push review/rollback limitations.
- [ ] Run the full check suite and clean-environment walkthrough with isolated volumes; verify rebuild and persistence; reconcile PROJECT_MAP with actual implementation.

Acceptance: a new user can follow README without guessing ports, env files, or command locations; report verification actually performed and any environment blockers. S1–S6 and both local design checklists. Commit: `docs: document and verify the complete finance API workflow`.

**PAUSE — user must approve before continuing to next batch.**

## Optional authentication extension — separately approved

The core exercise is complete after Gate 14. These gates are not prerequisites for the local demo and are not included in its implementation approval.

### Gate A1 — credentials and sessions

- [ ] Review current primary security guidance and choose a maintained password-hashing implementation compatible with the runtime/container; document parameters and dependency choice before use.
- [ ] Add password hashes and PostgreSQL sessions with hashed random tokens, user FK, expiry, and lookup/cleanup indexes; preserve existing owner IDs.
- [ ] Add verification for password failure/success, token hashing, expiry, and revocation using actual database records.

Acceptance: no plaintext credentials/session tokens stored or logged; sessions are revocable server-side. S5 security and PROJECT_MAP auth update. Commit: `feat: store password credentials and revocable sessions`.

**PAUSE — user must approve before continuing to next batch.**

### Gate A2 — auth endpoints and middleware

- [ ] Add registration/login/current-user/logout and protected owner-context middleware; remove demo fallback from auth-enabled execution.
- [ ] Set HttpOnly, SameSite, Path, expiry, and production Secure cookie attributes; rotate sessions at login and revoke them at logout.
- [ ] Add Origin/CSRF protection for cookie-authenticated mutations, bounded login throttling, and generic credential failure responses; document proxy trust and single-instance limiter scope.
- [ ] Verify cookie flags, fixation resistance, revoked/expired sessions, malicious origins, throttling, and cross-user API isolation; add cookie-jar curl examples.

Acceptance: protected requests derive owner only from a valid database session; logout immediately invalidates the server session. Password recovery/email delivery/MFA remain future scope, explicitly documented. S5 and updated PROJECT_MAP. Commit: `feat: protect finance API with cookie sessions`.

**PAUSE — user must approve before continuing to next batch.**

## Source checks

Official references consulted while planning; recheck compatible versions at implementation time:

- [Hono on Bun](https://hono.dev/docs/getting-started/bun): current runtime integration. Earlier Node/Vitest gate results below describe the original implementation before the approved Bun correction.
- [Drizzle seed overview](https://orm.drizzle.team/docs/seed-overview): deterministic synthetic generation; safe rerun policy is application code, not an assumed generator guarantee.
- [Drizzle Kit push](https://orm.drizzle.team/docs/drizzle-kit-push): direct schema comparison/application without committed migration files.
- [Docker Compose environment interpolation](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/): explicitly select environment files and distinguish interpolation from container environment injection.

## RELAY

- **Status:** Gate 6 implemented and the local schema push passed. The original 109 integration tests passed; the 19 trimmed tests await a fresh integration run.
- **Handoff:** Ready for review and manual commit. No assistant commits. Stop before Gate 7.
- **User action:** Review the financial schema and updated database guide, commit when ready, and approve Gate 7 separately.
- **Next gate:** Reproducible demo seeds with production guards and safe rerun behavior.
- **Drift risks:** Money rounding or JavaScript floating-point calculations; cross-owner links; treating schema uniqueness as the complete reversal operation; tests touching real data. Stable Drizzle repeat-push churn is deferred by explicit user instruction; no tooling patch/upgrade or repeat-push guard is planned.
