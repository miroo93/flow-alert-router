#!/usr/bin/env node
// Grader §14 — Full reset.
// After POST /reset: routes, alerts, suppression windows, and stats all
// empty/zeroed.

import { check, section, postJSON, requireServer, runMain, BASE } from './lib.mjs';

await runMain('§14 Full reset', async () => {
  await requireServer();

  section('§14 — Full reset');

  // Populate: a route, a routed alert (which seeds a suppression window),
  // a suppressed alert (to bump those counters), and an unrouted alert.
  await fetch(`${BASE}/reset`, { method: 'POST' });

  await postJSON('/routes', {
    id: 'r', priority: 10,
    conditions: { severity: ['critical'], service: ['payment-*'] },
    target: { type: 'slack', channel: '#p' },
    suppression_window_seconds: 300,
  });
  await postJSON('/alerts', {
    id: 'a1', severity: 'critical', service: 'payment-api', group: 'g',
    timestamp: '2026-04-19T10:00:00Z',
  });
  await postJSON('/alerts', {
    id: 'a2', severity: 'critical', service: 'payment-api', group: 'g',
    timestamp: '2026-04-19T10:01:00Z',
  });
  await postJSON('/alerts', {
    id: 'a3', severity: 'info', service: 'other', group: 'g',
    timestamp: '2026-04-19T10:02:00Z',
  });

  // Confirm non-empty pre-reset (sanity — not part of the reset contract)
  const preRoutes = await (await fetch(`${BASE}/routes`)).json();
  check('Pre-reset: routes non-empty',
    preRoutes.routes.length === 1, JSON.stringify(preRoutes));
  const preStats = await (await fetch(`${BASE}/stats`)).json();
  check('Pre-reset: stats show 3 processed',
    preStats.total_alerts_processed === 3, JSON.stringify(preStats));

  // Reset
  const resetRes = await fetch(`${BASE}/reset`, { method: 'POST' });
  const resetBody = await resetRes.json();
  check('POST /reset → {status:"ok"}',
    resetRes.status === 200 && resetBody.status === 'ok',
    JSON.stringify(resetBody));

  // Routes empty
  const routes = await (await fetch(`${BASE}/routes`)).json();
  check('After reset: GET /routes → {routes:[]}',
    Array.isArray(routes.routes) && routes.routes.length === 0,
    JSON.stringify(routes));

  // Alerts empty
  const alerts = await (await fetch(`${BASE}/alerts`)).json();
  check('After reset: GET /alerts → {alerts:[], total:0}',
    alerts.total === 0 && alerts.alerts.length === 0,
    JSON.stringify(alerts));

  // Stats zeroed
  const stats = await (await fetch(`${BASE}/stats`)).json();
  check('After reset: all top-level counters zero',
    stats.total_alerts_processed === 0 &&
    stats.total_routed === 0 &&
    stats.total_suppressed === 0 &&
    stats.total_unrouted === 0,
    JSON.stringify(stats));
  check('After reset: by_severity pre-populated with three zeros',
    stats.by_severity?.critical === 0 &&
    stats.by_severity?.warning === 0 &&
    stats.by_severity?.info === 0,
    JSON.stringify(stats.by_severity));
  check('After reset: by_route and by_service empty',
    Object.keys(stats.by_route ?? {}).length === 0 &&
    Object.keys(stats.by_service ?? {}).length === 0,
    JSON.stringify({ br: stats.by_route, bs: stats.by_service }));

  // Suppression cleared — re-seed and submit a second alert that WOULD have
  // been suppressed had state carried over; it should route.
  await postJSON('/routes', {
    id: 'r', priority: 10,
    conditions: { severity: ['critical'], service: ['payment-*'] },
    target: { type: 'slack', channel: '#p' },
    suppression_window_seconds: 300,
  });
  // Submit an alert at the same timestamp as the PRE-reset second alert.
  // Before reset this alert was suppressed; after reset the window is gone,
  // so this should route freshly.
  const firstAfterReset = await (await postJSON('/alerts', {
    id: 'post-1', severity: 'critical', service: 'payment-api', group: 'g',
    timestamp: '2026-04-19T10:01:00Z',
  })).json();
  check('After reset: suppression window cleared (fresh alert routes, not suppressed)',
    firstAfterReset.suppressed === false,
    `suppressed=${firstAfterReset.suppressed}`);
});
