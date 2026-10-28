# Project map

## Current state

The application runs on Bun 1.3.14 with Hono. `src/config.ts` uses a small Valibot schema to validate `APP_ENV` and convert `API_PORT` into a number. Invalid values stop startup with errors that omit submitted values. Configuration does not read files. Database and browser-origin validation arrive when those features need them.

`src/server.ts` uses the validated `API_PORT` and forwards requests to `src/app.ts`. Local and test modes listen on loopback; production mode listens on all interfaces. The local template uses `127.0.0.1:3000`. `GET /health/live` returns `200` with `{ "status": "ok" }`. Importing the app does not start a server.

`bun run check` runs type checking, ESLint, Bun unit tests, and the Bun build. Test files are included in type checking. The bundle is `dist/server.js`. `bunfig.toml` disables automatic environment loading for application commands; `dev` explicitly selects `.env.local`. `start` requires caller-supplied settings. Both commands use `APP_ENV` for the mode. See the [README](README.md) for commands and [project notes](docs/discoveries.md) for the Bun package-manager exception.

PostgreSQL runs separately through `bun run db:up` and `bun run db:down`. Test commands use the `db:test:*` namespace. Local and test Compose files contain only PostgreSQL and retain their named volumes on shutdown. The [setup guide](docs/setup.md) lists environment identities and operating commands.

The current API is a liveness scaffold with no database queries. Database connection code, authentication, and finance features follow in the [approval-gated implementation plan](sessions/001_fresh_start/01-architect-todos.md).

## Confirmed project rules

| Rule | Requirement |
| --- | --- |
| R1. Stack | Use Bun 1.3.14, TypeScript, Hono, PostgreSQL, Drizzle, and Valibot. Use Bun for package commands and tests. Include `bun.lock` with dependency changes. |
| R2. Development | Run the API, checks, seeds, schema pushes, and Drizzle Studio on the host. Only PostgreSQL runs in Docker during development and integration testing. Keep a production API image for deployment and continuous integration checks. |
| R3. Code layout | Keep a feature's validation, handlers, and database queries in one readable feature file. Share concrete behavior such as JSON parsing and error responses. Do not add controller, service, or repository layers. |
| R4. Configuration | Put commands directly in `package.json`. Disable automatic environment-file loading. Local commands explicitly select their environment file. Configuration validates supplied values without reading files or guessing the database target. |
| R5. Features | Support email/password authentication, accounts, transactions, categories, and tags. Tags must attach to both accounts and transactions and support search. Provide development seed data. |
| R6. Tests | Use Bun's built-in test runner. Test business decisions and failure behavior. Do not write tests that only prove Drizzle or PostgreSQL can insert and retrieve rows. |
| R7. Review | Implement small phases, each with user approval before continuing. Each phase covers one part of the current feature. Suggest a commit after each phase. The user makes all Git commits. Avoid changes to ten or more files after initial setup. |
| R8. Documentation | Active docs describe current behavior and decision reasons in beginner-friendly language, with useful examples and Mermaid diagrams. Apply `unslop` and preserve exact commands, paths, fields, and syntax. Keep history in session artifacts or the archive. Active docs must stand alone and contain no links to archived briefs. |
| R9. Schema changes | Use `drizzle-kit push` for all database schema changes, including local development, integration tests, and production checks. Do not generate or apply database migration files. |
| R10. Learning sequence | Scaffold first, then authentication, accounts, transactions, tags, and categories. Add each feature's schema, endpoints, middleware, validation, tests, and examples in small steps before moving to the next feature. Extend the schema with pushes as needed. Do not create the whole schema or future feature files in advance. Each review should explain the current request flow and how it changed. |
| R11. Authentication | Use email/password login and server-side sessions with an opaque session credential in an HttpOnly, Secure cookie. Build authentication after the scaffold and enforce user ownership as each finance feature is introduced. Passkeys and external login providers are deferred. |
| R12. Manual API testing | The user controls the development API in their own terminal and prefers manual checks in Requestly desktop. Agents may probe an existing instance when necessary. Use Requestly's cookie jar for the session and a separate CSRF token for writes. Do not require copying the session credential into collection or environment variables. |

## Boundaries

Build the remaining features only after their phase is approved. Authentication and ownership must precede finance endpoints. Each user will access only their own records. Public deployment is a separate decision.

Preserve existing Docker data. The Compose projects are `finance-tracker-fresh-local`, `finance-tracker-fresh-test`, and `finance-tracker-fresh-production`. Host database ports are 5433, 5435, and 5434 respectively, all bound to loopback. PostgreSQL 18 volumes use `/var/lib/postgresql`.

The retained Dockerfile and production Compose configuration have not been validated for this scaffold. Follow the host development commands in the [README](README.md).
