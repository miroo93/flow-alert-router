import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, INITIAL_STATS } from '../../src/store.js';
import type { RoutingResult, Alert } from '../../src/types.js';

const alert = (id: string): Alert => ({
  id,
  severity: 'warning',
  service: 'payment-api',
  group: 'default',
  timestamp: '2026-04-19T12:00:00Z',
});

const result = (a: Alert): RoutingResult => ({
  alert_id: a.id,
  routed_to: null,
  suppressed: false,
  matched_routes: [],
  evaluation_details: {
    total_routes_evaluated: 0,
    routes_matched: 0,
    routes_not_matched: 0,
    suppression_applied: false,
  },
  _alert: a,
});

describe('store.stats', () => {
  let store: ReturnType<typeof createStore>;
  beforeEach(() => {
    store = createStore();
  });

  it('INITIAL_STATS has exact shape required by FR-025b / data-model lines 128-138', () => {
    expect(INITIAL_STATS).toEqual({
      total_alerts_processed: 0,
      total_routed: 0,
      total_suppressed: 0,
      total_unrouted: 0,
      by_severity: { critical: 0, warning: 0, info: 0 },
      by_route: {},
      by_service: {},
    });
  });

  it('fresh stats() deep-equals INITIAL_STATS', () => {
    expect(store.stats()).toEqual(INITIAL_STATS);
  });

  it('stats() returns a live reference mutated in place (FR-025b)', () => {
    const s = store.stats();
    s.total_alerts_processed = 1;
    expect(store.stats().total_alerts_processed).toBe(1);
  });

  it('reset() clears all four Maps and restores initial stats', () => {
    // populate all four collections
    store.addRoute({
      id: 'r1',
      priority: 1,
      conditions: {},
      target: { type: 'slack', channel: '#ops' },
    });
    store.upsertAlert(result(alert('a1')));
    store.setSuppression({
      route_id: 'r1',
      service: 'payment-api',
      window_start_iso: '2026-04-19T12:00:00Z',
      expires_at_iso: '2026-04-19T12:05:00Z',
    });
    const s = store.stats();
    s.total_alerts_processed = 5;
    s.by_route['r1'] = { total_matched: 5, total_routed: 5, total_suppressed: 0 };
    s.by_service['payment-api'] = 5;

    store.reset();

    expect(store.listRoutes()).toEqual([]);
    expect(store.listAlerts({})).toEqual([]);
    expect(store.getSuppression('r1', 'payment-api')).toBeUndefined();
    expect(store.stats()).toEqual(INITIAL_STATS);
  });

  it('reset() does not leak state between stats() references when repeatedly reset', () => {
    const before = store.stats();
    before.total_routed = 7;
    store.reset();
    expect(store.stats().total_routed).toBe(0);
  });
});
