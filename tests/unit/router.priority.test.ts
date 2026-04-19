import { describe, it, expect, beforeEach } from 'vitest';
import { createStore } from '../../src/store.js';
import { createRouter } from '../../src/router.js';
import type { Alert, Route } from '../../src/types.js';

const alert = (o: Partial<Alert> = {}): Alert => ({
  id: 'a1',
  severity: 'critical',
  service: 'payment-api',
  group: 'default',
  timestamp: '2026-04-19T12:00:00Z',
  ...o,
});

const route = (o: Partial<Route> & { id: string; priority: number }): Route => ({
  conditions: {},
  target: { type: 'slack', channel: '#ops' },
  ...o,
});

describe('router.priority', () => {
  let store: ReturnType<typeof createStore>;
  let router: ReturnType<typeof createRouter>;
  beforeEach(() => {
    store = createStore();
    router = createRouter(store);
  });

  it('three matching routes: winner is the max-priority route', () => {
    store.addRoute(route({ id: 'r-low', priority: 1 }));
    store.addRoute(route({ id: 'r-mid', priority: 5 }));
    store.addRoute(route({ id: 'r-hi', priority: 10 }));
    const result = router.evaluate(alert());
    expect(result.routed_to?.route_id).toBe('r-hi');
  });

  it('matched_routes lists all matching ids sorted priority-desc (losers included)', () => {
    store.addRoute(route({ id: 'r-low', priority: 1 }));
    store.addRoute(route({ id: 'r-mid', priority: 5 }));
    store.addRoute(route({ id: 'r-hi', priority: 10 }));
    const result = router.evaluate(alert());
    expect(result.matched_routes).toEqual(['r-hi', 'r-mid', 'r-low']);
  });

  it('priority tie broken by insertion order: first-inserted wins; both appear in matched_routes', () => {
    store.addRoute(route({ id: 'first', priority: 5 }));
    store.addRoute(route({ id: 'second', priority: 5 }));
    const result = router.evaluate(alert());
    expect(result.routed_to?.route_id).toBe('first');
    expect(result.matched_routes).toEqual(['first', 'second']);
  });

  it('non-matching routes excluded from matched_routes; winner is highest-priority matcher', () => {
    // r-hi has priority 100 but its conditions exclude this alert
    store.addRoute(route({ id: 'r-hi', priority: 100, conditions: { severity: ['info'] } }));
    store.addRoute(route({ id: 'r-mid', priority: 10 }));
    store.addRoute(route({ id: 'r-low', priority: 1 }));
    const result = router.evaluate(alert({ severity: 'critical' }));
    expect(result.routed_to?.route_id).toBe('r-mid');
    expect(result.matched_routes).toEqual(['r-mid', 'r-low']);
  });

  it('no matching routes: routed_to is null, matched_routes is empty', () => {
    store.addRoute(route({ id: 'r-info', priority: 10, conditions: { severity: ['info'] } }));
    const result = router.evaluate(alert({ severity: 'critical' }));
    expect(result.routed_to).toBeNull();
    expect(result.matched_routes).toEqual([]);
    expect(result.suppressed).toBe(false);
  });

  it('active_hours filter also gates matching (non-active route not in matched_routes)', () => {
    store.addRoute(
      route({
        id: 'r-active',
        priority: 10,
        active_hours: { start: '09:00', end: '17:00', timezone: 'America/New_York' },
      }),
    );
    store.addRoute(route({ id: 'r-fallback', priority: 1 }));
    // 21:00 UTC -> 17:00 EDT (exclusive end) -> r-active NOT active
    const result = router.evaluate(alert({ timestamp: '2026-04-20T21:00:00Z' }));
    expect(result.routed_to?.route_id).toBe('r-fallback');
    expect(result.matched_routes).toEqual(['r-fallback']);
  });

  it('winner routed_to echoes the target from the winning route', () => {
    store.addRoute(
      route({
        id: 'r-hi',
        priority: 10,
        target: { type: 'webhook', url: 'https://example.com/hook', headers: { 'x-key': 'abc' } },
      }),
    );
    const result = router.evaluate(alert());
    expect(result.routed_to?.target).toEqual({
      type: 'webhook',
      url: 'https://example.com/hook',
      headers: { 'x-key': 'abc' },
    });
  });
});
