#!/usr/bin/env node
// Grader §5 — Glob matching on service.
// payment-*, auth-*, *-api against various service names including
// non-matching cases. Only * wildcard supported.

import { check, section, postJSON, reset, requireServer, runMain } from './lib.mjs';

async function matchFor(serviceName, expectedRouteId) {
  const r = await postJSON('/alerts', {
    id: `glob-${serviceName}`,
    severity: 'critical',
    service: serviceName,
    group: 'g',
    timestamp: '2026-04-19T10:00:00Z',
  });
  return (await r.json()).routed_to?.route_id ?? null;
}

await runMain('§5 Glob matching', async () => {
  await requireServer();
  await reset();

  section('§5 — Glob matching (prefix, suffix, and literal patterns)');

  // Four routes with disjoint globs at different priorities
  await postJSON('/routes', {
    id: 'payment', priority: 30,
    conditions: { service: ['payment-*'] },
    target: { type: 'slack', channel: '#p' },
  });
  await postJSON('/routes', {
    id: 'auth', priority: 30,
    conditions: { service: ['auth-*'] },
    target: { type: 'slack', channel: '#a' },
  });
  await postJSON('/routes', {
    id: 'api', priority: 10,
    conditions: { service: ['*-api'] },
    target: { type: 'slack', channel: '#x' },
  });
  await postJSON('/routes', {
    id: 'literal', priority: 50,
    conditions: { service: ['user-service'] },
    target: { type: 'slack', channel: '#u' },
  });

  // payment-api: matches "payment-*" (prio 30) and "*-api" (prio 10). Winner: payment
  check('"payment-api" → payment (prefix beats suffix by priority)',
    (await matchFor('payment-api')) === 'payment');

  // payment-worker: matches only payment-*
  check('"payment-worker" → payment', (await matchFor('payment-worker')) === 'payment');

  // auth-service: matches only auth-*
  check('"auth-service" → auth', (await matchFor('auth-service')) === 'auth');

  // some-api: matches only *-api
  check('"some-api" → api (suffix glob)', (await matchFor('some-api')) === 'api');

  // user-service: matches only the literal (payment-*, auth-*, *-api don't)
  check('"user-service" → literal (exact match)',
    (await matchFor('user-service')) === 'literal');

  // billing: no glob matches
  check('"billing" → null (no glob matches)', (await matchFor('billing')) === null);

  // "payment-": with `*` matching empty (common glob semantics)
  // Note: we don't strictly assert this — some libs match, some don't. Skip.
});
