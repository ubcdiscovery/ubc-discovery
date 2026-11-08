import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname)) {
  throw new Error("TEST_DATABASE_URL must name a disposable localhost PostgreSQL database");
}
const temporary = await mkdtemp(join(tmpdir(), "ubc-worker-runtime-"));
let worker;
let exited;
let output = "";
try {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  worker = spawn(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "dev",
      "--config",
      "test/runtime/wrangler.jsonc",
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--inspector-port",
      "0",
      "--persist-to",
      join(temporary, "r2"),
      "--var",
      `DATABASE_URL:${databaseUrl}`,
      "--log-level",
      "error",
      "--show-interactive-dev-session=false",
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    },
  );
  exited = once(worker, "exit");
  for (const stream of [worker.stdout, worker.stderr])
    stream.on("data", (chunk) => {
      output = (output + chunk).slice(-8000);
    });
  const url = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 100 && worker.exitCode === null; attempt++) {
    try {
      ready = (await fetch(url, { signal: AbortSignal.timeout(500) })).ok;
    } catch {
      /* not listening yet */
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(ready, `Local Worker failed to start: ${output}`);
  const response = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, 200, `Runtime probe failed: ${output}`);
  assert.deepEqual(await response.json(), {
    database: true,
    r2: true,
    capabilities: true,
    auth: true,
    vancouver: true,
    betterAuth: true,
  });
  console.log(
    "Workers runtime: pgvector transaction, Better Auth email-code sign-in, secret comparison, local R2, and direct PUT signing and signed private/public media read routes passed.",
  );
} finally {
  if (worker && worker.exitCode === null) {
    worker.kill("SIGTERM");
    const killTimeout = setTimeout(() => worker.kill("SIGKILL"), 5000);
    await exited;
    clearTimeout(killTimeout);
  }
  await rm(temporary, { recursive: true, force: true });
}
