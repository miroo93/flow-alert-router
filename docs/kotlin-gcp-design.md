# Kotlin + GCP Production Design — Configurable Alert Routing Engine

**Companion to**: TypeScript/Node.js submission at repo root.
**Purpose**: Design-only. Describes the production-scale equivalent on the hiring company's stack. No implementation code.
**Authoritative spec**: `specs/001-alert-router-engine/spec.md`. All semantics (severity/service-glob/group/labels matching, priority ties by insertion order, suppression windows keyed by `(route_id, service)`, IANA-timezone `active_hours`, `POST /test` dry-run isolation, upsert-by-alert-id, `POST /reset` full-clear) are preserved verbatim; only the substrate changes.

---

## 1. System Overview

```
                         ┌──────────────────────┐
                         │  Operators / CI      │
                         │  (routes CRUD, stats)│
                         └──────────┬───────────┘
                                    │  HTTPS (ID token)
                                    ▼
   Alert producers ──► Pub/Sub ──► Push sub ──► ┌──────────────────────────┐
   (prod services)    (topic:     (OIDC-signed)│  Cloud Run service       │
                      alerts.in)               │  Kotlin + Ktor           │
                                               │  HTTP/2, concurrency=80  │
                                               │  min=1, max=50 instances │
                                               │  stateless pods          │
                                               └──────┬────────┬──────────┘
                                                      │        │
                                          ┌───────────┘        └──────────┐
                                          ▼                                ▼
                                   ┌──────────────┐                ┌────────────────┐
                                   │ Firestore    │                │ Memorystore    │
                                   │ (Native)     │                │ (Redis)        │
                                   │ routes/      │                │ suppressions   │
                                   │ alerts/      │                │  TTL per key   │
                                   └──────┬───────┘                └────────────────┘
                                          │
                                          ▼
                                   ┌──────────────┐
                                   │ Secret Mgr   │  → webhook / PD keys
                                   │ Cloud Logging│  → structured JSON
                                   │ Cloud Trace  │  → per-request spans
                                   │ Cloud Mon    │  → SLOs + alerts
                                   └──────────────┘
```

The service is a stateless Kotlin HTTP server on **Cloud Run**, fronted by HTTPS with ID-token authentication for admin endpoints and OIDC-signed Pub/Sub push for ingestion. Pods scale on concurrent-request count; every request is pure-function-plus-IO against externalised state (Firestore for durable records, Redis for short-lived suppression windows). Nothing lives in pod memory beyond request lifetime, so any replica can serve any request.

**Framework choice: Ktor** over Spring WebFlux. Justification: (a) Ktor cold-starts in ~500ms vs Spring's 2–4s, which matters for Cloud Run scale-from-zero; (b) Ktor's coroutine-native request model is a better fit for non-blocking Firestore/Redis calls than WebFlux's reactor-types, which tend to leak into the domain layer; (c) the service has a narrow HTTP surface (9 endpoints) — we do not need Spring's DI/AOP/config weight. WebFlux would be preferable only if the organisation standardises on Spring Boot; noted as a swap-in with no impact on the design below.

---

## 2. Data Store — Firestore vs Spanner

| Dimension | Firestore (Native) | Spanner |
|---|---|---|
| Model | Document (JSON-shaped) | Relational SQL with strong schema |
| Consistency | Strong at document, eventual across collections | Strong, global (external consistency) |
| Scale floor cost | Pay-per-op; ~$0 at idle | ~$650/mo floor (1 node minimum) |
| Scale ceiling | ~10k sustained writes/s per DB | Horizontal: add nodes linearly |
| Indexing | Single-field auto; composite via index config; no substring/glob indexes | Real secondary indexes; interleaved tables |
| Query fit for "scan catalogue per alert" | Catalogue cached in-process + watched via Firestore listener — fine up to ~10k routes | Indexed lookup by `severity`, `group`, label-keys — fine at 100k+ routes |
| Document shape fit | Native: Route/Alert are JSON | Requires flattening or JSON column (loses indexability) |
| Ops burden | Managed, zero tuning | Managed but needs schema design, index tuning |
| TTL | Native per-field TTL | Requires scheduled delete job |
| Local emulator | Yes (firestore-emulator) | Limited |

