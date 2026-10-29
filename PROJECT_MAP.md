# Project map

## Current state

The application runs on Bun 1.3.14 with Hono. `src/config.ts` uses a small Valibot schema to validate the mode, required database strings, and API/database ports. Invalid values stop startup with errors that omit submitted values. Configuration does not read files or guess a database target. Browser-origin validation arrives with request middleware.

`src/server.ts` opens the database connection and passes the same object to `createApp(database)` in `src/app.ts` before listening. Start PostgreSQL with `bun run db:up` before `bun run dev`. Local and test modes listen on loopback; production mode listens on all interfaces. The local template uses `127.0.0.1:3000`. Importing or constructing the app starts no server and opens no connection.

`GET /health/live` returns `200` with `{ "status": "ok" }` without querying PostgreSQL. `GET /health/ready` runs `SELECT 1` through Drizzle and returns `200` with the same body or a common `503` error with code `DATABASE_UNAVAILABLE`. Readiness uses the existing database timeouts; it adds no separate deadline or connection-reservation logic.

`src/http.ts` installs server-generated request IDs, no-store responses, browser security headers, an 8 KiB URL limit, method errors, and a common JSON error shape. Unexpected errors omit raw exception details. Hono's body-limit middleware enforces a 64 KiB request limit. The small JSON helper checks content type and calls `c.req.json()` with a safe parsing error. Feature fields remain the responsibility of each feature. See [the API guide](docs/api.md) for current behavior. Origin/CORS checks, content negotiation, and request logging follow in their own review.

`src/db/client.ts` builds one Drizzle 0.45.4 database object backed by Bun's SQL pool. Explicit settings choose the target; credentials are passed as options. The pool permits five connections, times out connection attempts after five seconds, applies PostgreSQL's five-second statement timeout, and closes idle connections after 30 seconds. Importing the module opens no connection. No application tables exist yet.

`bun run check` runs type checking, ESLint, Bun unit tests, and the Bun build. Test files are included in type checking. The bundle is `dist/server.js`. `bunfig.toml` disables automatic environment loading for application commands; `dev` explicitly selects `.env.local`. `start` requires caller-supplied settings. Both commands use `APP_ENV` for the mode. See the [README](README.md) for commands and [project notes](docs/discoveries.md) for the Bun package-manager exception.

PostgreSQL runs separately through `bun run db:up` and `bun run db:down`. Test commands use the `db:test:*` namespace. Local and test Compose files contain only PostgreSQL and retain their named volumes on shutdown. The [setup guide](docs/setup.md) lists environment identities and operating commands.

SIGINT, SIGTERM, uncaught exceptions, and unhandled promise rejections use one shutdown path. It stops accepting connections, drains requests, then closes the pool. A five-second deadline forces exit if cleanup stalls. Fatal errors and failed cleanup exit nonzero without logging raw error details.

Local development uses HTTP on loopback with no certificate setup. The scaffold provides health checks and shutdown. Authentication and finance features follow in the [approval-gated implementation plan](sessions/001_fresh_start/01-architect-todos.md).

## Confirmed project rules

| Rule | Requirement |
| --- | --- |
| R1. Stack | Use Bun 1.3.14, TypeScript, Hono, PostgreSQL, Drizzle, and Valibot. Use Bun for package commands and tests. Include `bun.lock` with dependency changes. |
| R2. Development | Run the API, checks, seeds, schema pushes, and Drizzle Studio on the host. Only PostgreSQL runs in Docker during development and integration testing. Keep a production API image for deployment and continuous integration checks. |
| R3. Code layout | Keep a feature's validation, handlers, and database queries in one readable feature file. Share concrete behavior such as JSON parsing and error responses. Prefer framework helpers when they meet the current need. Do not add controller, service, or repository layers. |
| R4. Configuration | Put commands directly in `package.json`. Disable automatic environment-file loading. Local commands explicitly select their environment file. Configuration validates supplied values without reading files or guessing the database target. |
| R5. Features | Support email/password authentication, accounts, transactions, categories, and tags. Tags must attach to both accounts and transactions and support search. Provide development seed data. |
| R6. Tests | Use Bun's built-in test runner. Test business decisions and failure behavior. Do not write tests that only prove Drizzle or PostgreSQL can insert and retrieve rows. |
| R7. Review | Implement small phases, each with user approval before continuing. Each phase covers one part of the current feature. Suggest a commit after each phase. The user makes all Git commits. Avoid changes to ten or more files after initial setup. |
| R8. Documentation | Active docs describe current behavior and decision reasons in beginner-friendly language, with useful examples and Mermaid diagrams. Apply `unslop` and preserve exact commands, paths, fields, and syntax. Keep history in session artifacts or the archive. Active docs must stand alone and contain no links to archived briefs. |
| R9. Schema changes | Use `drizzle-kit push` for all database schema changes, including local development, integration tests, and production checks. Do not generate or apply database migration files. |
| R10. Learning sequence | Scaffold first, then authentication, accounts, transactions, tags, and categories. Add each feature's schema, endpoints, middleware, validation, tests, and examples in small steps before moving to the next feature. Extend the schema with pushes as needed. Do not create the whole schema or future feature files in advance. Each review should explain the current request flow and how it changed. |
| R11. Authentication | Use email/password login and server-side sessions with an opaque session credential in an HttpOnly cookie. Local/test HTTP cookies omit Secure; production requires HTTPS and Secure cookies. Keep SameSite=Lax, host-only cookies, origin checks, and CSRF protection. Build authentication after the scaffold and enforce user ownership as each finance feature is introduced. Passkeys and external login providers are deferred. |
| R12. Manual API testing | The user controls the development API in their own terminal and prefers manual checks in Requestly desktop. Agents may probe an existing instance when necessary. Use Requestly's cookie jar for the session and a separate CSRF token for writes. Do not require copying the session credential into collection or environment variables. |

## Boundaries

Build the remaining features only after their phase is approved. Authentication and ownership must precede finance endpoints. Each user will access only their own records. Public deployment is a separate decision.

Preserve existing Docker data. The Compose projects are `finance-tracker-fresh-local`, `finance-tracker-fresh-test`, and `finance-tracker-fresh-production`. Host database ports are 5433, 5435, and 5434 respectively, all bound to loopback. PostgreSQL 18 volumes use `/var/lib/postgresql`.

The retained Dockerfile and production Compose configuration have not been validated for this scaffold. Follow the host development commands in the [README](README.md).
