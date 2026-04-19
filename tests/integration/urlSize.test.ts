import { describe, it, expect } from 'vitest';
import { buildApp } from '../../src/app.js';

// T032 — URLs/query strings > 2 KiB MUST respond 400 or 414 (NFR-S-002).
describe('T032: oversized URL/query', () => {
  it('GET /alerts with > 2 KiB query string rejected', async () => {
    const { app } = buildApp();
    try {
      const huge = 'a'.repeat(3000);
      const res = await app.inject({
        method: 'GET',
        url: `/alerts?x=${huge}`,
      });
      expect([400, 414]).toContain(res.statusCode);
    } finally {
      await app.close();
    }
  });

  it('GET /health with normal URL still 200', async () => {
    const { app } = buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