**Recommendation**: **Firestore for the first production deployment**. Targets:
- Route catalogue < 10k routes
- Alert ingestion < 5k QPS sustained (Cloud Run + Firestore can handle this with standard indexes)

**Migration trigger**: move the **route catalogue** (not alerts) to Spanner when either threshold is exceeded. Alerts collection stays in Firestore regardless, with **TTL-based expiration** on the `timestamp` field (e.g. 90-day retention) to keep storage bounded. The alerts collection is append-only-then-TTL — a bad fit for Spanner's row-lifecycle model, a good fit for Firestore's.

**Collection layout (Firestore)**:

| Collection | Doc ID | Fields | Notes |
|---|---|---|---|
| `routes` | `route.id` | full Route JSON, `insertion_order` (server-timestamp int) | Watched by Cloud Run pods for catalogue cache |
| `alerts` | `alert.id` | full Alert + RoutingResult JSON, `submission_ts` for ordering | TTL on `submission_ts + 90d` |
| `stats_daily` | `YYYY-MM-DD` | counters by severity/service/route | Rolled up hourly; live `GET /stats` fan-reads current-day + cached prior |

Note: the spec requires `GET /stats` to be O(1). With Firestore, that is achieved by keeping a **running stats document** (`stats/global`) updated transactionally on each alert write. `stats_daily` is a separate analytical rollup.

**Spanner schema (migration path)**:

```
Table routes (
  route_id STRING(64) PRIMARY KEY,
  priority INT64 NOT NULL,
  insertion_seq INT64 NOT NULL,  -- tie-break, monotonic
  config_json JSON NOT NULL,
  severity_set ARRAY<STRING>,    -- materialised for index
  group_set ARRAY<STRING>,
  label_keys ARRAY<STRING>       -- keys only, for index intersection
);
Index routes_by_severity ON routes (severity_set) STORING (priority, insertion_seq);
Index routes_by_group    ON routes (group_set)    STORING (priority, insertion_seq);
Index routes_by_labelkey ON routes (label_keys)   STORING (priority, insertion_seq);
```

---

## 3. Async Ingestion — Pub/Sub

```
producer ──► Topic: alerts.ingest
                │
                ├──► Push subscription: alerts.to-router
                │      → Cloud Run /alerts (OIDC-authenticated)
                │      → ack deadline 30s, exp backoff retry
                │
                └──► DLQ topic: alerts.deadletter (after 5 failed deliveries)
                       → alerting fires; stored for forensic inspection
```

**Design points**:

| Concern | Choice | Rationale |
|---|---|---|
| Delivery semantics | At-least-once | Standard Pub/Sub guarantee; duplicates handled by FR-007 upsert-by-id |
| Idempotency key | `alert.id` | Spec already mandates upsert; re-delivery is naturally safe |
| Ordering | Not required | Routing is a function of `(alert, routes, suppression_state)`; reorders are fine |
| Message size | 10MB cap (Pub/Sub), but we reject at 1MB (NFR-S-001) | Enforced in handler before Firestore write |
| Auth | OIDC-signed push with audience = Cloud Run URL | Only Pub/Sub can invoke the ingest endpoint |
| DLQ policy | After 5 failed deliveries → `alerts.deadletter` | Validation failures and persistent Firestore errors land here |
| DLQ alerting | Cloud Monitoring alert on DLQ message count > 0 | On-call is paged |

**Synchronous vs async ingestion**: the spec's `POST /alerts` is synchronous and must return the routing decision. We expose **both** paths:
- **Sync HTTPS** `POST /alerts`: for operator / dry-run workflows that need the decision in the response.
- **Async Pub/Sub push** → same handler: for high-volume producers that fire-and-forget. The decision is still written to Firestore; producers can optionally subscribe to a `routing-decisions` topic if they need the result.

Both paths funnel into the same handler, so matching/suppression/stats logic is shared — there is no drift between sync and async processing.

---

## 4. Suppression State at Scale — Memorystore (Redis)

Suppression records are **short-lived, hot, and write-heavy**. Firestore is wrong for them (latency, cost per op). Use **Memorystore for Redis** (Standard tier, HA).

**Key schema**:

```
Key:    suppress:{route_id}:{service}
Value:  {first_alert_ts, expires_at_iso, alert_id}  (hash)
TTL:    suppression_window_seconds (set on creation; never extended)
```

