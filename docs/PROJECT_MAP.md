# Project map

## Purpose and workflow

Build a personal finance API to learn Bun, Hono, PostgreSQL, and Drizzle. Follow the approved [implementation plan](01-architect-todos.md), one gate at a time. The user makes all commits. The local-development pivot and Gate 6 are approved. Gate 7 seeding is verified: 68 fast tests, 25 PostgreSQL integration tests, and both local seed runs passed. Stop for review before Gate 8 shared HTTP behavior.

- Develop on the host with Bun 1.3.14 and TypeScript 5.9. Run the API, Drizzle, and checks locally. Install exact dependencies with `bun install --frozen-lockfile`; commit `bun.lock` with dependency changes.
- Run only PostgreSQL in Docker for everyday development. `compose.yaml` preserves the existing `hono-drizzle-local` project and `postgres_data` volume.
- Bun's built-in test runner checks behavior; TypeScript and ESLint check coding mistakes. Zod validates supplied settings. Drizzle ORM and `pg` provide database access; Drizzle Kit handles reviewed schema pushes and Studio.
- Keep direct commands in `package.json`. There is no command dispatcher or application environment-file loader. Automatic Bun file loading is disabled; local commands select `.env.local` explicitly. Exported terminal values take precedence.
- Build the production API image separately for CI/deployment checks. No CI provider, publishing, or deployment is configured. The optional production Compose example uses a separate project and volume.

## Code boundaries

- `src/app.ts` creates the Hono app without opening a port. `src/server.ts` validates settings and starts `Bun.serve`, binding to loopback in local mode and all container interfaces in production mode.
- `src/lib/config.ts` validates `process.env` without reading files or detecting Docker. Connection fields are explicit: `POSTGRES_HOST` defaults to `127.0.0.1`, and `POSTGRES_PORT` to `5433`. The deployment Compose API explicitly receives `db:5432`. Credentials stay separate fields, not a password-containing URL.
- `src/db/client.ts` creates a bounded shared pool and Drizzle client. `src/db/schema.ts` defines users, accounts, categories, tags, transactions, transaction tags, and budgets. Name rules, owner relationships, account types, USD currency, and owner/ID targets are enforced by PostgreSQL. Future updates must set `updated_at` explicitly.
- `src/db/demo-data.ts` holds fixed local demo fixtures and `DEMO_OWNER_ID`. `src/db/seed-demo.ts` creates them atomically, serializes concurrent seed commands, rejects partial/conflicting fixtures, and leaves completed fixtures untouched on reruns. `src/db/seed.ts` guards local settings before opening a connection and closes the pool on completion. Seed commands never reset data or run at API startup.
- `/health/live` checks the process. `/health/ready` runs a database query with a three-second deadline and returns `503` on failure or during shutdown. SIGTERM/Ctrl+C drains HTTP and closes the pool within ten seconds.
- Database tests cover our schema safeguards with representative cases. Avoid testing library defaults, SQL arithmetic, synthetic probe tables, or exhaustive field-validation matrices. Test feature behavior through services or HTTP routes as those features arrive.
- `tests/` covers requests, configuration, readiness, shutdown, and test-target guards. Fast checks skip database integration tests. Future feature code belongs in `src/modules/`; shared helpers in `src/lib/`; database code in `src/db/`.
- `scripts/test-integration.ts` runs on the host. It starts uniquely named PostgreSQL via `compose.test.yaml` on an assigned loopback port, creates and tests a generated database, verifies cleanup targets, and removes its project. Test storage is temporary and separate from real databases. Interrupted cleanup is attempted, with the project name printed for manual recovery if necessary. Stable Drizzle Kit repeat-push churn is known and deferred by the user; do not add patches, upgrades, or a repeat-push acceptance guard without revisiting that decision.
- `docs/docker-guide.md` explains the local workflow and deployment Dockerfile. `docs/database-guide.md` explains reference tables and test isolation. Earlier container-development notes under `docs/archive/` are historical.

## Data and API rules for later gates

- Never commit real environment files or copy them into images. Bun parses local settings once before supplying commands or Compose. Escape literal variable references as `\$NAME` in file values. A trailing dollar sign remains unescaped in Bun 1.3.14. Changing file credentials does not change a PostgreSQL user already stored in a volume.
- Keep local, test, and production storage separate. Normal local shutdown preserves data. Schema pushes and seeds are explicit steps, never server startup actions. Use Drizzle pushes without generating migration files; retain review for potentially destructive changes.
- Scope all finance records to an owner. Use a server-selected demo identity until optional session authentication is implemented. Future composite foreign keys must include owner ID to reject cross-owner links.
- Accept USD only. Money uses exact `numeric` with whole-cent/range checks rather than a scale that silently rounds input. Magnitude is limited to `999999999999.99`; transactions are nonzero and budget limits are positive. Money stays as strings in Drizzle and must be formatted to two decimals in future API output. Do not calculate it using JavaScript floating point.
- Composite foreign keys enforce matching owners for accounts, categories, tags, transaction links, and reversal references. Unique rules prevent duplicate tag links, budgets, and reversals. Restricted deletes protect references. The reversal service must enforce opposite amounts, copied metadata/tags, no chains, and active parents in a later gate.
- Preserve transaction history with reversal entries. Derive balances from entries instead of maintaining mutable balance totals.
- Use `/api/v1` for business routes, camelCase JSON, bounded pagination, validated input, and safe errors. Never log credentials, cookies, request bodies, or query strings.
- Use actual isolated PostgreSQL for constraint and transaction tests. PostgreSQL 18 restricted deletions use `23001`; future conflict handling must recognize it alongside foreign-key code `23503`.

## Scope limits

This is a local learning project. Public hosting, bank connections, transfers, multiple currencies, and savings goals remain outside the core plan. Authentication is a separate optional extension.
