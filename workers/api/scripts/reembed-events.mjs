// Re-embed events whose vector is missing or was made by another model, using
// the Workers AI REST API with the same model and input as the API Worker.
// Resumable: each batch commits on its own, and a rerun skips finished events.
//
//   DATABASE_URL=... node scripts/reembed-events.mjs --cf-account ACCOUNT_ID [--dry-run] [--all]
//
// Authenticates with CLOUDFLARE_API_TOKEN (Workers AI: Read) or `wrangler login`.
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  EMBEDDING_MODEL_ID,
  embeddingRequest,
  embeddingsFromResult,
  generateEventText,
} from "../src/services/embeddings.ts";
import { runCommand, wranglerBearerToken } from "./storage-common.mjs";

const BATCH_SIZE = 32;

// Rows that need a vector from the current model; --all also redoes current ones.
function pendingQuery(all, afterId) {
  return {
    text: `SELECT id, title, description, club_name, location_name FROM events
      WHERE id > $1 ${all ? "" : "AND embedding_model IS DISTINCT FROM $2"}
      ORDER BY id LIMIT ${BATCH_SIZE}`,
    values: all ? [afterId] : [afterId, EMBEDDING_MODEL_ID],
  };
}

export async function reembedEvents(options, { db, fetcher = fetch, getToken, log = console.log }) {
  const { "cf-account": account, "dry-run": dryRun = false, all = false } = options;
  if (!/^[a-f0-9]{32}$/.test(account ?? ""))
    throw new Error("--cf-account must be a 32-character lowercase hex account ID");

  const { rows: counts } = await db.query(
    `SELECT coalesce(embedding_model, '(none)') AS model, count(*)::int AS events
     FROM events GROUP BY 1 ORDER BY 1`,
  );
  for (const { model, events } of counts) log(`${model}: ${events} events`);
  if (dryRun) return { embedded: 0, skipped: 0, failed: 0 };

  const token = getToken();
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${EMBEDDING_MODEL_ID}`;
  let afterId = "";
  let embedded = 0;
  let skipped = 0;
  let failed = 0;
  while (true) {
    const { rows } = await db.query(pendingQuery(all, afterId));
    if (rows.length === 0) break;
    afterId = rows.at(-1).id;
    const texts = rows.map(generateEventText);
    let vectors = null;
    try {
      const response = await fetcher(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(embeddingRequest(texts)),
        redirect: "error",
        signal: AbortSignal.timeout(60_000),
      });
      const body = await response.json();
      if (response.ok && body.success) vectors = embeddingsFromResult(body.result, rows.length);
    } catch {
      // Counted below; never log event text or credentials.
    }
    if (!vectors) {
      failed += rows.length;
      log(`Batch after ${rows[0].id} failed; rerun to retry it`);
      continue;
    }
    await db.query("BEGIN");
    try {
      for (const [index, row] of rows.entries()) {
        // Skip an event an admin edited since it was read: its new text was
        // embedded by the API, or will be by the next run.
        const result = await db.query(
          `UPDATE events SET embedding_vector = $2::vector, embedding_model = $3
           WHERE id = $1 AND title = $4 AND description = $5
             AND club_name IS NOT DISTINCT FROM $6 AND location_name = $7`,
          [
            row.id,
            JSON.stringify(vectors[index]),
            EMBEDDING_MODEL_ID,
            row.title,
            row.description,
            row.club_name,
            row.location_name,
          ],
        );
        if (result.rowCount === 1) embedded++;
        else skipped++;
      }
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
    log(`Embedded ${embedded} events so far`);
  }
  log(`Done: ${embedded} embedded, ${skipped} skipped (edited meanwhile), ${failed} failed`);
  return { embedded, skipped, failed };
}

// Match drizzle.config.ts: verified TLS for remote databases unless the URL chooses.
function connectionString(raw) {
  const url = new URL(raw.replace(/^postgresql\+asyncpg:/, "postgresql:"));
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (!local && !["ssl", "sslmode"].some((key) => url.searchParams.has(key)))
    url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: {
      "cf-account": { type: "string" },
      "dry-run": { type: "boolean" },
      all: { type: "boolean" },
    },
  });
  const raw = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
  if (!raw) throw new Error("Set DATABASE_URL (or DIRECT_DATABASE_URL)");
  const db = new pg.Client({ connectionString: connectionString(raw) });
  await db.connect();
  try {
    const result = await reembedEvents(values, {
      db,
      getToken: () =>
        process.env.CLOUDFLARE_API_TOKEN ||
        wranglerBearerToken((args) =>
          runCommand(execFileSync, "pnpm", ["exec", "wrangler", ...args], {
            encoding: "utf8",
            env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
          }),
        ),
    });
    if (result.failed) process.exitCode = 1;
  } finally {
    await db.end();
  }
}
