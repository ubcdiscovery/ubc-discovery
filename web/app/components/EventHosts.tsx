import { Fragment } from "react";
import { Link } from "react-router";
import type { ApiHost } from "~/lib/api";
import { hostPath } from "~/lib/hosts";

/** Inline host names, each linking to its page: "UBC Esports × UBC K-Wave". */
export function HostLinks({ hosts }: { hosts: readonly ApiHost[] }) {
  return (
    <>
      {hosts.map((host, index) => (
        <Fragment key={host.handle}>
          {index > 0 && <span className="text-muted"> × </span>}
          <Link to={hostPath(host)} className="text-accent no-underline hover:underline">
            {host.name}
          </Link>
        </Fragment>
      ))}
    </>
  );
}

/** Stacked hosts with their handles, for the desktop event sidebar. */
export function HostList({ hosts }: { hosts: readonly ApiHost[] }) {
  return (
    <ul className="mt-1.5 flex flex-col gap-2">
      {hosts.map((host) => (
        <li key={host.handle}>
          <Link to={hostPath(host)} className="group block text-ink no-underline">
            <span className="font-display font-bold text-lg/tight tracking-tight group-hover:text-accent">
              {host.name}
            </span>
            <span className="mt-0.5 block font-mono text-xs tracking-wide text-accent uppercase">
              @{host.handle} · All events →
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