**Write path (claim window)**:

```
1. MULTI
2.   HGET suppress:{rid}:{svc} expires_at
3.   (if unset or past alert.timestamp → SET new record with EX=window_sec)
4. EXEC
```

Implementation uses **SET NX EX** semantics on a guard key to make claim-window atomic — no read-modify-write race across pods. The guard key and the hash are in the same Redis slot (same `{rid}:{svc}` hash tag) so the transaction is local.

**Read path (check suppression on subsequent alert)**: single `HGET` + timestamp comparison. Sub-ms.

**Critical nuance — alert-timestamp-driven, not wall-clock**: Redis native TTL is wall-clock. The spec (FR-016) mandates suppression is keyed off `alert.timestamp`. We therefore:
- Store `expires_at_iso` in the hash value (authoritative).
- Set the **Redis TTL** to `suppression_window_seconds + small buffer` so the key is auto-cleaned, but **the decision to suppress is made by comparing `alert.timestamp` to `expires_at_iso` in the record**, not by the key's existence. If an alert arrives with `timestamp > expires_at`, we overwrite with a new window (FR-017).
- This handles historical-timestamp test scenarios (grading script injects past timestamps) correctly.

**Failure handling**:

| Scenario | Behaviour | Rationale |
|---|---|---|
| Redis connection timeout | Log + degrade to no-suppression; route alert normally | Availability > strict suppression (a double-page is better than a dropped page) |
| Redis returns stale data | Overwrite on next claim | TTL auto-repairs within window |
| HA failover mid-write | Retry once with jitter | Memorystore Standard has replica failover; writes are idempotent |
| Memorystore region down | Circuit-break suppression checks for 30s, degrade-open | Ingestion stays up |

**Sizing**: at 5k QPS, ~500k active suppression keys (TTL ≤ 1 hour typical). Standard-tier 1GB instance is ~5M keys headroom. Start at 1GB.

---

## 5. Active-Hours Evaluation Helpers — Cloud Scheduler

Active-hours evaluation is a pure function of `(alert.timestamp, route.active_hours, route.timezone)` — no scheduler needed on the hot path. Cloud Scheduler is used for **supporting jobs**, not request-time evaluation:

| Job | Schedule | Purpose |
|---|---|---|
| `route-health-audit` | Daily 03:00 UTC | Scan all routes; for each with `active_hours`, compute whether the window ever opens in a 24h span in its own tz. Emit warnings for routes where `start == end` or tz is valid but window is empty (common config error). |
| `stale-suppression-sweep` | Every 15 min | Scan for Redis keys with expired `expires_at_iso` but still-live TTL (should be rare; belt-and-braces cleanup). |
| `stats-daily-rollup` | Hourly, delayed 10min | Compute `stats_daily/YYYY-MM-DD` document from in-day deltas — enables cheaper historical queries without re-aggregating live counters. |
| `active-routes-mv-refresh` (optional) | Every 5 min | If per-request active-hours evaluation becomes a measurable hotspot (profiling shows it in p99), materialise a "currently active route ids" set per tz into Redis. Hot-path then skips TZ math for most routes. Not enabled by default — premature optimisation. |

All jobs invoke Cloud Run endpoints via OIDC; service-account least-privilege enforced.

---

## 6. Route Catalogue Indexing for >10k Routes

At >10k routes, linear catalogue scan per alert (O(R)) becomes a cost driver. Introduce **inverted indexes**, computed in-memory per pod, refreshed from Firestore via a real-time listener.

**Indexes**:

| Index | Shape | Purpose |
|---|---|---|
| `index_by_severity` | `Map<severity, Set<route_id>>` | Candidate filter by alert.severity |
| `index_by_group` | `Map<group, Set<route_id>>` | Candidate filter by alert.group |
| `index_by_label_key` | `Map<label_key, Set<route_id>>` | Candidate filter by label *keys* present on the alert |
| `routes_by_service_exact` | `Map<service, Set<route_id>>` | O(1) lookup for exact service conditions |
| `routes_with_service_glob` | `List<(glob_pattern, route_id)>` | Linear scan (small list) for glob service conditions |
| `routes_no_conditions` | `Set<route_id>` | `conditions: {}` — always match |

