#!/usr/bin/env node
// Grader §1 — Route CRUD.
// Creates, lists, updates (re-POST with existing ID), deletes, 404 on missing.

import { check, section, postJSON, reset, requireServer, runMain, BASE } from './lib.mjs';

await runMain('§1 Route CRUD', async () => {
  await requireServer();
  await reset();

  section('§1 — Route CRUD');

  // Empty list
  const empty = await (await fetch(`${BASE}/routes`)).json();
  check('GET /routes on empty store → {routes: []}',
    Array.isArray(empty.routes) && empty.routes.length === 0,
    JSON.stringify(empty));

  // Create
  const createRes = await postJSON('/routes', {
    id: 'r-1', priority: 10,
    conditions: { severity: ['critical'] },
    target: { type: 'slack', channel: '#ops' },
  });
  const created = await createRes.json();
  check('POST /routes new id → 201 {id, created:true}',
    createRes.status === 201 && created.id === 'r-1' && created.created === true,
    `status=${createRes.status} body=${JSON.stringify(created)}`);

  // Re-POST (update)
  const updateRes = await postJSON('/routes', {
    id: 'r-1', priority: 20,
    conditions: { severity: ['warning'] },
    target: { type: 'email', address: 'ops@example.com' },
  });
  const updated = await updateRes.json();
  check('POST /routes existing id → 201 {id, created:false}',
    updateRes.status === 201 && updated.created === false,
    JSON.stringify(updated));

  // Verify the update replaced the prior route
  const afterUpdate = await (await fetch(`${BASE}/routes`)).json();
  check('GET /routes reflects updated priority and target',
    afterUpdate.routes.length === 1 &&
    afterUpdate.routes[0].priority === 20 &&
    afterUpdate.routes[0].target?.type === 'email',
    JSON.stringify(afterUpdate));

  // Insertion order preserved across multiple routes
  await postJSON('/routes', {
    id: 'r-2', priority: 5, conditions: {},
    target: { type: 'slack', channel: '#a' },
  });
  await postJSON('/routes', {
    id: 'r-3', priority: 15, conditions: {},
    target: { type: 'slack', channel: '#b' },
  });
  const listed = await (await fetch(`${BASE}/routes`)).json();
  check('GET /routes preserves insertion order',
    listed.routes.map((r) => r.id).join(',') === 'r-1,r-2,r-3',
    listed.routes.map((r) => r.id).join(','));

  // Delete
  const delRes = await fetch(`${BASE}/routes/r-2`, { method: 'DELETE' });
  const delBody = await delRes.json();
  check('DELETE /routes/:id → 200 {id, deleted:true}',
    delRes.status === 200 && delBody.id === 'r-2' && delBody.deleted === true,
    JSON.stringify(delBody));

  const afterDel = await (await fetch(`${BASE}/routes`)).json();
  check('Deleted route removed from GET /routes',
    !afterDel.routes.some((r) => r.id === 'r-2'),
    JSON.stringify(afterDel.routes.map((r) => r.id)));

  // 404 on missing
  const miss = await fetch(`${BASE}/routes/does-not-exist`, { method: 'DELETE' });
  const missBody = await miss.json();
  check('DELETE /routes/:id missing → 404 {"error":"route not found"}',
    miss.status === 404 && missBody.error === 'route not found',
    `status=${miss.status} body=${JSON.stringify(missBody)}`);
});
