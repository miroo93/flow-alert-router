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

// Observable snapshot of every store-mutable surface visible to /alerts,
// /test, /stats, and /alerts/:id handlers. If router.evaluate({dryRun:true})
// mutates ANY of these, the before/after deep-equal will catch it.
function snapshot(store: ReturnType<typeof createStore>, serviceKeys: string[]) {
  return {
    stats: JSON.parse(JSON.stringify(store.stats())),
    alerts: store.listAlerts({}).map((r) => ({ id: r.alert_id, raw: JSON.stringify(r) })),
    routes: store.listRoutes().map((r) => r.id),
    suppressions: serviceKeys
      .flatMap((svc) =>
        store.listRoutes().map((r) => {
          const rec = store.getSuppression(r.id, svc);
          return rec ? { key: `${r.id}:${svc}`, raw: JSON.stringify(rec) } : null;
        }),
      )
      .filter((x): x is { key: string; raw: string } => x !== null),
  };
}

describe('router.dryRun', () => {
  let store: ReturnType<typeof createStore>;
  let router: ReturnType<typeof createRouter>;
  beforeEach(() => {
    store = createStore();
    router = createRouter(store);
  });

  it('dryRun on an empty store produces a RoutingResult without mutating state', () => {
    const before = snapshot(store, ['payment-api']);
    const result = router.evaluate(alert({ id: 'a1' }), { dryRun: true });
    const after = snapshot(store, ['payment-api']);
    expect(after).toEqual(before);
    // The return shape is still a full RoutingResult
    expect(result.alert_id).toBe('a1');
    expect(result.routed_to).toBeNull();
    expect(result.evaluation_details.total_routes_evaluated).toBe(0);
  });

  it('dryRun with matching routes returns the same result shape but writes nothing', () => {
    store.addRoute(route({ id: 'r1', priority: 10, suppression_window_seconds: 300 }));
    store.addRoute(route({ id: 'r2', priority: 1 }));
    const before = snapshot(store, ['payment-api']);

    const result = router.evaluate(alert({ id: 'dry-1' }), { dryRun: true });

    const after = snapshot(store, ['payment-api']);
    expect(after).toEqual(before);
    // Result is complete and correct — it mirrors what a real evaluate would say.
    expect(result.routed_to?.route_id).toBe('r1');
    expect(result.matched_routes).toEqual(['r1', 'r2']);
    expect(result.evaluation_details).toEqual({
      total_routes_evaluated: 2,
      routes_matched: 2,
      routes_not_matched: 0,
      suppression_applied: false,
    });
    // Explicitly: no alerts record, no suppression record, stats still zeroed
    expect(store.getAlert('dry-1')).toBeUndefined();
    expect(store.getSuppression('r1', 'payment-api')).toBeUndefined();
    expect(store.stats().total_alerts_processed).toBe(0);
  });

  it('dryRun does NOT reset or extend an existing suppression window (landmine #4)', () => {
    // Real alert sets a 300s window starting 12:00:00Z, expiring 12:05:00Z.
    store.addRoute(route({ id: 'r1', priority: 10, suppression_window_seconds: 300 }));
    router.evaluate(alert({ id: 'real-1', timestamp: '2026-04-19T12:00:00Z' }));
    const recBefore = store.getSuppression('r1', 'payment-api');
    expect(recBefore?.expires_at_iso).toBe('2026-04-19T12:05:00Z');
    const statsBefore = JSON.parse(JSON.stringify(store.stats()));

    // Dry-run at +60s — would be suppressed in a real call.
    const dry = router.evaluate(alert({ id: 'dry-1', timestamp: '2026-04-19T12:01:00Z' }), {
      dryRun: true,
    });
    expect(dry.suppressed).toBe(true);

    // Suppression record untouched, stats untouched, alert not stored.
    const recAfter = store.getSuppression('r1', 'payment-api');
    expect(recAfter).toEqual(recBefore);
    expect(store.stats()).toEqual(statsBefore);
    expect(store.getAlert('dry-1')).toBeUndefined();
  });

  it('without dryRun (default opts) stats and suppression DO mutate — sanity guard', () => {
    // Router mutates stats + suppressions on real calls. (Alerts are persisted
    // by the POST /alerts handler, not the router itself — see T025.)
    store.addRoute(route({ id: 'r1', priority: 10, suppression_window_seconds: 300 }));
    router.evaluate(alert({ id: 'a1' }));
    expect(store.stats().total_alerts_processed).toBe(1);
    expect(store.getSuppression('r1', 'payment-api')).toBeDefined();
  });
});
