#!/usr/bin/env node
// Grader §7 — Active hours & timezones.
// Alerts with timestamps inside and outside a route's active window, tested
// with America/New_York conversions including boundaries. Spec doesn't
// explicitly fix inclusive/exclusive; we assert the contract the service
// implements (start inclusive, end exclusive) and a DST-insensitive Tokyo
// cross-check that catches luxon-falls-back-to-UTC regressions.

import { check, section, postJSON, reset, requireServer, runMain } from './lib.mjs';

await runMain('§7 Active hours & timezones', async () => {
  await requireServer();
  await reset();

  section('§7 — Active hours (America/New_York)');

  await postJSON('/routes', {
    id: 'ny', priority: 10,
    conditions: { service: ['*'] },
    target: { type: 'email', address: 'ops@example.com' },
    active_hours: { start: '09:00', end: '17:00', timezone: 'America/New_York' },
  });

  // Inside window: 14:00 UTC in April = 10:00 EDT → match
  const inside = await (await postJSON('/alerts', {
    id: 'inside', severity: 'critical', service: 'svc', group: 'g',
    timestamp: '2026-04-20T14:00:00Z',
  })).json();
  check('14:00Z (= 10:00 EDT) inside window → routed',
    inside.routed_to?.route_id === 'ny', JSON.stringify(inside.routed_to));

  // Before window: 12:00 UTC = 08:00 EDT → no match
  const before = await (await postJSON('/alerts', {
    id: 'before', severity: 'critical', service: 'svc', group: 'g',
    timestamp: '2026-04-20T12:00:00Z',
  })).json();
  check('12:00Z (= 08:00 EDT, before window) → no match',
    before.routed_to === null, JSON.stringify(before.routed_to));

  // After window: 22:00 UTC = 18:00 EDT → no match
  const after = await (await postJSON('/alerts', {
    id: 'after', severity: 'critical', service: 'svc', group: 'g',
    timestamp: '2026-04-20T22:00:00Z',
  })).json();
  check('22:00Z (= 18:00 EDT, after window) → no match',
    after.routed_to === null, JSON.stringify(after.routed_to));

  // Boundary: 13:00 UTC = 09:00 EDT — inclusive start → match
  const startBound = await (await postJSON('/alerts', {
    id: 'start', severity: 'critical', service: 'svc', group: 'g',
    timestamp: '2026-04-20T13:00:00Z',
  })).json();
  check('13:00Z (= 09:00 EDT, inclusive start) → match',
    startBound.routed_to?.route_id === 'ny', JSON.stringify(startBound.routed_to));

  // Boundary: 21:00 UTC = 17:00 EDT — exclusive end → no match
  const endBound = await (await postJSON('/alerts', {
    id: 'end', severity: 'critical', service: 'svc', group: 'g',
    timestamp: '2026-04-20T21:00:00Z',
  })).json();
  check('21:00Z (= 17:00 EDT, exclusive end) → no match',
    endBound.routed_to === null, JSON.stringify(endBound.routed_to));

  // Route without active_hours is always active
  await postJSON('/routes', {
    id: 'always', priority: 1,
    conditions: { service: ['*'] },
    target: { type: 'slack', channel: '#z' },
  });
  // Re-ask with a timestamp outside the NY window — "always" should win since "ny" doesn't match
  const any = await (await postJSON('/alerts', {
    id: 'any', severity: 'critical', service: 'svc', group: 'g',
    timestamp: '2026-04-20T03:00:00Z',  // 23:00 EDT previous day
  })).json();
  check('Route without active_hours always active (matches outside NY window)',
    any.routed_to?.route_id === 'always', JSON.stringify(any.routed_to));

  // Tokyo cross-check (no DST — catches luxon-UTC-fallback regressions)
  await reset();
  await postJSON('/routes', {
    id: 'jp', priority: 5,
    conditions: { service: ['*'] },
    target: { type: 'email', address: 'jp@example.com' },
    active_hours: { start: '09:00', end: '17:00', timezone: 'Asia/Tokyo' },
  });
  const tkStart = await (await postJSON('/alerts', {
    id: 'tk-start', severity: 'critical', service: 'svc', group: 'g',
    timestamp: '2026-04-20T00:00:00Z',  // 09:00 JST
  })).json();
  check('Tokyo: 00:00Z (= 09:00 JST, inclusive start) → match',
    tkStart.routed_to?.route_id === 'jp', JSON.stringify(tkStart.routed_to));
  const tkEnd = await (await postJSON('/alerts', {
    id: 'tk-end', severity: 'critical', service: 'svc', group: 'g',
    timestamp: '2026-04-20T08:00:00Z',  // 17:00 JST
  })).json();
  check('Tokyo: 08:00Z (= 17:00 JST, exclusive end) → no match',
    tkEnd.routed_to === null, JSON.stringify(tkEnd.routed_to));
});
