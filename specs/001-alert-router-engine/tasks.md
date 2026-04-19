---
description: "Dependency-ordered task list for the Configurable Alert Routing Engine"
---

# Tasks: Configurable Alert Routing Engine

**Input**: `/specs/001-alert-router-engine/` (spec.md, plan.md, data-model.md, contracts/api.md, quickstart.md, research.md)
**Tests**: Included — plan.md §Development Workflow mandates TDD (unit + `fastify.inject` integration + curl acceptance).

Format: `- [ ] TNNN [P?] [Story?] Description — DoD [refs]`

Legend: `[P]` = parallelisable (disjoint files, no sequential dep). DoD is the single verification check that closes the task. `REFS` are FR/NFR/SC/Rn/Sn/Xn IDs from spec.md + plan.md.

---

## Phase 1: Setup (Shared Infrastructure) — 3 parallel agents

- [ ] T001 [P] Create `package.json` at repo root with exact-pinned `fastify@4.x`, `minimatch`, `luxon`, dev-deps `vitest`, `@types/node`, `typescript@5.x`; scripts `build`, `start`, `test`, `test:acceptance` — DoD `npm ci && npm run build` succeeds on a clean clone producing `dist/index.js` [NFR-S-008, plan §Architectural Decisions].
- [ ] T002 [P] Create `tsconfig.json` with `strict: true`, `target: ES2022`, `module: NodeNext`, `outDir: dist`, `rootDir: src` — DoD `npx tsc --noEmit` exits 0 against an empty `src/types.ts` [plan §Project Structure].
- [ ] T003 [P] Create `vitest.config.ts` + `tests/` tree (`tests/unit/`, `tests/integration/`) — DoD `npx vitest run` exits 0 with "no tests found" (config valid) [plan §Development Workflow].
- [ ] T004 [P] Create `.dockerignore` excluding `node_modules`, `dist`, `specs`, `docs`, `tests`, `.git`, `*.md` — DoD `docker build` context size under 1 MiB (`du -sh` of staged context) [NFR-S-006].
- [ ] T005 [P] Create multi-stage `Dockerfile`: build stage `node:20-alpine` → `npm ci` → `tsc`; runtime stage `node:20-alpine` with `USER node` (UID 1000), `EXPOSE 8080`, no build tools, `CMD ["node","dist/index.js"]` — DoD `docker build -t alert-router . && docker inspect alert-router --format '{{.Config.User}}'` → `node`; `docker run --rm alert-router which npm` → empty/not-found [NFR-S-006, SC-S-003, FR-037].
- [ ] T006 [P] Create `src/types.ts` with all interfaces from data-model.md (`Severity`, `TargetType`, `Target` union, `Route`, `Alert`, `RoutingResult`, `EvaluationDetails`, `SuppressionRecord`, `Stats`, `PerRouteStats`, `InMemoryStore`, `AlertFilters`) — DoD `npx tsc --noEmit` green; `grep -c 'export interface\|export type' src/types.ts` ≥ 11 [data-model.md].
- [ ] T007 [P] TDD: author `tests/unit/validators.test.ts` with Red tests for IANA timezone (`America/New_York` OK, `Mars/Phobos` reject), `HH:MM` regex (`09:00` OK, `9:00`/`09:00:00`/`24:00` reject), ISO 8601 absolute instant (`2026-04-19T10:00:00Z` OK, `2026-04-19` and `March 25` reject), webhook header value type (all strings OK, number reject), integer priority (`3`/`-1` OK, `3.5`/`"high"` reject), non-negative suppression window — DoD `npx vitest run tests/unit/validators.test.ts` fails with file-not-found for `src/validators.ts` [FR-028…036].
- [ ] T008 Implement `src/validators.ts` + `src/schemas.ts` (Fastify JSON schemas for route and alert bodies, enum for severity/target type) to turn T007 green — DoD `npx vitest run tests/unit/validators.test.ts` all green, no `.skip`/`.only` in file [FR-028…036, NFR-R-005]. Depends: T002, T006, T007.
- [ ] T009 Implement `src/app.ts` Fastify factory: `bodyLimit: 1_048_576`, disabled `X-Powered-By`, `logger: { level: 'info' }` (pino default — metadata only, no request/response body logging; no explicit `redact` paths — we never log bodies, so redaction is unnecessary), register `GET /health` returning `{status:"ok"}`; `src/index.ts` boots `app.listen({port: 8080, host: '0.0.0.0'})`, installs `SIGTERM`/`SIGINT` → `fastify.close()` with 5 s drain → `process.exit(0)`, installs `uncaughtException`/`unhandledRejection` log-only handlers — DoD `tests/integration/health.test.ts` via `fastify.inject({url:'/health'})` returns 200 in <50 ms; `curl -s -o /dev/null -w '%{http_code}' localhost:8080/health` returns 200 after `docker run`; `grep -n "logger:" src/app.ts` shows `level: 'info'` and zero occurrences of body-logging options like `serializers` with `req.body` or `reply.payload` [NFR-R-002, NFR-R-003, NFR-R-006, NFR-S-001, NFR-S-009, NFR-S-010, R2, R3, R5, S1, S9, S10]. Depends: T001, T002, T005.

