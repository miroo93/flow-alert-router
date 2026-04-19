import { describe, it, expect } from 'vitest';
import { buildApp } from '../../src/app.js';

// T023 — GET /routes + DELETE /routes/:id behaviour.

describe('GET /routes', () => {
  it('empty store → 200 {routes:[]}', async () => {
    const { app } = buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/routes' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ routes: [] });
    } finally {
      await app.close();
    }
  });

  it('returns routes in insertion order without _insertionOrder field', async () => {
    const { app } = buildApp();
    try {
      const r1 = await app.inject({
        method: 'POST',
        url: '/routes',
        payload: {
          id: 'r1',
          priority: 10,
          conditions: {},
          target: { type: 'slack', channel: '#a' },
        },
      });
      expect(r1.statusCode).toBe(201);

      const r2 = await app.inject({
        method: 'POST',
        url: '/routes',
        payload: {
          id: 'r2',
          priority: 20,
          conditions: {},
          target: { type: 'slack', channel: '#b' },
        },
      });
      expect(r2.statusCode).toBe(201);

      const res = await app.inject({ method: 'GET', url: '/routes' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.routes)).toBe(true);
      expect(body.routes).toHaveLength(2);
      expect(body.routes[0].id).toBe('r1');
      expect(body.routes[1].id).toBe('r2');
      for (const r of body.routes) {
        expect(r).not.toHaveProperty('_insertionOrder');
      }
    } finally {
      await app.close();
    }
  });
});

describe('DELETE /routes/:id', () => {
  it('unknown id → 404 {"error":"route not found"}', async () => {
    const { app } = buildApp();
    try {
      const res = await app.inject({
        method: 'DELETE',
        url: '/routes/does-not-exist',
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'route not found' });
    } finally {
      await app.close();
    }
  });

  it('existing id → 200 {id, deleted:true}, subsequent GET omits route', async () => {
    const { app } = buildApp();
    try {
      const create = await app.inject({
        method: 'POST',
        url: '/routes',
        payload: {
          id: 'r1',
          priority: 10,
          conditions: {},
          target: { type: 'slack', channel: '#a' },
        },
      });
      expect(create.statusCode).toBe(201);

      const del = await app.inject({
        method: 'DELETE',
        url: '/routes/r1',
      });
      expect(del.statusCode).toBe(200);
      expect(del.json()).toEqual({ id: 'r1', deleted: true });

      const list = await app.inject({ method: 'GET', url: '/routes' });
      expect(list.statusCode).toBe(200);
      expect(list.json()).toEqual({ routes: [] });
    } finally {
      await app.close();
    }
  });
});
