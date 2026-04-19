#!/usr/bin/env node
// Boot probe — service must accept connections within 10 s of launch.
// Quoted from the brief: "The container must start, listen on port 8080,
// and be ready to accept requests within 10 seconds of `docker run`."

import { BASE, check, section, waitForBoot, runMain } from './lib.mjs';

await runMain('boot — /health within 10 s', async () => {
  section(`Boot probe (target: ${BASE})`);

  const t0 = performance.now();
  const { ok, attempts, lastError } = await waitForBoot(10_000);
  const elapsedMs = performance.now() - t0;

  check(`/health returns {status:"ok"} (attempts=${attempts})`,
    ok, ok ? '' : `last error: ${lastError?.message ?? 'non-200'}`);
  check(`Elapsed ${elapsedMs.toFixed(0)} ms <= 10_000 ms`, elapsedMs <= 10_000);
});
