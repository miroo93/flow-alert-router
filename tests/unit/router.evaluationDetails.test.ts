import { describe, it, expect, beforeEach } from 'vitest';
import { createStore } from '../../src/store.js';
import { createRouter } from '../../src/router.js';
import type { Alert, Route } from '../../src/types.js';

const route = (o: Partial<Route> & { id: string; priority: number }): Route => ({
  conditions: {},
  target: { type: 'slack', channel: '#ops' },
  ...o,
});

const alert = (o: Partial<Alert> = {}): Alert => ({
  id: 'a1',
  severity: 'critical',
  service: 'payment-api',
  group: 'default',
  timestamp: '2026-04-19T12:00:00Z',
  ...o,
});

describe('router.evaluationDetails', () => {
  let store: ReturnType<typeof createStore>;
  let router: ReturnType<typeof createRouter>;
  beforeEach(() => {
    store = createStore();
    router = createRouter(store);
  });

  it('with 5 routes in store and 2 matches: total_routes_evaluated=5, matched=2, not_matched=3', () => {
    // 5 routes total, 2 match the alert (severity:critical, service:payment-api)
    store.addRoute(route({ id: 'r1', priority: 10 })); // match (empty conditions)
    store.addRoute(route({ id: 'r2', priority: 5, conditions: { severity: ['critical'] } })); // match
    store.addRoute(route({ id: 'r3', priority: 1, conditions: { severity: ['info'] } })); // no
    store.addRoute(route({ id: 'r4', priority: 1, conditions: { service: ['auth-*'] } })); // no
    store.addRoute(route({ id: 'r5', priority: 1, conditions: { group: ['otherGroup'] } })); // no

    const r = router.evaluate(alert());
    expect(r.evaluation_details.total_routes_evaluated).toBe(5);
    expect(r.evaluation_details.routes_matched).toBe(2);
    expect(r.evaluation_details.routes_not_matched).toBe(3);
  });

  it('total_routes_evaluated tracks the store route count, not the matched count', () => {
    // 3 routes, none match — evaluation still counts all 3
    store.addRoute(route({ id: 'r1', priority: 10, conditions: { severity: ['info'] } }));
    store.addRoute(route({ id: 'r2', priority: 5, conditions: { severity: ['info'] } }));
    store.addRoute(route({ id: 'r3', priority: 1, conditions: { severity: ['info'] } }));
    const r = router.evaluate(alert({ severity: 'critical' }));
    expect(r.evaluation_details.total_routes_evaluated).toBe(3);
    expect(r.evaluation_details.routes_matched).toBe(0);
    expect(r.evaluation_details.routes_not_matched).toBe(3);
  });

  it('suppression_applied is true IFF the winner was suppressed', () => {
    store.addRoute(route({ id: 'r1', priority: 10, suppression_window_seconds: 300 }));
    router.evaluate(alert({ id: 'a1', timestamp: '2026-04-19T12:00:00Z' }));
    const r = router.evaluate(alert({ id: 'a2', timestamp: '2026-04-19T12:01:00Z' }));
    expect(r.suppressed).toBe(true);
    expect(r.evaluation_details.suppression_applied).toBe(true);
  });

  it('suppression_applied is false when winner was routed (non-suppressed)', () => {
    store.addRoute(route({ id: 'r1', priority: 10, suppression_window_seconds: 300 }));
    const r = router.evaluate(alert());
    expect(r.suppressed).toBe(false);
    expect(r.evaluation_details.suppression_applied).toBe(false);
  });

  it('no-match case: routed_to=null, matched_routes=[], suppression_reason absent', () => {
    store.addRoute(route({ id: 'r1', priority: 10, conditions: { severity: ['info'] } }));
    const r = router.evaluate(alert({ severity: 'critical' }));
    expect(r.routed_to).toBeNull();
    expect(r.matched_routes).toEqual([]);
    expect(r.suppression_reason).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(r, 'suppression_reason')).toBe(false);
    expect(r.evaluation_details.suppression_applied).toBe(false);
  });

  it('empty store: total_routes_evaluated=0, matched=0, not_matched=0', () => {
    const r = router.evaluate(alert());
    expect(r.evaluation_details.total_routes_evaluated).toBe(0);
    expect(r.evaluation_details.routes_matched).toBe(0);
    expect(r.evaluation_details.routes_not_matched).toBe(0);
    expect(r.routed_to).toBeNull();
  });
});
