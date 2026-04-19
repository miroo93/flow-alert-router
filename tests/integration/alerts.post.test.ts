import { describe, it, expect } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { FastifyInstance } from 'fastify';
import type { InMemoryStore } from '../../src/types.js';

// T024 — POST /alerts integration contract.
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
    throw new Error(
      `route setup failed: ${res.statusCode} ${res.payload}`,
    );
  }
}

/**
 * Boots an app with one critical+payment-* route (r1, priority 10,
 * 300s suppression window).
 */
async function buildFixture(): Promise<{
  app: FastifyInstance;
  store: InMemoryStore;
}> {
  const { app, store } = buildApp();
  await postRoute(app, {
    id: 'r1',
    priority: 10,
    conditions: { severity: ['critical'], service: ['payment-*'] },
    target: { type: 'slack', channel: '#ops' },
    suppression_window_seconds: 300,
  });
  return { app, store };
}

describe('POST /alerts', () => {
  it('FR-004a routed response shape — slack target', async () => {
    const { app } = await buildFixture();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/alerts',
        payload: {
          id: 'a1',
          severity: 'critical',
          service: 'payment-api',
          group: 'billing',
          timestamp: '2026-04-19T10:00:00Z',
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.alert_id).toBe('a1');
      expect(body.suppressed).toBe(false);
      expect(body.routed_to).toEqual({
        route_id: 'r1',
        target: { type: 'slack', channel: '#ops' },
      });
      expect(body.matched_routes).toContain('r1');
      expect(body.evaluation_details.total_routes_evaluated).toBe(1);
      expect('suppression_reason' in body).toBe(false);
      expect('_alert' in body).toBe(false);
      expect('_submissionOrder' in body).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('FR-004a routed response echoes webhook headers verbatim', async () => {
    const { app } = await buildFixture();
    try {
      await postRoute(app, {
        id: 'r-web',
        priority: 20,
        conditions: { severity: ['critical'], service: ['payment-*'] },
        target: {
          type: 'webhook',
          url: 'https://x',
          headers: { 'X-API-Key': 'sekret' },
        },
      });
      const res = await app.inject({
        method: 'POST',
        url: '/alerts',
        payload: {
          id: 'a1',
          severity: 'critical',
          service: 'payment-api',
          group: 'billing',
          timestamp: '2026-04-19T10:00:00Z',
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.routed_to).not.toBeNull();
      expect(body.routed_to.route_id).toBe('r-web');
      expect(body.routed_to.target).toEqual({
        type: 'webhook',
        url: 'https://x',
        headers: { 'X-API-Key': 'sekret' },
      });
    } finally {
      await app.close();
    }
  });

  it('FR-004b suppressed response still echoes winner route + target + FR-015 reason', async () => {
    const { app } = await buildFixture();
    try {
      // First: routes, establishes window through 10:05:00Z.
      const first = await app.inject({
        method: 'POST',
        url: '/alerts',
        payload: {
          id: 'a1',
          severity: 'critical',
          service: 'payment-api',
          group: 'billing',
          timestamp: '2026-04-19T10:00:00Z',
        },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json().suppressed).toBe(false);

      // Second: T+60s, same (route, service) — suppressed.
      const res = await app.inject({
        method: 'POST',
        url: '/alerts',
        payload: {
          id: 'a2',
          severity: 'critical',
          service: 'payment-api',
          group: 'billing',
          timestamp: '2026-04-19T10:01:00Z',
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.suppressed).toBe(true);
      expect(body.routed_to).not.toBeNull();
      expect(body.routed_to.route_id).toBe('r1');
      expect(body.routed_to.target).toEqual({
        type: 'slack',
        channel: '#ops',
      });
      expect(body.suppression_reason).toBe(
        "Alert for service 'payment-api' on route 'r1' suppressed until 2026-04-19T10:05:00Z",
      );
      expect(body.evaluation_details.suppression_applied).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('FR-004c no-match response has null routed_to, empty matched_routes, no suppression_reason key', async () => {
    const { app } = await buildFixture();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/alerts',
        payload: {
          id: 'a1',
          severity: 'info',
          service: 'payment-api',
          group: 'billing',
          timestamp: '2026-04-19T10:00:00Z',
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.routed_to).toBeNull();
      expect(body.matched_routes).toEqual([]);
      expect('suppression_reason' in body).toBe(false);
      expect(body.evaluation_details.suppression_applied).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('FR-007 / SC-008 re-post same id upserts single record; stats tick twice', async () => {
    const { app, store } = await buildFixture();
    try {
      const first = await app.inject({
        method: 'POST',
        url: '/alerts',
        payload: {
          id: 'a1',
          severity: 'critical',
          service: 'payment-api',
          group: 'billing',
          timestamp: '2026-04-19T10:00:00Z',
        },
      });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({
        method: 'POST',
        url: '/alerts',
        payload: {
          id: 'a1',
          severity: 'critical',
          service: 'payment-api',
          group: 'billing',
          timestamp: '2026-04-19T10:10:00Z',
        },
      });
      expect(second.statusCode).toBe(200);

      const list = await app.inject({ method: 'GET', url: '/alerts' });
      // GET /alerts lives in T026 but endpoint absence would fail here;
      // if the handler isn't wired yet, sidestep via the store.
      if (list.statusCode === 200) {
        const body = list.json();
        expect(body.total).toBe(1);
        expect(body.alerts).toHaveLength(1);
      }
      // Direct store inspection (always available).
      const stored = store.listAlerts({});
      expect(stored.map((r) => r.alert_id)).toEqual(['a1']);
      expect(store.stats().total_alerts_processed).toBe(2);
    } finally {
      await app.close();
    }
  });

  it('validation failures return 400 with non-empty error string', async () => {
    const { app } = await buildFixture();
    try {
      // Bad severity (enum violation).
      const badSev = await app.inject({
        method: 'POST',
        url: '/alerts',
        payload: {
          id: 'v1',
          severity: 'urgent',
          service: 'svc',
          group: 'g',
          timestamp: '2026-04-19T10:00:00Z',
        },
      });
      expect(badSev.statusCode).toBe(400);
      const b1 = badSev.json();
      expect(typeof b1.error).toBe('string');
      expect(b1.error.length).toBeGreaterThan(0);

      // Date-only timestamp (not an absolute instant).
      const badTs = await app.inject({
        method: 'POST',
        url: '/alerts',
        payload: {
          id: 'v2',
          severity: 'critical',
          service: 'svc',
          group: 'g',
          timestamp: '2026-04-19',
        },
      });
      expect(badTs.statusCode).toBe(400);
      expect(typeof badTs.json().error).toBe('string');
      expect(badTs.json().error.length).toBeGreaterThan(0);

      // Missing required `id`.
      const missingId = await app.inject({
        method: 'POST',
        url: '/alerts',
        payload: {
          severity: 'critical',
          service: 'svc',
          group: 'g',
          timestamp: '2026-04-19T10:00:00Z',
        },
      });
      expect(missingId.statusCode).toBe(400);
      expect(typeof missingId.json().error).toBe('string');
      expect(missingId.json().error.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });
});
