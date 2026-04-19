import { describe, it, expect } from 'vitest';
import { buildApp } from '../../src/app.js';

describe('GET /health', () => {
  it('returns 200 {status:"ok"} in <50ms', async () => {
    const { app } = buildApp();
    try {
      const t0 = performance.now();
      const res = await app.inject({ method: 'GET', url: '/health' });
      const dt = performance.now() - t0;
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
      expect(dt).toBeLessThan(50);
    } finally {
      await app.close();
    }
  });
});
