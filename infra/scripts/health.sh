#!/usr/bin/env bash
set -euo pipefail

infra_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
release_env=${1:-"$infra_root/compose/.env"}
compose_file=${COMPOSE_FILE:-"$infra_root/compose/beta.compose.yml"}

test -f "$release_env"
set -a
# shellcheck disable=SC1090
. "$release_env"
set +a
: "${BETA_HOSTNAME:?BETA_HOSTNAME is required}"

compose() {
  docker-compose --env-file "$release_env" -f "$compose_file" "$@"
}

for service in caddy api postgres; do
  compose ps --services --filter status=running | grep -Fxq "$service"
done

compose exec -T postgres \
  pg_isready -U ubc_discovery -d ubc_discovery_beta
curl --fail --silent --show-error --max-time 10 \
  "https://${BETA_HOSTNAME}/" >/dev/null

echo "Beta health checks passed."
