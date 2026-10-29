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

| Setting | What to supply |
| --- | --- |
| `APP_ENV` | `local`, `test`, or `production`. |
| `API_PORT` | A decimal port from `1` to `65535`, without leading zeros. The local template uses `3000`. |
| `API_ORIGIN` | The exact public API origin, such as `http://127.0.0.1:3000`, without a path or trailing slash. Production requires HTTPS. |
| `CORS_ORIGINS` | An optional comma-separated browser allowlist for cross-origin resource sharing (CORS). Empty disables it. See [origin behavior](api.md#origins-and-browser-access). |
| `POSTGRES_HOST` | The supplied database hostname. Host commands use `127.0.0.1`. |
| `POSTGRES_PORT` | A decimal port using the same validation as `API_PORT`. Select the published port below. |
| `POSTGRES_USER`, `POSTGRES_DB` | Nonblank names for the selected database identity. |
| `POSTGRES_PASSWORD` | A nonblank password. Configuration preserves its characters rather than trimming it. |

Use separate credentials and these database identities:

| File | `APP_ENV` | Host PostgreSQL port | Database | User |
| --- | --- | --- | --- | --- |
| `.env.local` | `local` | 5433 | `finance_tracker_local` | `finance` |
| `.env.test` | `test` | 5435 | `finance_tracker_test` | `finance_test` |
| `.env.production` | `production` | 5434 | `finance_tracker_production` | `finance_production` |

The usual test API port is `3002`, with `API_ORIGIN=http://127.0.0.1:3002`. For production, supply the actual public HTTPS origin. It may differ from the API's internal address behind a deployment proxy. Production Compose explicitly uses `db:5432` inside its API container; host database tools use the published production port.

### Environment files

`bunfig.toml` sets `env = false`. Application commands select files explicitly: `dev` loads `.env.local`, while checks and builds use no environment files. Test configuration uses invented values. Commands are directly visible in `package.json`.

Bun 1.3.14's package manager ignores the runtime environment-file controls and reads default files such as `.env.local` and `.env.production`. Run dependency installation in a checkout without private environment files. For an existing checkout, keep those files outside it during package commands and restore them afterward. A clean temporary installation directory containing `package.json`, `bun.lock`, and `bunfig.toml` also avoids exposing application credentials to package commands. See the [upstream Bun issue](https://github.com/oven-sh/bun/issues/31450) and [runtime environment settings](https://bun.sh/docs/runtime/environment-variables).

For database commands, Bun parses the selected file and supplies its values to Docker Compose. Compose receives `--env-file /dev/null` so it does not independently parse another environment file. Unit tests do not load private files.

## Start and stop

Start PostgreSQL, then the API:

```sh
bun run db:up
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

## Check and build

| Command | Purpose |
| --- | --- |
| `bun run typecheck` | Check source and tests with TypeScript. |
| `bun run lint` | Check source and configuration with ESLint. |
| `bun run test` | Run Bun unit tests without PostgreSQL. |
| `bun run build` | Bundle the server into `dist/server.js`. |
| `bun run check` | Run type checking, lint, tests, and build in order. |

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

| Compose file | Project | Named volume |
| --- | --- | --- |
| `compose.yaml` | `finance-tracker-fresh-local` | `finance-tracker-fresh-local_postgres_data` |
| `compose.test.yaml` | `finance-tracker-fresh-test` | `finance-tracker-fresh-test_postgres_data` |
| `compose.production.yaml` | `finance-tracker-fresh-production` | `finance-tracker-fresh-production_postgres_data` |

Compose combines the explicit project name and `postgres_data` key to name each volume. Commands pass `-p` so an inherited `COMPOSE_PROJECT_NAME` cannot select a different project. An explicit global volume name would bypass this project boundary. See [Compose volume names](https://docs.docker.com/reference/compose-file/volumes/#name).

PostgreSQL 18 stores files under `/var/lib/postgresql/18/docker`; the volume mounts its parent `/var/lib/postgresql`. Preserve that image layout when changing Compose. See the [PostgreSQL image documentation](https://hub.docker.com/_/postgres).

`db:down` keeps the volume, and a later `db:up` reuses its files. PostgreSQL uses `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` to initialize an empty volume. Editing those values afterward does not change identities already stored in that volume. These separate project names leave older volumes untouched.
