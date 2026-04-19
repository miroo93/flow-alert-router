import { describe, it, expect } from 'vitest';
import { buildApp } from '../../src/app.js';

// T034 — NFR-R-005: validation MUST complete before any store mutation.
// A malformed POST /alerts must leave store.stats() AND store.listAlerts({})
// bit-for-bit identical to their pre-call snapshots.
describe('T034: validation atomicity', () => {
  it('malformed POST /alerts (bad timestamp) leaves stats and alerts untouched', async () => {
    const { app, store } = buildApp();
    try {
      // Establish some prior state so the snapshot is non-trivial: one route,
      // one successful alert.
      await app.inject({
        method: 'POST',
        url: '/routes',
        headers: { 'content-type': 'application/json' },
        payload: {
          id: 'r1',
          priority: 1,
          conditions: {},
          target: { type: 'slack', channel: '#x' },
        },
      });
      await app.inject({
        method: 'POST',
        url: '/alerts',
        headers: { 'content-type': 'application/json' },
        payload: {
          id: 'a-ok',
          severity: 'critical',
          service: 'payment-api',
          group: 'billing',
          timestamp: '2026-04-19T10:00:00Z',
        },
      });

      const statsBefore = JSON.stringify(store.stats());
      const alertsBefore = JSON.stringify(store.listAlerts({}));

      // Malformed: date-only timestamp, missing T and Z.
      const res = await app.inject({
        method: 'POST',
        url: '/alerts',
        headers: { 'content-type': 'application/json' },
        payload: {
          id: 'a-bad',
          severity: 'critical',
          service: 'payment-api',
          group: 'billing',
          timestamp: '2026-04-19',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBeTypeOf('string');

      const statsAfter = JSON.stringify(store.stats());
      const alertsAfter = JSON.stringify(store.listAlerts({}));
      expect(statsAfter).toBe(statsBefore);
      expect(alertsAfter).toBe(alertsBefore);
    } finally {
      await app.close();
    }
  });

  it('malformed POST /alerts (bad severity enum) leaves state untouched', async () => {
    const { app, store } = buildApp();
    try {
      const statsBefore = JSON.stringify(store.stats());
      const alertsBefore = JSON.stringify(store.listAlerts({}));

      const res = await app.inject({
        method: 'POST',
        url: '/alerts',
        headers: { 'content-type': 'application/json' },
        payload: {
          id: 'a-bad-sev',
          severity: 'urgent',
          service: 'svc',
          group: 'g',
          timestamp: '2026-04-19T10:00:00Z',
        },
      });
      expect(res.statusCode).toBe(400);

      expect(JSON.stringify(store.stats())).toBe(statsBefore);
      expect(JSON.stringify(store.listAlerts({}))).toBe(alertsBefore);
    } finally {
      await app.close();
    }
  });

  it('malformed POST /routes leaves route list untouched', async () => {
    const { app, store } = buildApp();
    try {
      const routesBefore = JSON.stringify(store.listRoutes());

      const res = await app.inject({
        method: 'POST',
        url: '/routes',
        headers: { 'content-type': 'application/json' },
        payload: {
          id: 'r-bad',
          priority: 3.5, // non-integer
          conditions: {},
          target: { type: 'slack', channel: '#x' },
        },
      });
      expect(res.statusCode).toBe(400);

      expect(JSON.stringify(store.listRoutes())).toBe(routesBefore);
    } finally {
      await app.close();
    }
  });
});
