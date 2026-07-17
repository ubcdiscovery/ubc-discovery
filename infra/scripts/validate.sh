#!/usr/bin/env bash
set -euo pipefail

infra_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
render_file=$(mktemp)
trap 'rm -f "$render_file"' EXIT

for script in "$infra_root"/scripts/*.sh; do
  bash -n "$script"
done

if command -v shellcheck >/dev/null; then
  shellcheck "$infra_root"/scripts/*.sh
else
  echo "warning: shellcheck is unavailable; CI runs it" >&2
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
  (.services | keys | sort) == ["api", "caddy", "postgres"] and
  ([.services[] | .image | test("@sha256:[0-9a-f]{64}$")] | all) and
  ([.services[] | .image | test("@sha256:0{64}$") | not] | all) and
  ([.services[] | has("healthcheck")] | all) and
  ([.services[] | .logging.options["max-size"] == "10m"] | all) and
  ([.services[] | .logging.options["max-file"] == "3"] | all) and
  ([.services[] | .privileged // false] | any | not) and
  (.services.api | has("ports") | not) and
  (.services.postgres | has("ports") | not) and
  (.services.postgres.volumes[0].target == "/var/lib/postgresql") and
  (.networks.data.internal == true)
' "$render_file" >/dev/null

# shellcheck disable=SC2016 # Match the literal Caddy environment placeholder.
grep -Fxq '{$BETA_HOSTNAME} {' "$infra_root/compose/Caddyfile"
grep -Eq '^[[:space:]]*reverse_proxy api:8000$' \
  "$infra_root/compose/Caddyfile"

if grep -R -nE 'image:[[:space:]]*.*(:latest|@sha256:0{64})' \
  "$infra_root/compose/beta.compose.yml"; then
  echo "mutable or placeholder image found in Compose source" >&2
  exit 1
fi

if grep -R -qE \
  '(BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16})' \
  "$infra_root/compose"; then
  echo "credential-like content found in Compose templates" >&2
  exit 1
fi

if git -C "$infra_root/.." ls-files 'infra/compose/runtime/*.env' | \
  grep -vE '\.env\.example$' | grep -q .; then
  echo "runtime environment file is tracked" >&2
  exit 1
fi

echo "Beta infrastructure validation passed."
