#!/usr/bin/env node
// Phase 4 verification via fetch. Runs against a booted container.
//   Usage:  npm run verify:phase4
//   Env:    ALERT_ROUTER_URL (default http://localhost:8080)
//
// Covers HTTP-exercisable Phase 4 tasks:
//   T037 — boot probe / health within 10 s
//   T038 — quickstart §3–§8 + Asia/Tokyo active-hours pair
//   T040 — oversized body → 413; concurrent /health < 50 ms
//   T043 — 100 malformed bodies → /health stays 200; final valid POST routes
//   T044 — 100 routes + 1000 alerts < 2 s (throughput floor)
//
// Not covered (not fetch-able): T036 npm test, T039 grep gate, T041 SIGTERM,
// T042 docker inspect, T045 doc grep, T046 README grep.

const BASE = process.env.ALERT_ROUTER_URL ?? 'http://localhost:8080';

let passed = 0;
let failed = 0;
const failures = [];

function check(label, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failed++;
    const msg = detail ? `${label} — ${detail}` : label;
    failures.push(msg);
    console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
  }
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

async function reset() {
  const r = await fetch(`${BASE}/reset`, { method: 'POST' });
  if (!r.ok) throw new Error(`reset failed: ${r.status}`);
}

async function postJSON(path, body) {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function postJSONBody(path, rawBody) {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: rawBody,
  });
}

// ---- T037: boot probe -------------------------------------------------------

async function t037_bootProbe() {
  section('T037 — boot probe (/health within 10 s)');
  const deadline = Date.now() + 10_000;
  let ok = false;
  let lastErr = null;
  let attempts = 0;
  while (Date.now() < deadline) {
    attempts++;
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.status === 200) {
        const body = await r.json();
        if (body.status === 'ok') { ok = true; break; }
      }
    } catch (e) {
      lastErr = e;
    }
    await new Promise((res) => setTimeout(res, 200));
  }
  check(`/health returns {status:"ok"} within 10 s (${attempts} attempts)`, ok,
    ok ? '' : `last error: ${lastErr?.message ?? 'non-200'}`);
}

// ---- T038 §3: suppression expiry --------------------------------------------

async function t038_suppression() {
  section('T038 §3 — Landmine #1: suppression expiry');
  await reset();

  const routeRes = await postJSON('/routes', {
    id: 'r1',
    priority: 10,
    conditions: { severity: ['critical'], service: ['payment-*'] },
    target: { type: 'slack', channel: '#ops' },
    suppression_window_seconds: 300,
  });
  check('POST /routes r1 → 2xx', routeRes.ok, `status ${routeRes.status}`);

  const a1 = await (await postJSON('/alerts', {
    id: 'a1', severity: 'critical', service: 'payment-api', group: 'billing',
    timestamp: '2026-04-19T10:00:00Z',
  })).json();
  check('T=0 first alert routed (suppressed:false, routed_to.route_id="r1")',
    a1.suppressed === false && a1.routed_to?.route_id === 'r1',
    JSON.stringify({ s: a1.suppressed, rid: a1.routed_to?.route_id }));

  const a2 = await (await postJSON('/alerts', {
    id: 'a2', severity: 'critical', service: 'payment-api', group: 'billing',
    timestamp: '2026-04-19T10:01:00Z',
  })).json();
  const expectedReason = "Alert for service 'payment-api' on route 'r1' suppressed until 2026-04-19T10:05:00Z";
  check('T=+60s second alert suppressed with exact reason',
    a2.suppressed === true && a2.suppression_reason === expectedReason,
    `got reason="${a2.suppression_reason}"`);

  const a3 = await (await postJSON('/alerts', {
    id: 'a3', severity: 'critical', service: 'payment-api', group: 'billing',
    timestamp: '2026-04-19T10:10:00Z',
  })).json();
  check('T=+600s third alert routes again (suppressed:false)', a3.suppressed === false,
    `suppressed=${a3.suppressed}`);

  const a4 = await (await postJSON('/alerts', {
    id: 'a4', severity: 'critical', service: 'payment-worker', group: 'billing',
    timestamp: '2026-04-19T10:10:30Z',
  })).json();
  check('Different service on same route NOT suppressed (FR-019)', a4.suppressed === false,
    `suppressed=${a4.suppressed}`);
}

// ---- T038 §4: active-hours boundary (America/New_York) ---------------------

