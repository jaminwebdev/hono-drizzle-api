# Project map

## Purpose

Build a personal finance API to learn Hono, PostgreSQL, and Drizzle. Work follows the approved [implementation plan](01-architect-todos.md), one review gate at a time. The user makes all commits.

## Stack

- Node.js 24, TypeScript 5.9, Hono, and the Hono Node adapter.
- npm manages dependencies. `package-lock.json` must accompany the first code commit and all dependency changes.
- Vitest tests behavior. TypeScript and ESLint check for coding mistakes.
- PostgreSQL 18 is the selected database major for Gate 3. Drizzle ORM, Drizzle Kit, `pg`, `drizzle-seed`, and Zod join in later gates.
- All development, builds, tools, and checks run in Docker. The current tooling image is `node:24-bookworm-slim`; no host Node installation is required. Resolve exact dependency versions in the lockfile using Docker before accepting Gate 1.

## Code boundaries

- `src/app.ts` creates the Hono app without opening a port.
- `src/server.ts` starts the server. It currently listens on container port 3000.
- `tests/` contains request tests that call the app directly.
- Future feature code belongs in `src/modules/`; shared helpers in `src/lib/`; database code in `src/db/`.
- Documentation lives in `docs/`, with the entry-point README and project instructions at the repository root.

## Rules for later gates

- Run the API and PostgreSQL in separate containers. Container clients connect to `db:5432`.
- Select `.env.local` or `.env.production` explicitly. Never commit real secrets or copy them into images.
- Keep database data in named volumes. Separate local, production, and test data. Normal shutdown preserves data.
- Use Drizzle schema pushes, with explicit review for destructive changes. Do not generate migration files or push/seed during server startup.
- Scope all finance records to an owner. Use server-selected demo identity until optional session authentication is implemented.
- Accept USD only. Store exact decimal amounts and return money as strings. Never use JavaScript floating point for money calculations.
- Preserve transaction history with reversal entries. Derive balances from entries instead of storing mutable balance totals.
- Use `/api/v1` for business routes, camelCase JSON, bounded pagination, validated input, and safe error messages.
- Never log credentials, cookies, request bodies, or query strings.
- Use actual PostgreSQL in an isolated test database for constraint and transaction checks.

## Scope limits

The API is a local learning project. Public deployment, bank connections, transfers, multiple currencies, and savings goals are outside the core plan. Authentication is a separate optional extension.
