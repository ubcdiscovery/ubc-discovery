#!/usr/bin/env bash
set -euo pipefail
umask 077

infra_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
release_env=${1:?usage: backup-postgres.sh RELEASE_ENV ABSOLUTE_BACKUP_DIR}
backup_dir=${2:?usage: backup-postgres.sh RELEASE_ENV ABSOLUTE_BACKUP_DIR}
compose_file=${COMPOSE_FILE:-"$infra_root/compose/beta.compose.yml"}

test -f "$release_env"
case "$backup_dir" in
  /*) ;;
  *) echo "backup directory must be absolute" >&2; exit 2 ;;
esac
test "$backup_dir" != "/"
install -d -m 0700 "$backup_dir"

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
final="$backup_dir/ubc-discovery-beta-$timestamp.dump"
temporary="$final.partial"

cleanup() {
  rm -f "$temporary"
}
trap cleanup EXIT

docker-compose --env-file "$release_env" -f "$compose_file" exec -T postgres \
  pg_dump --format=custom --no-owner --no-acl \
  -U ubc_discovery ubc_discovery_beta >"$temporary"
test -s "$temporary"
mv "$temporary" "$final"
(
  cd "$backup_dir"
  sha256sum "$(basename "$final")" >"$(basename "$final").sha256"
)

echo "Backup created: $final"
