// Shared helpers for Phase 4 verification scripts.
// Node 20 native fetch. No deps.

export const BASE = process.env.ALERT_ROUTER_URL ?? 'http://localhost:8080';

const state = {
  passed: 0,
  failed: 0,
  failures: [],
  currentSection: null,
};

export function section(title) {
  state.currentSection = title;
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

export function check(label, cond, detail) {
  if (cond) {
    state.passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    state.failed++;
    const msg = detail ? `${label} — ${detail}` : label;
    state.failures.push(`[${state.currentSection ?? 'unsectioned'}] ${msg}`);
    console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
  }
}

export function report(scriptLabel) {
  console.log(`\n─────────────────────────────────────────`);
  console.log(`  ${scriptLabel}`);
  console.log(`  Passed: ${state.passed}`);
  console.log(`  Failed: ${state.failed}`);
  if (state.failures.length) {
    console.log(`\nFailures:`);
    for (const f of state.failures) console.log(`  - ${f}`);
  }
  return state.failed === 0 ? 0 : 1;
}

// -- HTTP helpers ------------------------------------------------------------

export async function postJSON(path, body) {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function postRaw(path, rawBody, contentType = 'application/json') {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: rawBody,
  });
}

export async function reset() {
  const r = await fetch(`${BASE}/reset`, { method: 'POST' });
  if (!r.ok) throw new Error(`reset failed: ${r.status}`);
}

// Wait for the service to accept connections and return {status:"ok"} on
// /health within `timeoutMs`. Returns { ok, attempts, lastError }.
export async function waitForBoot(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  let lastError = null;
  while (Date.now() < deadline) {
    attempts++;
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.status === 200) {
        const body = await r.json();
        if (body?.status === 'ok') return { ok: true, attempts, lastError: null };
      }
    } catch (e) {
      lastError = e;
    }
    await new Promise((res) => setTimeout(res, 200));
  }
  return { ok: false, attempts, lastError };
}

// Most scripts only need a quick "is the server up" check — a 2 s cap is
// plenty if the container is already running, and if it's not, the error
// message makes that clear.
export async function requireServer() {
  const { ok, lastError } = await waitForBoot(2_000);
  if (!ok) {
    console.error(`\x1b[31mFATAL\x1b[0m: server at ${BASE} not reachable — ${lastError?.message ?? 'no /health 200'}`);
    console.error('Start the service first (e.g. `docker run -p 8080:8080 alert-router` or `npm start`).');
    process.exit(2);
  }
}

// Stable sort-keys serializer for deep-equality diffing of stats/etc.
export function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

// Thin error-reporting wrapper for main() — catches fatal errors and still
// prints the summary line so the runner can grep it.
export async function runMain(scriptLabel, fn) {
  try {
    await fn();
  } catch (e) {
    console.error(`\n\x1b[31mFATAL\x1b[0m: ${e.stack ?? e.message}`);
    state.failed++;
    state.failures.push(`[fatal] ${e.message}`);
  }
  process.exit(report(scriptLabel));
}
