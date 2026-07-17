# Beta infrastructure

Docker Compose is the source of truth for the beta application stack. AWS
Lightsail instance creation and resizing remain manual CEO actions. This beta
package does not manage AWS resources, DNS, SSH, or the host firewall. The
pre-existing `prod/` configuration is separate and unchanged by this baseline.

## Contents

- `compose/`: Caddy, FastAPI, and PostgreSQL topology.
- `HOST-RUNBOOK.md`: one-time Debian 13 preparation, with no firewall or SSH
  changes and no reboot.
- `OPERATIONS.md`: release, backup, restore, health, and rollback procedures.
- `scripts/`: local validation and operational helpers.
- `changes/`: exact non-executable review manifest for the first baseline.

EventScraper is intentionally absent: its current foundation has no runnable
container image or approved candidate-delivery contract.

## Validate locally

```bash
infra/scripts/validate.sh
```

The validation renders Compose using placeholder, non-secret configuration. It
does not pull images, connect to AWS, SSH to a host, or deploy anything.

Before any beta execution, a different agent must review the exact commit,
rendered Compose hash, image digests, secret references, commands, health checks,
and rollback in a new execution manifest. CTO approval is required.
