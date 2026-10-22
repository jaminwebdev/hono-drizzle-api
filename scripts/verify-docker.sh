#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

command -v curl >/dev/null || { echo 'This check needs curl.' >&2; exit 1; }
[ -f .env.local ] || { echo 'Create .env.local from .env.example first.' >&2; exit 1; }
unset APP_ENV API_PORT POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB POSTGRES_PORT
unset COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES

compose() {
  docker compose --env-file .env.local -f compose.yaml "$@"
}

db_sql() {
  compose exec -T db sh -c \
    'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -At "$@"' sh "$@"
}

probe_name=gate3_probe_$$
probe_created=false
cleanup() {
  if [ "$probe_created" = true ]; then
    db_sql -c "DROP TABLE IF EXISTS $probe_name" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

sh scripts/docker.sh local check
sh scripts/docker.sh local up
api_port=$(compose exec -T api printenv API_PORT)
curl --fail --silent --show-error "http://127.0.0.1:$api_port/health/live"
echo

# A regular table, rather than a SQL temporary table, can survive a restart.
db_sql -c "CREATE TABLE $probe_name (value text NOT NULL); INSERT INTO $probe_name VALUES ('persisted');"
probe_created=true
sh scripts/docker.sh local down
sh scripts/docker.sh local up

result=$(db_sql -c "SELECT value FROM $probe_name")
[ "$result" = persisted ] || { echo 'Database persistence check failed.' >&2; exit 1; }
curl --fail --silent --show-error "http://127.0.0.1:$api_port/health/live"
echo
echo 'API responds and database data survived down/up.'

docker build --target runtime -t hono-drizzle-runtime-check .
docker run --rm --network none --read-only hono-drizzle-runtime-check \
  node --input-type=module -e '
    import { existsSync, readdirSync } from "node:fs";
    if (process.getuid() === 0 || existsSync("/app/node_modules/typescript") ||
        readdirSync("/app").some(name => name.startsWith(".env"))) process.exit(1);
    console.log("Runtime image uses a non-root user and excludes development tools and environment files.");
  '
echo 'Gate 3 checks passed. Local services remain running; the probe table is removed on exit.'
