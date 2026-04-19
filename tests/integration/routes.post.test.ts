import { describe, it, expect } from 'vitest';
import { buildApp } from '../../src/app.js';

// T022 — POST /routes validation contract.
// Each test boots a fresh app to keep route-store state isolated.

describe('POST /routes', () => {
  it('valid body → 201 {id, created:true}', async () => {
    const { app } = buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/routes',
        payload: {
          id: 'r1',
          priority: 10,
          conditions: {},
          target: { type: 'slack', channel: '#ops' },
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ id: 'r1', created: true });
    } finally {
      await app.close();
    }
  });

  it('re-post same id → 201 {id, created:false}', async () => {
    const { app } = buildApp();
    try {
      const first = await app.inject({
        method: 'POST',
        url: '/routes',
        payload: {
          id: 'r1',
          priority: 10,
          conditions: {},
          target: { type: 'slack', channel: '#ops' },
        },
      });
      expect(first.statusCode).toBe(201);
      expect(first.json()).toEqual({ id: 'r1', created: true });

      const again = await app.inject({
        method: 'POST',
        url: '/routes',
        payload: {
          id: 'r1',
          priority: 20,
          conditions: {},
          target: { type: 'slack', channel: '#ops-2' },
        },
      });
      expect(again.statusCode).toBe(201);
      expect(again.json()).toEqual({ id: 'r1', created: false });
    } finally {
      await app.close();
    }
  });

  it('missing priority → 400 non-empty error', async () => {
    const { app } = buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/routes',
        payload: {
          id: 'r1',
          conditions: {},
          target: { type: 'slack', channel: '#ops' },
        },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(typeof body.error).toBe('string');
      expect(body.error.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it('target.type "sms" → 400', async () => {
    const { app } = buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/routes',
        payload: {
          id: 'r1',
          priority: 10,
          conditions: {},
          target: { type: 'sms', number: '+15551234567' },
        },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(typeof body.error).toBe('string');
      expect(body.error.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it('active_hours.timezone "Mars/Phobos" → 400', async () => {
    const { app } = buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/routes',
        payload: {
          id: 'r1',
          priority: 10,
          conditions: {},
          target: { type: 'slack', channel: '#ops' },
          active_hours: { start: '09:00', end: '17:00', timezone: 'Mars/Phobos' },
        },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(typeof body.error).toBe('string');
      expect(body.error.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it('priority 3.5 → 400', async () => {
    const { app } = buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/routes',
        payload: {
          id: 'r1',
          priority: 3.5,
          conditions: {},
          target: { type: 'slack', channel: '#ops' },
        },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(typeof body.error).toBe('string');
      expect(body.error.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it('suppression_window_seconds -1 → 400', async () => {
    const { app } = buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/routes',
        payload: {
          id: 'r1',
          priority: 10,
          conditions: {},
          target: { type: 'slack', channel: '#ops' },
          suppression_window_seconds: -1,
        },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(typeof body.error).toBe('string');
      expect(body.error.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it('webhook headers with non-string value → 400', async () => {
    const { app } = buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/routes',
        payload: {
          id: 'r1',
          priority: 10,
          conditions: {},
          target: {
            type: 'webhook',
            url: 'https://example.test/hook',
            headers: { x: 1 },
          },
        },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(typeof body.error).toBe('string');
      expect(body.error.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });
});
