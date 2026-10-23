# Project discoveries

## Initial planning — 2026-10-22

- The workspace initially contains `setup.md`, `./docs/archive/API_design.md`, and `./docs/archive/database_design.md`; no application, package manifest, or project ledger exists. **Why this matters:** the plan starts with scaffolding and treats architecture choices as proposed until reviewed.
- Initially, `git status` reported no usable repository. The user subsequently confirmed they initialized Git. **Why this matters:** initialization is no longer outstanding; commits remain the user's responsibility.
- The requested workflow explicitly requires small increments, review gates, and manual commits. **Why this matters:** author the plan first; implementation must follow the approved gates rather than build the entire API immediately.
- The database reference recommends safe schema evolution, while `setup.md` explicitly chooses pushes instead of migration files. **Why this matters:** retain backup, review, constraint, and restore practices while using Drizzle Kit push as requested.
- The user confirmed that all application and tooling workflows should run in Docker. **Why this matters:** API and tooling consistently connect to `db:5432`; document direct Compose commands so host Node/npm is not required.

## Gate 1

- Documentation now lives in `docs/`. The root `AGENTS.md` points to the moved plan. **Why this matters:** future work must follow the current paths.
- Docker was initially unavailable in WSL. After the user refreshed WSL Integration, the CLI and Compose became available, but this session received permission denied when connecting to `/var/run/docker.sock`. **Why this matters:** Compose configuration can be checked here, but dependency installation, lockfile generation, tests, and compilation cannot yet be verified. Do not mark Gate 1 complete without those checks.
- `compose.tools.yaml` supplies the Docker tooling needed before Gate 3. **Why this matters:** Gate 1 must also work without host Node.js. Installed dependencies stay in temporary container storage; the lockfile and build output persist in the project.
- The existing `unslop` skill remains at `/home/jamin/.opencode/skills/unslop/SKILL.md`; the global Codex copy was not present when checked. **Why this matters:** follow the path in `AGENTS.md` rather than assuming the earlier manual copy took place.
- The user's first Docker run created `package-lock.json`, but installation failed with `EACCES` when esbuild tried to run its native program. The temporary dependency mount now explicitly includes `exec`. **Why this matters:** write permissions alone do not permit program execution. Confirm the fix by rerunning installation and checks; this session still cannot access the Docker socket.
- ESLint 9 is no longer maintained. Gate 1 now selects ESLint 10 and a TypeScript lint plugin version that supports it. **Why this matters:** regenerate the lockfile before running `npm ci`; the previous lockfile still reflects ESLint 9.
- After the fixes, the user reran the Docker commands successfully. The three request tests passed, and the build created `dist/server.js` without reported errors. The refreshed lockfile matches the package manifest and selects ESLint 10.13.0. **Why this matters:** Gate 1 is ready for review. Its runtime checks were user-run, not independently run by the assistant.

## Gate 2

- The original Gate 2 implementation supported file and container environment sources. This was superseded by the approved simplification below. **Why this matters:** that earlier design is historical, not the current configuration contract.
- Development now requires `.env.local` with database credentials, even though database connections start in Gate 4. **Why this matters:** startup validates the complete shared settings early; tests and builds still need no real secrets.
- The earlier plan mentioned host connection switching. The confirmed Docker-only workflow instead fixes container connections at `db:5432`; `POSTGRES_PORT` is only for optional host access. **Why this matters:** changing the published database port must not redirect container traffic.
- Gate 2 introduces Zod. Docker socket access remains blocked for the assistant. **Why this matters:** the user must refresh the lockfile and run Docker checks before this gate is marked verified.
- The user refreshed the lockfile and ran all Gate 2 checks successfully: type checking, linting, 25 tests, and the build. **Why this matters:** Gate 2 is ready for review. Docker works from the user's WSL terminal despite the assistant session's socket-access restriction; npm notices did not prevent installation or checks.

## Gate 3