async function t038_activeHoursNY() {
  section('T038 §4 — Landmine #2: active-hours NY boundary');
  await reset();

  await postJSON('/routes', {
    id: 'r-biz', priority: 5,
    conditions: { service: ['*'] },
    target: { type: 'email', address: 'ops@example.com' },
    active_hours: { start: '09:00', end: '17:00', timezone: 'America/New_York' },
  });

  const b1 = await (await postJSON('/alerts', {
    id: 'b1', severity: 'critical', service: 'svc', group: 'g',
    timestamp: '2026-04-20T13:00:00Z',
  })).json();
  check('13:00Z (=09:00 EDT, inclusive start) matches → routed_to.route_id="r-biz"',
    b1.routed_to?.route_id === 'r-biz',
    `routed_to=${JSON.stringify(b1.routed_to)}`);

  const b2 = await (await postJSON('/alerts', {
    id: 'b2', severity: 'critical', service: 'svc', group: 'g',
    timestamp: '2026-04-20T21:00:00Z',
  })).json();
  check('21:00Z (=17:00 EDT, exclusive end) no match → routed_to:null, matched_routes:[]',
    b2.routed_to === null && Array.isArray(b2.matched_routes) && b2.matched_routes.length === 0,
    JSON.stringify({ rt: b2.routed_to, mr: b2.matched_routes }));
}

// ---- T038 + Asia/Tokyo pair (DST-insensitive cross-check) ------------------

async function t038_activeHoursTokyo() {
  section('T038 +SC-005 — Asia/Tokyo active-hours cross-check (no DST)');
  await reset();

  await postJSON('/routes', {
    id: 'r-jp', priority: 5,
    conditions: { service: ['*'] },
    target: { type: 'email', address: 'jp@example.com' },
    active_hours: { start: '09:00', end: '17:00', timezone: 'Asia/Tokyo' },
  });

  const tm = await (await postJSON('/alerts', {
    id: 'tk1', severity: 'critical', service: 'svc', group: 'g',
    timestamp: '2026-04-20T00:00:00Z',
  })).json();
  check('00:00Z (=09:00 Tokyo, inclusive start) matches',
    tm.routed_to?.route_id === 'r-jp',
    `routed_to=${JSON.stringify(tm.routed_to)}`);

  const tn = await (await postJSON('/alerts', {
    id: 'tk2', severity: 'critical', service: 'svc', group: 'g',
    timestamp: '2026-04-20T08:00:00Z',
  })).json();
  check('08:00Z (=17:00 Tokyo, exclusive end) no match',
    tn.routed_to === null && tn.matched_routes.length === 0,
    JSON.stringify({ rt: tn.routed_to, mr: tn.matched_routes }));
}

// ---- T038 §5: evaluation_details.total_routes_evaluated = store size -------

async function t038_evalDetails() {
  section('T038 §5 — Landmine #3: evaluation_details counts');
  await reset();

  for (let i = 1; i <= 3; i++) {
    await postJSON('/routes', {
      id: `r${i}`, priority: i,
      conditions: i < 3 ? { severity: ['critical'] } : { severity: ['info'] },
      target: { type: 'slack', channel: '#ops' },
    });
  }

  const c1 = await (await postJSON('/alerts', {
    id: 'c1', severity: 'critical', service: 'svc', group: 'g',
    timestamp: '2026-04-19T10:00:00Z',
  })).json();
  const ed = c1.evaluation_details;
  check('total_routes_evaluated=3, routes_matched=2, routes_not_matched=1, suppression_applied=false',
    ed?.total_routes_evaluated === 3 &&
    ed?.routes_matched === 2 &&
    ed?.routes_not_matched === 1 &&
    ed?.suppression_applied === false,
    JSON.stringify(ed));
}

// ---- T038 §6: POST /test is a dry run --------------------------------------

