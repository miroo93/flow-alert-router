#!/usr/bin/env node
// Grader §6 — Suppression windows.
// First alert routes normally; second alert for same service within the
// window is suppressed; alert after window expires routes again; different
// service in the same window is not suppressed.

import { check, section, postJSON, reset, requireServer, runMain } from './lib.mjs';

await runMain('§6 Suppression windows', async () => {
  await requireServer();
  await reset();

  section('§6 — Suppression windows (driven by alert.timestamp)');

  await postJSON('/routes', {
    id: 'r1', priority: 10,
    conditions: { severity: ['critical'], service: ['payment-*'] },
    target: { type: 'slack', channel: '#ops' },
    suppression_window_seconds: 300,
  });

  // T=0 — first alert, routes
  const a1 = await (await postJSON('/alerts', {
    id: 'a1', severity: 'critical', service: 'payment-api', group: 'billing',
    timestamp: '2026-04-19T10:00:00Z',
  })).json();
  check('T=0 first alert routed (suppressed:false)',
    a1.suppressed === false && a1.routed_to?.route_id === 'r1',
    JSON.stringify({ s: a1.suppressed, rid: a1.routed_to?.route_id }));

  // T=+60s — suppressed with exact reason
  const a2 = await (await postJSON('/alerts', {
    id: 'a2', severity: 'critical', service: 'payment-api', group: 'billing',
    timestamp: '2026-04-19T10:01:00Z',
  })).json();
  const expectedReason = "Alert for service 'payment-api' on route 'r1' suppressed until 2026-04-19T10:05:00Z";
  check('T=+60s suppressed with exact suppression_reason',
    a2.suppressed === true && a2.suppression_reason === expectedReason,
    `got="${a2.suppression_reason}"`);
  check('suppression_applied:true on suppressed alert',
    a2.evaluation_details?.suppression_applied === true,
    JSON.stringify(a2.evaluation_details));
  check('routed_to still non-null on suppressed alert (winner exists, just no notification)',
    a2.routed_to?.route_id === 'r1', JSON.stringify(a2.routed_to));

  // T=+600s — window expired, routes again
  const a3 = await (await postJSON('/alerts', {
    id: 'a3', severity: 'critical', service: 'payment-api', group: 'billing',
    timestamp: '2026-04-19T10:10:00Z',
  })).json();
  check('T=+600s (past window) routes again', a3.suppressed === false,
    `suppressed=${a3.suppressed}`);

  // Different service on same route during original window → not suppressed
  // (reset and re-establish window to prove this cleanly)
  await reset();
  await postJSON('/routes', {
    id: 'r1', priority: 10,
    conditions: { severity: ['critical'], service: ['payment-*'] },
    target: { type: 'slack', channel: '#ops' },
    suppression_window_seconds: 300,
  });
  await postJSON('/alerts', {
    id: 'seed', severity: 'critical', service: 'payment-api', group: 'g',
    timestamp: '2026-04-19T10:00:00Z',
  });
  const diffSvc = await (await postJSON('/alerts', {
    id: 'a4', severity: 'critical', service: 'payment-worker', group: 'g',
    timestamp: '2026-04-19T10:01:00Z',
  })).json();
  check('Different service within same window on same route NOT suppressed',
    diffSvc.suppressed === false, `suppressed=${diffSvc.suppressed}`);

  // Window-not-extended proof: alert inside window, then one just past original expiry.
  // If the suppressed alert incorrectly extended the window, the "T+310s" alert would
  // still be suppressed. Spec says window starts from first non-suppressed alert only.
  await reset();
  await postJSON('/routes', {
    id: 'r1', priority: 10,
    conditions: { severity: ['critical'], service: ['payment-*'] },
    target: { type: 'slack', channel: '#ops' },
    suppression_window_seconds: 300,
  });
  await postJSON('/alerts', {
    id: 'w0', severity: 'critical', service: 'payment-api', group: 'g',
    timestamp: '2026-04-19T10:00:00Z',  // T=0
  });
  const w240 = await (await postJSON('/alerts', {
    id: 'w240', severity: 'critical', service: 'payment-api', group: 'g',
    timestamp: '2026-04-19T10:04:00Z',  // T=+240s: suppressed
  })).json();
  check('T+240s suppressed (within window)', w240.suppressed === true,
    `suppressed=${w240.suppressed}`);
  const w310 = await (await postJSON('/alerts', {
    id: 'w310', severity: 'critical', service: 'payment-api', group: 'g',
    timestamp: '2026-04-19T10:05:10Z',  // T=+310s: past original 300s window
  })).json();
  check('T+310s routes (window NOT extended by the suppressed alert)',
    w310.suppressed === false, `suppressed=${w310.suppressed}`);
});
