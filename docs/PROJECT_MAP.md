# Project map

## Purpose

Build a personal finance API to learn Hono, PostgreSQL, and Drizzle. Work follows the approved [implementation plan](01-architect-todos.md), one review gate at a time. The user makes all commits.

## Stack

- Bun 1.3.14, TypeScript 5.9, and Hono using Bun's native HTTP server.
- Bun manages dependencies. `bun.lock` must accompany all dependency changes.
- Bun's built-in test runner tests behavior. TypeScript and ESLint check for coding mistakes.
- Zod validates startup settings. PostgreSQL uses `postgres:18.6-bookworm`. Drizzle ORM and `pg` provide database access. Drizzle Kit provides explicit schema pushes and Studio. `drizzle-seed` joins in a later gate.
- Use the hybrid workflow: Bun 1.3.14 and local `bun install --frozen-lockfile` provide editor types; the API, PostgreSQL, and verification checks run in Docker with `oven/bun:1.3.14-debian`. Both dependency installations use the same lockfile and stay separate. `.vscode/settings.json` selects the local TypeScript SDK.

## Code boundaries

- `src/app.ts` creates the Hono app without opening a port.
- `src/server.ts` validates settings before starting `Bun.serve` on `API_PORT`, which defaults to 3000.
- `bunfig.toml` disables automatic environment-file loading. Compose remains the sole file-selection step. The runtime also uses `--no-env-file` explicitly.
- `src/lib/config.ts` validates `process.env` only; it never reads files. Compose selects `.env.local` or `.env.production` and supplies values to containers. The single startup argument selects the expected mode, which must match `APP_ENV`. Errors never print credential values.
- `src/db/client.ts` creates a shared PostgreSQL connection pool and Drizzle client. `src/db/schema.ts` defines users, accounts, categories, and tags, including owner-aware unique names and owner-and-ID targets for future foreign keys. Names are 1–100 characters; email values must be normalized. Account types and USD currency are checked in PostgreSQL. `updated_at` requires an explicit value during future mutations.
- `/health/live` checks the process; `/health/ready` runs a database query with a three-second deadline and returns `503` during an outage or shutdown.
- SIGTERM and SIGINT stop HTTP requests and close the pool within a ten-second deadline. Compose allows fifteen seconds before forcing a stop.
- `tests/` checks requests, configuration, readiness, shutdown, and test-target guards. `tests/integration/` checks actual PostgreSQL constraints separately; it is skipped by fast checks.
- `scripts/test-integration.ts` creates one generated database per run, applies the schema with a test-only Drizzle configuration, runs integration tests, and drops only that database. Cleanup verifies names and connected identities.
- `docs/database-guide.md` explains reference tables, name rules, indexes, and test isolation.
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

- `compose.yaml` runs local API and database services. `compose.production.yaml` runs compiled API code and a separate database. API startup waits for the PostgreSQL health check. The API health check uses database readiness.
- `Dockerfile` has development, build, production-dependencies, and runtime stages. Development dependencies stay in the development image. Runtime runs as the non-root `bun` user and contains compiled code and production dependencies only.
- Local source changes reach the API through a read-only shared `src/` folder. Tools share source, tests, and configuration while using dependencies from the development image.
- Projects `hono-drizzle-local` and `hono-drizzle-production` have separate networks and named `postgres_data` volumes. PostgreSQL 18 stores data under the volume mounted at `/var/lib/postgresql`.
- Everyday Docker commands live directly in `package.json`, with explicit Compose and environment-file options. Standard Compose precedence applies: terminal values override file values. No dispatcher clears inherited settings. Down commands preserve volumes. Published ports bind to `127.0.0.1`.
- `bun run docker:rebuild` runs local `bun install --frozen-lockfile`, builds local API and tooling images, and updates local services without deleting database volumes. It stops on failure; checks remain a separate `docker:check` command. `compose.tools.yaml` remains an optional dependency-update helper; normal checks reuse the development image.

- The optional `db-tools` service runs Drizzle Kit with the selected environment credentials. The separate optional `studio` service shares database-tool settings and publishes only on loopback port 4983. `db:studio` starts or updates this background service; `db:studio:stop` stops it. `docker:down` selects all profiles and removes orphan containers from this project to clean up Studio and older tooling sessions. Drizzle explicitly disables SSL for the bundled PostgreSQL containers, which do not configure it. Production has an explicit push command and no published Studio port.
- `compose.test.yaml` uses a separate `hono-drizzle-test` project with no published ports or persistent database volumes. `test:integration` runs the suite and stops its services; `test:integration:down` removes the stopped test project. Test credentials are fixed and separate from environment-file credentials.
- `scripts/verify-docker.sh` checks real container behavior beyond `docker:check`. Its temporary Studio server uses an available loopback port and is removed on exit.

## Scope limits

The API is a local learning project. Public deployment, bank connections, transfers, multiple currencies, and savings goals are outside the core plan. Authentication is a separate optional extension.