**Evaluation algorithm (>10k route path)**:

```
1. candidates := routes_no_conditions
2. candidates ∪= index_by_severity[alert.severity]     (if alert has severity)
3. candidates ∪= index_by_group[alert.group]           (if alert has group)
4. for each label_key in alert.labels:
     candidates ∪= index_by_label_key[label_key]
5. candidates ∪= routes_by_service_exact[alert.service]
6. for each (pattern, route_id) in routes_with_service_glob:
     if glob_match(pattern, alert.service): candidates.add(route_id)
7. For each candidate: run full condition check (subset verification, value equality, active_hours, priority tie-break).
8. Sort matched by priority desc, insertion_order asc.
```

**Key insight**: the indexes produce a **candidate superset**, not a confirmed match. Full condition verification still runs on candidates because:
- `index_by_label_key` indexes keys, not key-value pairs. Value equality is checked in step 7.
- A route with `conditions.severity: [critical, warning]` appears in both severity buckets; step 7 confirms membership.
- This trades index size (keys only) for exact-match correctness.

**Service glob handling — recommendation (a)**: keep exact services in a hash map and glob patterns in a small separate list scanned linearly. Rationale:
- In real catalogues, >90% of service conditions are exact or use a single prefix glob like `payment-*`.
- A full trie is more code, more memory, and more test surface for marginal benefit.
- The glob list is typically O(hundreds) even in a 10k-route catalogue; linear scan is sub-ms.
- Option (b) — normalising glob prefixes/suffixes into a trie — becomes worthwhile only if profiling shows the glob list exceeds ~5k patterns. Revisit then.

**Index freshness**: each Cloud Run pod subscribes to a Firestore `onSnapshot` listener on `routes/`. Index rebuild on change is O(R), done off-request-path. Routes CRUD is low-frequency (ops action) so this is cheap. Cold-start: initial catalogue fetch + index build. A 10k-route catalogue builds in < 500ms.

**Why per-pod in-memory, not Redis-backed**: the full catalogue fits in pod memory (~10MB per 10k routes). Loading from Redis on every request adds 1–2ms per lookup + network cost. In-memory + listener-based invalidation is faster and cheaper.

---

## 7. IAM + Secret Manager

**Service account**: `alert-router@{project}.iam.gserviceaccount.com`. One SA per environment (dev/staging/prod). Least-privilege roles:

| Role | Why |
|---|---|
| `roles/datastore.user` | Firestore read/write on `routes/`, `alerts/`, `stats/` |
| `roles/pubsub.subscriber` | Ack/nack pushed messages (push auth) |
| `roles/secretmanager.secretAccessor` | Read webhook keys, PD service keys |
| `roles/redis.editor` | Memorystore client access |
| `roles/cloudtrace.agent` | Emit trace spans |
| `roles/logging.logWriter` | Structured logs |
| `roles/monitoring.metricWriter` | Custom metrics |

**What the SA does NOT have**: `roles/datastore.owner`, `roles/iam.*`, any cross-project access. No human accounts have production write access to Firestore — changes go through the service API.

**Secrets** (Secret Manager, versioned):

| Secret | Consumer | Mount |
|---|---|---|
| `webhook-default-auth-header` | webhook dispatcher | env var |
| `pagerduty-service-keys` (keyed by route target config) | PD dispatcher | env var, loaded on cold start |
| `internal-admin-api-shared-token` (bootstrap only; prefer ID-token auth) | admin endpoints | env var |

**Rotation**: Secret Manager versions are immutable; new version → pod restart triggered via `gcloud run services update --update-secrets`. Rolling restart, no downtime.

**Auth boundaries**:

| Caller | Method |
|---|---|
| Pub/Sub push | OIDC-signed tokens, audience = service URL |
| Internal admin (operators via CLI/dashboard) | ID-token auth; operator's user identity checked via IAM |
| External alert producers | Pub/Sub publish role; never direct HTTP to Cloud Run |
| Cloud Scheduler | OIDC-signed tokens, per-job SA |

**What never logs**: webhook headers, target URLs (if they contain secrets), PD service keys, request bodies beyond alert.id/severity/service. See §8.

---

## 8. Observability

**Logging — Cloud Logging**:

