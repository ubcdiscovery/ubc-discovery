# Beta operations

All commands assume an independently reviewed release directory at
`/opt/ubc-discovery-beta`, private `runtime/*.env` files with mode `600`, and an
exact `release.env` containing digest-pinned images. Never copy secrets into a
review artifact or command log.

`release.env` must set `API_ENV_FILE` and `POSTGRES_ENV_FILE` to the absolute
host paths `/opt/ubc-discovery-beta/runtime/api.env` and
`/opt/ubc-discovery-beta/runtime/postgres.env`. The committed files under
`compose/runtime/` are templates only.

## Preview and deploy

```bash
cd /opt/ubc-discovery-beta
sudo docker-compose --env-file release.env -f compose/beta.compose.yml config --quiet
sudo docker-compose --env-file release.env -f compose/beta.compose.yml pull
sudo docker-compose --env-file release.env -f compose/beta.compose.yml up -d
sudo ./scripts/health.sh release.env
```

The executor may run these only when the reviewed manifest binds the commit,
Compose render hash, target, image digests, secret-reference versions, and exact
commands. No mutable tags such as `latest` are permitted.

## Backup

Run before a database migration and on the reviewed schedule:

```bash
cd /opt/ubc-discovery-beta
sudo ./scripts/backup-postgres.sh release.env /var/backups/ubc-discovery-beta
```

Copy the resulting dump and checksum to the separately approved encrypted
off-host destination. Local-only backup is not sufficient for launch readiness.

## Restore drill

Restore is destructive and requires a separate CEO-approved manifest. First
take and verify a fresh backup. Then stop the API, restore the exact selected
dump, restart, and run health checks:

```bash
cd /opt/ubc-discovery-beta
test -f /absolute/path/to/reviewed.dump
(cd /absolute/path/to && sha256sum --check reviewed.dump.sha256)
sudo docker-compose --env-file release.env -f compose/beta.compose.yml stop api
sudo docker-compose --env-file release.env -f compose/beta.compose.yml exec -T postgres \
  dropdb --if-exists -U ubc_discovery ubc_discovery_beta
sudo docker-compose --env-file release.env -f compose/beta.compose.yml exec -T postgres \
  createdb -U ubc_discovery ubc_discovery_beta
sudo docker-compose --env-file release.env -f compose/beta.compose.yml exec -T postgres \
  pg_restore --exit-on-error -U ubc_discovery -d ubc_discovery_beta \
  </absolute/path/to/reviewed.dump
sudo docker-compose --env-file release.env -f compose/beta.compose.yml start api
sudo ./scripts/health.sh release.env
```

## Rollback

Each successful beta release archives its non-secret `release.env`, Compose
file, Caddyfile, scripts, and manifest under a release ID. To roll back
application code and runtime configuration, restore the complete previously
healthy bundle; do not roll the database back unless its migration runbook
explicitly requires it.

```bash
cd /opt/ubc-discovery-beta
previous=releases/PREVIOUS_APPROVED_RELEASE
test -f "$previous/release.env"
test -f "$previous/compose/beta.compose.yml"
test -f "$previous/compose/Caddyfile"
sudo cp "$previous/release.env" release.env
sudo cp "$previous/compose/beta.compose.yml" compose/beta.compose.yml
sudo cp "$previous/compose/Caddyfile" compose/Caddyfile
sudo docker-compose --env-file release.env -f compose/beta.compose.yml config --quiet
sudo docker-compose --env-file release.env -f compose/beta.compose.yml pull api caddy
sudo docker-compose --env-file release.env -f compose/beta.compose.yml up -d api caddy
sudo ./scripts/health.sh release.env
```

If health fails, collect `docker-compose ps` and bounded service logs, stop, and
return to the reviewer. Do not fix forward interactively.
