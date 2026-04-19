import { describe, it, expect, beforeEach } from 'vitest';
import { createStore } from '../../src/store.js';
import type { SuppressionRecord } from '../../src/types.js';

const rec = (o: Partial<SuppressionRecord> & { route_id: string; service: string }): SuppressionRecord => ({
  window_start_iso: '2026-04-19T12:00:00Z',
  expires_at_iso: '2026-04-19T12:05:00Z',
  ...o,
});

describe('store.suppressions', () => {
  let store: ReturnType<typeof createStore>;
  beforeEach(() => {
    store = createStore();
  });

  it('getSuppression returns undefined when no record is set', () => {
    expect(store.getSuppression('r1', 'payment-api')).toBeUndefined();
  });

  it('setSuppression writes a record retrievable by composite key (route_id, service)', () => {
    const r = rec({ route_id: 'r1', service: 'payment-api' });
    store.setSuppression(r);
    expect(store.getSuppression('r1', 'payment-api')).toEqual(r);
  });

  it('composite key isolates records across different (route_id, service) pairs', () => {
    const paymentRec = rec({
      route_id: 'r1',
      service: 'payment-api',
      expires_at_iso: '2026-04-19T12:05:00Z',
    });
    const authRec = rec({
      route_id: 'r1',
      service: 'auth-service',
      expires_at_iso: '2026-04-19T13:00:00Z',
    });
    store.setSuppression(paymentRec);
    store.setSuppression(authRec);
    expect(store.getSuppression('r1', 'payment-api')).toEqual(paymentRec);
    expect(store.getSuppression('r1', 'auth-service')).toEqual(authRec);
    expect(store.getSuppression('r2', 'payment-api')).toBeUndefined();
  });

  it('setSuppression overwrites the existing record for the same key', () => {
    store.setSuppression(rec({ route_id: 'r1', service: 'payment-api', expires_at_iso: '2026-04-19T12:05:00Z' }));
    store.setSuppression(rec({ route_id: 'r1', service: 'payment-api', expires_at_iso: '2026-04-19T12:10:00Z' }));
    expect(store.getSuppression('r1', 'payment-api')?.expires_at_iso).toBe('2026-04-19T12:10:00Z');
  });
});
