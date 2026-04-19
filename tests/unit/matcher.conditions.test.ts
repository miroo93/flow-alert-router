import { describe, it, expect } from 'vitest';
import { matchesConditions } from '../../src/matcher.js';
import type { Alert, Route } from '../../src/types.js';

const alert = (o: Partial<Alert> = {}): Alert => ({
  id: 'a1',
  severity: 'critical',
  service: 'payment-api',
  group: 'default',
  timestamp: '2026-04-19T12:00:00Z',
  ...o,
});

const route = (o: Partial<Route> & { conditions?: Route['conditions'] } = {}): Route => ({
  id: 'r1',
  priority: 1,
  conditions: o.conditions ?? {},
  target: { type: 'slack', channel: '#ops' },
  ...o,
});

describe('matcher.conditions', () => {
  it('empty conditions match every alert (conditions:{} semantics)', () => {
    expect(matchesConditions(route({ conditions: {} }), alert())).toBe(true);
  });

  it('severity list match / no-match', () => {
    expect(
      matchesConditions(route({ conditions: { severity: ['critical', 'warning'] } }), alert({ severity: 'critical' })),
    ).toBe(true);
    expect(
      matchesConditions(route({ conditions: { severity: ['warning'] } }), alert({ severity: 'critical' })),
    ).toBe(false);
  });

  it('service glob payment-* matches payment-api and payment-worker; excludes auth-service', () => {
    const r = route({ conditions: { service: ['payment-*'] } });
    expect(matchesConditions(r, alert({ service: 'payment-api' }))).toBe(true);
    expect(matchesConditions(r, alert({ service: 'payment-worker' }))).toBe(true);
    expect(matchesConditions(r, alert({ service: 'auth-service' }))).toBe(false);
  });

  it('service glob *-api matches payment-api; excludes payment-worker', () => {
    const r = route({ conditions: { service: ['*-api'] } });
    expect(matchesConditions(r, alert({ service: 'payment-api' }))).toBe(true);
    expect(matchesConditions(r, alert({ service: 'auth-api' }))).toBe(true);
    expect(matchesConditions(r, alert({ service: 'payment-worker' }))).toBe(false);
  });

  it('service literal (no wildcard) matches exactly', () => {
    const r = route({ conditions: { service: ['payment-api'] } });
    expect(matchesConditions(r, alert({ service: 'payment-api' }))).toBe(true);
    expect(matchesConditions(r, alert({ service: 'payment-worker' }))).toBe(false);
  });

  it('group list OR match', () => {
    const r = route({ conditions: { group: ['payments', 'billing'] } });
    expect(matchesConditions(r, alert({ group: 'payments' }))).toBe(true);
    expect(matchesConditions(r, alert({ group: 'billing' }))).toBe(true);
    expect(matchesConditions(r, alert({ group: 'auth' }))).toBe(false);
  });

  it('labels subset match: alert superset OK, missing key rejects, wrong value rejects', () => {
    const r = route({ conditions: { labels: { env: 'prod', team: 'payments' } } });
    // alert has both required labels plus extras — match
    expect(
      matchesConditions(r, alert({ labels: { env: 'prod', team: 'payments', region: 'us-east-1' } })),
    ).toBe(true);
    // missing team — no match
    expect(matchesConditions(r, alert({ labels: { env: 'prod' } }))).toBe(false);
    // wrong value — no match
    expect(
      matchesConditions(r, alert({ labels: { env: 'staging', team: 'payments' } })),
    ).toBe(false);
    // alert has no labels at all — no match (required labels present)
    expect(matchesConditions(r, alert({}))).toBe(false);
  });

  it('omitted condition field = match all for that field', () => {
    // no severity in conditions — any severity matches
    const r = route({ conditions: { service: ['payment-*'] } });
    expect(matchesConditions(r, alert({ severity: 'info', service: 'payment-api' }))).toBe(true);
    expect(matchesConditions(r, alert({ severity: 'critical', service: 'payment-api' }))).toBe(true);
  });

  it('combined conditions are AND-joined', () => {
    const r = route({
      conditions: {
        severity: ['critical'],
        service: ['payment-*'],
        labels: { env: 'prod' },
      },
    });
    // all three satisfied
    expect(
      matchesConditions(
        r,
        alert({ severity: 'critical', service: 'payment-api', labels: { env: 'prod' } }),
      ),
    ).toBe(true);
    // severity wrong
    expect(
      matchesConditions(
        r,
        alert({ severity: 'warning', service: 'payment-api', labels: { env: 'prod' } }),
      ),
    ).toBe(false);
    // service wrong
    expect(
      matchesConditions(
        r,
        alert({ severity: 'critical', service: 'auth-api', labels: { env: 'prod' } }),
      ),
    ).toBe(false);
    // label wrong
    expect(
      matchesConditions(
        r,
        alert({ severity: 'critical', service: 'payment-api', labels: { env: 'staging' } }),
      ),
    ).toBe(false);
  });

  it('empty array on a field semantically matches nothing (conservative)', () => {
    // severity:[] — no severity allowed
    expect(
      matchesConditions(route({ conditions: { severity: [] } }), alert({ severity: 'critical' })),
    ).toBe(false);
  });
});
