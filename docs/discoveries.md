# Project discoveries

## 2026-10-23. Old Docker storage remains after the source restart

Docker reported one volume, `hono-drizzle-local_postgres_data`, and no containers. Its Compose labels identify project `hono-drizzle-local` and volume key `postgres_data`. The remaining Compose files use different names, `hono-drizzle-postgres-local` and `hono-drizzle-postgres-production`. A later Docker inventory may differ from this snapshot.

Why this matters: deleting source files does not delete Docker volumes. Changing `POSTGRES_DB` or a password also does not reinitialize a database that already has data. The restart should use new Compose projects and verify their resolved volume names before starting PostgreSQL. Leave the old volume untouched.

Temporary copies of the retained Compose files confirmed that explicit `-p finance-tracker-fresh-local` and `-p finance-tracker-fresh-production` resolve to their corresponding new `*_postgres_data` volumes, even with `COMPOSE_PROJECT_NAME=hono-drizzle-local` inherited from the shell. The check used invented credentials and did not start containers or change repository configuration.

Source: read-only `docker volume ls`, `docker ps -a`, and `docker volume inspect` during this session. See [Compose project naming](https://docs.docker.com/compose/how-tos/project-name/) and the PostgreSQL image's [environment-variable behavior](https://hub.docker.com/_/postgres).

## 2026-10-23. The existing PostgreSQL 18 mount is correct

Keep `/var/lib/postgresql` as the volume target while using PostgreSQL 18. Its default data directory is `/var/lib/postgresql/18/docker`.

Why this matters: older PostgreSQL image examples commonly mount `/var/lib/postgresql/data`. Applying that older path here could leave the intended volume outside the active data directory. Fresh storage requires a new volume identity, not an older mount path.

Source: the official [PostgreSQL image documentation, PGDATA](https://hub.docker.com/_/postgres).

## 2026-10-23. Bun 1.3.14 supports the required explicit environment workflow

A scratch directory under `/tmp` verified that `env = false` in `bunfig.toml` prevented automatic loading of `.env` and `.env.local`. Adding `--env-file=.env.local` loaded only the explicitly selected test file. The check used invented values and did not read project credentials.

Why this matters: the API, Drizzle, and Compose commands can share Bun's parsed environment without a second dotenv loader. Compose commands should use `--env-file /dev/null` after Bun loads the selected file, so Compose does not independently parse an unrelated `.env` file.

Source: local Bun 1.3.14 execution and [Bun environment documentation](https://bun.sh/docs/runtime/environment-variables).

## 2026-10-23. The retained Dockerfile is not buildable yet

The Dockerfile expects `package.json`, `bun.lock`, `bunfig.toml`, a build command, and `dist/server.js`. Those application inputs do not exist. Its `EXPOSE 3000` also differs from the production Compose default API port of 3001.

Why this matters: retain the image structure as a starting point, then reconcile the build output, startup arguments, and port in the production phase. A failed image build now would reflect the missing application, not a newly introduced regression.
