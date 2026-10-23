# Hono and Drizzle finance API

A personal finance API built in small, reviewable steps. Hono and PostgreSQL now run in separate Docker containers. The API currently exposes a health route; Drizzle and finance routes come in later gates.

See the [approved plan](docs/01-architect-todos.md) and [project map](docs/PROJECT_MAP.md).

Read the [Docker setup guide and instruction walkthrough](docs/docker-guide.md) for the complete local startup flow, configuration explanation, Dockerfile instructions, and Compose settings.

## Start locally

Use Node.js 24 and npm in your WSL project for editor support, and Docker with Docker Compose to run the API, database, and checks. Docker uses Node.js 24.22.1. In WSL, enable your distro in Docker Desktop's WSL Integration settings.

Copy the example settings, then replace its example password:

```bash
cp .env.example .env.local
```

Install local editor dependencies, build the development images, and start both containers:

```bash
npm run docker:rebuild
```

In VS Code, open this project through WSL and choose **TypeScript: Select TypeScript Version → Use Workspace Version** if prompted. `.vscode/settings.json` points the editor to the project's TypeScript installation.

For later startups with unchanged dependencies, use `npm run docker:up`.

The first run downloads images and installs dependencies. Later builds reuse unchanged steps. The command waits for PostgreSQL and the API to become healthy.

```bash
curl http://localhost:3000/health/live
```

Expected response:

```json
{ "data": { "status": "ok" } }
```

The API starts after PostgreSQL is ready, but it does not query the database yet. Gate 4 adds that connection and database readiness checks. No schema push or seed runs at startup.

## What Docker runs

An image is a prepared environment containing a program and its dependencies. A container runs that image. Compose describes how related containers run together.

```mermaid
flowchart LR
    Client["Your browser or curl"] -->|"localhost:3000"| API["API container"]
    Source["Your src folder"] -->|"Shared for automatic restarts"| API
    API -.->|"db:5432 connection comes in Gate 4"| DB["PostgreSQL container"]
    DB --> Data["Named database volume"]
    Tools["Temporary tools container"] --> Checks["Type checks, lint, tests, build"]
```

The local API shares your `src/` folder, so source edits restart it automatically. Local `node_modules` supplies editor types; each development image has its own installed dependencies. The containers do not share host `node_modules`, and `.dockerignore` excludes it from image builds. Both installations use the same lockfile. Tool containers reuse the development image's dependencies.