| Level | Content | Example |
|---|---|---|
| `info` | request line, alert id, route id, outcome, latency | `{"ev":"alerts.post","alert_id":"a-1","routed_to":"r-2","suppressed":false,"dur_ms":12}` |
| `warn` | validation failures, Redis timeouts, DLQ events | `{"ev":"redis.timeout","route":"r-2","degraded":"no-suppression"}` |
| `error` | 5xx, unhandled exceptions (caught at top level), Firestore write failures | stack trace server-side only |
| `debug` (off by default) | full request body, full route config | never enabled in prod |

All logs structured JSON. Request bodies never logged at info. `labels` field contents never logged (may contain sensitive ids). `webhook.headers` never logged.

**Metrics — Cloud Monitoring SLOs**:

| SLO | Target | Alert threshold |
|---|---|---|
| Alert-evaluation latency p95 | < 100ms | p95 > 200ms for 10min → page |
| Alert-evaluation latency p99 | < 500ms | p99 > 1s for 10min → page |
| Routing error rate (5xx) | < 0.1% | > 1% for 5min → page |
| Firestore write success | > 99.9% | < 99% for 5min → page |
| Redis availability | > 99.9% | degraded-mode duration > 5min → page |
| DLQ non-empty | 0 messages | > 0 for 2min → page |

**Custom metrics**:
- `alert_router/routes_matched_per_alert` (histogram) — detects runaway route-set sizes.
- `alert_router/suppression_hit_ratio` — sanity check on suppression config.
- `alert_router/catalogue_size` (gauge) — trips the Firestore→Spanner migration threshold alarm at 10k.

**Tracing — Cloud Trace**: per-request spans: `ingest` → `validate` → `load_routes` → `match` → `suppression_check` → `persist` → `dispatch`. Each span tagged with `alert.id`, `route.id` (if routed), `pod.instance`. p99 slow spans trigger automatic investigation.

**Error Reporting**: uncaught exceptions with stack traces surfaced in Cloud Error Reporting; aggregated by stack-trace hash. On-call gets notified when a new unique exception appears.

**Audit logging**: Cloud Audit Logs on Firestore captures every route CRUD (who, when, what). Supports post-incident forensics. Alerts collection is not audit-logged (high volume, low forensic value).

---

## 9. Migration Path from the TypeScript Submission

The TS submission's module boundaries (NFR-X-007) are the migration substrate. Mapping:

| TS module | TS data structure | GCP equivalent | Interface change |
|---|---|---|---|
| `store.ts` — `routes: Map<string, Route>` | In-memory map | Firestore `routes/` + in-pod cache from listener | `get(id)`, `put(id, route)`, `delete(id)`, `list()` unchanged — all become async |
| `store.ts` — `alerts: Map<string, RoutingResult>` | In-memory map | Firestore `alerts/` | Same; `list(filters)` translates filter object to Firestore query |
| `store.ts` — `suppressions: Map<string, SuppressionRecord>` | In-memory map | Redis keys `suppress:{rid}:{svc}` | Atomic SET NX EX replaces unchecked write |
| `store.ts` — `stats: Stats` | Single mutable object | Firestore `stats/global` with transactional increments | Per-op atomic increment; O(1) read preserved |
| `matcher.ts` | Pure functions | **Unchanged** — runs inside Cloud Run pod | Zero change |
| `router.ts` | Pure functions | **Unchanged** | Zero change |
| `routes/*.ts` (HTTP) | Express handlers | Ktor handlers | New implementation; same request/response contract |

**Key property**: matcher.ts and router.ts have **zero** dependencies on storage or transport. They take `(alert, routes[], current_suppression)` and return a `RoutingResult`. Swapping the store is a single-module change — a direct validation that NFR-X-007 and SC-X-002 (the "no import from matcher into HTTP layer" check) were not just paperwork.

**Migration steps** (if re-implementing in Kotlin):

1. Port matcher + router pure functions to Kotlin verbatim (they are ~300 lines of pure logic).
2. Implement Kotlin `Store` interface with the same method surface as TS `store.ts`.
3. Implement Firestore-backed + Redis-backed Store. All Store methods become `suspend` functions.
4. Wire Ktor HTTP layer to the Store + pure-function layer.
5. Shared contract tests: run the grading script's 14 sections against both the TS container and the Kotlin Cloud Run service. Byte-for-byte identical responses prove semantic equivalence.

