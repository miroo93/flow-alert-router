import { describe, it, expect } from 'vitest';
import { buildApp } from '../../src/app.js';

// T031: per-request timeout. Production budget is 30 s (NFR-R-007). For test
// speed we override the budget via an env var honoured by buildApp when set,
// so this suite completes in ~150 ms instead of ~31 s. The real 30 s budget
// is exercised by the quickstart smoke sweep and by container-level runs.

describe('T031: per-request timeout', () => {
  it('async handler exceeding the budget responds 503 {error:"request timed out"}', async () => {
    process.env.REQUEST_TIMEOUT_MS = '100';
    const { app } = buildApp();
    try {
      app.get('/slow', async () => {
        await new Promise((r) => setTimeout(r, 500));
        return { ok: true };
      });
      const t0 = performance.now();
      const res = await app.inject({ method: 'GET', url: '/slow' });
      const dt = performance.now() - t0;
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ error: 'request timed out' });
      expect(dt).toBeLessThan(400);
      expect(dt).toBeGreaterThanOrEqual(95);
    } finally {
      await app.close();
      delete process.env.REQUEST_TIMEOUT_MS;
    }
  });

  it('fast handler (e.g. /health) is not affected by the timeout', async () => {
    process.env.REQUEST_TIMEOUT_MS = '100';
    const { app } = buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
    } finally {
      await app.close();
      delete process.env.REQUEST_TIMEOUT_MS;
    }
  });

  it('concurrent health request responds immediately while slow handler hangs', async () => {
    process.env.REQUEST_TIMEOUT_MS = '200';
    const { app } = buildApp();
    try {
      app.get('/slow', async () => {
        await new Promise((r) => setTimeout(r, 500));
        return { ok: true };
      });
      const slow = app.inject({ method: 'GET', url: '/slow' });
      const t0 = performance.now();
      const health = await app.inject({ method: 'GET', url: '/health' });
      const dt = performance.now() - t0;
      expect(health.statusCode).toBe(200);
      expect(dt).toBeLessThan(50);
      const slowRes = await slow;
      expect(slowRes.statusCode).toBe(503);
    } finally {
      await app.close();
      delete process.env.REQUEST_TIMEOUT_MS;
    }
  });
});