- PostgreSQL 18's official image uses version-specific data directories beneath `/var/lib/postgresql`; the volume is mounted at that parent path. **Why this matters:** older examples mounting only `/var/lib/postgresql/data` do not match this image's default layout. Reference: [official PostgreSQL image](https://hub.docker.com/_/postgres).
- Local and production use separate Compose project names and volumes. The production example uses API port 3001 and database host port 5434 to avoid local defaults. **Why this matters:** both setups can run without sharing database storage or published ports.
- Development and check containers now reuse dependencies installed in the development image. Only source, tests, and configuration folders are shared. **Why this matters:** ordinary checks avoid repeated installation and do not populate host `node_modules`. Dependency changes require an image rebuild.
- The original host helper cleared inherited settings before reading the selected file. This was later superseded by direct npm commands using standard Compose precedence. **Why this matters:** current terminal variables can override environment-file values; the earlier clearing behavior is historical.
- Docker socket access is still blocked for the assistant. **Why this matters:** static Compose and shell checks passed here, but image builds, service health, and persistence need the user-run verification script before accepting Gate 3.
- The user completed `scripts/verify-docker.sh` successfully. All 26 tests, type checking, linting, and compilation passed. Both local services became healthy, the API responded before and after restart, and the probe row survived. The runtime image built and passed its non-root, TypeScript exclusion, and environment-file exclusion checks. **Why this matters:** Gate 3 is verified and ready for review. These are user-run results; the full production stack was not started. Local services remain running.

## Configuration simplification and documentation consolidation

- The user approved one configuration path before Gate 4. Compose reads the chosen environment file; the application validates `process.env` only. Removed the application file loader, source-selection argument, and redundant startup scripts. **Why this matters:** local and production follow the same settings flow. The expected mode still must match `APP_ENV`. The user subsequently confirmed verification succeeded and shared healthy API and PostgreSQL status. These checks were user-run because this session cannot access Docker's socket.
- The user moved the earlier Docker notes into `docs/archive/` and requested a single active guide. `docs/docker-guide.md` preserves the complete instruction walkthrough and integrates the startup, configuration, and operational details from the other note. **Why this matters:** use one maintained guide; keep archived originals unchanged. README and Gate 4 references now point to the active guide.

## Hybrid editor support

- The user approved local dependency installation for editor support while retaining Docker application execution and verification. **Why this matters:** an editor outside Docker needs local package types; container-only dependencies left unresolved imports and misleading TypeScript errors.
- `.vscode/settings.json` points to the project's TypeScript installation. Local dependencies remain ignored by Git, excluded from image builds, and separate from image dependencies. **Why this matters:** editor support does not change the application's runtime environment.
- `npm run docker:rebuild` runs local `npm ci`, builds API and tools images, then updates local services. It stops on failure and preserves database volumes. **Why this matters:** dependency changes synchronize both installations with one command; tests remain a separate Docker command.
- The assistant removed the empty, differently owned node_modules directory before trying installation. npm then failed because registry requests returned EAI_AGAIN in this restricted session. **Why this matters:** local packages are not installed yet; the user must complete the command in their terminal. Shell command sequencing can be checked here, but live Docker access is also unavailable.
- The user subsequently confirmed dependencies installed and all checks passed. The local TypeScript server files are now present. **Why this matters:** the hybrid setup is verified and ready for review; the earlier installation blocker is resolved through the user's terminal.

## Direct npm Docker commands

- The user chose direct Compose commands in `package.json` to simplify the workflow. Removed `scripts/docker.sh`; added direct `docker:build`, `docker:ps`, and `docker:check-config` shortcuts alongside existing commands. **Why this matters:** the commands are visible in one file, with no dispatcher to interpret.
- `docker:rebuild` still runs local `npm ci`, builds both development images, and updates services, stopping on failure. The separate smoke test now calls npm shortcuts. **Why this matters:** dependency synchronization and persistence checks retain their behavior without the deleted helper.
- Commands now use standard Compose precedence, without clearing inherited project variables. **Why this matters:** terminal settings can override the explicitly selected environment file; this behavior is documented in README and the Docker guide.
- Verified all ten direct npm-to-Compose commands with a Docker stub, plus rebuild ordering and stopping after failed installation or build. Both real Compose configurations validate; shell syntax, documentation links, JSON snippets, and whitespace checks pass. **Why this matters:** command behavior is checked without claiming live containers were run from this restricted session.
- Renamed the Compose validation shortcut to `docker:check-config` for clarity. `docker:check` continues to run code checks in a temporary development container, using current shared source files. **Why this matters:** configuration validation, application checks, and live container health are separate tasks.


## Gate 4

- Added a shared PostgreSQL pool, Drizzle client, explicit schema push commands, and local Studio. Finance tables remain for Gate 5. No schema changes run during API startup.
- Readiness runs a database query with a three-second deadline. Liveness remains independent of PostgreSQL. Shutdown closes HTTP and the pool within ten seconds; Compose allows fifteen seconds.
- The first Studio verification attempt collided with an occupied host port 4983. The script now requests an available loopback port. The usual Studio command retains port 4983, and existing sessions can remain running.
- The user supplied a complete successful verification run. Type checking, linting, 41 tests, compilation, persistence, outage recovery, runtime image contents, Studio connectivity, and compiled server shutdown passed. These were user-run checks because the assistant cannot access the Docker socket. Push execution and the full production stack have not been confirmed.
- Compose reported that the local network was still in use during down. Other containers attached to that network can keep it present after the main API and database are removed. The verification continued and passed; this message was not a port allocation error.


## Studio lifecycle and browser connection

- Replaced the one-off Studio command with an optional Compose `studio` service. Repeated `db:studio` commands reuse or update one service. Added stop/log commands, and local `docker:down` now includes all profiles. Older one-off sessions require one-time manual cleanup if they still hold port 4983.
- The installed Drizzle Kit prints its listening host in the browser URL. Docker requires `--host=0.0.0.0`, but the browser should use `https://local.drizzle.studio/?host=127.0.0.1`. Chrome may also require the Studio site's Apps on device or local/loopback network permission.
- Compose configuration validates with shared database credentials and loopback-only Studio publishing. Shell syntax and whitespace checks pass. The updated service lifecycle and browser connection still require user verification because this session cannot access Docker's socket.


## Studio database SSL correction

- Studio reached PostgreSQL but failed because the server does not support SSL. The installed Drizzle Kit passes an SSL options object when `dbCredentials.ssl` is omitted, while the API's `pg` pool defaults differ. Set `ssl: false` explicitly in `drizzle.config.ts` for the bundled Compose database in both environments. Externally hosted databases may require a different SSL policy.
- Added `--remove-orphans` to local `docker:down` so it also cleans up leftover containers from earlier tooling commands within this Compose project. Named database volumes remain preserved.
- The previous smoke check verified Studio's listening port, not a Studio database query. Its successful result did not verify the browser's database connection. The SSL fix still needs user-run Studio verification.


## Bun migration after Gate 4

- The user corrected the intended stack to Bun + Hono and approved migration. They also chose Bun's built-in test runner over retaining Vitest. Bun 1.3.14 is pinned locally and in `oven/bun:1.3.14-debian` images.
- Replaced the Hono Node adapter with `Bun.serve`, npm dependency management with `bun.lock`, and TypeScript emission with Bun bundling. TypeScript still checks types separately. Removed `tsx`, Vitest, and their obsolete configuration. PostgreSQL, Drizzle, the `pg` pool, data volumes, and the Studio service retain their roles.
- `bunfig.toml` disables automatic environment-file loading and points tests at `tests/`. Runtime commands also use `--no-env-file`; Compose continues selecting settings. Runtime and package-script behavior were checked with a harmless environment probe outside the project.
- The first watched server used Docker's full fifteen-second shutdown allowance. Docker now starts the Bun watcher directly, and the server explicitly exits after HTTP/pool cleanup. The smoke script checks its exit status and cleanup log, in addition to the separate built-server check.
- The final user-run smoke script passed all 41 Bun tests, type checking, lint, bundling, persistence, database outage recovery, runtime image checks, Studio port access, and watched/built SIGTERM shutdown. The watched server stopped in about 0.3 seconds. No application checks ran on the host; Docker results came from the user's terminal because this session cannot access its socket.
- Static local/production/helper Compose validation, lockfile consistency, documentation links/script names, shell syntax, and whitespace checks pass. Studio browser database access, schema push execution, and the full production stack remain unconfirmed. No commits were created.

- The user subsequently confirmed that both the Studio browser database connection and local `bun run db:push` ran successfully. Bun migration verification is complete for the local workflow; the full production stack remains untested. Pause for review before Gate 5.


## Gate 5: owners and reference schema

- Added users, accounts, categories, and tags with UUID defaults and timestamps. Owner-scoped names are unique ignoring case and remain reserved after archive. Names are trimmed, limited to 100 characters, and cannot contain control characters. Emails must be lowercase, trimmed, unique, and have a basic valid shape. Accounts accept checking/savings/cash and USD only. Updates must explicitly set `updated_at`.
- Each reference has a unique `(owner_id, id)` target for future composite foreign keys. The existing owner-first name and owner/ID indexes also cover owner lookups, so no redundant standalone owner index was added.
- Database tests use a separate `hono-drizzle-test` Compose project, network, fixed test-only credentials, no published database port, and temporary storage. The runner creates one generated database per run, pushes into that fresh target, and removes only that database. Cleanup verifies database/user identity and a strict generated-name pattern. Fast checks skip integration tests.
- PostgreSQL 18 reports restricted owner deletions as SQLSTATE `23001`, distinct from missing foreign-key targets (`23503`). Later API conflict mapping must recognize both. A temporary table cannot reference regular tables; the composite-key tests instead create a regular probe table inside a transaction and always roll it back.
- The user confirmed code checks and local schema push passed. All 57 PostgreSQL integration tests passed, including raw invalid inserts/updates, owner constraints, protected deletion, and cross-owner composite link rejection. Cleanup removed each test database, including after the earlier failed assertions. Docker execution was user-run because the assistant cannot access its socket. No production push, demo seed, migration file, or business route was added. Stop for Gate 5 review before Gate 6.


## Local-development pivot after Gate 5

- The user approved running Bun, Hono, Drizzle, and checks on the host, keeping PostgreSQL in Docker and retaining the production image for CI/deployment checks. Removed development API/tools/Studio services, the optional dependency helper, the old Docker smoke script, and their package shortcuts. The production Dockerfile has no development/watch stage.
- Added explicit `POSTGRES_HOST` and made `POSTGRES_PORT` the actual client port. Defaults are `127.0.0.1:5433`. Deployment Compose explicitly supplies `db:5432` to the API. Local mode binds the API to loopback. Existing database project/volume names stay unchanged.
- Bun explicitly loads `.env.local` for local API/Drizzle/database commands; validation reads supplied values only. Bun's file parser expands dollar references even inside quotes. Literal dollar signs must be escaped as `\$`. Database lifecycle commands load settings through Bun before invoking Compose so password parsing stays consistent. A harmless synthetic-value probe verified the child environment and Compose model. Real environment files were not edited.
- Integration tests now execute in host Bun. The runner creates a unique PostgreSQL Compose project on an assigned loopback port, checks connection identity and a generated database name, runs the schema push/tests, and cleans up the database/project. It attempts cleanup on interruption. This removes the integration runner image, fixed test port, and separate cleanup shortcut.
- Local type checking, lint, 66 fast tests, and bundling passed. Local, test, and production Compose models validate; active documentation commands/links, dependency-lock consistency, and whitespace checks pass. Docker/database/API verification through the user's terminal is pending because this session cannot access its socket. The old walkthrough is retained locally under docs/archive, while current guides describe the local workflow. No commits created; Gate 6 remains paused.

- The first local push returned password-authentication error `28P01`. A private parser comparison confirmed that the old Compose workflow and Bun interpreted the password differently. Updated only ignored `.env.local` quoting/escaping and verified that Bun now reads the old Compose password; no database password or data was changed. Bun 1.3.14 preserves an unwanted backslash when escaping a final dollar sign, so the docs now distinguish literal variable references from a trailing dollar. The user must retry the live connection from their terminal.


## Gate 6: financial schema

- The user confirmed the local-development pivot worked and approved Gate 6. Added transactions, transaction tags, and monthly budgets. Composite foreign keys enforce owner matching; uniqueness prevents duplicate tag links, monthly budgets, and reversals. Restricted deletes preserve referenced accounts, categories, tags, and original transactions. Query-driven indexes cover owner/date, account/category/date, tag filters, and budget-month lookups.
- Refined money storage from the planned `numeric(14,2)` to exact `numeric` plus whole-cent/range checks. PostgreSQL rounds to a declared scale before checks, so a fixed scale would silently change fractional-cent input. The allowed range remains through `999999999999.99` in magnitude; transaction amounts are nonzero and budget limits positive. NaN/infinity are rejected. Drizzle retains strings; future API output must format two decimals without floating-point arithmetic.
- Budgets use the first day of a finite month and `limit_amount`, exposed as `limitAmount`. Transaction business timestamps must be finite; descriptions are trimmed, nonempty, at most 500 characters, and have no control characters. Actual reversal copying/opposite amounts/no chains and archived-parent write coordination remain later service work. No database trigger makes rows globally immutable.
- The second-push check exposed existing Drizzle Kit introspection churn involving composite keys/indexes. Upstream documents a composite-key ordering bug in the stable line, fixed in the release candidate: https://github.com/drizzle-team/drizzle-orm/issues/6193. The user explicitly deferred this concern and asked to finish the phase. Removed the added repeat-push guard; no patch, version upgrade, or schema weakening was applied. Normal local push review remains.
- Local type checking, lint, 66 fast tests, and bundling passed. The user ran all 109 PostgreSQL tests successfully and confirmed the local push applied. Financial tests include exact money/bounds, invalid dates, ownership, links/budgets/reversal uniqueness, competing reversal inserts, protected references, and archive preservation. The reference suite still passes. No API routes, seeds, or migration files were added. Pause for Gate 6 review before Gate 7.


## Gate 6 test review

- The user requested narrower database coverage. Removed library/default-value checks, SQL arithmetic, synthetic owner-link probe tables, and broad field-validation matrices. Retained representative tests for declared ownership, money, uniqueness, archive-name, and protected-history rules, including competing reversal inserts. The schema and application behavior are unchanged.
- These suites verify database safeguards. Future service and HTTP tests must verify transaction creation, reversal behavior, archived-parent rules, and reports. The earlier 109-test result describes the original suites; the 19 trimmed tests need a fresh integration run.

- After trimming, type checking, lint, 66 fast tests, and bundling pass. Docker socket access is unavailable in this session, so the 19 database tests await user-run verification.