async function t038_dryRun() {
  section('T038 §6 — Landmine #4: POST /test leaves state unchanged');
  await reset();

  await postJSON('/routes', {
    id: 'r1', priority: 1, conditions: {},
    target: { type: 'slack', channel: '#ops' },
  });

  const before = await (await fetch(`${BASE}/stats`)).json();

  const dry = await (await postJSON('/test', {
    id: 'dry-1', severity: 'info', service: 'svc', group: 'g',
    timestamp: '2026-04-19T10:00:00Z',
  })).json();
  check('POST /test returns plausible decision (routed_to.route_id="r1")',
    dry.routed_to?.route_id === 'r1',
    `routed_to=${JSON.stringify(dry.routed_to)}`);

  const notPersisted = await fetch(`${BASE}/alerts/dry-1`);
  check('GET /alerts/dry-1 → 404 (not persisted)', notPersisted.status === 404,
    `status=${notPersisted.status}`);

  const after = await (await fetch(`${BASE}/stats`)).json();
  check('Stats unchanged (bit-for-bit after sorted-key JSON)',
    JSON.stringify(sortKeys(before)) === JSON.stringify(sortKeys(after)),
    `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
}

// ---- T038 §7: tie-break determinism ----------------------------------------

async function t038_tieBreak() {
  section('T038 §7 — tie-break determinism (FR-006)');
  await reset();

  await postJSON('/routes', {
    id: 'first', priority: 10, conditions: {},
    target: { type: 'slack', channel: '#a' },
  });
  await postJSON('/routes', {
    id: 'second', priority: 10, conditions: {},
    target: { type: 'slack', channel: '#b' },
  });

  const t1 = await (await postJSON('/alerts', {
    id: 't1', severity: 'critical', service: 'svc', group: 'g',
    timestamp: '2026-04-19T10:00:00Z',
  })).json();
  check('Winner is first-inserted → routed_to.route_id="first"',
    t1.routed_to?.route_id === 'first',
    `routed_to=${JSON.stringify(t1.routed_to)}`);
  check('matched_routes=["first","second"]',
    Array.isArray(t1.matched_routes) &&
    t1.matched_routes.length === 2 &&
    t1.matched_routes[0] === 'first' &&
    t1.matched_routes[1] === 'second',
    JSON.stringify(t1.matched_routes));
}

// ---- T038 §8: validation smoke --------------------------------------------

async function t038_validation() {
  section('T038 §8 — validation smoke (4x 400)');
  await reset();

  const cases = [
    ['Bad severity', '/alerts', {
      id: 'v1', severity: 'urgent', service: 's', group: 'g', timestamp: '2026-04-19T10:00:00Z',
    }],
    ['Bad IANA zone', '/routes', {
      id: 'r', priority: 1, conditions: {},
      target: { type: 'slack', channel: '#x' },
      active_hours: { start: '09:00', end: '17:00', timezone: 'Mars/Phobos' },
    }],
    ['Non-integer priority', '/routes', {
      id: 'r', priority: 3.5, conditions: {},
      target: { type: 'slack', channel: '#x' },
    }],
    ['Date-only timestamp', '/alerts', {
      id: 'v4', severity: 'critical', service: 's', group: 'g', timestamp: '2026-04-19',
    }],
  ];

  for (const [label, path, body] of cases) {
    const r = await postJSON(path, body);
    let err = '';
    try { err = (await r.json())?.error ?? ''; } catch { /* body may not be JSON */ }
    check(`${label} → 400 with non-empty error`,
      r.status === 400 && typeof err === 'string' && err.length > 0,
      `status=${r.status} error="${err}"`);
  }
}

// ---- T040: oversized body -> 413, /health concurrent still <50ms -----------

async function t040_oversizedBody() {
  section('T040 — oversized body → 413, concurrent /health <50 ms');
  await reset();

  // 2 MiB payload (> 1 MiB bodyLimit). Using 2 MiB instead of 10 MiB is enough
  // for a 413 and keeps the transfer fast.
  const huge = 'a'.repeat(2 * 1024 * 1024);
  const rawBody = JSON.stringify({ blob: huge });

  const oversizedPromise = postJSONBody('/alerts', rawBody);

  // Fire /health concurrently while the oversized request is in flight.
  const start = performance.now();
  const healthR = await fetch(`${BASE}/health`);
  const healthMs = performance.now() - start;
  const oversized = await oversizedPromise;

  check('Oversized body → 413', oversized.status === 413, `status=${oversized.status}`);
  check('Concurrent /health returns 200', healthR.status === 200, `status=${healthR.status}`);
  check(`Concurrent /health latency <50 ms (measured ${healthMs.toFixed(1)} ms)`,
    healthMs < 50);
}

// ---- T043: fuzz 100 malformed bodies ---------------------------------------

async function t043_fuzz() {
  section('T043 — fuzz 100 malformed bodies, /health stays 200, final valid POST routes');
  await reset();

  await postJSON('/routes', {
    id: 'fuzz-r', priority: 1, conditions: {},
    target: { type: 'slack', channel: '#fuzz' },
  });

  const fuzzBodies = [];
  for (let i = 0; i < 100; i++) {
    switch (i % 5) {
      case 0: fuzzBodies.push(Buffer.from([0xFF, 0xFE, 0xFD, i & 0xFF])); break;
      case 1: fuzzBodies.push('{"id":"x","severity":"' + 'x'.repeat(10_000) + '"}'); break;
      case 2: {
        let nested = 'null';
        for (let d = 0; d < 500; d++) nested = '{"a":' + nested + '}';
        fuzzBodies.push(nested);
        break;
      }
      case 3: fuzzBodies.push('not json at all ' + i); break;
      case 4: fuzzBodies.push('{"id":"x","severity":"info","service":"s","group":"g","timestamp":"bogus-' + i + '"}'); break;
    }
  }

  let survivedAll = true;
  let lastHealth = 0;
  for (let i = 0; i < fuzzBodies.length; i++) {
    try {
      await fetch(`${BASE}/alerts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: fuzzBodies[i],
      });
    } catch { /* network-level error irrelevant — we check /health next */ }
    const h = await fetch(`${BASE}/health`);
    lastHealth = h.status;
    if (h.status !== 200) { survivedAll = false; break; }
  }
  check(`All 100 malformed bodies survived (last /health=${lastHealth})`, survivedAll);

  const finalPost = await postJSON('/alerts', {
    id: 'fuzz-final', severity: 'critical', service: 'svc', group: 'g',
    timestamp: '2026-04-19T10:00:00Z',
  });
  const body = finalPost.ok ? await finalPost.json() : null;
  check('Final valid POST /alerts routes to fuzz-r',
    finalPost.status === 200 && body?.routed_to?.route_id === 'fuzz-r',
    `status=${finalPost.status} routed_to=${JSON.stringify(body?.routed_to)}`);
}