PostgreSQL stores data in a named volume, which is storage managed by Docker. Removing a container does not remove this volume. [Docker explains persistent volumes here](https://docs.docker.com/engine/storage/volumes/).

## Docker command reference

Run these commands from your WSL project terminal. Each uses `.env.local`, except the commands ending in `:production`, which use `.env.production`.

| Command | Purpose | Effect on containers |
| --- | --- | --- |
| `npm run docker:up` | Normal startup. Build the local API image if needed, then wait for API and database health checks. | Start services or update changed containers. |
| `npm run docker:rebuild` | After dependency changes: run local `npm ci`, build API and tools images, then wait for service health checks. Does not run code checks. | Start services or update changed containers; preserve database data. |
| `npm run docker:check` | Run TypeScript checking, ESLint, Vitest tests, and compilation using the development image and current shared code. | Build if needed, run a temporary tools container, then remove it. Does not inspect the running API or production image. |
| `npm run docker:check-config` | Validate Compose settings and required environment values without printing resolved credentials. Does not check application code. | Do not build images or start containers. |
| `npm run docker:build` | Build local API and tools development images only. Also used by `docker:rebuild`. | Do not start or replace running containers. |
| `npm run docker:ps` | Show local service status, including health information when available. | Observe existing containers. |
| `npm run docker:logs` | Follow API and database logs. Ctrl+C stops following the logs. | Leave services running. |
| `npm run docker:down` | Stop and remove local service containers and their network. | Preserve the named database volume and its data. |
| `npm run docker:up:production` | Build the production runtime image if needed and start the separate production setup. | Start or update production services and wait for health checks. |
| `npm run docker:down:production` | Stop and remove production service containers and their network. | Preserve the production database volume. |
| `npm run docker:logs:production` | Follow production API and database logs. | Leave production services running. |

For everyday work, use `docker:up`, `docker:logs`, and `docker:check`. Use `docker:rebuild` after dependency changes. `docker:check-config` answers whether Docker settings are valid; `docker:check` answers whether the code checks pass inside the development environment.

Each shortcut contains its Compose command directly in `package.json`.

You can also call Compose directly:

```bash
docker compose --env-file .env.local -f compose.yaml up --build --detach --wait
docker compose --env-file .env.local -f compose.yaml down
docker compose --env-file .env.local -f compose.yaml logs --follow api db
docker compose --env-file .env.local -f compose.yaml --profile tools run --build --rm tools
```

Both npm shortcuts and direct Compose commands use standard precedence: matching terminal variables override values in the selected environment file. Unset exported project variables when you want the file values. There is no command dispatcher or automatic environment clearing.

`docker:check` builds the development tools image if needed and runs type checking, linting, tests, and compilation in a new temporary container. It reads your current shared source and tests; it does not inspect the running API container or verify the production image.

`docker:up`, `docker:down`, `docker:logs`, `docker:check`, and `docker:rebuild` run from your computer. Do not run these shortcuts inside a container; the containers do not contain Docker.

## Environment settings

Keep `.env.local` and `.env.production` private. Git ignores them, and `.dockerignore` excludes them from image builds. Only `.env.example` belongs in Git.

| Setting                                             | Purpose                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `APP_ENV`                                           | `local` for development or `production` for the production setup. Startup rejects a mismatch.                 |
| `API_PORT`                                          | API port inside Docker and on your computer. Local default is `3000`.                                         |
| `POSTGRES_PORT`                                     | Optional database access from your computer. Local default is `5433`. Container clients always use `db:5432`. |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Required credentials supplied to both PostgreSQL and the API.                                                 |

Keep passwords containing `#`, `$`, or spaces in single quotes, as shown in `.env.example`. Credentials remain separate connection fields, so URL characters do not need encoding.

Ports bind to `127.0.0.1`, which limits published access to your computer. Changing a database password in the environment file does not change an existing database's password. PostgreSQL uses its initialization settings only when its data volume is empty. Keep the file consistent with the stored credentials.

## Production setup

Create `.env.production` from the example and use separate credentials. Set:

```dotenv
APP_ENV=production
API_PORT=3001
POSTGRES_PORT=5434
```

Then run:

```bash
npm run docker:up:production
curl http://localhost:3001/health/live
npm run docker:down:production
```

The direct startup command is:

```bash
docker compose --env-file .env.production -f compose.production.yaml up --build --detach --wait
```

The production image contains compiled JavaScript and production dependencies. It runs as the `node` user rather than root and has no shared source folder. This demonstrates a production build; the example still has no authentication or public hosting setup.

| Setup      | Compose project           | Database volume                         |
| ---------- | ------------------------- | --------------------------------------- |
| Local      | `hono-drizzle-local`      | `hono-drizzle-local_postgres_data`      |
| Production | `hono-drizzle-production` | `hono-drizzle-production_postgres_data` |

The different projects also have separate networks. The suggested ports let both run at once. Normal down commands preserve both volumes. Adding `--volumes` to a down command deletes that project's database data.

## Verify Gate 3

```bash
sh scripts/verify-docker.sh
```

This runs the code checks, checks the API through its published port, saves a probe row, stops and restarts local services, and reads the row back. It removes the probe table afterward. It also builds the production image and checks that it runs without root privileges, development tools, or environment files. Local services remain running for inspection.

## Change dependencies

Add a package from your WSL terminal, then synchronize the local editor installation and Docker images:

```bash
npm install package-name
npm run docker:rebuild
npm run docker:check
```

After manually editing dependency declarations in `package.json`, run `npm install --package-lock-only` before the rebuild command. `npm ci` requires an up-to-date lockfile; it does not update one.

`docker:rebuild` runs these steps in order:

1. `npm ci` installs exact locked dependencies locally for your editor.
2. Docker builds the local API and tools images, reusing unchanged build steps.
3. Compose starts or updates local services and waits for health checks. Database storage is preserved.

A failed step stops the command. Code checks remain a separate `npm run docker:check` command. Rebuilding starts services too, so `.env.local` must already exist.

Commit `package.json` and `package-lock.json` after dependency changes. Do not commit `node_modules`. `compose.tools.yaml` remains available as an optional Docker-based dependency-update helper.

## Application scripts

These run inside the development image. They do not require real environment files for checks or builds.

| Script                      | Purpose                                                               |
| --------------------------- | --------------------------------------------------------------------- |
| `dev`                       | Watch source edits using local settings supplied by Compose.          |
| `build`                     | Compile TypeScript into `dist/`.                                      |
| `start`                     | Run compiled code with production settings supplied to the container. |
| `typecheck`, `lint`, `test` | Check types, coding mistakes, or behavior.                            |
| `test:watch`                | Rerun tests after edits.                                              |
| `check`                     | Run all code checks and compile the app.                              |
