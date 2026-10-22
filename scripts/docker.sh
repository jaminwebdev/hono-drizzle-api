#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

mode=${1:-}
action=${2:-}

case "$mode" in
  local) compose_file=compose.yaml; settings_file=.env.local ;;
  production) compose_file=compose.production.yaml; settings_file=.env.production ;;
  *) echo 'Choose local or production.' >&2; exit 1 ;;
esac

if [ ! -f "$settings_file" ]; then
  echo "Create $settings_file from .env.example before running Docker." >&2
  exit 1
fi

# The selected file supplies project settings, even if the shell has other values.
unset APP_ENV API_PORT POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB POSTGRES_PORT
unset COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES

compose() {
  docker compose --env-file "$settings_file" -f "$compose_file" "$@"
}

case "$action" in
  up) compose up --build --detach --wait --wait-timeout 120 ;;
  down) compose down ;;
  logs) compose logs --follow api db ;;
  ps) compose ps ;;
  config) compose config --quiet ;;
  check)
    if [ "$mode" != local ]; then
      echo 'Run development checks with local check.' >&2
      exit 1
    fi
    compose --profile tools run --build --rm tools
    ;;
  *) echo 'Choose up, down, logs, ps, config, or check.' >&2; exit 1 ;;
esac
