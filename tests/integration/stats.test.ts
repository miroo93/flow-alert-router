import { describe, it, expect } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { FastifyInstance } from 'fastify';

// T027 — GET /stats integration contract.
// Each test boots a fresh app to keep store state isolated.

async function postRoute(
  app: FastifyInstance,
  payload: unknown,
): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/routes',
    payload,
  });
  if (res.statusCode !== 201) {
    throw new Error(`route setup failed: ${res.statusCode} ${res.payload}`);
  }
}

async function postAlert(
  app: FastifyInstance,
  payload: unknown,
): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/alerts',
    payload,
  });
  if (res.statusCode !== 200) {
    throw new Error(`alert post failed: ${res.statusCode} ${res.payload}`);
  }
}

describe('GET /stats', () => {
  it('FR-025b initial shape — fresh container returns zeroed stats', async () => {
    const { app } = buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/stats' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        total_alerts_processed: 0,
        total_routed: 0,
        total_suppressed: 0,
        total_unrouted: 0,
        by_severity: { critical: 0, warning: 0, info: 0 },
        by_route: {},
        by_service: {},
      });
    } finally {
      await app.close();
    }
  });

  it('FR-025 — routed alert increments counters exactly once', async () => {
    const { app } = buildApp();
    try {
      await postRoute(app, {
        id: 'r1',
        priority: 10,
        conditions: {},
        target: { type: 'slack', channel: '#ops' },
      });
      await postAlert(app, {
        id: 'a1',
        severity: 'critical',
        service: 'payment-api',
        group: 'billing',
        timestamp: '2026-04-19T10:00:00Z',
      });

      const res = await app.inject({ method: 'GET', url: '/stats' });
      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.total_alerts_processed).toBe(1);
      expect(body.total_routed).toBe(1);
      expect(body.total_suppressed).toBe(0);
      expect(body.total_unrouted).toBe(0);
      expect(body.by_severity).toEqual({ critical: 1, warning: 0, info: 0 });
      expect(body.by_route['r1']).toEqual({
        total_matched: 1,
        total_routed: 1,
        total_suppressed: 0,
      });
      expect(body.by_service['payment-api']).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('FR-025 — suppressed alert ticks total_suppressed and by_route.total_suppressed', async () => {
    const { app } = buildApp();
    try {
      await postRoute(app, {
        id: 'r1',
        priority: 10,
        conditions: {},
        target: { type: 'slack', channel: '#ops' },
        suppression_window_seconds: 300,
      });
      // First alert: routed (opens suppression window).
      await postAlert(app, {
        id: 'a1',
        severity: 'critical',
        service: 'payment-api',
        group: 'billing',
        timestamp: '2026-04-19T10:00:00Z',
      });
      // Second alert T+60s on same route+service: suppressed.
      await postAlert(app, {
        id: 'a2',
        severity: 'critical',
        service: 'payment-api',
        group: 'billing',
        timestamp: '2026-04-19T10:01:00Z',
      });

      const res = await app.inject({ method: 'GET', url: '/stats' });
      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.total_alerts_processed).toBe(2);
      expect(body.total_routed).toBe(1);
      expect(body.total_suppressed).toBe(1);
      expect(body.total_unrouted).toBe(0);
      expect(body.by_route['r1']).toEqual({
        total_matched: 2,
        total_routed: 1,
        total_suppressed: 1,
      });
      expect(body.by_service['payment-api']).toBe(2);
    } finally {
      await app.close();
    }
  });
});
