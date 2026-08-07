#!/usr/bin/env bash
set -euo pipefail

infra_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
render_file=$(mktemp)
trap 'rm -f "$render_file"' EXIT

if command -v shellcheck >/dev/null; then
  shellcheck "$infra_root"/scripts/*.sh
else
  for script in "$infra_root"/scripts/*.sh; do
    bash -n "$script"
  done
  echo "warning: ShellCheck is unavailable; CI runs it" >&2
fi

if docker compose version >/dev/null 2>&1; then
  compose=(docker compose)
elif command -v docker-compose >/dev/null; then
  compose=(docker-compose)
else
  echo "Docker Compose is required" >&2
  exit 1
fi

API_ENV_FILE="$infra_root/compose/runtime/api.env.example" \
POSTGRES_ENV_FILE="$infra_root/compose/runtime/postgres.env.example" \
"${compose[@]}" \
  --env-file "$infra_root/compose/.env.example" \
  -f "$infra_root/compose/beta.compose.yml" \
  config --format json >"$render_file"

jq -e '
  ([.services[] | .image | test("@sha256:[0-9a-f]{64}$")] | all) and
  ([.services[] | .image | test("@sha256:0{64}$") | not] | all) and
  ([.services[] | .privileged // false] | any | not) and
  (.services.api | has("ports") | not) and
  (.services.postgres | has("ports") | not) and
  (.networks.data.internal == true)
' "$render_file" >/dev/null

if git -C "$infra_root/.." ls-files 'infra/compose/runtime/*.env' | \
  grep -vE '\.env\.example$' | grep -q .; then
  echo "runtime environment file is tracked" >&2
  exit 1
fi

echo "Beta infrastructure validation passed."
