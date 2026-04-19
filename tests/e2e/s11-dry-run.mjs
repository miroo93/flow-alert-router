#!/usr/bin/env node
// Grader §11 — Dry-run (POST /test).
// Returns correct routing result, does not persist the alert, does not
// affect suppression state, does not affect stats.

import { check, section, postJSON, reset, requireServer, runMain, sortKeys, BASE } from './lib.mjs';

await runMain('§11 Dry-run POST /test', async () => {
  await requireServer();
  await reset();

  section('§11 — Dry-run POST /test');

  await postJSON('/routes', {
    id: 'r-pay', priority: 10,
    conditions: { severity: ['critical'], service: ['payment-*'] },
    target: { type: 'slack', channel: '#p' },
    suppression_window_seconds: 300,
  });

  // Seed a real alert so there's state to protect
  await postJSON('/alerts', {
    id: 'seed', severity: 'critical', service: 'payment-api', group: 'g',
    timestamp: '2026-04-19T10:00:00Z',
  });

  // Snapshot state before the dry run
  const statsBefore = await (await fetch(`${BASE}/stats`)).json();
  const alertsBefore = await (await fetch(`${BASE}/alerts`)).json();

  // Dry run — would be suppressed if real
  const dry = await (await postJSON('/test', {
    id: 'dry-1', severity: 'critical', service: 'payment-api', group: 'g',
    timestamp: '2026-04-19T10:01:00Z',
  })).json();

  check('Dry-run response includes alert_id, routed_to, matched_routes, evaluation_details',
    dry.alert_id === 'dry-1' &&
    dry.routed_to !== undefined &&
    Array.isArray(dry.matched_routes) &&
    typeof dry.evaluation_details === 'object',
    JSON.stringify({
      alert_id: dry.alert_id, rt: dry.routed_to?.route_id,
      mr: dry.matched_routes, ed: !!dry.evaluation_details,
    }));
  check('Dry-run returned suppressed:true (would suppress if real)',
    dry.suppressed === true, `suppressed=${dry.suppressed}`);

  // Not persisted
  const lookup = await fetch(`${BASE}/alerts/dry-1`);
  check('GET /alerts/dry-1 → 404 (not persisted)',
    lookup.status === 404, `status=${lookup.status}`);

  // Stats bit-for-bit identical
  const statsAfter = await (await fetch(`${BASE}/stats`)).json();
  check('Stats bit-for-bit identical before/after POST /test',
    JSON.stringify(sortKeys(statsBefore)) === JSON.stringify(sortKeys(statsAfter)),
    `before=${JSON.stringify(statsBefore)} after=${JSON.stringify(statsAfter)}`);

  // Alerts list unchanged
  const alertsAfter = await (await fetch(`${BASE}/alerts`)).json();
  check('Alert list unchanged before/after POST /test',
    alertsBefore.total === alertsAfter.total &&
    JSON.stringify(sortKeys(alertsBefore)) === JSON.stringify(sortKeys(alertsAfter)),
    JSON.stringify({ before: alertsBefore.total, after: alertsAfter.total }));

  // Suppression window not mutated — prove by submitting a REAL alert at a
  // timestamp that would be past-window if the dry run had reset/extended
  // it. With the window untouched, it should still be suppressed.
  const realWithinOriginal = await (await postJSON('/alerts', {
    id: 'real-within', severity: 'critical', service: 'payment-api', group: 'g',
    timestamp: '2026-04-19T10:04:00Z',  // +240s from seed, inside original 300s window
  })).json();
  check('Real alert at T+240s still suppressed — dry run did not reset/extend window',
    realWithinOriginal.suppressed === true,
    `suppressed=${realWithinOriginal.suppressed}`);
});
