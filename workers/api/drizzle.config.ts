import { defineConfig } from 'drizzle-kit';

function migrationUrl(raw: string | undefined): string {
  // Existing deployment secrets may still use the SQLAlchemy dialect spelling.
  const url = (raw ?? '').replace(/^postgresql\+asyncpg:/, 'postgresql:');
  if (!url) return url;
  const parsed = new URL(url);
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname);
  // Like the API Worker, require verified TLS for remote origins unless the URL chooses otherwise.
  if (!local && !['ssl', 'sslmode'].some(key => parsed.searchParams.has(key))) {
    parsed.searchParams.set('sslmode', 'verify-full');
  }
  return parsed.toString();
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: migrationUrl(process.env.DATABASE_URL) },
  strict: true,
});
