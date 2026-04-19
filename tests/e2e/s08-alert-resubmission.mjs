#!/usr/bin/env node
// Grader §8 — Alert re-submission.
// Posting an alert with an existing ID updates the record in place.

import { check, section, postJSON, reset, requireServer, runMain, BASE } from './lib.mjs';

await runMain('§8 Alert re-submission', async () => {
  await requireServer();
  await reset();

  section('§8 — Alert re-submission (upsert by id)');

  await postJSON('/routes', {
    id: 'crit', priority: 10, conditions: { severity: ['critical'] },
    target: { type: 'slack', channel: '#crit' },
  });
  await postJSON('/routes', {
    id: 'info', priority: 10, conditions: { severity: ['info'] },
    target: { type: 'slack', channel: '#info' },
  });

  // First submission: severity critical → routed to "crit"
  const first = await (await postJSON('/alerts', {
    id: 'a1', severity: 'critical', service: 'svc', group: 'g',
    timestamp: '2026-04-19T10:00:00Z',
    description: 'first',
  })).json();
  check('First submission routes to "crit"',
    first.routed_to?.route_id === 'crit', JSON.stringify(first.routed_to));

  // Re-submit with same id but different severity → routes to "info"
  await postJSON('/alerts', {
    id: 'a1', severity: 'info', service: 'svc', group: 'g',
    timestamp: '2026-04-19T10:05:00Z',
    description: 'updated',
  });

  // GET /alerts/:id shows the updated record
  const stored = await (await fetch(`${BASE}/alerts/a1`)).json();
  check('After re-submission, GET /alerts/a1 shows the updated routing',
    stored.routed_to?.route_id === 'info',
    JSON.stringify(stored.routed_to));

  // List has exactly 1 record (not 2)
  const list = await (await fetch(`${BASE}/alerts`)).json();
  check('Alert list has exactly 1 entry (upsert, not duplicate)',
    list.total === 1 && list.alerts.length === 1,
    JSON.stringify({ total: list.total, count: list.alerts.length }));

  // Stats: total_alerts_processed should reflect both submissions (2)
  const stats = await (await fetch(`${BASE}/stats`)).json();
  check('Stats total_alerts_processed = 2 (both POSTs counted)',
    stats.total_alerts_processed === 2,
    `total=${stats.total_alerts_processed}`);
});
