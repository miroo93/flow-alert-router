import { describe, it, expect } from 'vitest';
import { isWithinActiveHours } from '../../src/matcher.js';
import type { Alert, Route } from '../../src/types.js';

const alert = (timestamp: string, o: Partial<Alert> = {}): Alert => ({
  id: 'a1',
  severity: 'warning',
  service: 'payment-api',
  group: 'default',
  timestamp,
  ...o,
});

const route = (o: Partial<Route> = {}): Route => ({
  id: 'r1',
  priority: 1,
  conditions: {},
  target: { type: 'slack', channel: '#ops' },
  ...o,
});

describe('matcher.activeHours', () => {
  it('route with no active_hours is always active', () => {
    expect(isWithinActiveHours(route({ active_hours: undefined }), alert('2026-04-20T03:00:00Z'))).toBe(true);
    expect(isWithinActiveHours(route({ active_hours: undefined }), alert('2026-04-20T23:59:59Z'))).toBe(true);
  });

  it('America/New_York 09:00-17:00: 13:00 UTC on 2026-04-20 = 09:00 EDT (inclusive start, match)', () => {
    const r = route({
      active_hours: { start: '09:00', end: '17:00', timezone: 'America/New_York' },
    });
    expect(isWithinActiveHours(r, alert('2026-04-20T13:00:00Z'))).toBe(true);
  });

  it('America/New_York 09:00-17:00: 21:00 UTC on 2026-04-20 = 17:00 EDT (exclusive end, no match)', () => {
    const r = route({
      active_hours: { start: '09:00', end: '17:00', timezone: 'America/New_York' },
    });
    expect(isWithinActiveHours(r, alert('2026-04-20T21:00:00Z'))).toBe(false);
  });

  it('America/New_York 09:00-17:00: 12:00 UTC (08:00 EDT, before window) no match', () => {
    const r = route({
      active_hours: { start: '09:00', end: '17:00', timezone: 'America/New_York' },
    });
    expect(isWithinActiveHours(r, alert('2026-04-20T12:00:00Z'))).toBe(false);
  });

  it('America/New_York 09:00-17:00: 20:59 UTC (16:59 EDT, inside window) match', () => {
    const r = route({
      active_hours: { start: '09:00', end: '17:00', timezone: 'America/New_York' },
    });
    expect(isWithinActiveHours(r, alert('2026-04-20T20:59:00Z'))).toBe(true);
  });

  it('Asia/Tokyo 09:00-17:00: 00:00 UTC on 2026-04-20 = 09:00 JST (inclusive start, match)', () => {
    const r = route({
      active_hours: { start: '09:00', end: '17:00', timezone: 'Asia/Tokyo' },
    });
    expect(isWithinActiveHours(r, alert('2026-04-20T00:00:00Z'))).toBe(true);
  });

  it('Asia/Tokyo 09:00-17:00: 08:00 UTC = 17:00 JST (exclusive end, no match)', () => {
    const r = route({
      active_hours: { start: '09:00', end: '17:00', timezone: 'Asia/Tokyo' },
    });
    expect(isWithinActiveHours(r, alert('2026-04-20T08:00:00Z'))).toBe(false);
  });

  it('Asia/Tokyo 09:00-17:00: 07:59 UTC = 16:59 JST (inside window) match', () => {
    const r = route({
      active_hours: { start: '09:00', end: '17:00', timezone: 'Asia/Tokyo' },
    });
    expect(isWithinActiveHours(r, alert('2026-04-20T07:59:00Z'))).toBe(true);
  });

  it('input with offset (±HH:MM) is interpreted as the absolute instant, then zoned', () => {
    // 2026-04-20T09:00:00-04:00 == 13:00:00Z == 09:00 EDT in America/New_York
    const r = route({
      active_hours: { start: '09:00', end: '17:00', timezone: 'America/New_York' },
    });
    expect(isWithinActiveHours(r, alert('2026-04-20T09:00:00-04:00'))).toBe(true);
  });
});
