#!/usr/bin/env node
// Grader §12 — Omitted conditions.
// A route with empty conditions {} matches all alerts.

import { check, section, postJSON, reset, requireServer, runMain } from './lib.mjs';

await runMain('§12 Omitted conditions', async () => {
  await requireServer();
  await reset();

  section('§12 — Omitted conditions (empty {} matches everything)');

  await postJSON('/routes', {
    id: 'catch-all', priority: 1,
    conditions: {},
    target: { type: 'slack', channel: '#catch' },
  });

  // Four alerts spanning severities, services, groups, labels
  const cases = [
    { id: 'c1', severity: 'critical', service: 'payment-api', group: 'billing',
      timestamp: '2026-04-19T10:00:00Z',
      labels: { environment: 'production' } },
    { id: 'c2', severity: 'warning', service: 'auth-service', group: 'backend',
      timestamp: '2026-04-19T10:00:00Z' },
    { id: 'c3', severity: 'info', service: 'worker', group: 'batch',
      timestamp: '2026-04-19T10:00:00Z' },
    { id: 'c4', severity: 'critical', service: 'totally-random', group: 'misc',
      timestamp: '2026-04-19T10:00:00Z' },
  ];
  for (const alert of cases) {
    const r = await (await postJSON('/alerts', alert)).json();
    check(`Alert ${alert.id} (severity=${alert.severity}, service=${alert.service}) routed to catch-all`,
      r.routed_to?.route_id === 'catch-all',
      JSON.stringify(r.routed_to));
  }

  // Also: a route with some fields specified and others omitted — omitted
  // fields match-all per spec
  await reset();
  await postJSON('/routes', {
    id: 'crit-any-svc', priority: 1,
    conditions: { severity: ['critical'] },  // service/group/labels omitted
    target: { type: 'slack', channel: '#c' },
  });
  const payment = await (await postJSON('/alerts', {
    id: 'p1', severity: 'critical', service: 'payment-api', group: 'billing',
    timestamp: '2026-04-19T10:00:00Z',
  })).json();
  check('Omitted service condition matches any service (payment-api)',
    payment.routed_to?.route_id === 'crit-any-svc');
  const auth = await (await postJSON('/alerts', {
    id: 'p2', severity: 'critical', service: 'auth', group: 'backend',
    timestamp: '2026-04-19T10:00:00Z',
  })).json();
  check('Omitted service condition matches any service (auth)',
    auth.routed_to?.route_id === 'crit-any-svc');

  // Non-matching severity still filters
  const info = await (await postJSON('/alerts', {
    id: 'p3', severity: 'info', service: 'auth', group: 'backend',
    timestamp: '2026-04-19T10:00:00Z',
  })).json();
  check('Specified severity still filters (info severity does not match)',
    info.routed_to === null, JSON.stringify(info.routed_to));
});
