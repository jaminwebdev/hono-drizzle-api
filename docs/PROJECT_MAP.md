# Project map

## Purpose

Build a personal finance API to learn Hono, PostgreSQL, and Drizzle. Work follows the approved [implementation plan](01-architect-todos.md), one review gate at a time. The user makes all commits.

## Stack

- Node.js 24, TypeScript 5.9, Hono, and the Hono Node adapter.
- npm manages dependencies. `package-lock.json` must accompany the first code commit and all dependency changes.
- Vitest tests behavior. TypeScript and ESLint check for coding mistakes.
- Zod validates startup settings. PostgreSQL uses `postgres:18.6-bookworm`. Drizzle ORM, Drizzle Kit, `pg`, and `drizzle-seed` join in later gates.
- Use the hybrid workflow: Node.js 24 and local `npm ci` provide editor types; the API, PostgreSQL, and verification checks run in Docker with `node:24.22.1-bookworm-slim`. Both dependency installations use the same lockfile and stay separate. `.vscode/settings.json` selects the local TypeScript SDK.

## Code boundaries

- `src/app.ts` creates the Hono app without opening a port.
- `src/server.ts` validates settings before starting the server on `API_PORT`, which defaults to 3000.
- `src/lib/config.ts` validates `process.env` only; it never reads files. Compose selects `.env.local` or `.env.production` and supplies values to containers. The single startup argument selects the expected mode, which must match `APP_ENV`. Errors never print credential values.
- `tests/` contains request tests that call the app directly.
- Future feature code belongs in `src/modules/`; shared helpers in `src/lib/`; database code in `src/db/`.
- Documentation lives in `docs/`, with the entry-point README and project instructions at the repository root.

## Rules for later gates

- Run the API and PostgreSQL in separate containers. Container clients connect to `db:5432`.
- Select `.env.local` or `.env.production` explicitly through Compose. Keep one application configuration path and two startup scripts: `dev` for local watching, `start` for compiled production code. Never commit real secrets or copy them into images.
- Database connection options always use `db:5432` with separate user/password/database fields. `POSTGRES_PORT` controls only optional access from the host computer.
- Keep database data in named volumes. Separate local, production, and test data. Normal shutdown preserves data.
- Use Drizzle schema pushes, with explicit review for destructive changes. Do not generate migration files or push/seed during server startup.
- Scope all finance records to an owner. Use server-selected demo identity until optional session authentication is implemented.
- Accept USD only. Store exact decimal amounts and return money as strings. Never use JavaScript floating point for money calculations.
- Preserve transaction history with reversal entries. Derive balances from entries instead of storing mutable balance totals.
- Use `/api/v1` for business routes, camelCase JSON, bounded pagination, validated input, and safe error messages.
- Never log credentials, cookies, request bodies, or query strings.
- Use actual PostgreSQL in an isolated test database for constraint and transaction checks.

## Docker setup

- `compose.yaml` runs local API and database services. `compose.production.yaml` runs compiled API code and a separate database. API startup waits for the PostgreSQL health check. Database queries and application readiness begin in Gate 4.
- `Dockerfile` has development, build, production-dependencies, and runtime stages. Development dependencies stay in the development image. Runtime runs as the non-root `node` user and contains compiled code and production dependencies only.
- Local source changes reach the API through a read-only shared `src/` folder. Tools share source, tests, and configuration while using dependencies from the development image.
- Projects `hono-drizzle-local` and `hono-drizzle-production` have separate networks and named `postgres_data` volumes. PostgreSQL 18 stores data under the volume mounted at `/var/lib/postgresql`.
- `scripts/docker.sh` selects the matching file and clears inherited project settings. Down commands preserve volumes. Published ports bind to `127.0.0.1`.
- `npm run docker:rebuild` runs local `npm ci`, builds local API and tools images, and updates local services without deleting database volumes. It stops on failure; checks remain a separate `docker:check` command. `compose.tools.yaml` remains an optional dependency-update helper; normal checks reuse the development image.

## Scope limits

The API is a local learning project. Public deployment, bank connections, transfers, multiple currencies, and savings goals are outside the core plan. Authentication is a separate optional extension.
