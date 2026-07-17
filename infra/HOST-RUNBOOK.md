# Debian 13 beta host bootstrap

This is a proposed one-time runbook, not execution approval. A different agent
must review the exact commit and commands before the operator runs them.

It intentionally does not change UFW, SSH, DNS, AWS resources, or Docker daemon
configuration. It does not reboot. The current host uses UFW and has a pending
reboot; rebooting must be a separate reviewed change.

## Preconditions

- Keep the current SSH session open and open a second key-based session.
- Confirm the target in the private inventory; do not paste its address here.
- Confirm Debian 13 and at least 1.8 GiB memory.
- Confirm UFW is active with default-deny ingress and SSH remains allowed.
- Confirm no production credentials or data are present.

Read-only preflight:

```bash
set -eu
. /etc/os-release
test "$ID" = debian
test "$VERSION_ID" = 13
test "$(awk '/MemTotal/{print $2}' /proc/meminfo)" -ge 1800000
sudo sshd -t
sudo ufw status verbose
test ! -e /etc/docker/daemon.json || sudo jq empty /etc/docker/daemon.json
```

The last command may report `jq: command not found` on the current host; install
it below, then repeat the validation before restarting anything.

## Reviewed package and directory change

```bash
sudo apt-get update
sudo apt-get install --yes \
  ca-certificates curl docker.io docker-cli docker-compose jq
test ! -e /etc/docker/daemon.json || sudo jq empty /etc/docker/daemon.json
sudo systemctl enable --now docker
sudo install -d -o root -g root -m 0755 /opt/ubc-discovery-beta
sudo install -d -o root -g root -m 0700 \
  /opt/ubc-discovery-beta/runtime \
  /var/backups/ubc-discovery-beta
```

Do not add the administrative user to the `docker` group; Docker access is
root-equivalent. Operational commands use `sudo docker-compose`.

## Verification

```bash
sudo docker version
sudo docker-compose version
sudo systemctl is-active docker
sudo stat -c '%U:%G %a %n' \
  /opt/ubc-discovery-beta \
  /opt/ubc-discovery-beta/runtime \
  /var/backups/ubc-discovery-beta
sudo ufw status verbose
sudo sshd -t
```

Expected directory modes are `755`, `700`, and `700`. Stop and return to the
reviewer on any mismatch; do not improvise a firewall or SSH fix.
