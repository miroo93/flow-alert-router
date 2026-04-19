# Flow Alert Router

Configurable alert routing engine delivered as a single Dockerized HTTP service on port 8080. Ingests monitoring alerts, evaluates them against user-defined routing rules (severity / service globs / group / labels, with priority, suppression windows, and active-hours gating), and returns deterministic routing decisions. In-memory state only; `POST /reset` clears everything.

Built as an AI-assisted take-home exercise — see [AI-assisted Take-Home Exercise - Candidate Instructions.md](AI-assisted%20Take-Home%20Exercise%20-%20Candidate%20Instructions.md) for the authoritative requirements.

## Stack

- **TypeScript 5.x** on **Node.js 20 LTS**
- **Fastify v4** (HTTP + JSON Schema body validation)
- **minimatch** (service globbing — `*` wildcard only)
- **luxon** (IANA-timezone conversion for `active_hours`)
- **Docker** (single `node:20-alpine` container, non-root UID)

No database. State lives in `Map<string, T>` inside one process.

## Run It

The container must accept connections on `http://localhost:8080` within 10 seconds (SC-002).

```bash
docker build -t alert-router .
docker run --rm -p 8080:8080 alert-router

# Liveness
curl -s http://localhost:8080/health
# → {"status":"ok"}
```

For full smoke-test scripts covering the known landmines (suppression expiry, active-hours boundary, `evaluation_details` counts, `POST /test` isolation, tie-break determinism, validation, oversized-body/prototype-pollution resiliency), see [specs/001-alert-router-engine/quickstart.md](specs/001-alert-router-engine/quickstart.md).

## API Surface

