#!/usr/bin/env node
// Grader §10 — Stats.
// All aggregate counters plus by_severity, by_service, by_route breakdowns.

import { check, section, postJSON, reset, requireServer, runMain, BASE } from './lib.mjs';

await runMain('§10 Stats', async () => {
  await requireServer();
  await reset();

  section('§10 — Stats');

  // Fresh stats baseline
  const fresh = await (await fetch(`${BASE}/stats`)).json();
  check('Fresh stats: all counters zero',
    fresh.total_alerts_processed === 0 &&
    fresh.total_routed === 0 &&
    fresh.total_suppressed === 0 &&
    fresh.total_unrouted === 0,
    JSON.stringify(fresh));
  check('Fresh stats: by_severity pre-populated with 3 zeros',
    fresh.by_severity?.critical === 0 &&
    fresh.by_severity?.warning === 0 &&
    fresh.by_severity?.info === 0,
    JSON.stringify(fresh.by_severity));
  check('Fresh stats: by_route and by_service empty',
    Object.keys(fresh.by_route ?? {}).length === 0 &&
    Object.keys(fresh.by_service ?? {}).length === 0,
    JSON.stringify({ br: fresh.by_route, bs: fresh.by_service }));

  // Setup: one route matching payment-api critical with 300s suppression
  await postJSON('/routes', {
    id: 'r-pay', priority: 10,
    conditions: { severity: ['critical'], service: ['payment-*'] },
    target: { type: 'slack', channel: '#p' },
    suppression_window_seconds: 300,
  });

  // Routed
  await postJSON('/alerts', {
    id: '1', severity: 'critical', service: 'payment-api', group: 'g',
    timestamp: '2026-04-19T10:00:00Z',
  });
  // Suppressed (same service within window)
  await postJSON('/alerts', {
    id: '2', severity: 'critical', service: 'payment-api', group: 'g',
    timestamp: '2026-04-19T10:01:00Z',
  });
  // Unrouted (no matching route)
  await postJSON('/alerts', {
    id: '3', severity: 'warning', service: 'user-service', group: 'g',
    timestamp: '2026-04-19T10:02:00Z',
  });
  // Another routed (different service)
  await postJSON('/alerts', {
    id: '4', severity: 'critical', service: 'payment-worker', group: 'g',
    timestamp: '2026-04-19T10:03:00Z',
  });
  // Info alert unrouted
  await postJSON('/alerts', {
    id: '5', severity: 'info', service: 'user-service', group: 'g',
    timestamp: '2026-04-19T10:04:00Z',
  });

  const s = await (await fetch(`${BASE}/stats`)).json();

  check('total_alerts_processed = 5',
    s.total_alerts_processed === 5, `total=${s.total_alerts_processed}`);
  check('total_routed = 2 (alerts 1, 4)',
    s.total_routed === 2, `total_routed=${s.total_routed}`);
  check('total_suppressed = 1 (alert 2)',
    s.total_suppressed === 1, `total_suppressed=${s.total_suppressed}`);
  check('total_unrouted = 2 (alerts 3, 5)',
    s.total_unrouted === 2, `total_unrouted=${s.total_unrouted}`);
  check('invariant: processed = routed + suppressed + unrouted',
    s.total_alerts_processed === s.total_routed + s.total_suppressed + s.total_unrouted);

  check('by_severity.critical = 3',
    s.by_severity?.critical === 3, `critical=${s.by_severity?.critical}`);
  check('by_severity.warning = 1',
    s.by_severity?.warning === 1, `warning=${s.by_severity?.warning}`);
  check('by_severity.info = 1',
    s.by_severity?.info === 1, `info=${s.by_severity?.info}`);

  check('by_service.payment-api = 2',
    s.by_service?.['payment-api'] === 2, JSON.stringify(s.by_service));
  check('by_service.payment-worker = 1',
    s.by_service?.['payment-worker'] === 1, JSON.stringify(s.by_service));
  check('by_service.user-service = 2',
    s.by_service?.['user-service'] === 2, JSON.stringify(s.by_service));

  const perRoute = s.by_route?.['r-pay'] ?? {};
  check('by_route.r-pay.total_matched = 3 (alerts 1, 2, 4)',
    perRoute.total_matched === 3, `matched=${perRoute.total_matched}`);
  check('by_route.r-pay.total_routed = 2',
    perRoute.total_routed === 2, `routed=${perRoute.total_routed}`);
  check('by_route.r-pay.total_suppressed = 1',
    perRoute.total_suppressed === 1, `suppressed=${perRoute.total_suppressed}`);
  check('invariant: route.total_matched >= route.total_routed + route.total_suppressed',
    perRoute.total_matched >= perRoute.total_routed + perRoute.total_suppressed);
});
