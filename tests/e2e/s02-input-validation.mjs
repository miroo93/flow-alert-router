#!/usr/bin/env node
// Grader §2 — Input validation.
// Missing required fields, invalid severity values, bad timestamps, invalid
// target types, negative suppression windows, invalid timezones, malformed
// time formats — all must return 400 {"error": "..."}.

import { check, section, postJSON, reset, requireServer, runMain } from './lib.mjs';

async function expect400(label, path, body) {
  const r = await postJSON(path, body);
  let err = '';
  try { err = (await r.json())?.error ?? ''; } catch { /* non-JSON OK */ }
  check(`${label} → 400 with non-empty error`,
    r.status === 400 && typeof err === 'string' && err.length > 0,
    `status=${r.status} error="${err}"`);
}

await runMain('§2 Input validation', async () => {
  await requireServer();
  await reset();

  section('§2 — Input validation (expect 400 {"error": "..."})');

  // Alerts — missing required fields
  await expect400('Alert missing id', '/alerts', {
    severity: 'critical', service: 's', group: 'g', timestamp: '2026-04-19T10:00:00Z',
  });
  await expect400('Alert missing severity', '/alerts', {
    id: 'a', service: 's', group: 'g', timestamp: '2026-04-19T10:00:00Z',
  });
  await expect400('Alert missing service', '/alerts', {
    id: 'a', severity: 'critical', group: 'g', timestamp: '2026-04-19T10:00:00Z',
  });
  await expect400('Alert missing group', '/alerts', {
    id: 'a', severity: 'critical', service: 's', timestamp: '2026-04-19T10:00:00Z',
  });
  await expect400('Alert missing timestamp', '/alerts', {
    id: 'a', severity: 'critical', service: 's', group: 'g',
  });

  // Invalid severity
  await expect400('Invalid severity "urgent"', '/alerts', {
    id: 'a', severity: 'urgent', service: 's', group: 'g', timestamp: '2026-04-19T10:00:00Z',
  });

  // Bad timestamps
  await expect400('Date-only timestamp', '/alerts', {
    id: 'a', severity: 'critical', service: 's', group: 'g', timestamp: '2026-04-19',
  });
  await expect400('Non-ISO timestamp', '/alerts', {
    id: 'a', severity: 'critical', service: 's', group: 'g', timestamp: 'March 25',
  });

  // Routes — missing required
  await expect400('Route missing priority', '/routes', {
    id: 'r', conditions: {}, target: { type: 'slack', channel: '#x' },
  });
  await expect400('Route missing target', '/routes', {
    id: 'r', priority: 1, conditions: {},
  });
  await expect400('Route missing conditions', '/routes', {
    id: 'r', priority: 1, target: { type: 'slack', channel: '#x' },
  });

  // Invalid target.type
  await expect400('target.type "sms" invalid', '/routes', {
    id: 'r', priority: 1, conditions: {},
    target: { type: 'sms', number: '+1' },
  });

  // Target missing its type-specific required field
  await expect400('slack target missing channel', '/routes', {
    id: 'r', priority: 1, conditions: {},
    target: { type: 'slack' },
  });
  await expect400('webhook target missing url', '/routes', {
    id: 'r', priority: 1, conditions: {},
    target: { type: 'webhook' },
  });

  // Priority not an integer
  await expect400('Priority 3.5 (non-integer)', '/routes', {
    id: 'r', priority: 3.5, conditions: {},
    target: { type: 'slack', channel: '#x' },
  });
  await expect400('Priority "high" (non-integer)', '/routes', {
    id: 'r', priority: 'high', conditions: {},
    target: { type: 'slack', channel: '#x' },
  });

  // Negative suppression window
  await expect400('suppression_window_seconds -1', '/routes', {
    id: 'r', priority: 1, conditions: {},
    target: { type: 'slack', channel: '#x' },
    suppression_window_seconds: -1,
  });

  // Invalid IANA timezone
  await expect400('Invalid IANA timezone', '/routes', {
    id: 'r', priority: 1, conditions: {},
    target: { type: 'slack', channel: '#x' },
    active_hours: { start: '09:00', end: '17:00', timezone: 'Mars/Phobos' },
  });

  // Malformed active_hours time formats
  await expect400('active_hours start "9:00" (missing leading zero)', '/routes', {
    id: 'r', priority: 1, conditions: {},
    target: { type: 'slack', channel: '#x' },
    active_hours: { start: '9:00', end: '17:00', timezone: 'UTC' },
  });
  await expect400('active_hours end "09:00:00" (with seconds)', '/routes', {
    id: 'r', priority: 1, conditions: {},
    target: { type: 'slack', channel: '#x' },
    active_hours: { start: '09:00', end: '09:00:00', timezone: 'UTC' },
  });
  await expect400('active_hours "24:00" (hour > 23)', '/routes', {
    id: 'r', priority: 1, conditions: {},
    target: { type: 'slack', channel: '#x' },
    active_hours: { start: '09:00', end: '24:00', timezone: 'UTC' },
  });
});
