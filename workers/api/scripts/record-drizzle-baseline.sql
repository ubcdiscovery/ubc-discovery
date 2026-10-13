BEGIN;
DO $$
BEGIN
  IF (SELECT version_num FROM alembic_version) <> '0012_queue_extraction' THEN
    RAISE EXCEPTION 'Expected Alembic head 0012_queue_extraction';
  END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT '7098a1b06b3677c55d95c9069b65eaffa8a1ebde23c1ffee07ddab1c16a22447', 1791846245147
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations);
COMMIT;
