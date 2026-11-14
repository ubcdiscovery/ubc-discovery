import { Fragment } from "react";
import { Link } from "react-router";
import type { ApiHost } from "~/lib/api";
import { SOURCE_DISPLAY } from "~/lib/constants";
import { hostPath } from "~/lib/hosts";

/**
 * The source code block, then the hosts. `linked` makes each host open its page; leave it
 * off inside a card that is already one link.
 */
export function SourceBadge({
  sourceLabel,
  hosts,
  linked = false,
}: {
  sourceLabel: string;
  hosts: readonly ApiHost[];
  linked?: boolean;
}) {
  const m = SOURCE_DISPLAY[sourceLabel] ?? { code: "?", tone: "var(--color-muted)" };
  const fallback = sourceLabel.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold tracking-wider uppercase text-ink">
      <span
        className="inline-flex shrink-0 items-center justify-center w-7.5 h-4 text-on-color text-2xs tracking-wide"
        style={{ background: m.tone }}
      >
        {m.code}
      </span>
      <span className="min-w-0">
        {hosts.length === 0
          ? fallback
          : hosts.map((host, index) => (
              <Fragment key={host.handle}>
                {index > 0 && <span className="text-muted"> × </span>}
                {linked ? (
                  <Link
                    to={hostPath(host)}
                    className="text-ink no-underline hover:text-accent hover:underline"
                  >
                    {host.name}
                  </Link>
                ) : (
                  host.name
                )}
              </Fragment>
            ))}
      </span>
    </span>
  );
}
