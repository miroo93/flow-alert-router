import { describe, it, expect } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { FastifyInstance } from 'fastify';

// T029 — POST /reset integration contract (FR-027, SC-007).
// Populates store with routes + alerts + suppressions + stats,
// then verifies /reset clears everything back to initial state.

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

const INITIAL_STATS = {
  total_alerts_processed: 0,
  total_routed: 0,
  total_suppressed: 0,
  total_unrouted: 0,
  by_severity: { critical: 0, warning: 0, info: 0 },
  by_route: {},
  by_service: {},
};

describe('POST /reset', () => {
  it('clears routes, alerts, suppressions, and stats', async () => {
    const { app } = buildApp();
    try {
      await postRoute(app, {
        id: 'r1',
        priority: 10,
        conditions: { severity: ['critical'] },
        target: { type: 'slack', channel: '#ops' },
        suppression_window_seconds: 300,
      });
      await postRoute(app, {
        id: 'r2',
        priority: 5,
        conditions: {},
        target: { type: 'email', address: 'oncall@example.com' },
      });

      // Two alerts: first establishes a suppression window on r1,
      // second routes through r2 (different severity, bumps stats).
      await postAlert(app, {
        id: 'a1',
        severity: 'critical',
        service: 'payment-api',
        group: 'billing',
        timestamp: '2026-04-19T10:00:00Z',
      });
      await postAlert(app, {
        id: 'a2',
        severity: 'info',
        service: 'auth-service',
        group: 'security',
        timestamp: '2026-04-19T10:01:00Z',
      });

      // Pre-reset sanity checks.
      const preRoutes = await app.inject({ method: 'GET', url: '/routes' });
      expect((preRoutes.json() as { routes: unknown[] }).routes).toHaveLength(2);

      const preAlerts = await app.inject({ method: 'GET', url: '/alerts' });
      expect((preAlerts.json() as { total: number }).total).toBe(2);

      const preStats = await app.inject({ method: 'GET', url: '/stats' });
      expect((preStats.json() as { total_alerts_processed: number })
        .total_alerts_processed).toBe(2);

      // Reset.
      const reset = await app.inject({ method: 'POST', url: '/reset' });
      expect(reset.statusCode).toBe(200);
      expect(reset.json()).toEqual({ status: 'ok' });

      // Post-reset assertions.
      const routes = await app.inject({ method: 'GET', url: '/routes' });
      expect(routes.statusCode).toBe(200);
      expect(routes.json()).toEqual({ routes: [] });

      const alerts = await app.inject({ method: 'GET', url: '/alerts' });
      expect(alerts.statusCode).toBe(200);
      expect(alerts.json()).toEqual({ alerts: [], total: 0 });

      const stats = await app.inject({ method: 'GET', url: '/stats' });
      expect(stats.statusCode).toBe(200);
      expect(stats.json()).toEqual(INITIAL_STATS);
    } finally {
      await app.close();
    }
  });

  it('accepts empty body with no content-type header', async () => {
    const { app } = buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/reset',
        // no payload, no content-type
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
    } finally {
      await app.close();
    }
  });
});
