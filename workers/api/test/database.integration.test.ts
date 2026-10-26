import { getTableColumns, getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vite-plus/test";
import type { ApiEnv } from "../src/env";
import { schema, withDatabase, withTransaction } from "../src/db";

// This suite must only target a disposable local database migrated by Alembic.
const testUrl = process.env.TEST_DATABASE_URL;
if (testUrl && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(testUrl).hostname)) {
  throw new Error("Database integration tests require a disposable localhost database");
}
const env = { DATABASE_URL: testUrl } as ApiEnv;
const normalizeType = (type: string) =>
  type
    .replace("character varying", "varchar")
    .replace("timestamp with time zone", "timestamp with time zone")
    .replace("float8", "double precision");

describe.skipIf(!testUrl)("existing Alembic database compatibility", () => {
  it("maps every table, column, PostgreSQL type, nullability and SQL default in the migrated database", async () => {
    await withDatabase(env, async (db) => {
      const rows = await db.execute<{
        table_name: string;
        column_name: string;
        sql_type: string;
        not_null: boolean;
        has_default: boolean;
      }>(sql`
        SELECT c.relname AS table_name, a.attname AS column_name,
               format_type(a.atttypid, a.atttypmod) AS sql_type,
               a.attnotnull AS not_null, a.atthasdef AS has_default
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND a.attnum > 0 AND NOT a.attisdropped AND c.relname <> 'alembic_version'
        ORDER BY c.relname, a.attnum
      `);
      const tables = Object.values(schema).filter((value) => is(value, PgTable));
      expect([...new Set(rows.rows.map((row) => row.table_name))].sort()).toEqual(
        tables.map(getTableName).sort(),
      );
      for (const table of tables) {
        const columns = Object.values(getTableColumns(table));
        const actual = rows.rows.filter((row) => row.table_name === getTableName(table));
        expect(actual.map((row) => row.column_name).sort()).toEqual(
          columns.map((column) => column.name).sort(),
        );
        for (const column of columns) {
          const row = actual.find((value) => value.column_name === column.name)!;
          expect(normalizeType(row.sql_type), `${row.table_name}.${row.column_name} type`).toBe(
            normalizeType(column.getSQLType()),
          );
          expect(row.not_null, `${row.table_name}.${row.column_name} nullability`).toBe(
            column.notNull,
          );
          expect(row.has_default, `${row.table_name}.${row.column_name} SQL default`).toBe(
            column.default !== undefined,
          );
        }
      }
    });
  });

  it("round-trips application defaults, timestamps, JSON and pgvector while rolling back all fixture writes", async () => {
    const rolledBack = new Error("intentional integration fixture rollback");
    await expect(
      withDatabase(env, (db) =>
        withTransaction(db, async (tx) => {
          const id = crypto.randomUUID();
          const [user] = await tx
            .insert(schema.users)
            .values({
              id,
              firebaseUid: id,
              email: `${id}@example.test`,
              preferredName: "Integration fixture",
              interests: ["music"],
            })
            .returning();
          expect(user!.isAdmin).toBe(false);
          expect(user!.ubcVerified).toBe(false);
          expect(user!.onboardingCompleted).toBe(false);
          expect(user!.createdAt).toBeInstanceOf(Date);
          expect(user!.interests).toEqual(["music"]);

          const embedding = [1, ...Array<number>(1023).fill(0)];
          const [event] = await tx
            .insert(schema.events)
            .values({
              title: "Integration fixture",
              source: "manual",
              locationName: "UBC",
              eventDate: new Date("2030-01-01T12:00:00Z"),
              embeddingVector: embedding,
            })
            .returning();
          expect(event!.id).toMatch(/^[A-Za-z0-9_-]{8}$/);
          expect(event!.description).toBe("");
          expect(event!.vibes).toEqual([]);
          expect(event!.sourceLabel).toBe("campus_community");
          expect(event!.eventDate.toISOString()).toBe("2030-01-01T12:00:00.000Z");
          expect(event!.embeddingVector).toEqual(embedding);

          const [candidate] = await tx
            .insert(schema.eventListingCandidates)
            .values({
              sourceAccount: "fixture",
              sourceType: "integration_test",
              externalSourceId: id,
            })
            .returning();
          expect(candidate!.processingGeneration).toBe(1);
          expect(candidate!.status).toBe("pending");
          expect(candidate!.imageKeys).toEqual([]);
          expect(candidate!.vibes).toEqual([]);
          throw rolledBack;
        }),
      ),
    ).rejects.toBe(rolledBack);
  });
});
