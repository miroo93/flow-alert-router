import { describe, it, expect, beforeEach } from 'vitest';
import { createStore } from '../../src/store.js';
import { createRouter } from '../../src/router.js';
import type { Alert, Route } from '../../src/types.js';

const route = (o: Partial<Route> & { id: string } = { id: 'r1' }): Route => ({
  id: o.id,
  priority: 10,
  conditions: {},
  target: { type: 'slack', channel: '#ops' },
  suppression_window_seconds: 300,
  ...o,
});

const alert = (id: string, timestamp: string, o: Partial<Alert> = {}): Alert => ({
  id,
  severity: 'critical',
  service: 'payment-api',
  group: 'default',
  timestamp,
  ...o,
});

describe('router.suppression', () => {
  let store: ReturnType<typeof createStore>;
  let router: ReturnType<typeof createRouter>;
  beforeEach(() => {
    store = createStore();
    router = createRouter(store);
  });

  it('first alert establishes the window and is NOT suppressed', () => {
    store.addRoute(route({ id: 'r1', suppression_window_seconds: 300 }));
    const r = router.evaluate(alert('a1', '2026-04-19T12:00:00Z'));
    expect(r.suppressed).toBe(false);
    expect(r.suppression_reason).toBeUndefined();
    expect(r.routed_to?.route_id).toBe('r1');
    // Suppression record written with expiry = window_start + 300s
    const rec = store.getSuppression('r1', 'payment-api');
    expect(rec?.window_start_iso).toBe('2026-04-19T12:00:00Z');
    expect(rec?.expires_at_iso).toBe('2026-04-19T12:05:00Z');
  });

  it('second alert inside the window is suppressed with exact FR-015 reason template', () => {
    store.addRoute(route({ id: 'r1', suppression_window_seconds: 300 }));
    router.evaluate(alert('a1', '2026-04-19T12:00:00Z'));
    const r = router.evaluate(alert('a2', '2026-04-19T12:03:00Z'));
    expect(r.suppressed).toBe(true);
    expect(r.suppression_reason).toBe(
      "Alert for service 'payment-api' on route 'r1' suppressed until 2026-04-19T12:05:00Z",
    );
    // When suppressed, routed_to is still populated with the winner (FR-004b)
    expect(r.routed_to?.route_id).toBe('r1');
  });

  it('third alert after the window routes AND restarts the window at its own timestamp', () => {
    store.addRoute(route({ id: 'r1', suppression_window_seconds: 300 }));
    router.evaluate(alert('a1', '2026-04-19T12:00:00Z')); // window starts 12:00Z, expires 12:05Z
    router.evaluate(alert('a2', '2026-04-19T12:03:00Z')); // suppressed inside window
    const r = router.evaluate(alert('a3', '2026-04-19T12:06:00Z')); // after window
    expect(r.suppressed).toBe(false);
    const rec = store.getSuppression('r1', 'payment-api');
    expect(rec?.window_start_iso).toBe('2026-04-19T12:06:00Z');
    expect(rec?.expires_at_iso).toBe('2026-04-19T12:11:00Z');
  });

  it('WINDOW-NOT-EXTENDED PROOF: suppressed alert at T+240s does NOT extend window; alert at T+310s routes', () => {
    // Window is 300s. Establish at T=0 (expires T+300). Suppressed alert at T+240
    // (inside window). If T+240 had extended the window to T+540, then T+310 would
    // suppress — but FR-019 says suppressed alerts do NOT extend the window, so T+310 routes.
    store.addRoute(route({ id: 'r1', suppression_window_seconds: 300 }));
    router.evaluate(alert('a1', '2026-04-19T12:00:00Z')); // T=0
    const r240 = router.evaluate(alert('a2', '2026-04-19T12:04:00Z')); // T+240s
    expect(r240.suppressed).toBe(true);
    const r310 = router.evaluate(alert('a3', '2026-04-19T12:05:10Z')); // T+310s
    expect(r310.suppressed).toBe(false);
    // And the new window restarts from T+310:
    const rec = store.getSuppression('r1', 'payment-api');
    expect(rec?.window_start_iso).toBe('2026-04-19T12:05:10Z');
    expect(rec?.expires_at_iso).toBe('2026-04-19T12:10:10Z');
  });

  it('different service on same route is NOT suppressed (composite key isolation)', () => {
    store.addRoute(route({ id: 'r1', suppression_window_seconds: 300, conditions: {} }));
    router.evaluate(alert('a1', '2026-04-19T12:00:00Z', { service: 'payment-api' }));
    const r = router.evaluate(alert('a2', '2026-04-19T12:01:00Z', { service: 'auth-service' }));
    expect(r.suppressed).toBe(false);
    // Both suppression records exist for their respective services
    expect(store.getSuppression('r1', 'payment-api')).toBeDefined();
    expect(store.getSuppression('r1', 'auth-service')).toBeDefined();
  });

  it('suppression_window_seconds: 0 is equivalent to omission (no suppression ever)', () => {
    store.addRoute(route({ id: 'r1', suppression_window_seconds: 0 }));
    router.evaluate(alert('a1', '2026-04-19T12:00:00Z'));
    const r = router.evaluate(alert('a2', '2026-04-19T12:00:01Z'));
    expect(r.suppressed).toBe(false);
    // No suppression record is written when the window is zero/omitted
    expect(store.getSuppression('r1', 'payment-api')).toBeUndefined();
  });

  it('suppression_window_seconds omitted: no suppression ever', () => {
    store.addRoute(route({ id: 'r1', suppression_window_seconds: undefined }));
    router.evaluate(alert('a1', '2026-04-19T12:00:00Z'));
    const r = router.evaluate(alert('a2', '2026-04-19T12:00:01Z'));
    expect(r.suppressed).toBe(false);
    expect(store.getSuppression('r1', 'payment-api')).toBeUndefined();
  });

  it('suppression_applied flag reflects winner-was-suppressed', () => {
    store.addRoute(route({ id: 'r1', suppression_window_seconds: 300 }));
    router.evaluate(alert('a1', '2026-04-19T12:00:00Z'));
    const r = router.evaluate(alert('a2', '2026-04-19T12:01:00Z'));
    expect(r.evaluation_details.suppression_applied).toBe(true);
  });

  it('only the winner drives the suppression window; losers do not write records', () => {
    // Two matching routes; 'r1' wins on priority.
    store.addRoute(route({ id: 'r1', priority: 10, suppression_window_seconds: 300 }));
    store.addRoute(route({ id: 'r2', priority: 1, suppression_window_seconds: 300 }));
    router.evaluate(alert('a1', '2026-04-19T12:00:00Z'));
    expect(store.getSuppression('r1', 'payment-api')).toBeDefined();
    expect(store.getSuppression('r2', 'payment-api')).toBeUndefined();
  });
});
