import { asc, eq, inArray, sql } from "drizzle-orm";
import {
  candidateHosts,
  eventHosts,
  events,
  hosts,
  HOST_HANDLE_PATTERN,
  type Host,
} from "../db/schema";
import { ApiError } from "../http/errors";
import type { Database } from "./event-administration";

export type HostSummary = { handle: string; name: string };

/** A lowercase Instagram handle from `@Handle`, `handle` or a profile URL, or null. */
export function normalizeHandle(raw: string): string | null {
  let value = raw.trim().toLowerCase();
  const url = /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#]+)/.exec(value);
  if (url) value = url[1]!;
  value = value.replace(/^@/, "");
  return HOST_HANDLE_PATTERN.test(value) ? value : null;
}

/** Distinct valid handles in order; throws on an invalid one when `strict`. */
export function normalizeHandles(raw: readonly string[], strict = false): string[] {
  const handles: string[] = [];
  for (const item of raw) {
    const handle = normalizeHandle(item);
    if (!handle) {
      if (strict) throw new ApiError(422, `Invalid Instagram handle: ${item}`);
      continue;
    }
    if (!handles.includes(handle)) handles.push(handle);
  }
  return handles;
}

export function hostName(host: Pick<Host, "handle" | "displayName" | "profileName">): string {
  return host.displayName?.trim() || host.profileName?.trim() || host.handle;
}

export function presentHostSummary(host: Pick<Host, "handle" | "displayName" | "profileName">) {
  return { handle: host.handle, name: hostName(host) };
}

export async function ensureHosts(db: Database, handles: readonly string[]) {
  if (!handles.length) return;
  await db
    .insert(hosts)
    .values(handles.map((handle) => ({ handle })))
    .onConflictDoNothing();
}

/** Record what the source profile says about itself; admin display names are kept. */
export async function updateHostProfile(
  db: Database,
  handle: string,
  profile: { name?: string | null; instagramUserId?: string | null },
) {
  const changes: Partial<Host> = {};
  const name = profile.name?.trim();
  if (name) changes.profileName = name.slice(0, 255);
  const id = profile.instagramUserId?.trim();
  if (id && /^\d{1,32}$/.test(id)) changes.instagramUserId = id;
  if (Object.keys(changes).length)
    await db.update(hosts).set(changes).where(eq(hosts.handle, handle));
}

async function loadHosts<Key extends string>(
  db: Database,
  table: typeof eventHosts | typeof candidateHosts,
  keyColumn: typeof eventHosts.eventId | typeof candidateHosts.candidateId,
  ids: readonly Key[],
): Promise<Map<Key, HostSummary[]>> {
  const result = new Map<Key, HostSummary[]>(ids.map((id) => [id, []]));
  if (!ids.length) return result;
  const rows = await db
    .select({
      key: keyColumn,
      handle: hosts.handle,
      displayName: hosts.displayName,
      profileName: hosts.profileName,
    })
    .from(table)
    .innerJoin(hosts, eq(hosts.handle, table.hostHandle))
    .where(inArray(keyColumn, [...new Set(ids)]))
    .orderBy(asc(table.position), asc(table.hostHandle));
  for (const row of rows) result.get(row.key as Key)?.push(presentHostSummary(row));
  return result;
}

export function hostsForEvents(db: Database, ids: readonly string[]) {
  return loadHosts(db, eventHosts, eventHosts.eventId, ids);
}

export async function hostsForEvent(db: Database, id: string) {
  return (await hostsForEvents(db, [id])).get(id) ?? [];
}

export function hostsForCandidates(db: Database, ids: readonly string[]) {
  return loadHosts(db, candidateHosts, candidateHosts.candidateId, ids);
}

export async function candidateHostHandles(db: Database, candidateId: string): Promise<string[]> {
  const rows = await db
    .select({ handle: candidateHosts.hostHandle })
    .from(candidateHosts)
    .where(eq(candidateHosts.candidateId, candidateId))
    .orderBy(asc(candidateHosts.position), asc(candidateHosts.hostHandle));
  return rows.map((row) => row.handle);
}

export async function setEventHosts(db: Database, eventId: string, handles: readonly string[]) {
  await ensureHosts(db, handles);
  await db.delete(eventHosts).where(eq(eventHosts.eventId, eventId));
  if (handles.length)
    await db
      .insert(eventHosts)
      .values(handles.map((hostHandle, position) => ({ eventId, hostHandle, position })));
}

export async function setCandidateHosts(
  db: Database,
  candidateId: string,
  handles: readonly string[],
) {
  await ensureHosts(db, handles);
  await db.delete(candidateHosts).where(eq(candidateHosts.candidateId, candidateId));
  if (handles.length)
    await db
      .insert(candidateHosts)
      .values(handles.map((hostHandle, position) => ({ candidateId, hostHandle, position })));
}

/** Attach handles without disturbing existing ones, appended after them. */
export async function addCandidateHosts(
  db: Database,
  candidateId: string,
  handles: readonly string[],
) {
  if (!handles.length) return;
  await ensureHosts(db, handles);
  const [last] = await db
    .select({ value: sql<number>`coalesce(max(${candidateHosts.position}), -1)`.mapWith(Number) })
    .from(candidateHosts)
    .where(eq(candidateHosts.candidateId, candidateId));
  await db
    .insert(candidateHosts)
    .values(
      handles.map((hostHandle, index) => ({
        candidateId,
        hostHandle,
        position: last!.value + 1 + index,
      })),
    )
    .onConflictDoNothing();
}

/** Rows of `event_hosts` linking the outer event to a Host whose handle or name matches. */
export function hostMatch(pattern: string) {
  return sql`(SELECT 1 FROM ${eventHosts} JOIN ${hosts} ON ${hosts.handle} = ${eventHosts.hostHandle}
    WHERE ${eventHosts.eventId} = ${events.id}
      AND (${hosts.handle} ILIKE ${pattern} OR ${hosts.displayName} ILIKE ${pattern}
        OR ${hosts.profileName} ILIKE ${pattern}))`;
}
