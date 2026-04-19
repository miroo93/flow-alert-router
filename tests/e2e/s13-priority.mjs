#!/usr/bin/env node
// Grader §13 — Priority with multiple matching routes.
// Three routes at different priorities all match; highest wins; all three
// appear in matched_routes.

import { check, section, postJSON, reset, requireServer, runMain } from './lib.mjs';

await runMain('§13 Priority', async () => {
  await requireServer();
  await reset();

  section('§13 — Priority with multiple matching routes');

  // Three routes at priorities 1, 50, 100 — all match a critical alert
  await postJSON('/routes', {
    id: 'lo', priority: 1, conditions: { severity: ['critical'] },
    target: { type: 'slack', channel: '#lo' },
  });
  await postJSON('/routes', {
    id: 'md', priority: 50, conditions: { severity: ['critical'] },
    target: { type: 'slack', channel: '#md' },
  });
  await postJSON('/routes', {
    id: 'hi', priority: 100, conditions: { severity: ['critical'] },
    target: { type: 'slack', channel: '#hi' },
  });

  const r = await (await postJSON('/alerts', {
    id: 'a', severity: 'critical', service: 'svc', group: 'g',
    timestamp: '2026-04-19T10:00:00Z',
  })).json();

  check('Highest priority wins (routed_to = "hi")',
    r.routed_to?.route_id === 'hi', JSON.stringify(r.routed_to));
  check('routed_to.target echoes "hi" target',
    r.routed_to?.target?.channel === '#hi',
    JSON.stringify(r.routed_to?.target));
  check('matched_routes contains all 3 ids',
    Array.isArray(r.matched_routes) && r.matched_routes.length === 3 &&
    ['lo', 'md', 'hi'].every((id) => r.matched_routes.includes(id)),
    JSON.stringify(r.matched_routes));
  check('matched_routes ordered priority-desc: hi, md, lo',
    r.matched_routes[0] === 'hi' &&
    r.matched_routes[1] === 'md' &&
    r.matched_routes[2] === 'lo',
    JSON.stringify(r.matched_routes));
  check('evaluation_details: 3 evaluated, 3 matched, 0 not matched',
    r.evaluation_details?.total_routes_evaluated === 3 &&
    r.evaluation_details?.routes_matched === 3 &&
    r.evaluation_details?.routes_not_matched === 0,
    JSON.stringify(r.evaluation_details));

  // Tie-break: two routes at same priority → first-inserted wins
  await reset();
  await postJSON('/routes', {
    id: 'first', priority: 10, conditions: {},
    target: { type: 'slack', channel: '#a' },
  });
  await postJSON('/routes', {
    id: 'second', priority: 10, conditions: {},
    target: { type: 'slack', channel: '#b' },
  });
  const tie = await (await postJSON('/alerts', {
    id: 't', severity: 'critical', service: 'svc', group: 'g',
    timestamp: '2026-04-19T10:00:00Z',
  })).json();
  check('Tie at same priority → first-inserted wins',
    tie.routed_to?.route_id === 'first', JSON.stringify(tie.routed_to));
  check('matched_routes preserves both tied ids',
    tie.matched_routes.length === 2 &&
    tie.matched_routes.includes('first') &&
    tie.matched_routes.includes('second'),
    JSON.stringify(tie.matched_routes));
});
