# Project map

## Current state

This repository is restarting as a personal finance API. Planning is complete enough for review, but implementation has not started. The remaining root files are reusable setup files, not a working application. There is no `package.json`, `bun.lock`, `bunfig.toml`, application code, database schema, or test suite yet.

The original requirements are in [new_start.md](docs/archive/new_start.md). Later user decisions below take precedence. The proposed design and approval gates are in [01-architect-todos.md](sessions/001_fresh_start/01-architect-todos.md). Proposed behavior becomes a project rule only after the user approves it.

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
| R8. Documentation | Use beginner-friendly explanations, concrete examples, and useful Mermaid diagrams. Apply the `unslop` skill. Preserve exact commands, paths, API fields, and syntax. |
| R9. Schema changes | Use `drizzle-kit push` for all database schema changes, including local development, integration tests, and production checks. Do not generate or apply database migration files. |
| R10. Learning sequence | Scaffold first, then authentication, accounts, transactions, tags, and categories. Add each feature's schema, endpoints, middleware, validation, tests, and examples in small steps before moving to the next feature. Extend the schema with pushes as needed. Do not create the whole schema or future feature files in advance. Each review should explain the current request flow and how it changed. |
| R11. Authentication | Use email/password login and server-side sessions with an opaque session credential in an HttpOnly, Secure cookie. Build authentication after the scaffold and enforce user ownership as each finance feature is introduced. Passkeys and external login providers are deferred. |
| R12. Manual API testing | Use Requestly desktop for the documented manual walkthrough. Use its cookie jar for the session and a separate CSRF token for writes. Do not require copying the session credential into collection or environment variables. |

## Boundaries

Authentication and user ownership are now part of the initial build. The plan must include email/password sessions before finance endpoints, safe cookie handling, request-forgery protection, and tests that one user cannot access another user's records. Planning approval does not authorize implementation or public deployment. The user will approve the first phase after reviewing the revised plan.

The user requested fresh Docker storage that does not collide with older data. Do not remove or reuse old volumes as part of the restart. Proposed environment names and the verification steps are in the implementation plan.

No load, capacity, or response-time targets have been supplied. The plan must bound requests and lists, explain query indexes, and distinguish measured results from proposed targets.

## Existing setup

The repository retains `compose.yaml`, `compose.production.yaml`, `Dockerfile`, `.env.example`, `.env.local`, `.dockerignore`, `.gitignore`, `tsconfig.json`, and `eslint.config.js`. The local environment file is ignored by Git. The production environment file is absent. Do not publish environment-file contents or replace local credentials without a reason.

The Compose files currently use `hono-drizzle-postgres-local` and `hono-drizzle-postgres-production`. Both mount `postgres_data` at `/var/lib/postgresql` for `postgres:18.6-bookworm`. The Dockerfile pins Bun 1.3.14 and refers to application files that have been removed.

See [discoveries.md](docs/discoveries.md) for verified setup details and their reasons.
