import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importPKCS8, SignJWT } from 'jose';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname)) {
  throw new Error('TEST_DATABASE_URL must name a disposable localhost PostgreSQL database');
}
const temporary = await mkdtemp(join(tmpdir(), 'ubc-worker-runtime-'));
let worker;
let exited;
let output = '';
try {
  // Synthetic short-lived certificate and key; no production credentials involved.
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=local-runtime-test',
    '-keyout', join(temporary, 'key.pem'), '-out', join(temporary, 'cert.pem')], { stdio: 'ignore' });
  const privateKey = await readFile(join(temporary, 'key.pem'), 'utf8');
  const certificate = await readFile(join(temporary, 'cert.pem'), 'utf8');
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    iss: 'https://securetoken.google.com/runtime-test', aud: 'runtime-test', sub: 'local-user',
    iat: now - 1, exp: now + 300, auth_time: now - 1, email: 'local@example.test', email_verified: true,
  }).setProtectedHeader({ alg: 'RS256', kid: 'runtime-key' }).sign(await importPKCS8(privateKey, 'RS256'));
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  worker = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev',
    '--config', 'test/runtime/wrangler.jsonc', '--local', '--ip', '127.0.0.1', '--port', String(port),
    '--inspector-port', '0', '--persist-to', join(temporary, 'r2'), '--var', `DATABASE_URL:${databaseUrl}`,
    '--log-level', 'error', '--show-interactive-dev-session=false'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  exited = once(worker, 'exit');
  for (const stream of [worker.stdout, worker.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-8000); });
  const url = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 100 && worker.exitCode === null; attempt++) {
    try { ready = (await fetch(url, { signal: AbortSignal.timeout(500) })).ok; } catch { /* not listening yet */ }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(ready, `Local Worker failed to start: ${output}`);
  const response = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ certificate, privateKey, token }),
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, 200, `Runtime probe failed: ${output}`);
  assert.deepEqual(await response.json(), { database: true, r2: true, capabilities: true, auth: true, vancouver: true, firebase: true });
  console.log('Workers runtime: pgvector transaction, Firebase X509/RS256, secret comparison, local R2, and direct PUT signing and signed private/public media read routes passed.');
} finally {
  if (worker && worker.exitCode === null) {
    worker.kill('SIGTERM');
    const killTimeout = setTimeout(() => worker.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(killTimeout);
  }
  await rm(temporary, { recursive: true, force: true });
}
