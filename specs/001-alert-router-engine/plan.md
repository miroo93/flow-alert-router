# Implementation Plan: Configurable Alert Routing Engine

**Branch**: `001-alert-router-engine` | **Date**: 2026-04-19 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-alert-router-engine/spec.md`

## Status

- **Phase 0 — Research**: ✅ complete (`research.md` committed in 5952f0f).
- **Phase 1 — Scaffolding (T001–T009)**: ✅ complete. Three parallel sub-agents landed package/tsconfig/vitest/Dockerfile, `src/types.ts` (14 exports), and `src/validators.ts` + `src/schemas.ts` with 33 unit tests green. Health endpoint responds <50 ms via `fastify.inject`. Two TDD-surfaced edge cases recorded in commit history: luxon accepting lowercase `utc` (fixed with `Intl.DateTimeFormat` canonicalisation) and the ES2015 `{__proto__: ...}` literal being inert (test rewritten to use `JSON.parse` which models the real Fastify body-parse attack surface, commit `T007a`).
- **Phase 2 — Kernel (T010–T021)**: ⏳ pending — sequential single agent, TDD per function.
- **Phase 3 — HTTP handlers (T022–T035)**: ⏳ pending — four parallel streams once T021 grep gate passes.
- **Phase 4 — Verification (T036–T046)**: ⏳ pending.

## Summary

Single Dockerized HTTP service on port 8080 that ingests alerts, evaluates them against user-defined routing rules (severity/service-glob/group/labels + priority, suppression, active hours), and returns deterministic routing decisions. All state in-memory; `POST /reset` clears. Evaluated by a 70+ assertion curl/jq suite across 14 sections; container must start in ≤10 s.

**Approach**: Fastify v4 on Node 20 LTS, TypeScript strict. Strict module separation — `matcher.ts` / `router.ts` / `store.ts` carry zero HTTP concerns so the engine is portable to a different transport or store (NFR-X-007). JSON Schema (Fastify native) handles shape validation; `validators.ts` enforces cross-field rules (IANA tz via luxon, `HH:MM` regex, ISO 8601 absolute-instant, webhook header value types). Globs via `minimatch` (no `new RegExp(userInput)`). Stats are maintained incrementally on write → O(1) reads.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 20 LTS
**Primary Dependencies**: Fastify v4 (HTTP + JSON schema), `minimatch` (service globs), `luxon` (IANA tz conversion)
**Storage**: In-memory only — `Map<string, T>` keyed stores; no database
**Testing**: Hand-run curl/jq smoke tests against a live container (per `quickstart.md`); grading script is the acceptance suite
**Target Platform**: Linux container (`node:20-alpine`), port 8080, non-root UID ≥ 1000
**Project Type**: Single-project HTTP service
**Performance Goals**: ≥500 alerts/s single core with 100 routes mixed matching (NFR-X-005); `GET /health` <50 ms; container accepting connections <10 s (SC-002)
**Constraints**: 1 MiB JSON body limit; 2 KiB query string limit; 30 s request timeout; 5 s graceful-shutdown drain; no prototype pollution; no secrets in image; no `X-Powered-By`
**Scale/Scope**: Single process, single tenant, ≤10k routes in-memory; no replication (scale-out path deferred to `docs/kotlin-gcp-design.md`)

## Constitution Check

`.specify/memory/constitution.md` is unpopulated (template placeholders only). No project-specific gates to evaluate. Proceeding per user direction.

## Project Structure

### Documentation (this feature)

```text
specs/001-alert-router-engine/
├── plan.md              # This file
├── research.md          # Library rationale + judgement calls
├── data-model.md        # TS interfaces for Route/Alert/RoutingResult/SuppressionRecord/Stats/InMemoryStore
├── quickstart.md        # docker build/run + curl smoke tests for the known landmines
├── contracts/
│   └── api.md           # Per-endpoint request/response schemas
└── spec.md              # Authoritative spec (exists)

