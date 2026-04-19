import { describe, it, expect, beforeEach } from 'vitest';
import { createStore } from '../../src/store.js';
import { createRouter } from '../../src/router.js';
import type { Alert, Route } from '../../src/types.js';

const route = (o: Partial<Route> & { id: string; priority: number }): Route => ({
  conditions: {},
  target: { type: 'slack', channel: '#ops' },
  ...o,
});

const alert = (o: Partial<Alert> & { id: string }): Alert => ({
  severity: 'critical',
  service: 'payment-api',
  group: 'default',
  timestamp: '2026-04-19T12:00:00Z',
  ...o,
});

describe('router.stats', () => {
  let store: ReturnType<typeof createStore>;
  let router: ReturnType<typeof createRouter>;
  beforeEach(() => {
    store = createStore();
    router = createRouter(store);
  });

  it('routed alert: total_alerts_processed, total_routed, by_severity, by_service, by_route increment', () => {
    store.addRoute(route({ id: 'r1', priority: 10 }));
    router.evaluate(alert({ id: 'a1' }));
    const s = store.stats();
    expect(s.total_alerts_processed).toBe(1);
    expect(s.total_routed).toBe(1);
    expect(s.total_suppressed).toBe(0);
    expect(s.total_unrouted).toBe(0);
    expect(s.by_severity.critical).toBe(1);
    expect(s.by_severity.warning).toBe(0);
    expect(s.by_severity.info).toBe(0);
    expect(s.by_service['payment-api']).toBe(1);
    expect(s.by_route['r1']).toEqual({ total_matched: 1, total_routed: 1, total_suppressed: 0 });
  });

  it('every match bumps by_route[*].total_matched, including losers', () => {
    store.addRoute(route({ id: 'hi', priority: 10 }));
    store.addRoute(route({ id: 'lo', priority: 1 }));
    router.evaluate(alert({ id: 'a1' }));
    const s = store.stats();
    expect(s.by_route['hi']).toEqual({ total_matched: 1, total_routed: 1, total_suppressed: 0 });
    expect(s.by_route['lo']).toEqual({ total_matched: 1, total_routed: 0, total_suppressed: 0 });
  });

  it('suppressed alert: total_suppressed + by_route[winner].total_suppressed increment, total_routed unchanged', () => {
    store.addRoute(route({ id: 'r1', priority: 10, suppression_window_seconds: 300 }));
    router.evaluate(alert({ id: 'a1', timestamp: '2026-04-19T12:00:00Z' }));
    router.evaluate(alert({ id: 'a2', timestamp: '2026-04-19T12:01:00Z' }));
    const s = store.stats();
    expect(s.total_alerts_processed).toBe(2);
    expect(s.total_routed).toBe(1);
    expect(s.total_suppressed).toBe(1);
    expect(s.total_unrouted).toBe(0);
    expect(s.by_route['r1']).toEqual({ total_matched: 2, total_routed: 1, total_suppressed: 1 });
  });

  it('no-match alert: total_unrouted increments; by_severity and by_service still increment', () => {
    store.addRoute(route({ id: 'r1', priority: 10, conditions: { severity: ['info'] } }));
    router.evaluate(alert({ id: 'a1', severity: 'critical' }));
    const s = store.stats();
    expect(s.total_alerts_processed).toBe(1);
    expect(s.total_routed).toBe(0);
    expect(s.total_suppressed).toBe(0);
    expect(s.total_unrouted).toBe(1);
    expect(s.by_severity.critical).toBe(1);
    expect(s.by_service['payment-api']).toBe(1);
    expect(s.by_route).toEqual({});
  });

  it('re-submission of the same alert id increments stats again (upsert ≠ dedupe)', () => {
    store.addRoute(route({ id: 'r1', priority: 10 }));
    router.evaluate(alert({ id: 'a1' }));
    router.evaluate(alert({ id: 'a1' })); // same id
    const s = store.stats();
    expect(s.total_alerts_processed).toBe(2);
    expect(s.total_routed).toBe(2);
    expect(s.by_route['r1']?.total_matched).toBe(2);
  });

  it('SC-009 invariant: total_alerts_processed = total_routed + total_suppressed + total_unrouted', () => {
    store.addRoute(route({ id: 'r1', priority: 10, suppression_window_seconds: 300 }));
    store.addRoute(route({ id: 'r-info', priority: 5, conditions: { severity: ['info'] } }));
    // One routed
    router.evaluate(alert({ id: 'a1', timestamp: '2026-04-19T12:00:00Z' }));
    // One suppressed
    router.evaluate(alert({ id: 'a2', timestamp: '2026-04-19T12:01:00Z' }));
    // One unrouted (different service so no match against r1 empty-conditions… actually r1 still matches)
    // Use severity:'warning' + service:'auth-service' so both routes miss:
    // r1 has empty conditions — still matches. Instead restrict r1 to 'critical' so warning misses.
    store.deleteRoute('r1');
    store.deleteRoute('r-info');
    store.addRoute(
      route({ id: 'r1', priority: 10, conditions: { severity: ['critical'] }, suppression_window_seconds: 300 }),
    );
    store.addRoute(route({ id: 'r-info', priority: 5, conditions: { severity: ['info'] } }));
    // Reset stats via store.reset() to get clean count
    store.reset();
    store.addRoute(
      route({ id: 'r1', priority: 10, conditions: { severity: ['critical'] }, suppression_window_seconds: 300 }),
    );
    router.evaluate(alert({ id: 'a1', severity: 'critical', timestamp: '2026-04-19T12:00:00Z' })); // routed
    router.evaluate(alert({ id: 'a2', severity: 'critical', timestamp: '2026-04-19T12:01:00Z' })); // suppressed
    router.evaluate(alert({ id: 'a3', severity: 'warning', timestamp: '2026-04-19T12:02:00Z' })); // unrouted (r1 only matches critical)

    const s = store.stats();
    expect(s.total_alerts_processed).toBe(s.total_routed + s.total_suppressed + s.total_unrouted);
    expect(s.total_alerts_processed).toBe(3);
    expect(s.total_routed).toBe(1);
    expect(s.total_suppressed).toBe(1);
    expect(s.total_unrouted).toBe(1);
  });

  it('SC-009 per-route invariant: total_matched ≥ total_routed + total_suppressed', () => {
    store.addRoute(route({ id: 'hi', priority: 10, suppression_window_seconds: 300 }));
    store.addRoute(route({ id: 'lo', priority: 1 }));
    router.evaluate(alert({ id: 'a1', timestamp: '2026-04-19T12:00:00Z' })); // hi routed, lo matched loser
    router.evaluate(alert({ id: 'a2', timestamp: '2026-04-19T12:01:00Z' })); // hi suppressed, lo matched loser
    const s = store.stats();
    for (const [id, per] of Object.entries(s.by_route)) {
      expect(per.total_matched, `route ${id}`).toBeGreaterThanOrEqual(
        per.total_routed + per.total_suppressed,
      );
    }
    // Losers have matched but no routed or suppressed counts
    expect(s.by_route['lo']).toEqual({ total_matched: 2, total_routed: 0, total_suppressed: 0 });
    expect(s.by_route['hi']).toEqual({ total_matched: 2, total_routed: 1, total_suppressed: 1 });
  });
});