9 endpoints — full per-endpoint request/response schemas in [specs/001-alert-router-engine/contracts/api.md](specs/001-alert-router-engine/contracts/api.md):

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/health` | Liveness |
| `POST` | `/reset` | Clear all in-memory state |
| `POST` | `/routes` | Upsert a route (201 + `created: true\|false`) |
| `GET`  | `/routes` | List all routes |
| `DELETE` | `/routes/:id` | Delete a route |
| `POST` | `/alerts` | Submit an alert; evaluate and persist the decision |
| `GET`  | `/alerts` / `/alerts/:id` | Read persisted decisions |
| `POST` | `/test` | **Dry-run** evaluate — no persistence, no stats, no suppression mutation |
| `GET`  | `/stats` | O(1) read of incrementally-maintained counters |

## Spec-Driven Development

This repo uses the Spec Kit workflow. All feature artifacts live under `specs/001-alert-router-engine/`:

- [spec.md](specs/001-alert-router-engine/spec.md) — user stories, functional requirements, success criteria (authoritative)
- [plan.md](specs/001-alert-router-engine/plan.md) — tech stack, module layout, phases
- [data-model.md](specs/001-alert-router-engine/data-model.md) — TypeScript interfaces for `Route`, `Alert`, `RoutingResult`, `SuppressionRecord`, `Stats`, `InMemoryStore`
- [research.md](specs/001-alert-router-engine/research.md) — library rationale and judgement calls
- [quickstart.md](specs/001-alert-router-engine/quickstart.md) — docker build/run + curl smoke tests
- [contracts/api.md](specs/001-alert-router-engine/contracts/api.md) — per-endpoint request/response schemas
- [checklists/requirements.md](specs/001-alert-router-engine/checklists/requirements.md), [checklists/quality.md](specs/001-alert-router-engine/checklists/quality.md) — review gates

Workflow template and Spec Kit config live under [.specify/](.specify/). See [CLAUDE.md](CLAUDE.md) for Claude Code guidance and the architectural invariants that must hold to pass the grading suite.

## Architectural Invariants

These are contract-level — violating any of them fails the automated test suite. Summarised here, fully enumerated in [CLAUDE.md](CLAUDE.md#architectural-invariants):

- Port 8080, in-memory only; `POST /reset` clears everything.
- Alert IDs are **upserted** — re-submitting the same id replaces the prior result.
- Priority ties: highest-priority match wins; **all** matching routes appear in `matched_routes`. Ties broken by insertion order.
- Suppression windows are driven by `alert.timestamp`, **not wall-clock**. Key: `${routeId}:${service}`. Window starts from the first non-suppressed alert.
- Active hours use IANA timezones; boundary is **start-inclusive, end-exclusive**.
- Glob matching: `*` wildcard only, applied to `service` conditions. No full regex.
- `labels` is a subset check; omitted condition field = match all; empty `conditions: {}` = match all alerts.
- `POST /test` is a **dry run** — no persist, no suppression mutation, no stats.
- `evaluation_details.total_routes_evaluated` = store size, not match count.
- Validation returns 400 with `{"error": "..."}` for malformed inputs (severity, IANA tz, ISO 8601, HH:MM, non-integer priority, negative suppression window, …).

## Module Boundaries

`src/matcher.ts`, `src/router.ts`, `src/store.ts` carry **zero HTTP concerns** (NFR-X-007) — the engine is portable to a different transport or store. A grep gate enforces this:

```bash
grep -E "from '(fastify|\./routes)" src/matcher.ts src/router.ts && echo "VIOLATION" || echo "OK"
```

## Known limitations

Deferred hardening items documented for production migration (exercise scope is loopback-only).

- **Per-request timeout covers async handlers only.** The 30 s budget (NFR-R-007) races the response against a timer; a synchronous CPU-bound handler cannot be interrupted on Node's single-threaded event loop. Proper preemption requires offloading to a worker-thread pool — deferred as a production-hardening task.
- **Connection timeout** is set at the Fastify level (`connectionTimeout: 30_000`) as socket-level belt-and-braces.
- **Unbounded alert history.** Alerts accumulate in an in-memory `Map` with no eviction policy (NFR-X-010). Add a TTL or bounded-cache strategy before production.
- **Single-process, in-memory state.** All state is lost on restart; no replication, no persistence. The exercise spec requires this; production would move routes to durable storage (see the Kotlin/GCP design doc).
- **No auth/TLS.** Loopback-only per exercise scope; expose behind a reverse proxy with IAM/mTLS before any external deployment.
- **Logger omits bodies by default.** Pino is configured with default serializers — request/response bodies are never logged (verified by the `canary-xyz-7f3b` regression test, T035). If body-level debug logging is ever re-enabled, explicit `redact` paths for `alert.labels`, `route.target.headers`, etc. must be added first.

## Companion Design Doc — Kotlin + GCP

The hiring company's production stack is **Kotlin + GCP**. [docs/kotlin-gcp-design.md](docs/kotlin-gcp-design.md) is a design-only (no implementation) deliverable describing what the equivalent system looks like on that substrate, preserving all semantics of the TypeScript submission.

**TL;DR**:

- **Compute**: Stateless **Kotlin + Ktor** on **Cloud Run** (HTTP/2, concurrency=80, min=1/max=50 instances). Ktor chosen over Spring WebFlux for ~500ms cold start and coroutine-native I/O.
- **Ingestion**: Alert producers publish to **Pub/Sub** (`alerts.in`); Cloud Run receives via OIDC-signed push subscription. Operators call admin endpoints over HTTPS with ID-token auth.
- **Durable state**: **Firestore (Native)** — `routes/`, `alerts/` (90-day TTL), running `stats/global` document updated transactionally for O(1) `GET /stats`. Spanner reserved as a migration target for the **route catalogue only** past ~10k routes.
- **Suppression windows**: **Memorystore (Redis)** with per-key TTL on `${routeId}:${service}`. Short-lived, not durable — right fit for Redis, wrong fit for Firestore.
- **Route catalogue caching**: Firestore listener pushes catalogue changes to every pod's in-process cache, so per-alert evaluation stays in-memory with no read-path Firestore hit.
- **Secrets & observability**: Secret Manager for webhook/PagerDuty keys; Cloud Logging (structured JSON), Cloud Trace (per-request spans), Cloud Monitoring (SLOs + alerts).
- **Module boundary holds**: only `Store.listRoutes()`/`getRoute(id)` change if the catalogue ever moves to Spanner — matcher, router, and stats are untouched.

Full design, scaling thresholds, and alternatives-considered matrix: [docs/kotlin-gcp-design.md](docs/kotlin-gcp-design.md).
