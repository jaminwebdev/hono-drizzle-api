# Project map

## Code map

The current Bun 1.3.14 application uses Hono, Drizzle with Bun SQL, PostgreSQL, and Valibot. It provides health checks, shared HTTP handling, and email/password registration. The users and sessions tables are defined. Login, session validation, and finance tables are not implemented yet.

| File | Responsibility |
| --- | --- |
| [src/server.ts](src/server.ts) | Validate settings, create the database, start Bun, and own shutdown. |
| [src/config.ts](src/config.ts) | Validate supplied values without reading environment files. |
| [src/db/client.ts](src/db/client.ts) | Create one Drizzle database object backed by Bun's connection pool. |
| [src/db/schema.ts](src/db/schema.ts) | Define users and sessions, including email/token uniqueness, user references, timestamps, and session lookup/expiry indexes. |
| [drizzle.config.ts](drizzle.config.ts) | Guard local/test targets before schema pushes or Studio connect. |
| [tests/integration/setup.ts](tests/integration/setup.ts) | Create test database objects only for the isolated test target. |
| [src/app.ts](src/app.ts) | Build Hono routes with the explicitly supplied database and HTTP settings. |
| [src/http.ts](src/http.ts) | Install shared middleware, common errors, and the small JSON parsing helper. |
| [src/features/auth.ts](src/features/auth.ts) | Validate registration, bound attempts and password work, hash passwords, and insert users. |

Importing or constructing the app opens no database connection and starts no server. Bootstrap owns the resources and passes them to the app.

Routes, middleware, and helpers throw `ApiError` for expected request failures. Only `app.onError` calls the private error formatter; unexpected exceptions become generic `500` responses.

Use [setup](docs/setup.md) for settings, commands, database identities, storage, and tool notes. Use [the API guide](docs/api.md) for endpoints, request limits, origin policy, middleware order, and errors. The [implementation plan](sessions/001_fresh_start/01-architect-todos.md) holds approval gates and session decisions.

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
| R11. Authentication | Use email/password login and server-side sessions with an opaque session credential in an HttpOnly cookie. Local/test HTTP cookies omit Secure; production requires HTTPS and Secure cookies. Keep SameSite=Lax, host-only cookies, required exact Origin checks on writes, strict JSON parsing, and an explicit CORS allowlist. Use no separate CSRF token or retrieval endpoint. Safe HTTP methods must never perform business mutations. Build authentication after the scaffold and enforce user ownership as each finance feature is introduced. Passkeys and external login providers are deferred. |
| R12. Manual API testing | The user controls the development API in their own terminal and prefers manual checks in Requestly desktop. Agents may probe an existing instance when necessary. Use Requestly's cookie jar for the session and an approved Origin on writes. Do not require copying the session credential into collection or environment variables. |

## Boundaries

Run development on the host with PostgreSQL in Docker. Local HTTP needs no certificates. Preserve existing Docker data and keep fresh environments separate; their exact identities are in [setup](docs/setup.md#database-storage).

Each feature requires its own approval. Authentication and ownership precede finance endpoints. Public deployment is a separate decision; the retained production image and Compose stack remain unverified.
