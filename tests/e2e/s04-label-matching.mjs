#!/usr/bin/env node
// Grader §4 — Label matching.
// All condition labels must be present in the alert; extra alert labels are
// fine; missing or wrong values mean no match.

import { check, section, postJSON, reset, requireServer, runMain } from './lib.mjs';

await runMain('§4 Label matching', async () => {
  await requireServer();
  await reset();

  section('§4 — Label matching');

  await postJSON('/routes', {
    id: 'prod-route', priority: 10,
    conditions: { labels: { environment: 'production', team: 'payments' } },
    target: { type: 'slack', channel: '#prod' },
  });

  // All required labels present + extras → match
  const a1 = await (await postJSON('/alerts', {
    id: 'a1', severity: 'critical', service: 'svc', group: 'g',
    timestamp: '2026-04-19T10:00:00Z',
    labels: { environment: 'production', team: 'payments', region: 'us-east-1' },
  })).json();
  check('All required labels match, extra labels tolerated → routed',
    a1.routed_to?.route_id === 'prod-route',
    JSON.stringify(a1.routed_to));

  // Missing label → no match
  const a2 = await (await postJSON('/alerts', {
    id: 'a2', severity: 'critical', service: 'svc', group: 'g',
    timestamp: '2026-04-19T10:00:00Z',
    labels: { environment: 'production' },
  })).json();
  check('Missing required label (team) → no match', a2.routed_to === null,
    JSON.stringify(a2.routed_to));

  // Wrong value → no match
  const a3 = await (await postJSON('/alerts', {
    id: 'a3', severity: 'critical', service: 'svc', group: 'g',
    timestamp: '2026-04-19T10:00:00Z',
    labels: { environment: 'staging', team: 'payments' },
  })).json();
  check('Wrong label value (environment:staging) → no match', a3.routed_to === null,
    JSON.stringify(a3.routed_to));

  // No labels at all on alert → no match
  const a4 = await (await postJSON('/alerts', {
    id: 'a4', severity: 'critical', service: 'svc', group: 'g',
    timestamp: '2026-04-19T10:00:00Z',
  })).json();
  check('Alert with no labels → no match against labeled condition',
    a4.routed_to === null, JSON.stringify(a4.routed_to));
});
