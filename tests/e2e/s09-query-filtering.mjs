#!/usr/bin/env node
// Grader §9 — Query & filtering.
// GET /alerts/{id}, 404 for missing, filter by service/severity/routed/
// suppressed, combined filters, and the `total` field.

import { check, section, postJSON, reset, requireServer, runMain, BASE } from './lib.mjs';

await runMain('§9 Query & filtering', async () => {
  await requireServer();
  await reset();

  section('§9 — Query & filtering');

  await postJSON('/routes', {
    id: 'r', priority: 10,
    conditions: { severity: ['critical'], service: ['payment-api'] },
    target: { type: 'slack', channel: '#p' },
    suppression_window_seconds: 300,
  });

  // Mix: routed, suppressed, unrouted alerts
  await postJSON('/alerts', {
    id: 'routed-1', severity: 'critical', service: 'payment-api', group: 'g',
    timestamp: '2026-04-19T10:00:00Z',
  });
  await postJSON('/alerts', {
    id: 'supp-1', severity: 'critical', service: 'payment-api', group: 'g',
    timestamp: '2026-04-19T10:01:00Z',
  });
  await postJSON('/alerts', {
    id: 'unrouted-1', severity: 'warning', service: 'payment-api', group: 'g',
    timestamp: '2026-04-19T10:02:00Z',
  });
  await postJSON('/alerts', {
    id: 'unrouted-2', severity: 'info', service: 'auth-service', group: 'g',
    timestamp: '2026-04-19T10:03:00Z',
  });

  // GET /alerts/:id
  const a1 = await fetch(`${BASE}/alerts/routed-1`);
  check('GET /alerts/routed-1 → 200', a1.status === 200);
  const a1b = await a1.json();
  check('GET /alerts/routed-1 payload includes alert_id and routing decision',
    a1b.alert_id === 'routed-1' && a1b.routed_to?.route_id === 'r',
    JSON.stringify({ id: a1b.alert_id, rid: a1b.routed_to?.route_id }));

  // 404 on missing
  const missing = await fetch(`${BASE}/alerts/no-such-id`);
  const missingBody = await missing.json();
  check('GET /alerts/missing → 404 {"error":"alert not found"}',
    missing.status === 404 && missingBody.error === 'alert not found',
    `status=${missing.status} body=${JSON.stringify(missingBody)}`);

  // List without filters
  const all = await (await fetch(`${BASE}/alerts`)).json();
  check('GET /alerts returns all 4 with total:4',
    all.total === 4 && all.alerts.length === 4,
    JSON.stringify({ total: all.total, count: all.alerts.length }));

  // Filter by service
  const bySvc = await (await fetch(`${BASE}/alerts?service=payment-api`)).json();
  check('?service=payment-api → 3 alerts (routed, supp, unrouted-1)',
    bySvc.total === 3, `total=${bySvc.total}`);

  const bySvc2 = await (await fetch(`${BASE}/alerts?service=auth-service`)).json();
  check('?service=auth-service → 1 alert',
    bySvc2.total === 1, `total=${bySvc2.total}`);

  // Filter by severity
  const bySev = await (await fetch(`${BASE}/alerts?severity=critical`)).json();
  check('?severity=critical → 2 alerts',
    bySev.total === 2, `total=${bySev.total}`);

  // Filter by routed
  const routed = await (await fetch(`${BASE}/alerts?routed=true`)).json();
  check('?routed=true → 1 alert (routed-1; suppressed excluded)',
    routed.total === 1 && routed.alerts[0]?.alert_id === 'routed-1',
    JSON.stringify({ total: routed.total, ids: routed.alerts.map((x) => x.alert_id) }));

  const unrouted = await (await fetch(`${BASE}/alerts?routed=false`)).json();
  check('?routed=false → 3 alerts (supp + 2 unrouted)',
    unrouted.total === 3, `total=${unrouted.total}`);

  // Filter by suppressed
  const supp = await (await fetch(`${BASE}/alerts?suppressed=true`)).json();
  check('?suppressed=true → 1 alert',
    supp.total === 1 && supp.alerts[0]?.alert_id === 'supp-1',
    JSON.stringify({ total: supp.total, ids: supp.alerts.map((x) => x.alert_id) }));

  // Combined filter: service + severity
  const combined = await (await fetch(`${BASE}/alerts?service=payment-api&severity=critical`)).json();
  check('?service=payment-api&severity=critical → 2 alerts',
    combined.total === 2, `total=${combined.total}`);

  // Combined filter that hits nothing
  const empty = await (await fetch(`${BASE}/alerts?service=payment-api&severity=info`)).json();
  check('?service=payment-api&severity=info → 0 alerts',
    empty.total === 0 && empty.alerts.length === 0,
    JSON.stringify(empty));
});
