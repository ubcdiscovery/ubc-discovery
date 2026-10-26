import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  account,
  apiOrigin,
  validateProductionConfiguration,
} from "./cloudflare-production-preflight.mjs";

const fixture = {
  DATABASE_URL: "postgresql+asyncpg://fixture:private@ep-fixture.us-west-2.aws.neon.tech/neondb",
  FIREBASE_PROJECT_ID: "fixture",
  FIREBASE_CREDENTIALS_JSON: JSON.stringify({
    project_id: "fixture",
    client_email: "fixture@example.test",
    private_key: "-----BEGIN PRIVATE KEY-----synthetic",
  }),
  AWS_ACCESS_KEY_ID: "synthetic-aws",
  AWS_SECRET_ACCESS_KEY: "synthetic-aws-secret",
  EMAIL_SENDER_EMAIL: "fixture@example.test",
  R2_ACCESS_KEY_ID: "synthetic-r2",
  R2_SECRET_ACCESS_KEY: "synthetic-r2-secret",
  UPLOAD_SIGNING_SECRET: "synthetic-storage-signing-secret-longer-than-32-bytes",
  EXTRACTION_QUEUE_PRODUCER_SECRET: "synthetic-dispatch-secret",
  CLOUDFLARE_ACCOUNT_ID: account,
  CLOUDFLARE_API_TOKEN: "synthetic-cloudflare",
  CLOUDFLARE_ENV: "production",
  VITE_AUTH_TEST_MODE: "false",
  VITE_API_URL: apiOrigin,
  VITE_FIREBASE_API_KEY: "synthetic-public",
  VITE_FIREBASE_AUTH_DOMAIN: "fixture.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "fixture",
  VITE_FIREBASE_APP_ID: "synthetic-app",
};

test("production preflight isolates API secrets from browser and deploy authentication", () => {
  const secrets = validateProductionConfiguration(fixture);
  assert.equal(secrets.R2_ACCESS_KEY_ID, "synthetic-r2");
  assert.equal(secrets.AWS_ACCESS_KEY_ID, "synthetic-aws");
  assert.equal(secrets.CLOUDFLARE_API_TOKEN, undefined);
  assert.equal(secrets.VITE_FIREBASE_API_KEY, undefined);
});

test("production preflight rejects missing credentials and unsafe build settings without exposing values", () => {
  for (const patch of [
    { DATABASE_URL: "" },
    { R2_ACCESS_KEY_ID: "" },
    { EXTRACTION_QUEUE_PRODUCER_SECRET: "" },
    { CLOUDFLARE_ACCOUNT_ID: "wrong-account" },
    { VITE_API_URL: "http://localhost:8000" },
    { CLOUDFLARE_ENV: "" },
    { VITE_AUTH_TEST_MODE: "true" },
    { VITE_FIREBASE_PROJECT_ID: "different" },
    { FIREBASE_CREDENTIALS_JSON: "private-malformed-json" },
    { UPLOAD_SIGNING_SECRET: "weak-private-key" },
  ]) {
    assert.throws(
      () => validateProductionConfiguration({ ...fixture, ...patch }),
      (error) => {
        assert.ok(!error.message.includes("private-malformed-json"));
        assert.ok(!error.message.includes("weak-private-key"));
        return true;
      },
    );
  }
});

test("production preflight rejects local, staged, pooled or insecure database URLs", () => {
  for (const DATABASE_URL of [
    "postgresql://fixture:private@localhost/neondb",
    fixture.DATABASE_URL.replace("/neondb", "/ubc_discovery_cloudflare_staging"),
    fixture.DATABASE_URL.replace("ep-fixture.", "ep-fixture-pooler."),
    `${fixture.DATABASE_URL}?sslmode=disable`,
    `${fixture.DATABASE_URL}?ssl=false`,
    `${fixture.DATABASE_URL}?ssl=False`,
    `${fixture.DATABASE_URL}?ssl=no-verify`,
    "not-a-url-with-private-credentials",
  ])
    assert.throws(
      () => validateProductionConfiguration({ ...fixture, DATABASE_URL }),
      (error) => {
        assert.ok(!error.message.includes("private"));
        return true;
      },
    );
});

test("production preflight rejects PostgreSQL connection-target query overrides", () => {
  for (const query of [
    "host=ep-fixture-pooler.us-west-2.aws.neon.tech",
    "host=localhost",
    "hostaddr=127.0.0.1",
    "port=55434",
    "database=ubc_discovery_cloudflare_staging",
    "dbname=staging",
    "user=another-user",
    "password=private-override",
    "service=staging",
  ])
    assert.throws(
      () =>
        validateProductionConfiguration({
          ...fixture,
          DATABASE_URL: `${fixture.DATABASE_URL}?${query}`,
        }),
      (error) => {
        assert.ok(!error.message.includes("private-override"));
        return true;
      },
    );
});

test("production bindings remain distinct from the default staging deployment", () => {
  const config = JSON.parse(
    readFileSync(new URL("../workers/api/wrangler.jsonc", import.meta.url), "utf8"),
  );
  assert.equal(config.name, "ubc-discovery-api-staging");
  const production = config.env.production;
  assert.equal(production.name, "ubc-discovery-api");
  assert.equal(production.account_id, account);
  assert.equal(production.vars.API_PUBLIC_BASE_URL, apiOrigin);
  assert.equal(production.vars.DATABASE_SSL, "true");
  assert.equal(production.vars.R2_BUCKET_NAME, production.r2_buckets[0].bucket_name);
  assert.equal(production.r2_buckets[0].bucket_name, "ubc-discovery-media");
  assert.notEqual(config.r2_buckets[0].bucket_name, production.r2_buckets[0].bucket_name);
  assert.equal(
    production.vars.EXTRACTION_QUEUE_PRODUCER_URL,
    "https://ubc-discovery-extraction.ubcdiscovery.workers.dev/enqueue",
  );
  assert.equal(production.vars.EXTRACTION_DELIVERY_TIMEOUT_SECONDS, "90000");
  assert.ok(production.secrets.required.includes("DATABASE_URL"));
  assert.ok(production.secrets.required.includes("EXTRACTION_QUEUE_PRODUCER_SECRET"));
  assert.equal(production.hyperdrive, undefined);
});

test("web build defaults remain staged and extractor callback is deployable", () => {
  const text = readFileSync(new URL("../web/wrangler.jsonc", import.meta.url), "utf8");
  const web = JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""));
  assert.equal(web.name, "ubc-discovery-web-staging");
  assert.equal(web.env.production.name, "ubc-discovery-web");
  assert.equal(web.env.production.account_id, account);
  assert.equal(web.env.production.assets.binding, "ASSETS");
  assert.equal(web.routes, undefined);
  assert.deepEqual(web.env.production.routes, [
    {
      pattern: "ubcdiscovery.com",
      custom_domain: true,
      zone_id: "bcd291566a7b602657d980a51d542c5f",
    },
  ]);
  const extraction = JSON.parse(
    readFileSync(new URL("../workers/extraction/wrangler.jsonc", import.meta.url), "utf8"),
  );
  assert.equal(extraction.vars.DISCOVERY_API_URL, apiOrigin);
  assert.equal(extraction.name, "ubc-discovery-extraction");
  assert.equal(extraction.queues.producers[0].queue, "ubc-discovery-extraction");
});
