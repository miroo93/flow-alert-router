import { describe, it, expect } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { FastifyInstance } from 'fastify';
import type { InMemoryStore } from '../../src/types.js';

// T028 — POST /test (dry run) integration contract.
// Dry-run MUST short-circuit before any mutation: no alert persisted,
// no stats touched, no suppression-window state created or extended.

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
): Promise<{ statusCode: number; body: unknown }> {
  const res = await app.inject({
    method: 'POST',
    url: '/alerts',
    payload,
  });
  return { statusCode: res.statusCode, body: res.json() };
}

describe('POST /test', () => {
  it('returns stripped RoutingResult for a matching alert', async () => {
    const { app } = buildApp();
    try {
      await postRoute(app, {
        id: 'r1',
        priority: 1,
        conditions: { severity: ['info'], service: ['*'] },
        target: { type: 'slack', channel: '#ops' },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/test',
        payload: {
          id: 'dry-1',
          severity: 'info',
          service: 'svc',
          group: 'g',
          timestamp: '2026-04-19T10:00:00Z',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body.alert_id).toBe('dry-1');
      expect(body.routed_to).toEqual({
        route_id: 'r1',
        target: { type: 'slack', channel: '#ops' },
      });
      // Stripped shape: no internal bookkeeping fields.
      expect('_alert' in body).toBe(false);
      expect('_submissionOrder' in body).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('FR-026: does NOT persist the alert (GET /alerts/:id returns 404)', async () => {
    const { app } = buildApp();
    try {
      await postRoute(app, {
        id: 'r1',
        priority: 1,
        conditions: {},
        target: { type: 'slack', channel: '#ops' },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/test',
        payload: {
          id: 'dry-1',
          severity: 'info',
          service: 'svc',
          group: 'g',
          timestamp: '2026-04-19T10:00:00Z',
        },
      });
      expect(res.statusCode).toBe(200);

      const fetched = await app.inject({
        method: 'GET',
        url: '/alerts/dry-1',
      });
      expect(fetched.statusCode).toBe(404);
      expect(fetched.json()).toEqual({ error: 'alert not found' });
    } finally {
      await app.close();
    }
  });

  it('FR-026 + SC-006: does NOT mutate stats (bit-for-bit identical snapshot)', async () => {
    const { app, store } = buildApp() as { app: FastifyInstance; store: InMemoryStore };
    try {
      await postRoute(app, {
        id: 'r1',
        priority: 1,
        conditions: {},
        target: { type: 'slack', channel: '#ops' },
      });

      const before = JSON.stringify(store.stats());

      const res = await app.inject({
        method: 'POST',
        url: '/test',
        payload: {
          id: 'dry-1',
          severity: 'critical',
          service: 'svc',
          group: 'g',
          timestamp: '2026-04-19T10:00:00Z',
        },
      });
      expect(res.statusCode).toBe(200);

      const after = JSON.stringify(store.stats());
      expect(after).toBe(before);
    } finally {
      await app.close();
    }
  });

  it('L3: total_routes_evaluated = store size (not match count), with 5 routes / 2 matching', async () => {
    const { app } = buildApp();
    try {
      // r1, r2 match critical+payment-api; r3, r4, r5 do not.
      await postRoute(app, {
        id: 'r1',
        priority: 5,
        conditions: { severity: ['critical'] },
        target: { type: 'slack', channel: '#a' },
      });
      await postRoute(app, {
        id: 'r2',
        priority: 4,
        conditions: { service: ['payment-*'] },
        target: { type: 'slack', channel: '#b' },
      });
      await postRoute(app, {
        id: 'r3',
        priority: 3,
        conditions: { severity: ['info'] },
        target: { type: 'slack', channel: '#c' },
      });
      await postRoute(app, {
        id: 'r4',
        priority: 2,
        conditions: { service: ['auth-service'] },
        target: { type: 'slack', channel: '#d' },
      });
      await postRoute(app, {
        id: 'r5',
        priority: 1,
        conditions: { severity: ['warning'] },
        target: { type: 'slack', channel: '#e' },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/test',
        payload: {
          id: 'dry-l3',
          severity: 'critical',
          service: 'payment-api',
          group: 'billing',
          timestamp: '2026-04-19T10:00:00Z',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        matched_routes: string[];
        evaluation_details: {
          total_routes_evaluated: number;
          routes_matched: number;
          routes_not_matched: number;
        };
      };
      expect(body.matched_routes.sort()).toEqual(['r1', 'r2']);
      expect(body.evaluation_details.total_routes_evaluated).toBe(5);
      expect(body.evaluation_details.routes_matched).toBe(2);
      expect(body.evaluation_details.routes_not_matched).toBe(3);
    } finally {
      await app.close();
    }
  });

  it('L4: suppression-isolation — /test does not extend or reset the window', async () => {
    const { app } = buildApp();
    try {
      await postRoute(app, {
        id: 'r1',
        priority: 1,
        conditions: { severity: ['critical'], service: ['payment-*'] },
        target: { type: 'slack', channel: '#ops' },
        suppression_window_seconds: 300,
      });

      // T=0 — real alert establishes window expiring 2026-04-19T10:05:00Z.
      const first = await postAlert(app, {
        id: 'a1',
        severity: 'critical',
        service: 'payment-api',
        group: 'billing',
        timestamp: '2026-04-19T10:00:00Z',
      });
      expect(first.statusCode).toBe(200);
      expect((first.body as { suppressed: boolean }).suppressed).toBe(false);

      // T+60s — dry-run. Must not throw; contents don't matter for this proof.
      const dry = await app.inject({
        method: 'POST',
        url: '/test',
        payload: {
          id: 'dry-a2',
          severity: 'critical',
          service: 'payment-api',
          group: 'billing',
          timestamp: '2026-04-19T10:01:00Z',
        },
      });
      expect(dry.statusCode).toBe(200);

      // T+250s — real alert; MUST be suppressed with the ORIGINAL expiry.
      // If /test had extended the window, expiry would shift to 10:06:00Z.
      const third = await postAlert(app, {
        id: 'a3',
        severity: 'critical',
        service: 'payment-api',
        group: 'billing',
        timestamp: '2026-04-19T10:04:10Z',
      });
      expect(third.statusCode).toBe(200);
      const body = third.body as {
        suppressed: boolean;
        suppression_reason?: string;
      };
      expect(body.suppressed).toBe(true);
      expect(body.suppression_reason).toBeDefined();
      expect(body.suppression_reason as string).toContain(
        'suppressed until 2026-04-19T10:05:00Z',
      );
    } finally {
      await app.close();
    }
  });
});
