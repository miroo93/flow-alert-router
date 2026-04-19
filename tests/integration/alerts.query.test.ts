import { describe, it, expect } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { FastifyInstance } from 'fastify';

// T026 — GET /alerts filter + GET /alerts/:id integration contract.
// Lenient filtering (FR-024a): invalid param values yield empty result.

async function seed(app: FastifyInstance): Promise<void> {
  // Route that matches everything so every POST /alerts lands on r1.
  const rr = await app.inject({
    method: 'POST',
    url: '/routes',
    payload: {
      id: 'r1',
      priority: 1,
      conditions: {},
      target: { type: 'slack', channel: '#ops' },
    },
  });
  if (rr.statusCode !== 201) {
    throw new Error(`route setup failed: ${rr.statusCode} ${rr.payload}`);
  }

  const alerts = [
    {
      id: 'a1',
      severity: 'critical',
      service: 'payment-api',
      group: 'g',
      timestamp: '2026-04-19T10:00:00Z',
    },
    {
      id: 'a2',
      severity: 'warning',
      service: 'payment-api',
      group: 'g',
      timestamp: '2026-04-19T10:01:00Z',
    },
    {
      id: 'a3',
      severity: 'critical',
      service: 'auth-api',
      group: 'g',
      timestamp: '2026-04-19T10:02:00Z',
    },
  ];
  for (const a of alerts) {
    const res = await app.inject({ method: 'POST', url: '/alerts', payload: a });
    if (res.statusCode !== 200) {
      throw new Error(`alert setup failed: ${res.statusCode} ${res.payload}`);
    }
  }
}

describe('GET /alerts', () => {
  it('empty store → {alerts:[], total:0}', async () => {
    const { app } = buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/alerts' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ alerts: [], total: 0 });
    } finally {
      await app.close();
    }
  });

  it('filters by service AND severity returns only the intersection', async () => {
    const { app } = buildApp();
    try {
      await seed(app);
      const res = await app.inject({
        method: 'GET',
        url: '/alerts?service=payment-api&severity=critical',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBe(1);
      expect(body.alerts).toHaveLength(1);
      expect(body.alerts[0].alert_id).toBe('a1');
      // No internal fields leak.
      expect('_alert' in body.alerts[0]).toBe(false);
      expect('_submissionOrder' in body.alerts[0]).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('FR-024a lenient: invalid severity → empty', async () => {
    const { app } = buildApp();
    try {
      await seed(app);
      const res = await app.inject({
        method: 'GET',
        url: '/alerts?severity=urgent',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ alerts: [], total: 0 });
    } finally {
      await app.close();
    }
  });

  it('FR-024a lenient: invalid routed → empty', async () => {
    const { app } = buildApp();
    try {
      await seed(app);
      const res = await app.inject({
        method: 'GET',
        url: '/alerts?routed=maybe',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ alerts: [], total: 0 });
    } finally {
      await app.close();
    }
  });
});

describe('GET /alerts/:id', () => {
  it('unknown id → 404 {error:"alert not found"}', async () => {
    const { app } = buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/alerts/missing',
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'alert not found' });
    } finally {
      await app.close();
    }
  });

  it('existing id → 200 stripped RoutingResult shape', async () => {
    const { app } = buildApp();
    try {
      await seed(app);
      const res = await app.inject({
        method: 'GET',
        url: '/alerts/a2',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.alert_id).toBe('a2');
      expect(body.routed_to).toEqual({
        route_id: 'r1',
        target: { type: 'slack', channel: '#ops' },
      });
      expect(body.suppressed).toBe(false);
      expect(body.matched_routes).toEqual(['r1']);
      expect(body.evaluation_details.total_routes_evaluated).toBe(1);
      // Internal bookkeeping not serialised.
      expect('_alert' in body).toBe(false);
      expect('_submissionOrder' in body).toBe(false);
    } finally {
      await app.close();
    }
  });
});