---

## Phase 2: Kernel — sequential single agent, TDD per function

Each kernel task = one Red → Green → Refactor cycle. No `[P]` within this phase.

### store.ts

- [X] T010 TDD Red+Green `tests/unit/store.routes.test.ts`: `addRoute` returns `{created:true}` first time and `{created:false}` on re-post of same id; `listRoutes()` preserves insertion order; `deleteRoute` returns `false` for unknown id, `true` after successful remove; `routeCount()` reflects current size — DoD `npx vitest run tests/unit/store.routes.test.ts` green; `src/store.ts` present [FR-001, FR-002, FR-003, NFR-X-004, NFR-X-005, X4, X5]. Depends: T006, T008.
- [X] T011 TDD Red+Green `tests/unit/store.alerts.test.ts`: `upsertAlert` replaces by id while preserving original submission-order index; `getAlert` returns stored record; `listAlerts({service, severity, routed, suppressed})` applies AND; invalid filter values produce empty array (lenient) — DoD test file green; no `.skip` [FR-007, FR-024, FR-024a, NFR-X-002, X2]. Depends: T010.
- [ ] T012 TDD Red+Green `tests/unit/store.suppressions.test.ts`: `getSuppression(route_id, service)` returns `undefined` when absent; `setSuppression(rec)` writes; composite key `${route_id}:${service}` verified by setting `(r1,payment-api)` and `(r1,auth-service)` independently — DoD green [FR-019, NFR-X-004, X4]. Depends: T010.
- [ ] T013 TDD Red+Green `tests/unit/store.stats.test.ts`: fresh `stats()` equals `INITIAL_STATS` per FR-025b (by_severity pre-populated with three zeros, by_route and by_service empty); `reset()` clears all four Maps and restores initial stats — DoD green [FR-025b, FR-027, X3]. Depends: T010.

### matcher.ts

- [ ] T014 TDD Red+Green `tests/unit/matcher.conditions.test.ts`: severity list match/no-match; service glob `payment-*` matches `payment-api` + `payment-worker`, excludes `auth-service`; `*-api` matches `payment-api` excludes `payment-worker`; group list match; labels subset match (alert superset OK, missing key rejects, wrong value rejects); omitted condition field = match all; `conditions:{}` = match all — DoD green [FR-009…014, NFR-S-004, S4]. Depends: T006, T008.
- [ ] T015 TDD Red+Green `tests/unit/matcher.activeHours.test.ts` using `luxon`: America/New_York 09:00–17:00 matches alert at `2026-04-20T13:00:00Z` (09:00 EDT, inclusive start); does NOT match `2026-04-20T21:00:00Z` (17:00 EDT, exclusive end); Asia/Tokyo cross-check; route without `active_hours` always active — DoD green [FR-021, FR-022, SC-005]. Depends: T014.

### router.ts