// ---- T044: throughput floor ------------------------------------------------

async function t044_throughput() {
  section('T044 — throughput: 100 routes + 1000 alerts < 2 s');
  await reset();

  // Create 100 varied routes (mix of severity & priority).
  const routePromises = [];
  for (let i = 0; i < 100; i++) {
    routePromises.push(postJSON('/routes', {
      id: `load-r${i}`,
      priority: i % 20,
      conditions: {
        severity: [i % 3 === 0 ? 'critical' : i % 3 === 1 ? 'warning' : 'info'],
        service: [`svc-${i % 10}-*`],
      },
      target: { type: 'slack', channel: `#load-${i}` },
    }));
  }
  const routeResults = await Promise.all(routePromises);
  const routesOk = routeResults.every((r) => r.ok);
  check('100 routes created (all 2xx)', routesOk);

  const severities = ['critical', 'warning', 'info'];
  const alertBodies = [];
  for (let i = 0; i < 1000; i++) {
    alertBodies.push({
      id: `load-a${i}`,
      severity: severities[i % 3],
      service: `svc-${i % 10}-api`,
      group: 'g',
      timestamp: '2026-04-19T10:00:00Z',
    });
  }

  // Issue all 1000 POSTs concurrently — let the server queue them; we're
  // measuring server-side throughput, not client serialization.
  const t0 = performance.now();
  const responses = await Promise.all(alertBodies.map((b) => postJSON('/alerts', b)));
  const elapsedMs = performance.now() - t0;
  const allOk = responses.every((r) => r.status === 200);

  check(`All 1000 alert POSTs returned 200`, allOk);
  check(`elapsed_ms=${elapsedMs.toFixed(0)} < 2000`, elapsedMs < 2000,
    `actual ${elapsedMs.toFixed(0)} ms`);
}

// ---- utils -----------------------------------------------------------------

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

// ---- main ------------------------------------------------------------------

async function main() {
  console.log(`Phase 4 verification against ${BASE}`);

  try {
    await t037_bootProbe();
    // If boot probe failed, stop — nothing else will work.
    if (failed > 0) {
      console.log('\nBoot probe failed — aborting remaining checks.');
      report();
      process.exit(1);
    }
    await t038_suppression();
    await t038_activeHoursNY();
    await t038_activeHoursTokyo();
    await t038_evalDetails();
    await t038_dryRun();
    await t038_tieBreak();
    await t038_validation();
    await t040_oversizedBody();
    await t043_fuzz();
    await t044_throughput();
  } catch (e) {
    console.error(`\nFATAL: ${e.message}`);
    report();
    process.exit(1);
  }

  report();
  process.exit(failed === 0 ? 0 : 1);
}

function report() {
  console.log(`\n─────────────────────────────────────────`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  if (failures.length) {
    console.log(`\nFailures:`);
    for (const f of failures) console.log(`  - ${f}`);
  }
}

main();
