#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

command -v curl >/dev/null || { echo 'This check needs curl.' >&2; exit 1; }
[ -f .env.local ] || { echo 'Create .env.local from .env.example first.' >&2; exit 1; }

compose() {
  docker compose --env-file .env.local -f compose.yaml "$@"
}

db_sql() {
  compose exec -T db sh -c \
    'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -At "$@"' sh "$@"
}

probe_name=gate3_probe_$$
probe_created=false
database_stopped=false
studio_container=''
shutdown_container=''
cleanup() {
  if [ "$database_stopped" = true ]; then
    compose up --detach --wait --wait-timeout 120 db >/dev/null 2>&1 || true
  fi
  for container in "$studio_container" "$shutdown_container"; do
    if [ -n "$container" ]; then
      docker rm --force "$container" >/dev/null 2>&1 || true
    fi
  done
  if [ "$probe_created" = true ]; then
    db_sql -c "DROP TABLE IF EXISTS $probe_name" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

bun run docker:check
bun run docker:up
api_port=$(compose exec -T api printenv API_PORT)
api_url=http://127.0.0.1:$api_port
curl --fail --silent --show-error "$api_url/health/ready"
echo

# A regular table, rather than a SQL temporary table, can survive a restart.
db_sql -c "CREATE TABLE $probe_name (value text NOT NULL); INSERT INTO $probe_name VALUES ('persisted');"
probe_created=true
api_container=$(compose ps --quiet api)
compose stop api
[ "$(docker inspect --format '{{.State.ExitCode}}' "$api_container")" = 0 ] || {
  docker logs "$api_container" >&2
  echo 'Development server did not shut down cleanly.' >&2
  exit 1
}
docker logs "$api_container" 2>&1 | grep -F 'HTTP server and database pool closed.'
echo 'Development server closed HTTP and its pool on SIGTERM.'
bun run docker:down
bun run docker:up

result=$(db_sql -c "SELECT value FROM $probe_name")
[ "$result" = persisted ] || { echo 'Database persistence check failed.' >&2; exit 1; }
curl --fail --silent --show-error "$api_url/health/ready"
echo
echo 'API responds and database data survived down/up.'

docker build --target runtime -t hono-drizzle-runtime-check .
docker run --rm --network none --read-only hono-drizzle-runtime-check \
  bun --no-env-file -e '
    import { existsSync, readdirSync } from "node:fs";
    if (process.getuid() === 0 || existsSync("/app/node_modules/typescript") ||
        existsSync("/app/node_modules/drizzle-kit") ||
        readdirSync("/app").some(name => name.startsWith(".env"))) process.exit(1);
    console.log("Runtime image uses a non-root user and excludes development tools and environment files.");
  '

# A stopped database must fail readiness without failing process liveness.
database_stopped=true
compose stop db
ready_status=$(curl --silent --show-error --max-time 8 --output /dev/null \
  --write-out '%{http_code}' "$api_url/health/ready")
[ "$ready_status" = 503 ] || { echo 'Expected database readiness status 503.' >&2; exit 1; }
curl --fail --silent --show-error "$api_url/health/live"
echo
compose up --detach --wait --wait-timeout 120 db
database_stopped=false

attempt=0
until curl --fail --silent --max-time 6 "$api_url/health/ready"; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 15 ] || { echo 'Database readiness did not recover.' >&2; exit 1; }
  sleep 1
done
echo
echo 'Readiness returns 503 during a database outage and recovers afterward.'

# Use a temporary host port to avoid collisions with other processes on port 4983.
studio_container=$(compose --profile tools run --detach --no-deps --publish 127.0.0.1::4983 db-tools \
  bun --bun run drizzle-kit studio --config=drizzle.config.ts --host=0.0.0.0 --port=4983)
studio_binding=$(docker port "$studio_container" 4983/tcp)
case "$studio_binding" in
  127.0.0.1:*) studio_port=${studio_binding##*:} ;;
  *) echo 'Studio verification must publish only on loopback.' >&2; exit 1 ;;
esac
attempt=0
until bun --no-env-file -e '
  const socket = require("node:net").connect(Number(process.argv[1]), "127.0.0.1");
  socket.setTimeout(2000);
  socket.once("connect", () => { socket.destroy(); process.exit(0); });
  socket.once("error", () => process.exit(1));
  socket.once("timeout", () => process.exit(1));
' "$studio_port"; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 20 ] || { docker logs "$studio_container" >&2; exit 1; }
  sleep 1
done
echo 'Studio accepts connections through its loopback-only published port.'

# Test signals against built Bun code, without the development watcher.
shutdown_container=$(compose run --detach --no-deps api \
  sh -c 'bun run build && exec bun --no-env-file dist/server.js local')
attempt=0
until [ "$(docker inspect --format '{{.State.Health.Status}}' "$shutdown_container")" = healthy ]; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 30 ] || { docker logs "$shutdown_container" >&2; exit 1; }
  sleep 1
done
docker stop --timeout 12 "$shutdown_container" >/dev/null
[ "$(docker inspect --format '{{.State.ExitCode}}' "$shutdown_container")" = 0 ] || exit 1
docker logs "$shutdown_container" 2>&1 | grep -F 'HTTP server and database pool closed.'
echo 'Compiled server closed HTTP and its pool on SIGTERM.'
echo 'Docker and Gate 4 checks passed. Local services stay running; temporary checks are cleaned up on exit.'