- [ ] T016 TDD Red+Green `tests/unit/router.priority.test.ts`: three matching routes return winner with max priority; `matched_routes` lists all matching ids sorted priority-desc with ties broken by insertion order; losers still listed — DoD green [FR-005, FR-005a, FR-006]. Depends: T014.
- [ ] T017 TDD Red+Green `tests/unit/router.suppression.test.ts`: first alert routes (`suppressed:false`), second alert within window suppressed with exact `suppression_reason` template matching FR-015 (`Alert for service '<svc>' on route '<rid>' suppressed until <iso8601Z>`); third alert beyond window routes and restarts window at its own timestamp; **window-not-extended proof**: alert at T+240s suppressed, then alert at T+310s routes (would suppress if the T+240s alert had extended the window to T+540s); different service on same route not suppressed; `suppression_window_seconds:0` and omission equivalent — DoD green [FR-015…020, SC-004, SC-010]. Depends: T016, T012.
- [ ] T018 TDD Red+Green `tests/unit/router.evaluationDetails.test.ts`: with 5 routes in store and 2 matches, `total_routes_evaluated=5`, `routes_matched=2`, `routes_not_matched=3`, `suppression_applied` true iff winner suppressed; no-match case: `routed_to=null`, `matched_routes=[]`, `suppression_reason` absent — DoD green [FR-004c, FR-008]. Depends: T016.
- [ ] T019 TDD Red+Green `tests/unit/router.stats.test.ts`: counters increment per FR-025a (`total_alerts_processed`, `by_severity`, `by_service`, `by_route[*].total_matched` for every match, `total_routed` + `by_route[winner].total_routed` when routed, `total_suppressed` + `by_route[winner].total_suppressed` when suppressed, `total_unrouted` on no match); re-submission increments again; invariants `total_alerts_processed = total_routed + total_suppressed + total_unrouted` and `total_matched ≥ total_routed + total_suppressed` — DoD green [FR-025a, SC-008, SC-009]. Depends: T018, T013.
- [ ] T020 TDD Red+Green `tests/unit/router.dryRun.test.ts`: snapshot `JSON.stringify(store.stats())` + suppression map + alerts map pre-call; `router.evaluate(alert, {dryRun:true})` returns same RoutingResult shape; post-call snapshot bit-for-bit identical — DoD green; deep-equal assertion on snapshot [FR-026, SC-006]. Depends: T019.
- [ ] T021 Kernel boundary gate: `grep -nE "from 'fastify'|from '\\./routes" src/matcher.ts src/router.ts src/store.ts` returns no matches — DoD grep exits 1 (no match) [NFR-X-007, SC-X-002, X7]. Depends: T010–T020.

---

## Phase 3: HTTP handlers — 4 parallel agents once Phase 2 is green

Each handler task begins with a failing `fastify.inject` integration test and ends with the corresponding curl from quickstart.md passing against a booted container.

### routes/routes.ts [US1]

- [ ] T022 [P] [US1] TDD `tests/integration/routes.post.test.ts`: `POST /routes` with valid body → 201 `{id, created:true}`; re-post same id → 201 `{id, created:false}`; missing `priority` → 400 non-empty `error`; `target.type:"sms"` → 400; `active_hours.timezone:"Mars/Phobos"` → 400; `priority:3.5` → 400; `suppression_window_seconds:-1` → 400; webhook header value `{x:1}` → 400 — DoD `vitest run tests/integration/routes.post.test.ts` green [FR-001, FR-028, FR-030, FR-031, FR-031a, FR-032, FR-035, FR-036]. Depends: T009, T010.
- [ ] T023 [US1] Implement `src/routes/routes.ts` `POST /routes`, `GET /routes`, `DELETE /routes/:id` to green T022 + new `tests/integration/routes.getdelete.test.ts` (GET returns `{routes:[]}` when empty, insertion order otherwise; DELETE unknown id → 404 `{"error":"route not found"}`) — DoD `curl -s -X POST :8080/routes -d @route.json` returns 201; `curl -s -X DELETE :8080/routes/nope -w '%{http_code}'` returns 404 [FR-002, FR-003]. Depends: T022.

### routes/alerts.ts [US2, US3, US4, US5, US6]

