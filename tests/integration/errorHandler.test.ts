import { describe, it, expect } from 'vitest';
import { buildApp } from '../../src/app.js';

describe('T030: setErrorHandler (global 500 fallback)', () => {
  it('converts thrown exception into 500 {"error":"internal error"} with no stack leak', async () => {
    const { app } = buildApp();
    try {
      // Register an explosive probe route *after* buildApp so the global
      // setErrorHandler from buildApp is already installed.
      app.get('/boom', async () => {
        throw new Error('boom: internal detail 42');
      });

      const res = await app.inject({ method: 'GET', url: '/boom' });
      expect(res.statusCode).toBe(500);
      const body = res.json();
      expect(body).toEqual({ error: 'internal error' });
      expect(body).not.toHaveProperty('stack');
      expect(body).not.toHaveProperty('message');
      expect(res.body).not.toContain('boom: internal detail 42');
      expect(res.body).not.toContain('Error:');
    } finally {
      await app.close();
    }
  });

  it('health endpoint still 200 after a prior handler threw', async () => {
    const { app } = buildApp();
    try {
      app.get('/boom', async () => {
        throw new Error('boom');
      });
      await app.inject({ method: 'GET', url: '/boom' });
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
    } finally {
      await app.close();
    }
  });
});
