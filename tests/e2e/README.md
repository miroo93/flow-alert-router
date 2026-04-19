# tests/e2e — mirror the grader's 14-section evaluation

The take-home brief describes how submissions are evaluated in §"How We Will Test Your Submission" — a `curl`/`jq` suite of **70+ assertions across 14 sections** run against a booted Docker container. These e2e scripts reproduce that suite section-for-section so you can run the same checks yourself at any time.

## Layout

| Script | Grader section | What it exercises |
|--------|---------------|-------------------|
| `boot.mjs` | — | `/health` 200 within 10 s (brief: "ready to accept requests within 10 seconds") |
| `s01-route-crud.mjs` | §1 | `POST`/`GET`/`DELETE /routes` incl. 404 and re-POST upsert |
| `s02-input-validation.mjs` | §2 | missing fields, invalid severity/target/tz, bad timestamps, malformed HH:MM, negative suppression |
| `s03-basic-routing.mjs` | §3 | multiple matches → highest priority wins; unrouted → `routed_to:null`; `matched_routes` + `evaluation_details` counts |
| `s04-label-matching.mjs` | §4 | all required labels present; extras ignored; missing/wrong → no match |
| `s05-glob-matching.mjs` | §5 | `payment-*`, `auth-*`, `*-api` + literal + non-match |
| `s06-suppression-windows.mjs` | §6 | first routes, second within window suppressed, post-window routes again, different service not suppressed, window-not-extended proof |
| `s07-active-hours.mjs` | §7 | inside/outside/boundary NY + Tokyo cross-check; route without `active_hours` always active |
| `s08-alert-resubmission.mjs` | §8 | re-POST same id upserts; list holds 1 record; stats count both |
| `s09-query-filtering.mjs` | §9 | `GET /alerts/:id` + 404; single and combined filters; `total` field |
| `s10-stats.mjs` | §10 | top-level counters + `by_severity` + `by_service` + `by_route` + invariants |
| `s11-dry-run.mjs` | §11 | `POST /test` returns decision; no persistence, no stats, no suppression mutation |
| `s12-omitted-conditions.mjs` | §12 | `conditions: {}` matches all; partial conditions still filter on specified fields |
| `s13-priority.mjs` | §13 | three routes at different priorities all match; highest wins; all three in `matched_routes`; tie-break |
| `s14-full-reset.mjs` | §14 | `POST /reset` clears routes + alerts + suppressions + stats |
| `docker.sh` | — | `docker build` → `docker run` → `/health` → clean stop — what the grader actually does |
| `lib.mjs` | — | shared `fetch` helpers (`BASE`, `check`, `section`, `reset`, `waitForBoot`, `sortKeys`, `runMain`) |
| `run-all.sh` | — | dispatcher |

Assertions across the 14 sections exceed 80 by design — a couple of sections (§6, §11) include extra proofs for regressions known to be sneaky (suppression-window extension, dry-run isolation).

## Running

```bash
# 1. Start the service yourself.
docker build -t alert-router . && docker run --rm -p 8080:8080 alert-router
# or
npm start

# 2. In another terminal, from repo root:
npm run e2e              # boot + all 14 grader sections
npm run e2e:docker       # do step 1 for you (build, run, probe, stop), then exit
npm run e2e:s03          # just §3
tests/e2e/run-all.sh --only s06,s07
ALERT_ROUTER_URL=http://127.0.0.1:9090 tests/e2e/run-all.sh
```

Each `.mjs` script is also runnable directly:

```bash
node tests/e2e/s07-active-hours.mjs
```

Exit codes: `0` on all assertions passing, `1` on any failure, `2` if the server is unreachable at startup (fetch scripts only).

## Why this shape

- **One file per grader section** — if `s10-stats.mjs` fails, you know exactly which grader section is affected, and the file is short enough to read top-to-bottom.
- **`POST /reset` between sections** — matches grader behavior (§ says "Each section resets your service's state"); failures don't cascade.
- **Fetch-based, no deps** — Node 20 native `fetch`. No `curl`/`jq` shell-outs, no transpilation.
- **Same source of truth as the grader** — assertions derive from the take-home brief's API spec and the enumerated 14 sections, not from the internal FR/NFR numbering.

## Relationship to `tests/unit` and `tests/integration`

- `tests/unit/`, `tests/integration/` — in-process vitest. Cover module-level correctness and `fastify.inject` contract tests. Fast.
- `tests/e2e/` — out-of-process against a real booted service. Matches the grader's contract.

If something breaks in e2e but passes in unit/integration, it's a boot-time, Docker-runtime, or HTTP-path regression — not a logic bug.
