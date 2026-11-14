import type { ApiHost } from "~/lib/api";

/** Collaborating hosts read as one credit, e.g. "UBC Esports × UBC K-Wave". */
export function hostCredit(hosts: readonly ApiHost[]): string | null {
  return hosts.length ? hosts.map((host) => host.name).join(" × ") : null;
}

export function hostPath(host: Pick<ApiHost, "handle">): string {
  return `/hosts/${encodeURIComponent(host.handle)}`;
}

/** A lowercase Instagram handle from `@Handle`, `handle` or a profile URL, or null. */
export function normalizeHandle(raw: string): string | null {
  let value = raw.trim().toLowerCase();
  const url = /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#]+)/.exec(value);
  if (url) value = url[1]!;
  value = value.replace(/^@/, "");
  return /^[a-z0-9._]{1,30}$/.test(value) ? value : null;
}