**Shared test harness**: the curl/jq grading script is the oracle. It works against any HTTP service on port 8080 — Cloud Run can be port-forwarded locally for direct assertion parity.

---

## 10. What the TS Submission Intentionally Omits

Each line: omitted concern → GCP component that addresses it in this design.

| Concern | TS submission | GCP equivalent |
|---|---|---|
| Authentication / authorization | None (loopback HTTP) | Cloud Run ID-token auth for admin, OIDC push for Pub/Sub — §7 |
| TLS termination | None (HTTP only) | Google Front End terminates TLS; Cloud Run enforces HTTPS — §1 |
| Replication / HA | Single process | Cloud Run multi-instance autoscale; Memorystore HA tier; Firestore multi-region — §1, §4 |
| Durable persistence | In-memory; lost on restart | Firestore for routes + alerts + stats; Redis is ephemeral but authoritative only for active windows — §2, §4 |
| Horizontal scale | Single-core, single-pod | Cloud Run concurrency-based autoscale; Firestore and Redis both scale independently — §1, §3 |
| Per-tenant isolation | Single-tenant | Not in this design either (single tenant per deployment); would add `tenant_id` column + IAM-scoped collections. Out of scope for first prod rollout. |
| Rate limiting | None | Cloud Armor at the LB layer; per-caller quota via API Gateway if admin API is exposed publicly — not in §1 diagram; add if needed |
| Route catalogue indexing (>10k routes) | Linear O(R) scan | Inverted indexes per pod, Firestore listener for invalidation — §6 |
| Secret management | None required | Secret Manager with mounted env vars — §7 |
| Observability beyond stdout | Console logs only | Cloud Logging + Monitoring + Trace + Error Reporting — §8 |
| Async ingestion | Synchronous HTTP only | Pub/Sub topic + push subscription + DLQ — §3 |
| Graceful handling of infra outages | N/A | Circuit-break suppression on Redis outage; Firestore retry with backoff — §4 |

---

## Appendix A — Decision Summary

| Decision | Choice | Alternative considered | Rejected because |
|---|---|---|---|
| HTTP framework | Ktor | Spring WebFlux | Cold-start cost; coroutine fit |
| Primary data store | Firestore | Spanner, CloudSQL/Postgres | Cost floor, document fit, TTL |
| Suppression store | Memorystore Redis | Firestore, in-pod cache | Latency, cross-pod coherence |
| Async ingestion | Pub/Sub push | Pub/Sub pull, Cloud Tasks | Cloud Run fits push model natively; DLQ first-class |
| Compute | Cloud Run | GKE, GAE Standard | Scale-to-zero, managed infra, HTTP/2 |
| Route indexing (>10k) | In-pod inverted index + Firestore listener | Redis-backed shared index, BigQuery | Per-request latency |
| Service globs | Exact map + linear glob list | Trie of glob patterns | Simplicity; expected glob count low |
| Secrets | Secret Manager | Env vars from CI, Vault | Integrated IAM, rotation |
| Observability | Cloud Logging + Monitoring + Trace | 3rd party (Datadog/Honeycomb) | GCP-native integration; no extra vendor |

## Appendix B — Scaling Thresholds

| Threshold | Action |
|---|---|
| Routes > 10k | Enable inverted indexes (§6); evaluate route catalogue → Spanner migration |
| Sustained alert QPS > 5k | Verify Firestore write quota; partition stats document to avoid contention hotspot |
| Suppression active keys > 1M | Upsize Memorystore to next tier |
| DLQ messages > 0 | Page on-call; inspect payloads for malformed inputs or missing validation |
| p95 evaluation latency > 100ms | Profile; likely candidate: glob pattern list growth → revisit option (b) trie |
| Cold-start count high (scale-from-zero storms) | Raise Cloud Run `min-instances` to 2–3 for prod |

## Appendix C — What Changes if the Route Catalogue Moves to Spanner

Only the `Store.listRoutes()` and `Store.getRoute(id)` implementations change. The inverted-index layer becomes optional (Spanner's real indexes do the equivalent work). matcher and router are untouched. Alerts stay in Firestore. Stats stay in Firestore. Suppressions stay in Redis. This confirms the module boundary is at `Store`, not deeper.
