import { getTableColumns, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db';
import { events, type Event } from '../db/schema';
import type { PublicEventRow } from '../presenters/events';

export const VIBE_WEIGHT_DEFAULT = 0.5;
export type RankedEvent = [PublicEventRow, number];
const { embeddingVector: _vector, ...columns } = getTableColumns(events);
const publicColumns = sql.join(Object.entries(columns).map(([property, column]) => sql`${column} AS ${sql.identifier(property)}`), sql`, `);

export async function averageSavedEmbedding(db: Db, savedEventIds: string[]): Promise<number[] | null> {
  if (savedEventIds.length === 0) return null;
  const result = await db.execute<{ embedding: string | null }>(sql`
    SELECT avg(embedding_vector)::text AS embedding FROM events
    WHERE id = ANY(${sql.param(savedEventIds)}::varchar[]) AND is_archived = false
  `);
  return result.rows[0]?.embedding ? JSON.parse(result.rows[0].embedding) as number[] : null;
}

async function rankCandidates(db: Db, candidates: SQL, embedding: number[] | null, vibes: string[], topN: number, vibeWeight: number): Promise<RankedEvent[]> {
  const vector = sql`${JSON.stringify(embedding)}::vector`;
  const vibeScore = sql`coalesce(
    (SELECT count(*) FROM (
      SELECT json_array_elements_text(candidates.vibes) AS vibe
      INTERSECT SELECT jsonb_array_elements_text(${JSON.stringify(vibes)}::jsonb) AS vibe
    ) intersection_vibes) * 1.0 /
    nullif((SELECT count(*) FROM (
      SELECT json_array_elements_text(candidates.vibes) AS vibe
      UNION SELECT jsonb_array_elements_text(${JSON.stringify(vibes)}::jsonb) AS vibe
    ) union_vibes), 0), 0.0)`;
  const cosine = sql`CASE WHEN vector_norm(candidates.embedding_vector) = 0 OR vector_norm(${vector}) = 0
    THEN 0.0 ELSE 1.0 - (candidates.embedding_vector <=> ${vector}) END`;
  const score = embedding === null ? vibeScore : sql`(1.0 - ${vibeWeight}) * (${cosine}) + ${vibeWeight} * (${vibeScore})`;
  const eligibility = embedding === null ? sql`(${vibeScore}) > 0` : sql`candidates.embedding_vector IS NOT NULL`;
  const result = await db.execute<Record<string, unknown>>(sql`
    WITH candidates AS MATERIALIZED (${candidates}), ranked AS (
      SELECT candidates.id, (${score}) AS score FROM candidates
      WHERE ${eligibility} ORDER BY score DESC, candidates.id LIMIT ${topN}
    )
    SELECT ${publicColumns}, ranked.score FROM events
    JOIN ranked ON events.id = ranked.id ORDER BY ranked.score DESC, events.id
  `);
  // db.execute intentionally skips Drizzle's select decoders: apply the existing
  // column codecs here, especially for timestamp strings returned by pg.
  return result.rows.map(row => {
    const event = Object.fromEntries(Object.entries(columns).map(([property, column]) => [
      property, row[property] === null ? null : column.mapFromDriverValue(row[property]),
    ])) as PublicEventRow;
    return [event, Number(row.score)];
  });
}

export async function similarEvents(db: Db, source: Event, options: { topN: number; vibeWeight: number }): Promise<RankedEvent[]> {
  const vector = source.embeddingVector;
  const candidates = vector === null ? sql`
    SELECT id, embedding_vector, vibes FROM events WHERE id <> ${source.id} AND is_archived = false
  ` : sql`
    SELECT id, embedding_vector, vibes FROM events
    WHERE id <> ${source.id} AND is_archived = false AND embedding_vector IS NOT NULL
    ORDER BY embedding_vector <=> ${JSON.stringify(vector)}::vector, id
    LIMIT ${Math.max(100, options.topN * 20)}
  `;
  return rankCandidates(db, candidates, vector, source.vibes ?? [], options.topN, options.vibeWeight);
}

export async function personalizedEvents(db: Db, options: { embedding: number[]; savedEventIds: string[]; vibes: string[]; topN: number }): Promise<RankedEvent[]> {
  const candidates = sql`
    SELECT id, embedding_vector, vibes FROM events
    WHERE NOT (id = ANY(${sql.param(options.savedEventIds)}::varchar[])) AND is_archived = false
    ORDER BY event_date DESC NULLS LAST, id LIMIT 200
  `;
  return rankCandidates(db, candidates, options.embedding, options.vibes, options.topN, VIBE_WEIGHT_DEFAULT);
}

/** Match Python round(score, 4), including ties and the exact binary float. */
export function roundScore(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Recommendation score is not finite');
  if (value === 0) return value;
  const data = new DataView(new ArrayBuffer(8));
  data.setFloat64(0, Math.abs(value));
  const bits = data.getBigUint64(0);
  const exponent = Number((bits >> 52n) & 0x7ffn);
  const mantissa = (bits & ((1n << 52n) - 1n)) | (exponent === 0 ? 0n : 1n << 52n);
  const power = (exponent === 0 ? -1022 : exponent - 1023) - 52;
  const numerator = mantissa * 10_000n * (power >= 0 ? 1n << BigInt(power) : 1n);
  const denominator = power < 0 ? 1n << BigInt(-power) : 1n;
  let rounded = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder * 2n > denominator || (remainder * 2n === denominator && rounded % 2n !== 0n)) rounded++;
  return Math.sign(value) * Number(rounded) / 10_000;
}
