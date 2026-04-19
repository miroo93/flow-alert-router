import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as wait } from 'node:timers/promises';
import net from 'node:net';

// T035 — NFR-S-010 / S10: the info-level pino logger (configured in app.ts)
// MUST NEVER emit request/response bodies. Spawn the built server as a real
// subprocess (same surface as `docker run ... alert-router`), POST a route
// + alert each carrying a sentinel `labels.canary` value, then inspect
// captured stdout+stderr. The sentinel MUST appear ZERO times across all
// captured log output. This is functionally equivalent to the T035 DoD:
//   docker logs <container> 2>&1 | grep -c 'canary-xyz-7f3b'
// returning 0.
const CANARY = 'canary-xyz-7f3b';

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close();
        reject(new Error('no address'));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForPort(port: number, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch {
      /* not yet ready */
    }
    if (Date.now() > deadline) throw new Error('boot timeout');
    await wait(50);
  }
}

describe('T035: pino canary — request bodies never logged', () => {
  it('sentinel in labels does not appear in server stdout/stderr', async () => {
    const port = await findFreePort();
    const proc = spawn('node', ['dist/index.js'], {
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let captured = '';
    proc.stdout.on('data', (c) => {
      captured += c.toString();
    });
    proc.stderr.on('data', (c) => {
      captured += c.toString();
    });

    try {
      await waitForPort(port);

      const routeRes = await fetch(`http://127.0.0.1:${port}/routes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'r-canary',
          priority: 1,
          conditions: { labels: { canary: CANARY } },
          target: { type: 'slack', channel: '#x' },
        }),
      });
      expect(routeRes.status).toBe(201);

      const alertRes = await fetch(`http://127.0.0.1:${port}/alerts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'a-canary',
          severity: 'critical',
          service: 'payment-api',
          group: 'billing',
          timestamp: '2026-04-19T10:00:00Z',
          labels: { canary: CANARY },
        }),
      });
      expect(alertRes.status).toBe(200);

      // Give pino's async flush a tick.
      await wait(150);

      const occurrences = captured.split(CANARY).length - 1;
      expect(occurrences).toBe(0);
    } finally {
      proc.kill('SIGTERM');
      await Promise.race([once(proc, 'exit'), wait(2000)]);
    }
  }, 15_000);
});
