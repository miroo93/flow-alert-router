#!/usr/bin/env node
// Grader §3 — Basic routing.
// Alert matching multiple routes routes to highest priority; unrouted alerts
// return routed_to:null; matched_routes and evaluation_details are correct.

import { check, section, postJSON, reset, requireServer, runMain } from './lib.mjs';

await runMain('§3 Basic routing', async () => {
  await requireServer();
  await reset();

  section('§3 — Basic routing');

  // Three routes: two match (different priorities), one does not
  await postJSON('/routes', {
    id: 'low', priority: 1, conditions: { severity: ['critical'] },
    target: { type: 'slack', channel: '#low' },
  });
  await postJSON('/routes', {
    id: 'high', priority: 100, conditions: { severity: ['critical'] },
    target: { type: 'slack', channel: '#high' },
  });
  await postJSON('/routes', {
    id: 'nomatch', priority: 50, conditions: { severity: ['info'] },
    target: { type: 'slack', channel: '#nm' },
  });

  const routed = await (await postJSON('/alerts', {
    id: 'a1', severity: 'critical', service: 'svc', group: 'g',
    timestamp: '2026-04-19T10:00:00Z',
  })).json();

  check('Winner is highest priority ("high")',
    routed.routed_to?.route_id === 'high',
    JSON.stringify(routed.routed_to));
  check('routed_to.target echoes the winner target',
    routed.routed_to?.target?.type === 'slack' && routed.routed_to?.target?.channel === '#high',
    JSON.stringify(routed.routed_to?.target));
  check('matched_routes lists both matches, priority-desc',
    Array.isArray(routed.matched_routes) &&
    routed.matched_routes.length === 2 &&
    routed.matched_routes[0] === 'high' &&
    routed.matched_routes[1] === 'low',
    JSON.stringify(routed.matched_routes));
  check('evaluation_details: 3 evaluated, 2 matched, 1 not matched, suppression false',
    routed.evaluation_details?.total_routes_evaluated === 3 &&
    routed.evaluation_details?.routes_matched === 2 &&
    routed.evaluation_details?.routes_not_matched === 1 &&
    routed.evaluation_details?.suppression_applied === false,
    JSON.stringify(routed.evaluation_details));
  check('suppressed:false on routed alert', routed.suppressed === false);

  // Unrouted — no matching route
  const unrouted = await (await postJSON('/alerts', {
    id: 'a2', severity: 'warning', service: 'svc', group: 'g',
    timestamp: '2026-04-19T10:00:00Z',
  })).json();
  check('No match → routed_to:null', unrouted.routed_to === null,
    JSON.stringify(unrouted.routed_to));
  check('No match → matched_routes:[]',
    Array.isArray(unrouted.matched_routes) && unrouted.matched_routes.length === 0);
  check('No match → suppression_reason key absent',
    !('suppression_reason' in unrouted),
    JSON.stringify(Object.keys(unrouted)));
  check('No match evaluation_details: 3 evaluated, 0 matched, 3 not matched',
    unrouted.evaluation_details?.total_routes_evaluated === 3 &&
    unrouted.evaluation_details?.routes_matched === 0 &&
    unrouted.evaluation_details?.routes_not_matched === 3 &&
    unrouted.evaluation_details?.suppression_applied === false,
    JSON.stringify(unrouted.evaluation_details));
});
