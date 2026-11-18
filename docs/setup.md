# Setup and development reference

Run Bun 1.3.14 and developer tools on the host. Docker provides PostgreSQL. Local development uses HTTP and needs no certificates. The API listens on the loopback address, so only this machine can connect. The production image and Compose stack remain unverified; use the host commands here for development.

## First-time setup

Check that Bun prints `1.3.14` and Docker Compose is available:

```sh
bun --version
docker compose version
```

Install the locked dependencies before creating private environment files:

```sh
bun install --frozen-lockfile
```

For an existing checkout with private environment files, follow the [package-manager limitation](#environment-files) before running package commands.

Create the local file if it does not already exist:

```sh
test -f .env.local || cp .env.example .env.local
```

Choose a unique database password before first startup. Keep real environment files out of Git. When changing an existing setup, preserve its password unless you also intend to change the database role's password.

## Configuration

`.env.example` is the template. `src/config.ts` validates the values Bun supplies; it does not read files or choose connection targets. Invalid settings stop startup with field names rather than submitted values.

| Setting                        | What to supply                                                                                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ENV`                      | `local`, `test`, or `production`.                                                                                                                                    |
| `API_PORT`                     | A decimal port from `1` to `65535`, without leading zeros. The local template uses `3000`.                                                                           |
| `API_ORIGIN`                   | The exact public API origin, such as `http://127.0.0.1:3000`, without a path or trailing slash. Production requires HTTPS.                                           |
| `CORS_ORIGINS`                 | An optional comma-separated browser allowlist for cross-origin resource sharing (CORS). Empty disables it. See [origin behavior](api.md#origins-and-browser-access). |
| `POSTGRES_HOST`                | The supplied database hostname. Host commands use `127.0.0.1`.                                                                                                       |
| `POSTGRES_PORT`                | A decimal port using the same validation as `API_PORT`. Select the published port below.                                                                             |
| `POSTGRES_USER`, `POSTGRES_DB` | Nonblank names for the selected database identity.                                                                                                                   |
| `POSTGRES_PASSWORD`            | A nonblank password. Configuration preserves its characters rather than trimming it.                                                                                 |

Use separate credentials and these database identities:

| File              | `APP_ENV`    | Host PostgreSQL port | Database                     | User                 |
| ----------------- | ------------ | -------------------- | ---------------------------- | -------------------- |
| `.env.local`      | `local`      | 5433                 | `finance_tracker_local`      | `finance`            |
| `.env.test`       | `test`       | 5435                 | `finance_tracker_test`       | `finance_test`       |
| `.env.production` | `production` | 5434                 | `finance_tracker_production` | `finance_production` |

The usual test API port is `3002`, with `API_ORIGIN=http://127.0.0.1:3002`. For production, supply the actual public HTTPS origin. It may differ from the API's internal address behind a deployment proxy. Production Compose explicitly uses `db:5432` inside its API container; host database tools use the published production port.

### Environment files

`bunfig.toml` sets `env = false`. Application commands select files explicitly: `dev` loads `.env.local`, while checks and builds use no environment files. Test configuration uses invented values. Commands are directly visible in `package.json`.

Bun 1.3.14's package manager ignores the runtime environment-file controls and reads default files such as `.env.local` and `.env.production`. Run dependency installation in a checkout without private environment files. For an existing checkout, keep those files outside it during package commands and restore them afterward. A clean temporary installation directory containing `package.json`, `bun.lock`, and `bunfig.toml` also avoids exposing application credentials to package commands. See the [upstream Bun issue](https://github.com/oven-sh/bun/issues/31450) and [runtime environment settings](https://bun.sh/docs/runtime/environment-variables).

For database commands, Bun parses the selected file and supplies its values to Docker Compose. Compose receives `--env-file /dev/null` so it does not independently parse another environment file. Unit tests do not load private files.

## Start and stop

Start PostgreSQL, then the API:

```sh
bun run db:up
bun run db:push
bun run dev
```

`db:up` returns after PostgreSQL is ready and leaves its container running in the background. `dev` stays in your terminal and restarts the API when source files change. Startup opens one database connection before listening. Local/test APIs bind to loopback; production mode binds to all interfaces inside its container.

The shared Bun SQL pool permits five connections. Connection attempts and PostgreSQL statements have five-second timeouts; idle connections close after 30 seconds. The options live in `src/db/client.ts`. See the [API guide](api.md#health-requests) for liveness and readiness behavior.

Press `Ctrl+C` in the API terminal to stop accepting connections, finish active requests, and close the pool. Shutdown forces exit after five seconds if cleanup stalls. Fatal process errors use the same path with a nonzero exit status. PostgreSQL keeps running.

```mermaid
flowchart LR
    Signal[Ctrl+C or termination signal] --> Stop[Stop accepting connections]
    Stop --> Finish[Let active requests finish]
    Finish --> Pool[Close the database pool]
    Pool --> Exit[Exit the API process]
```

To follow database logs or stop its container while preserving data:

```sh
bun run db:logs
bun run db:down
```

Pressing `Ctrl+C` during `db:logs` only stops following the logs. For the separate test database, use `bun run db:test:up`, `bun run db:test:logs`, and `bun run db:test:down`. Local and test databases can run together because their project names, volumes, and ports differ.

## Schema and database tools

`src/db/schema.ts` defines the current database structure. It contains `users`, used by [registration](api.md#register-a-user) and [login](api.md#log-in), `sessions`, created during login, and user-owned `accounts`. Account creation, detail, listing, search, renaming, archival, and deletion endpoints are available as described in [the API guide](api.md#create-an-account-and-read-its-details).

```mermaid
erDiagram
    users ||--o{ sessions : "can have"
    users ||--o{ accounts : "owns"
    users {
        uuid id PK
        varchar email UK
        text password_hash
        timestamptz created_at
        timestamptz updated_at
    }
    sessions {
        uuid id PK
        text token_hash UK
        uuid user_id FK
        timestamptz created_at
        timestamptz last_seen_at
        timestamptz expires_at
    }
    accounts {
        uuid id PK
        uuid user_id FK
        varchar name
        text type
        varchar currency
        numeric opening_balance
        boolean is_archived
        timestamptz created_at
        timestamptz updated_at
    }
```

Each user has a generated UUID, a unique email of at most 254 characters, a password hash, and timestamps that include a time zone. Every field is required. The database rejects empty emails and emails with uppercase letters or surrounding spaces. Registration trims and lowercases email, validates its format, and hashes the password before insertion. The timestamps default to the insertion time; future update handlers must set `updated_at` explicitly.

One user can have several sessions, such as separate logins on two devices. Each session has its own generated UUID and a unique credential hash. The foreign key requires an existing user. Deleting a user directly from the database also deletes that user's sessions; there is no user-deletion API.

`token_hash` stores the SHA-256 hash of the random session credential issued by login in an HttpOnly cookie. The raw credential is never stored in the database. Writes require an approved Origin, with an explicit browser allowlist and SameSite cookies, as explained in the [API guide](api.md#origins-and-browser-access).

`created_at` records session creation, `last_seen_at` records the latest accepted use, and `expires_at` is the absolute expiry time. The first two default to insertion time; login supplies a deadline seven days later. Session validation enforces idle and absolute expiry and updates `last_seen_at` on accepted requests. Timestamps alone do not enforce expiry or delete rows. The unique credential index supports session lookup, while separate indexes on `user_id`, `last_seen_at`, and `expires_at` support revoking a user's sessions and cleaning up idle or expired rows.

Each account belongs to an existing user through `user_id`. PostgreSQL restricts deleting that user while an account references them. The account name must contain 1–100 characters without surrounding spaces; names may repeat. Supported types are `checking`, `savings`, `cash`, `credit`, and `investment`. Investment represents a cash balance without holdings or market prices. Currency defaults to `USD` and must be `USD`, `EUR`, or `GBP`. Accounts start with `is_archived=false`, a generated UUID, and insertion timestamps. The owner index supports finding a user's accounts and checking their references when deleting a user.

`opening_balance` is the starting amount, stored as PostgreSQL `NUMERIC(18,2)`. This permits sixteen digits before the decimal point and two after it, including negative and zero balances. It defaults to `0.00`; debt can be negative, such as `"-24.50"` on a credit account. Drizzle returns this field as a decimal string. Keep it as a string in JSON and never convert money to a JavaScript number. The database rejects non-finite values. PostgreSQL rounds excess fractional digits, so the account endpoint validates the exact two-decimal input format before insertion. See [PostgreSQL numeric types](https://www.postgresql.org/docs/18/datatype-numeric.html#DATATYPE-NUMERIC-DECIMAL).

Bun SQL can omit trailing zeros when returning a numeric value, such as returning `"0"` for a stored `0.00`. Account queries select `opening_balance::text` to preserve PostgreSQL's two-decimal representation without converting money to a JavaScript number.

Account creation takes ownership only from the validated session. The account PATCH route allows only name and archive-status changes, preserving the owner, currency, and opening balance. The foreign key alone does not make those columns immutable. The PATCH handler sets `updated_at` in the same atomic SQL update as the supplied name/archive fields. There is no separate mutable balance column; transactions and balance queries arrive in later phases.

| Command                | Purpose                                                                     |
| ---------------------- | --------------------------------------------------------------------------- |
| `bun run db:push`      | Compare the schema with the local database and apply changes.               |
| `bun run db:test:push` | Apply the same schema to the isolated test database.                        |
| `bun run db:studio`    | Open Drizzle's database editor, bound to `127.0.0.1`, using local settings. |

Start the selected database before pushing. After editing the schema, run the matching push command again. Drizzle applies differences directly without generating migration files. Review any data-loss prompt before accepting it; these commands do not force destructive changes. See the [Drizzle push guide](https://orm.drizzle.team/docs/drizzle-kit-push).

`drizzle.config.ts` uses the existing configuration validator and checks `DATABASE_TASK_MODE`, which each command sets explicitly. Local tasks require `APP_ENV=local`, `127.0.0.1:5433`, and `finance_tracker_local`. Test tasks require `APP_ENV=test`, `127.0.0.1:5435`, and `finance_tracker_test`. A mismatch stops the tool before connecting. `schemaFilter: ['public']` limits pushes to the PostgreSQL schema containing our tables. Production tasks are not enabled yet. Credentials are passed as separate options, so passwords do not need URL encoding.

Drizzle ORM and Drizzle Kit are both pinned to `1.0.0-rc.5`, a release candidate chosen for the built-in Valibot integration. Keep their versions compatible when upgrading. The development dependency `pg` is available to the database tools. The API uses `drizzle-orm/bun-sql/postgres` with its existing Bun SQL pool; it does not load Drizzle Kit. The PostgreSQL-specific import avoids bundling the MySQL and SQLite adapters.

### Integration test setup

`tests/integration/setup.ts` provides `createTestDatabase()`. It validates the supplied settings and requires the exact test mode, host, port, and database listed above before creating a database object. It never loads an environment file or falls back to local settings. Tests must use this helper before making writes or deleting their fixtures, and close the returned database's `$client` afterward.

To run integration tests:

```sh
bun run db:test:up
bun run db:test:push
bun run test:integration
```

Unit tests run without private environment files or PostgreSQL. `test:integration` explicitly loads `.env.test` and runs the auth, session, and account suites serially against the guarded test database. It covers registration, login, password preservation, independent hashed session credentials, safe errors, cookie flags, password-change races, bounded limits, session ownership, idle/absolute expiry, and revoked or unavailable sessions. Auth tests supply a trusted connection-address fixture. Tests delete only their own accounts and users, including cascading sessions. Account tests cover strict input, exact opening balances, two-user ownership, bounded lists, literal name search, archive filtering, owned patches, safe update failures, account locking, and owned deletion without revoking sessions. Cookie flags are checked through Hono requests. The user has independently verified the current authentication flows in Requestly with manually created collections and routes. Stop the test container with `bun run db:test:down` when finished; its volume remains.

## Remove expired sessions manually

Session validation already rejects a session at its 30-minute idle deadline or its absolute expiry time. An expired row can remain in PostgreSQL until you remove it with a maintenance command. Cleanup reclaims storage; authentication does not depend on running it.

Run the command for the database you intend to maintain:

| Command | Explicit environment file | Required database target |
| ------- | ------------------------- | ------------------------ |
| `bun run db:sessions:cleanup` | `.env.local` | `APP_ENV=local`, `127.0.0.1:5433`, `finance_tracker_local` |
| `bun run db:test:sessions:cleanup` | `.env.test` | `APP_ENV=test`, `127.0.0.1:5435`, `finance_tracker_test` |
| `bun run db:production:sessions:cleanup` | `.env.production` | `APP_ENV=production`, `127.0.0.1:5434`, `finance_tracker_production` |

Each command sets `DATABASE_TASK_MODE` and uses `src/config.ts` to validate the supplied settings. The mode, host, port, and database must match before the command creates a database object. Production cleanup is a host command using the published PostgreSQL port; it does not start or verify the production stack. The selected database must already be running.

Each run captures one current time and deletes at most 100 sessions where `expires_at <= now` or `last_seen_at <= now - 30 minutes`. Equality counts as expired, matching session validation. The command checks expiry again during deletion so it preserves a session refreshed while waiting for a row lock. Live sessions and users remain intact.

```mermaid
flowchart TD
    Command[Run the selected cleanup command] --> Guard[Validate settings and exact database target]
    Guard --> Delete[Delete up to 100 expired sessions]
    Delete --> Count[Print the deleted count]
    Count --> Close[Close this command's database pool and exit]
```

For example, `Deleted 100 expired sessions` means another batch may remain. Run the same command again to process another batch. A zero count means that run removed no rows. A concurrent refresh or logout can reduce the count. Each command exits after one batch; there is no scheduled cleanup or automatic retry. The existing five-second connection and statement timeouts also apply.

Failures print a safe message and exit with a nonzero status. Check the selected settings and PostgreSQL availability before trying again. The command closes its own pool on success or failure and does not start or stop the API or database containers.

## Check and build

| Command                    | Purpose                                                                         |
| -------------------------- | ------------------------------------------------------------------------------- |
| `bun run typecheck`        | Check source and tests with TypeScript.                                         |
| `bun run lint`             | Check source and configuration with ESLint.                                     |
| `bun run format`           | Format all supported project files with Prettier.                               |
| `bun run format:check`     | Check formatting without changing files.                                        |
| `bun run test`             | Run Bun unit tests without PostgreSQL.                                          |
| `bun run test:integration` | Run auth, session, and account tests against the prepared test PostgreSQL database. |
| `bun run build`            | Bundle the server into `dist/server.js`.                                        |
| `bun run check`            | Run type checking, lint, tests, and build in order.                             |

Prettier uses `.prettierrc.json` for shared formatting rules, including single quotes in JavaScript and TypeScript. It skips files listed in `.gitignore` and `.prettierignore`, including generated output and `bun.lock`. The VS Code Prettier extension also uses the locally installed version and configuration.

The project pins TypeScript 6.0.3 and typescript-eslint 8.72.1, whose supported TypeScript range ends below 6.1.0. Bun's type package matches runtime version 1.3.14. Check compatibility when updating these packages together and include `bun.lock` with dependency changes.

After stopping the development API, run the built bundle with local settings:

```sh
bun run build
bun --env-file=.env.local dist/server.js
```

`bun run start` uses settings supplied by its caller. A host production-mode run can explicitly load `.env.production` with `bun --env-file=.env.production run start`; it needs the production database and a public HTTPS `API_ORIGIN`. This command does not validate the retained production image or authorize public deployment.

## Database storage

```mermaid
flowchart LR
    Terminal[Your terminal] --> API[Bun API on the host]
    Requestly[Requestly desktop] --> API
    API --> Pool[Shared Drizzle database and Bun pool]
    Pool --> Docker[PostgreSQL in Docker]
    Docker --> Volume[Named volume retains database files]
```

| Compose file              | Project                            | Named volume                                     |
| ------------------------- | ---------------------------------- | ------------------------------------------------ |
| `compose.yaml`            | `finance-tracker-fresh-local`      | `finance-tracker-fresh-local_postgres_data`      |
| `compose.test.yaml`       | `finance-tracker-fresh-test`       | `finance-tracker-fresh-test_postgres_data`       |
| `compose.production.yaml` | `finance-tracker-fresh-production` | `finance-tracker-fresh-production_postgres_data` |

Compose combines the explicit project name and `postgres_data` key to name each volume. Commands pass `-p` so an inherited `COMPOSE_PROJECT_NAME` cannot select a different project. An explicit global volume name would bypass this project boundary. See [Compose volume names](https://docs.docker.com/reference/compose-file/volumes/#name).

PostgreSQL 18 stores files under `/var/lib/postgresql/18/docker`; the volume mounts its parent `/var/lib/postgresql`. Preserve that image layout when changing Compose. See the [PostgreSQL image documentation](https://hub.docker.com/_/postgres).

`db:down` keeps the volume, and a later `db:up` reuses its files. PostgreSQL uses `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` to initialize an empty volume. Editing those values afterward does not change identities already stored in that volume. These separate project names leave older volumes untouched.