docs/
└── kotlin-gcp-design.md # Parallel deliverable — design-only, no code
```

### Source Code (repository root)

```text
src/
├── index.ts             # Bootstrap: build app, install signal/error handlers, listen :8080
├── app.ts               # Fastify factory (body limit, logger, error hook, /health)
├── types.ts             # All interfaces (Route, Alert, RoutingResult, SuppressionRecord, Stats)
├── store.ts             # InMemoryStore — Maps for routes/alerts/suppressions/stats. HTTP-free.
├── matcher.ts           # Condition evaluation (severity/service/group/labels/active_hours). HTTP-free.
├── router.ts            # Priority selection, suppression decision, stats mutation. HTTP-free.
├── validators.ts        # Cross-field validation (IANA tz, HH:MM, ISO 8601 instant, header values)
├── schemas.ts           # Fastify JSON schemas for route/alert bodies (shape + enums)
└── routes/
    ├── routes.ts        # POST/GET /routes, DELETE /routes/:id
    ├── alerts.ts        # POST /alerts, GET /alerts, GET /alerts/:id
    ├── stats.ts         # GET /stats
    └── system.ts        # GET /health, POST /reset, POST /test

Dockerfile               # Multi-stage, node:20-alpine, non-root
package.json             # Exact-pinned deps, `start` + `build` scripts
package-lock.json        # Committed; install with `npm ci`
tsconfig.json            # strict: true, target ES2022, module NodeNext
.dockerignore            # node_modules, specs, docs
```

**Structure Decision**: Single-project layout. `src/routes/*.ts` are thin Fastify handlers that delegate to `store` / `matcher` / `router`. Per NFR-X-007 and SC-X-002, `matcher.ts` and `router.ts` MUST NOT import from `routes/` or from Fastify — verifiable by dependency-graph inspection (grep-based gate in `quickstart.md`).

## Architectural Decisions (locked)

| Area | Decision | NFR tie-in |
|---|---|---|
| HTTP framework | Fastify v4 | NFR-R-001 (setErrorHandler), NFR-S-001 (bodyLimit), NFR-S-002 (URL parser), NFR-S-009 (no `X-Powered-By`) |
| Glob engine | `minimatch` (nobrace, noext, nonegate) | NFR-S-004 (no `new RegExp(user)`) |
| Timezone | `luxon` — `DateTime.fromISO(ts, {setZone: true}).setZone(tz)` | FR-021, SC-005 |
| Dynamic maps | `Map<string,…>` for labels/suppressions; `Object.create(null)` for response header objects | NFR-S-003, SC-S-001 |
| Validation layering | Fastify JSON schema (shape/enum) + `validators.ts` (cross-field) | FR-028…036, NFR-R-005 |
| Stats | Incremental counters on write | NFR-X-003, FR-025a |
| Shutdown | `fastify.close()` on SIGTERM/SIGINT, 5 s drain, exit 0 | NFR-R-003, SC-R-002 |
| Error surface | `setErrorHandler` → `{error: "internal error"}` 500, stack only to logs | NFR-R-001, NFR-S-005 |

### Resiliency (each becomes a task)

- **R1** — Fastify `setErrorHandler` → 500 `{"error":"internal error"}`; no stack leak (NFR-R-001, NFR-S-005).
- **R2** — `process.on('uncaughtException' | 'unhandledRejection')` — log, keep process alive (NFR-R-002).
- **R3** — `SIGTERM`/`SIGINT` → `fastify.close()` with 5 s drain → exit 0 (NFR-R-003, SC-R-002).
- **R4** — Per-request 30 s timeout via `connectionTimeout`/wrapper → 503 on breach (NFR-R-007).
- **R5** — `GET /health` — pure, <50 ms, no state mutation (NFR-R-006).
- **R6** — Validation rejects leave NO partial state — create alert record only after all validators pass (NFR-R-005).

### Security (each becomes a task)

- **S1** — `bodyLimit: 1_048_576` → 413 (NFR-S-001, SC-S-002).
- **S2** — Reject URL+query > 2 KiB → 414/400 (NFR-S-002).
- **S3** — Labels stored in `Map<string,string>`; header objects in `Object.create(null)`; reject own-property `__proto__`/`constructor`/`prototype` keys (NFR-S-003, SC-S-001).
- **S4** — Globs via `minimatch.makeRe(pattern, {nobrace, noext, nonegate})` — never `new RegExp(user)` (NFR-S-004).
- **S5** — Error bodies are stable strings; stack traces logged server-side only (NFR-S-005).
- **S6** — Dockerfile: multi-stage, `node:20-alpine`, `USER node` (UID 1000), `EXPOSE 8080` only, no build tools in final layer (NFR-S-006, SC-S-003).
- **S7** — No secrets baked; env-var list documented in README (NFR-S-007).
- **S8** — `npm ci` only; `package-lock.json` committed (NFR-S-008).
- **S9** — `X-Powered-By` disabled (Fastify default — verify via integration curl) (NFR-S-009).
- **S10** — Logger at `info` omits bodies; debug-level body logging off by default (NFR-S-010).

### Scalability (each becomes a task)

- **X1** — `evaluateAlert()`: single pass over routes (O(R)) → filter → sort matched (O(M log M)). No nested history scans (NFR-X-001).
- **X2** — `GET /alerts` filter: single O(N) pass with AND predicates (NFR-X-002).
- **X3** — `GET /stats`: serialize the already-maintained stats object (NFR-X-003).
- **X4** — Route/alert/suppression lookups via `Map<string, T>` — O(1) (NFR-X-004).
- **X5** — Insertion order preserved in JS `Map` — powers FR-002, FR-005a, FR-006, FR-024 deterministic ordering.
- **X6** — No request-scoped caches; HTTP layer stateless (NFR-X-008).
- **X7** — Module boundary gate: `matcher.ts` / `router.ts` must not import Fastify or `./routes/*` (NFR-X-007, SC-X-002) — grep check in `quickstart.md`.

## Development Workflow — Test-Driven Development

Implementation uses the `test-driven-development` skill's Red → Green → Refactor loop. This is non-negotiable for every kernel and handler task (Phases 2 and 3); scaffolding (Phase 1) is exempt where there is no behaviour to assert.

**Rules**:

1. **Red**: Write a failing test that expresses the next behaviour before writing any production code. For bugs, use the Prove-It pattern — reproduce the failure as a test first.
2. **Green**: Write the minimum production code to make the test pass. No extra behaviour, no speculative generalisation.
3. **Refactor**: Clean up with the full test suite green. Behaviour must not change.
4. **No test bypass**: Do not `.skip`, `.only`, delete, or weaken a test to get green. If a test is wrong, fix the test in its own commit with an explanation.
5. **Commit cadence**: One commit per Red→Green→Refactor cycle, or one per slice when slices are tightly coupled. Never mix a new failing test and its fix with unrelated refactors.
6. **Test layering**:
   - **Unit** (vitest): `validators.ts`, `matcher.ts`, `router.ts`, `store.ts` — pure functions, no Fastify, no I/O. Target: every FR/NFR branch.
   - **Integration** (vitest + `fastify.inject`): each handler in `src/routes/*.ts` — exercises JSON schema + validator + store in-process without a real socket.
   - **Acceptance** (curl/jq per `quickstart.md`): runs against the booted container; mirrors the grader's 70+ assertions.
7. **Coverage targets branches, not lines**: every enum, every condition omission, every suppression/active-hours boundary must have an explicit test. Landmines (suppression window start, `active_hours` end-exclusive, `total_routes_evaluated`, `POST /test` non-persistence) get named tests.
8. **Tooling**: `vitest` (dev-dep, pinned) + `@types/node`. `npm test` runs unit + integration; `npm run test:acceptance` runs the curl suite against a running container.

## Phases

### Phase 0 — Research (parallelisable with Phase 1 scaffolding)

Output: `research.md` — one-paragraph rationale per library choice (Fastify, minimatch, luxon, vitest), plus a note on Fastify JSON-schema limits that motivate `validators.ts`, and judgement calls surfaced for review.

### Phase 1 — Scaffolding (parallel sub-agents, ~15 min)

Three concurrent agents. TDD does not apply to pure scaffolding, but the test harness itself is set up here so Phase 2 can start Red immediately.

1. **Scaffold agent** — `package.json` (pinned, includes `vitest`), `tsconfig.json` (strict), `vitest.config.ts`, `Dockerfile` (multi-stage, non-root, test stage runs `npm test`), `.dockerignore`, lockfile, `src/index.ts` + `src/app.ts` boot with `/health`. One smoke test asserting `GET /health` returns 200 via `fastify.inject`.
2. **Types agent** — `src/types.ts` — all interfaces from `data-model.md`. No logic, no tests (types only).
3. **Validators agent** — TDD: write failing unit tests in `tests/unit/validators.test.ts` for each rule (IANA tz, `HH:MM`, ISO 8601 instant, header value types), then implement `src/validators.ts` + `src/schemas.ts` to green. Every FR-028…036 rule gets at least one positive and one negative test.

### Phase 2 — Kernel (single agent, sequential — tight coupling, ~25 min)

Build in strict TDD order: `store.ts` → `matcher.ts` → `router.ts`. Each function begins with a failing test.

- `store.ts`: tests for `addRoute` / `listRoutes` (insertion order preserved), `deleteRoute` (404-equivalent signal), `upsertAlert` (replace, not duplicate), `listAlerts(filters)` (AND predicates), suppression get/set, `reset()` (every Map cleared).
- `matcher.ts`: tests for each condition axis independently (severity, service-glob, group, labels-subset, active_hours) plus the conjunction; edge cases for empty `conditions: {}` = match-all, omitted field = match-all, `active_hours` start-inclusive / end-exclusive.
- `router.ts`: tests for priority-desc + insertion-order tie-break; `matched_routes` includes losers; suppression keyed by `${routeId}:${service}` and driven by `alert.timestamp` not wall-clock; suppression window starts from first non-suppressed alert; `evaluation_details.total_routes_evaluated` equals store size; dry-run path mutates nothing (store + stats snapshot compared before/after).

### Phase 3 — HTTP handlers (parallel sub-agents, ~20 min)

Four concurrent agents. Each begins with a failing integration test using `fastify.inject` before writing the handler.

1. `routes/routes.ts` — integration tests: POST with missing field → 400 with `{error}`; POST with bad IANA tz → 400; successful POST → 201 + body echo; GET lists in insertion order; DELETE removes.
2. `routes/alerts.ts` — integration tests: POST returns `RoutingResult` with correct winner + `matched_routes`; re-POST same `id` upserts (not duplicates); GET `/alerts` with lenient filters; GET `/alerts/:id` 404 on unknown.
3. `routes/stats.ts` — integration tests: fresh `GET /stats` shape; counters tick only on `POST /alerts`, never on `POST /test`.
4. `routes/system.ts` — integration tests: `/health` <50 ms; `POST /reset` clears all four Maps; `POST /test` — snapshot store+stats, call, assert bit-for-bit identical (SC-006).

### Phase 4 — Verification (~15 min)

1. `npm test` — all unit + integration tests green, no `.skip` / `.only`.
2. Run `quickstart.md` curl/jq sequence inside a booted container. Focus on landmines: suppression expiry across window, `active_hours` boundaries (inclusive start, exclusive end), `evaluation_details.total_routes_evaluated` equals store size, `POST /test` leaves state bit-for-bit identical (SC-006).
3. Any acceptance failure → write a failing unit/integration test that reproduces it, fix, re-run both suites.

### Parallel background track — Kotlin/GCP design doc

Runs as a separate sub-agent from Phase 1 onward. Output: `docs/kotlin-gcp-design.md` — Cloud Run + HTTP/2 autoscale, Firestore vs Spanner (decision + rationale), Pub/Sub async ingestion, Cloud Scheduler helpers for active_hours, Memorystore (Redis) for suppression at scale, IAM + Secret Manager for auth/secrets, inverted-index route catalogue (>10k routes). Design-only; no code.

## Complexity Tracking

No constitution gates to violate. Deliberate-choice call-outs live in `research.md` (Fastify vs raw http, minimatch vs hand-rolled glob, luxon vs Intl, Firestore vs Spanner).
