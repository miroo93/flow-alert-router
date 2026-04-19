import { describe, it, expect, beforeEach } from 'vitest';
import { createStore } from '../../src/store.js';
import type { RoutingResult, Alert } from '../../src/types.js';

const alert = (o: Partial<Alert> & { id: string }): Alert => ({
  severity: 'warning',
  service: 'payment-api',
  group: 'default',
  timestamp: '2026-04-19T12:00:00Z',
  ...o,
});

const result = (
  a: Alert,
  opts: { routed?: boolean; suppressed?: boolean; matched?: string[] } = {},
): RoutingResult => {
  const matched = opts.matched ?? [];
  const routed = opts.routed ?? false;
  const suppressed = opts.suppressed ?? false;
  return {
    alert_id: a.id,
    routed_to: routed || suppressed ? { route_id: matched[0] ?? 'rX', target: { type: 'slack', channel: '#ops' } } : null,
    suppressed,
    matched_routes: matched,
    evaluation_details: {
      total_routes_evaluated: 0,
      routes_matched: matched.length,
      routes_not_matched: 0,
      suppression_applied: suppressed,
    },
    _alert: a,
  };
};

describe('store.alerts', () => {
  let store: ReturnType<typeof createStore>;
  beforeEach(() => {
    store = createStore();
  });

  it('upsertAlert stores the record; getAlert retrieves it', () => {
    const a = alert({ id: 'a1' });
    store.upsertAlert(result(a));
    expect(store.getAlert('a1')?.alert_id).toBe('a1');
    expect(store.getAlert('missing')).toBeUndefined();
  });

  it('upsertAlert replaces by id while preserving original submission-order index', () => {
    store.upsertAlert(result(alert({ id: 'a1' })));
    store.upsertAlert(result(alert({ id: 'a2' })));
    store.upsertAlert(result(alert({ id: 'a3' })));
    // Re-submit a1 — it should still appear first (submission order preserved).
    store.upsertAlert(result(alert({ id: 'a1', description: 'updated' })));
    const ids = store.listAlerts({}).map((r) => r.alert_id);
    expect(ids).toEqual(['a1', 'a2', 'a3']);
    expect(store.getAlert('a1')?._alert?.description).toBe('updated');
  });

  it('listAlerts with no filters returns all records in submission order', () => {
    store.upsertAlert(result(alert({ id: 'a1' })));
    store.upsertAlert(result(alert({ id: 'a2' })));
    expect(store.listAlerts({}).map((r) => r.alert_id)).toEqual(['a1', 'a2']);
  });

  it('listAlerts applies AND across service + severity filters', () => {
    store.upsertAlert(result(alert({ id: 'a1', service: 'payment-api', severity: 'critical' })));
    store.upsertAlert(result(alert({ id: 'a2', service: 'payment-api', severity: 'warning' })));
    store.upsertAlert(result(alert({ id: 'a3', service: 'auth-service', severity: 'critical' })));
    expect(
      store
        .listAlerts({ service: 'payment-api', severity: 'critical' })
        .map((r) => r.alert_id),
    ).toEqual(['a1']);
  });

  it('listAlerts filters by routed=true/false', () => {
    store.upsertAlert(result(alert({ id: 'a1' }), { routed: true, matched: ['r1'] }));
    store.upsertAlert(result(alert({ id: 'a2' }), { routed: false }));
    expect(store.listAlerts({ routed: 'true' }).map((r) => r.alert_id)).toEqual(['a1']);
    expect(store.listAlerts({ routed: 'false' }).map((r) => r.alert_id)).toEqual(['a2']);
  });

  it('listAlerts filters by suppressed=true/false', () => {
    store.upsertAlert(result(alert({ id: 'a1' }), { suppressed: true, matched: ['r1'] }));
    store.upsertAlert(result(alert({ id: 'a2' }), { suppressed: false }));
    expect(store.listAlerts({ suppressed: 'true' }).map((r) => r.alert_id)).toEqual(['a1']);
    expect(store.listAlerts({ suppressed: 'false' }).map((r) => r.alert_id)).toEqual(['a2']);
  });

  it('invalid filter values produce empty array (lenient FR-024a)', () => {
    store.upsertAlert(result(alert({ id: 'a1', severity: 'critical' })));
    expect(store.listAlerts({ severity: 'nuclear' })).toEqual([]);
    expect(store.listAlerts({ routed: 'maybe' })).toEqual([]);
    expect(store.listAlerts({ suppressed: 'sometimes' })).toEqual([]);
  });
});