- [ ] T024 [P] [US2] TDD `tests/integration/alerts.post.test.ts`: routed response shape (FR-004a target echo incl. webhook headers); suppressed response (FR-004b, `routed_to` non-null when suppressed); no-match response (FR-004c, `routed_to:null`, `matched_routes:[]`, no `suppression_reason`); re-post same alert id upserts (single record, stats tick twice) — DoD green [FR-004, FR-004a, FR-004b, FR-004c, FR-007, FR-008a, SC-008]. Depends: T009, T019.
- [ ] T025 [US2,US3,US4,US5] Implement `POST /alerts` handler in `src/routes/alerts.ts` wiring validators + router + store — DoD quickstart §3 suppression sequence passes (first routed, second suppressed with exact `suppression_reason`, third routes after window); quickstart §4 active-hours inclusive-start/exclusive-end pair passes; quickstart §5 `total_routes_evaluated=3` passes; quickstart §7 tie-break `first` wins, `matched_routes:["first","second"]` [SC-004, SC-005, SC-010, landmines #1–#3]. Depends: T024, T023.
- [ ] T026 [P] [US6] TDD `tests/integration/alerts.query.test.ts` + implement `GET /alerts` and `GET /alerts/:id`: AND filter combinations, invalid `severity`/`routed` → `{alerts:[],total:0}` (lenient), unknown id → 404 `{"error":"alert not found"}`, empty store → `{alerts:[],total:0}` — DoD curl `:8080/alerts?service=payment-api&severity=critical` returns only intersection; `:8080/alerts/missing -w '%{http_code}'` = 404 [FR-023, FR-024, FR-024a]. Depends: T025.

### routes/stats.ts [US6]

- [ ] T027 [P] [US6] TDD `tests/integration/stats.test.ts` + implement `GET /stats` in `src/routes/stats.ts` returning live `store.stats()` object — DoD fresh container: `curl :8080/stats` returns `{total_alerts_processed:0,total_routed:0,total_suppressed:0,total_unrouted:0,by_severity:{critical:0,warning:0,info:0},by_route:{},by_service:{}}`; after a routed alert, counters tick exactly once [FR-025, FR-025b]. Depends: T009, T013.

### routes/system.ts [US7, US8]

- [ ] T028 [P] [US7] TDD `tests/integration/system.test.test.ts` + implement `POST /test` in `src/routes/system.ts` using `router.evaluate(alert, {dryRun:true})`. Tests MUST include: (i) **L3 extension**: with 5 routes in store and a dry-run alert matching 2, response `evaluation_details.total_routes_evaluated === 5` (proves count is pulled from store size, not stats); (ii) **L4 indirect suppression-isolation proof**: create route with `suppression_window_seconds: 300`, submit a real alert at T=0 establishing the window, `POST /test` at T=+60s with an alert that would be suppressed, then submit a real alert at T=+250s — it MUST still be `suppressed: true` with the original expiry (proving `/test` did not reset/extend the window) — DoD quickstart §6 passes: stats diff empty, `GET /alerts/dry-1` → 404, suppression record unchanged; plus L3 jq assertion and L4 indirect-proof assertions green [FR-026, FR-008, SC-006, landmine #3 + #4]. Depends: T020, T023, T027.
- [ ] T029 [P] [US8] TDD `tests/integration/system.reset.test.ts` + implement `POST /reset` in `src/routes/system.ts` calling `store.reset()` — DoD after populating routes + alerts + suppressions: `POST /reset` returns `{status:"ok"}`; `GET /routes` = `{routes:[]}`; `GET /alerts` = `{alerts:[],total:0}`; `GET /stats` matches initial shape [FR-027, SC-007]. Depends: T013.

### Global error + resiliency surface (wires across handlers)

- [ ] T030 Install Fastify `setErrorHandler` in `src/app.ts`: any thrown exception → `reply.code(500).send({error:"internal error"})`; stack logged via Fastify logger only, never in response body — DoD `tests/integration/errorHandler.test.ts` injects a handler that throws; response `{statusCode:500, body:{error:"internal error"}}`, no `stack` key; `GET /health` still 200 after [NFR-R-001, NFR-S-005, R1, S5]. Depends: T009.
- [ ] T031 Per-request 30 s timeout: add `withTimeout(handler, ms=30_000)` wrapper in `src/app.ts` that races the handler promise against `setTimeout` and responds 503 `{error:"request timed out"}` if the handler exceeds the budget; all routes register through it. Also set Fastify `connectionTimeout: 30_000` as the socket-level belt-and-braces. README "Known limitations" section MUST flag that this only interrupts **async** handlers — a synchronous CPU-bound handler cannot be aborted by Node's single-threaded event loop and would need a worker-thread pool to satisfy NFR-R-007 in full; deferred as a TODO for production hardening — DoD `tests/integration/timeout.test.ts`: route that `await`s `new Promise(r => setTimeout(r, 31_000))` returns 503 within ~30.1 s; concurrent `GET /health` during the pending handler responds in <50 ms [NFR-R-007, R4]. Depends: T009.
- [ ] T032 Reject URLs/query strings > 2 KiB with 414 or 400 — DoD `curl -s -o /dev/null -w '%{http_code}' ":8080/alerts?$(python3 -c 'print("x="+"a"*3000)')"` ∈ {400, 414} [NFR-S-002, S2]. Depends: T009.
- [ ] T033 Prototype-pollution safety: labels stored as `Map<string,string>`; webhook `headers` stored in `Object.create(null)`; reject own-property keys `__proto__`, `constructor`, `prototype` in labels/headers with 400 — DoD `tests/integration/prototypePollution.test.ts` posts route with `labels:{"__proto__":"polluted"}` → either 400 OR accepted but `({}).polluted === undefined` after the request [NFR-S-003, SC-S-001, S3]. Depends: T023.
- [ ] T034 Validation atomicity: validate fully before touching store/stats/suppressions — DoD `tests/integration/partialState.test.ts` posts invalid alert (bad timestamp); `store.stats()` and `store.listAlerts({})` unchanged before and after [NFR-R-005, R6]. Depends: T025.
- [ ] T035 Regression-guard: info-level logger (configured in T009) must never emit request bodies. Post a route with a sentinel `labels.canary` value of `canary-xyz-7f3b` and an alert carrying the same sentinel in its `labels`, then inspect container stdout/stderr captured during the run — DoD `docker logs <container> 2>&1 | grep -c 'canary-xyz-7f3b'` = 0 (sentinel never appears in any log line, proving bodies are not serialised by pino) [NFR-S-010, S10]. Depends: T009, T025.

---

## Phase 4: Verification

- [ ] T036 `npm test` — all unit + integration suites green, zero `.skip`/`.only` (`grep -rE "\\.skip\\(|\\.only\\(" tests/` returns no matches) [plan §Development Workflow]. Depends: T010–T035.
- [ ] T037 `docker build -t alert-router .` then `docker run --rm -p 8080:8080 alert-router`; verify `curl localhost:8080/health` returns 200 within 10 s of run (`time curl --max-time 10 --retry 20 --retry-delay 0.5 --retry-connrefused -fsS localhost:8080/health`) — DoD total elapsed ≤10 s [SC-002, FR-038]. Depends: T005, T009.
- [ ] T038 Run every curl block in `specs/001-alert-router-engine/quickstart.md` §3–§8 against the booted container; each `jq` assertion matches its inline expected value. **Additionally for SC-005**: create a second route with `active_hours: {start:"09:00", end:"17:00", timezone:"Asia/Tokyo"}` (no DST) and post alerts at `2026-04-20T00:00:00Z` (= 09:00 Tokyo, match) and `2026-04-20T08:00:00Z` (= 17:00 Tokyo, no match); verify behavior — catches luxon-fallback-to-UTC regressions that NY-during-DST would hide — DoD all 4 landmines + tie-break + validation smoke + Tokyo-zone pair green [SC-001, SC-003, SC-004, SC-005, SC-006, SC-007, SC-008, SC-010]. Depends: T037.
- [ ] T039 Module-boundary gate (final): `grep -nE "from 'fastify'|from '\\./routes" src/matcher.ts src/router.ts src/store.ts` → no output; additionally no import of `./store` from `src/matcher.ts` — DoD both greps exit 1 [NFR-X-007, SC-X-002, X7]. Depends: T021, T025.
- [ ] T040 Oversized body: `dd if=/dev/zero bs=1 count=$((10*1024*1024)) | curl -s -o /dev/null -w '%{http_code}' -X POST :8080/alerts -H 'content-type: application/json' --data-binary @-` → 413; concurrent `curl :8080/health` during rejection responds in <50 ms — DoD both conditions hold [NFR-S-001, SC-S-002, S1]. Depends: T037.
- [ ] T041 SIGTERM cleanliness: `docker run --name ar -d -p 8080:8080 alert-router && sleep 1 && time docker stop -t 6 ar && docker inspect ar --format '{{.State.ExitCode}}'` → exit code 0 within 6 s — DoD conditions hold [NFR-R-003, SC-R-002, R3]. Depends: T037.
- [ ] T042 Docker hardening inspection: `docker inspect alert-router --format '{{.Config.User}}'` = `node`; `docker inspect alert-router --format '{{range $p,$_ := .Config.ExposedPorts}}{{$p}}{{end}}'` = `8080/tcp`; `docker run --rm --entrypoint sh alert-router -c 'which npm || echo none'` = `none` — DoD three checks pass [NFR-S-006, SC-S-003, S6]. Depends: T005.
- [ ] T043 Fuzz resiliency: submit 100 malformed bodies (random bytes, oversized arrays, deep nesting up to 1000) via a small shell loop; after each, `GET /health` returns 200; a final valid `POST /alerts` succeeds — DoD loop exits 0, final POST returns expected RoutingResult [NFR-R-001, NFR-R-002, SC-R-001, R1, R2]. Depends: T037.
- [ ] T044 Throughput floor: write `tests/load/throughput.ts` (~40 LOC) that uses `node:http` with a shared `http.Agent({ keepAlive: true, maxSockets: 16 })`: POST 100 varied routes, then POST 1 000 alerts with mixed matching against `localhost:8080`, measure wall-clock of the 1 000-alert phase with `performance.now()`. Runnable via `npx tsx tests/load/throughput.ts`. Rationale: avoids `xargs`/`curl` per-process spawn overhead (~5–20 ms each on macOS) that would swamp the <2 s budget even with a correct O(R+M log M) matcher — DoD against a booted container, script prints `elapsed_ms` and exits 0 iff `elapsed_ms < 2000` [NFR-X-005, SC-X-001, X1, X2]. Depends: T037.
- [ ] T045 Kotlin/GCP design-doc coverage: `docs/kotlin-gcp-design.md` exists and contains all 10 sections listed in plan.md §Parallel background track (Cloud Run + HTTP/2 autoscale, Firestore vs Spanner with decision, Pub/Sub async ingestion, Cloud Scheduler for active_hours, Memorystore/Redis for suppression, IAM + Secret Manager, inverted-index route catalogue >10k routes, per-tenant isolation, sharding, known-limits + migration) — DoD `grep -cE "Cloud Run|Firestore|Spanner|Pub/Sub|Cloud Scheduler|Memorystore|IAM|Secret Manager|inverted[- ]index|per-tenant" docs/kotlin-gcp-design.md` ≥ 10 [plan §Parallel background track, NFR-X-009]. Depends: none.
- [ ] T046 README.md "Known limitations / production TODOs" section capturing deferred hardening items: (1) per-request timeout covers async handlers only — sync CPU-bound handler abort requires a worker-thread pool (NFR-R-007 caveat from T031); (2) unbounded `alerts` collection — no eviction policy (NFR-X-010); (3) single-process CPU bound + in-memory volatility on restart (NFR-X-010); (4) no auth/TLS — loopback-only per exercise scope; (5) logger omits bodies by default, redaction paths would be needed if body-level debug logging is ever enabled (NFR-S-010 / T035); plus documented env vars (none currently required — NFR-S-007) — DoD `grep -cE "worker thread|unbounded|restart|auth|TLS|redact" README.md` ≥ 6 under a "Known limitations" heading [NFR-R-007, NFR-S-007, NFR-S-010, NFR-X-010, NFR-X-009]. Depends: T031, T035.

---

## Dependencies & Execution Order

- **Phase 1** (T001–T009): T001–T007 all `[P]`; T008 blocks on T007; T009 blocks on T001/T002/T005.
- **Phase 2** (T010–T021): strictly sequential within the kernel agent. T010 → T011 → T012 → T013 → T014 → T015 → T016 → T017 → T018 → T019 → T020 → T021 gate.
- **Phase 3** (T022–T035): four `[P]` streams once T021 green.
  - Stream A (routes): T022 → T023.
  - Stream B (alerts): T024 → T025 → T026.
  - Stream C (stats): T027.
  - Stream D (system): T028, T029.
  - Cross-cutting (T030–T035) can run after T009; mergeable with any stream touching `src/app.ts` (serialise writes to that file).
- **Phase 4** (T036–T046): all depend on Phase 3 complete; T036 first (fast feedback), then T037 for container, then T038–T044 in parallel tabs, T045 independent throughout, T046 after T031+T035 land.

## Parallel Example

```bash
# Phase 1 kickoff (3 agents):
# Agent A: T001, T002, T003, T004, T005
# Agent B: T006, T007, T008
# Agent C: T009 (after T005 lands)

# Phase 3 kickoff (4 agents) once T021 green:
# Agent A: T022, T023
# Agent B: T024, T025, T026
# Agent C: T027
# Agent D: T028, T029
# Meanwhile T030–T035 handled by whichever agent owns src/app.ts
```

## Notes

- Every task's DoD is a single concrete check (unit green, integration green, curl status, grep output, `docker inspect` field). Any "implementation complete" without a verification line is invalid.
- No task rewrites an existing passing test to make new code green — if a test is wrong, fix it in its own commit with rationale (TDD rule #4, plan.md §Development Workflow).
- Kotlin/GCP design doc is pre-existing background work; T045 is the only doc-related task.
- Stop at the review-tasks gate per user direction. Do not begin `/speckit-implement` without approval.
