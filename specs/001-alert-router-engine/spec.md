# Feature Specification: Configurable Alert Routing Engine

**Feature Branch**: `001-alert-router-engine`
**Created**: 2026-04-19
**Status**: Draft
**Input**: User description: "Backend service that ingests monitoring alerts via a REST API, evaluates them against user-defined routing rules, and produces routed notification outputs. Single Docker container on port 8080, in-memory state. Evaluated by a 70+ assertion automated curl/jq test suite across 14 sections."

## User Scenarios & Testing *(mandatory)*
/s
### User Story 1 - Manage Routing Configurations (Priority: P1)

An operator registers, updates, lists, and removes routing rules that describe how incoming alerts should be dispatched. Each rule specifies the matching criteria (severity, service, group, labels), the notification target, and a priority used to break ties when multiple rules match.

**Why this priority**: No routing decisions are possible without routes. This is the foundational CRUD capability and the first thing the automated test suite exercises.

**Independent Test**: Submit routes via `POST /routes`, list them via `GET /routes`, replace one by re-posting the same `id`, delete one via `DELETE /routes/{id}`, and request a non-existent route to verify the 404 response. All without needing alerts or any other subsystem.

**Acceptance Scenarios**:

1. **Given** no routes exist, **When** the operator posts a valid route with `id: "route-1"`, **Then** the response is 201 with `{"id": "route-1", "created": true}` and subsequent `GET /routes` includes that route.
2. **Given** `route-1` already exists, **When** the operator posts another route with the same `id`, **Then** the prior route is replaced and the response is `{"id": "route-1", "created": false}`.
3. **Given** `route-1` exists, **When** the operator issues `DELETE /routes/route-1`, **Then** the response is `{"id": "route-1", "deleted": true}` and the route no longer appears in `GET /routes`.
4. **Given** no route named `route-999` exists, **When** the operator issues `DELETE /routes/route-999`, **Then** the response status is 404 with `{"error": "route not found"}`.
5. **Given** multiple routes exist, **When** the operator issues `GET /routes`, **Then** the response body is `{"routes": [...]}` containing all stored routes.

---

### User Story 2 - Submit Alerts and Receive Deterministic Routing Decisions (Priority: P1)

An alert producer posts a monitoring event. The system evaluates every stored route against the alert, records the result, and returns a deterministic routing decision that names the winning route (if any), lists every route that matched, and includes evaluation counts.

**Why this priority**: This is the core value of the system. Without it, the service does nothing useful. Routing correctness is the largest single chunk of the automated test suite.

**Independent Test**: After creating a single route, post an alert that matches and verify `routed_to` names that route; post an alert that does not match and verify `routed_to` is null and `matched_routes` is empty. Then add a second, higher-priority matching route and verify the higher priority wins while both ids appear in `matched_routes`.

**Acceptance Scenarios**:

1. **Given** one route exists that matches `severity: critical`, **When** the operator posts a critical alert, **Then** the response includes `routed_to.route_id` equal to that route, `suppressed: false`, and `evaluation_details.routes_matched: 1`.
2. **Given** three routes exist and all three match the alert, **When** the alert is posted, **Then** the winning `routed_to.route_id` is the one with the highest `priority`, and `matched_routes` lists all three ids.
3. **Given** no routes match, **When** an alert is posted, **Then** `routed_to` is null, `matched_routes` is empty, and `evaluation_details.routes_not_matched` equals the total number of routes.
4. **Given** an alert with `id: "alert-123"` has already been submitted, **When** another alert with the same id is posted, **Then** the stored record is updated in place and `GET /alerts/alert-123` reflects the latest submission (no duplicates created).
5. **Given** a route with empty `conditions: {}` exists, **When** any alert is posted, **Then** the route matches that alert.

---

### User Story 3 - Match on Severity, Service Globs, Group, and Labels (Priority: P1)

Routing rules filter alerts using a combination of severity lists, service name patterns (with `*` wildcard globbing), group lists, and label-equality checks. All specified conditions must match; omitted condition fields impose no restriction.

**Why this priority**: This is the heart of routing correctness and is tested by several dedicated test sections (Basic routing, Label matching, Glob matching, Omitted conditions). P1 because the system is useless if matching is wrong.

**Independent Test**: Create routes using each condition type in isolation and verify match/no-match behaviour against crafted alerts; then combine conditions on a single route and verify AND semantics across conditions.

**Acceptance Scenarios**:

1. **Given** a route with `conditions.severity: ["critical", "warning"]`, **When** an `info` alert is posted, **Then** that route does not appear in `matched_routes`.
2. **Given** a route with `conditions.service: ["payment-*"]`, **When** alerts with services `payment-api`, `payment-worker`, and `auth-service` are posted, **Then** the first two match and the third does not.
3. **Given** a route with `conditions.service: ["*-api"]`, **When** alerts with services `payment-api` and `payment-worker` are posted, **Then** only `payment-api` matches.
4. **Given** a route with `conditions.labels: {"environment": "production"}`, **When** an alert with labels `{"environment": "production", "region": "us-east-1"}` is posted, **Then** the route matches (extra labels are permitted).
5. **Given** the same route, **When** an alert with labels `{"environment": "staging"}` or no `environment` key is posted, **Then** the route does not match.
6. **Given** a route with multiple conditions (severity + service + labels), **When** an alert matches the severity and service but not the label, **Then** the route does not match.

---

### User Story 4 - Suppress Duplicate Alerts Within a Time Window (Priority: P2)

When a route specifies a positive `suppression_window_seconds`, the first matching alert for a given service is routed normally, but any subsequent alert for the same service on that same route within the window is recorded as suppressed (no notification produced). Once the window has expired, routing resumes.

**Why this priority**: Prevents alert storms and is explicitly called out as a dedicated test section. Must be present for the service to be production-useful.

**Independent Test**: Create a route with `suppression_window_seconds: 300`. Submit two alerts for `payment-api` with timestamps 60 seconds apart; verify the first is routed and the second is suppressed. Submit a third at `timestamp + 600s`; verify it routes normally again. Submit an alert for `user-service` during the window; verify it is NOT suppressed.

**Acceptance Scenarios**:

1. **Given** a route with `suppression_window_seconds: 300` and no prior alerts, **When** the first alert for `payment-api` arrives, **Then** `suppressed: false` and the alert is routed.
2. **Given** the above, **When** a second `payment-api` alert arrives with a timestamp within 300 seconds of the first, **Then** `suppressed: true`, `routed_to` still names the winning route (for transparency), and `suppression_reason` names the service and the expiry time.
3. **Given** the above first alert, **When** a `payment-api` alert arrives with a timestamp more than 300 seconds later, **Then** it routes normally and a new suppression window begins from that alert's timestamp.
4. **Given** the first `payment-api` alert created a suppression window, **When** an alert for `user-service` arrives on the same route within the window, **Then** it is NOT suppressed.
5. **Given** a route with `suppression_window_seconds: 0` (or omitted), **When** repeated alerts for the same service arrive, **Then** none are ever suppressed by this route.

---

### User Story 5 - Restrict Routes to Active Hours in a Timezone (Priority: P2)

An operator can attach an `active_hours` window to a route so that the route only matches alerts whose `timestamp`, when converted to the specified IANA timezone, falls inside the local `start`–`end` window. Routes without `active_hours` are always active.

**Why this priority**: Business-hours routing is a standard production operations feature and is tested explicitly. Complex timezone handling is one of the known "landmines" in the exercise.

**Independent Test**: Create a route with `active_hours: {start: "09:00", end: "17:00", timezone: "America/New_York"}`. Post alerts with UTC timestamps that map to 14:00 Eastern (inside) and 02:00 Eastern (outside) and verify match/no-match respectively. Include boundary cases (exactly 09:00 and exactly 17:00).

**Acceptance Scenarios**:

1. **Given** the route above, **When** an alert timestamp converts to 14:00 Eastern, **Then** the route matches.
2. **Given** the same route, **When** an alert timestamp converts to 02:00 Eastern, **Then** the route does NOT match.
3. **Given** a route with no `active_hours`, **When** an alert is posted at any timestamp, **Then** the route is always considered active.
4. **Given** a route with `active_hours`, **When** an alert timestamp is exactly at the local `start`, **Then** the route matches (start is inclusive).
5. **Given** a route with `active_hours`, **When** an alert timestamp is exactly at the local `end`, **Then** the route does NOT match (end is exclusive).

---

### User Story 6 - Query Historical Alerts and Aggregate Statistics (Priority: P2)

An operator inspects the routing history: fetch a single alert's decision, list alerts with filters (`service`, `severity`, `routed`, `suppressed`), and retrieve aggregate statistics grouped by severity, route, and service.

**Why this priority**: Required for the Query & filtering and Stats test sections. Also provides the evidence that earlier routing decisions were correct.

**Independent Test**: Submit a mix of routed, suppressed, and unrouted alerts with different services and severities. Then call `GET /alerts/{id}`, `GET /alerts?service=...`, `GET /alerts?severity=...&routed=true`, and `GET /stats`; verify filter intersections and aggregate counters.

**Acceptance Scenarios**:

1. **Given** alert `alert-123` exists, **When** the operator requests `GET /alerts/alert-123`, **Then** the response is the same structure as the `POST /alerts` response for that alert.
2. **Given** no `alert-999` exists, **When** the operator requests `GET /alerts/alert-999`, **Then** the response is 404 with `{"error": "alert not found"}`.
3. **Given** five routed and three suppressed alerts exist, **When** the operator queries `GET /alerts?routed=true`, **Then** only routed alerts are returned and `total` equals the returned count.
4. **Given** mixed alert data, **When** the operator queries `GET /alerts?service=payment-api&severity=critical`, **Then** only alerts matching both filters are returned.
5. **Given** alerts have been processed, **When** the operator requests `GET /stats`, **Then** the response contains `total_alerts_processed`, `total_routed`, `total_suppressed`, `total_unrouted`, `by_severity`, `by_route` (with `total_matched`, `total_routed`, `total_suppressed` per route), and `by_service`, each reflecting the recorded history.

---

### User Story 7 - Dry-Run a Proposed Alert (Priority: P2)

An operator tests how a hypothetical alert would be routed against the current configuration without persisting it, without mutating any suppression window, and without affecting statistics.

**Why this priority**: Lets operators validate route changes safely. Tested in a dedicated section.

**Independent Test**: Configure a route with a suppression window, submit one real alert so a suppression record exists, then `POST /test` with another alert that should be suppressed. Verify the dry-run response correctly reports `suppressed: true`, but `GET /alerts/{id}` returns 404 for the test alert, the suppression record is unchanged, and `GET /stats` is unchanged.

**Acceptance Scenarios**:

1. **Given** current routes, **When** the operator posts an alert to `/test`, **Then** the response is the same structure as `POST /alerts`.
2. **Given** the above, **When** the operator queries `GET /alerts/{id}` for that alert, **Then** the response is 404.
3. **Given** a suppression record exists, **When** `POST /test` submits an alert that would be suppressed, **Then** the response reports `suppressed: true`, but subsequent real alerts within the window behave as if the dry-run never happened.
4. **Given** stats counters have known values, **When** `POST /test` is invoked, **Then** `GET /stats` counters are unchanged afterward.

---

### User Story 8 - Clear All State (Priority: P3)

An operator resets the service to an empty state — all routes, all alert history, all suppression records, and all statistics are cleared.

**Why this priority**: Required for test isolation (the grading script resets between sections) but not a user-facing feature. Simple to implement but essential for passing.

**Independent Test**: Populate the system with several routes and alerts, invoke `POST /reset`, then verify `GET /routes` returns an empty array, `GET /alerts` returns an empty list with `total: 0`, and `GET /stats` shows all zero counters and empty breakdowns.

**Acceptance Scenarios**:

1. **Given** routes, alerts, suppression records, and stats exist, **When** the operator issues `POST /reset`, **Then** the response is `{"status": "ok"}` and subsequent queries show empty routes, empty alert history, and zeroed statistics.

---

### User Story 9 - Reject Invalid Input With Clear Errors (Priority: P1)

The service validates every request and returns `400 Bad Request` with `{"error": "..."}` for malformed or non-conforming input (missing required fields, invalid severity, invalid target type, bad ISO 8601 timestamps, bad IANA timezones, malformed `HH:MM`, non-integer priority, negative suppression window).

**Why this priority**: A dedicated test section (Input validation) targets these rejections. P1 because a single silent acceptance of bad input can cause downstream failures throughout the test suite.

**Independent Test**: Submit malformed payloads for each validation category and verify status 400 with an `error` string in the body. Then submit the corrected version and verify it succeeds.

**Acceptance Scenarios**:

1. **Given** an alert payload missing `severity`, **When** posted, **Then** the service responds 400 with an `error` describing the missing field.
2. **Given** an alert with `severity: "urgent"`, **When** posted, **Then** the service responds 400 (severity must be `critical`, `warning`, or `info`).
3. **Given** a route with `target.type: "sms"`, **When** posted, **Then** the service responds 400 (target type must be `slack`, `email`, `pagerduty`, or `webhook`).
4. **Given** a route with `active_hours.timezone: "Mars/Phobos"`, **When** posted, **Then** the service responds 400.
5. **Given** a route with `active_hours.start: "9:00"` or `"09:00:00"`, **When** posted, **Then** the service responds 400 (must be `HH:MM`).
6. **Given** a route with `priority: 3.5` or `"high"`, **When** posted, **Then** the service responds 400.
7. **Given** a route with `suppression_window_seconds: -10`, **When** posted, **Then** the service responds 400.
8. **Given** an alert with `timestamp: "March 25"`, **When** posted, **Then** the service responds 400.

---

### Edge Cases

- Re-submitting an alert with an existing `id` updates the record in place (no duplicate created; stats counters still increment because it is a new evaluation).
- A route with `conditions: {}` matches every alert.
- An alert carrying labels that are a superset of the route's label conditions matches (extras are ignored); an alert missing one of the required labels, or holding a wrong value, does not.
- A glob like `payment-*` matches `payment-api` and `payment-worker` but not `auth-service`; `*-api` matches `payment-api` and `user-api` but not `payment-worker`.
- Suppression window timing is driven by the alert's `timestamp` field, not by the server's wall-clock, so tests that inject historical timestamps must still produce correct suppression behaviour.
- Multiple routes tied at the same priority: selection must be deterministic (first-inserted wins); all such routes still appear in `matched_routes`.
- `active_hours` boundary semantics: `start` is inclusive, `end` is exclusive (a half-open interval).
- `suppression_window_seconds: 0` is equivalent to omitting the field — no suppression ever applies.
- The `POST /test` dry-run path must share matching logic with `POST /alerts` (to avoid drift) but must not touch stored state of any kind.
- `evaluation_details.total_routes_evaluated` reflects the number of routes currently in the store, not just the number matched.

## Requirements *(mandatory)*

### Functional Requirements

**Route Management**

- **FR-001**: The system MUST accept `POST /routes` with a routing configuration and respond **201 Created** with `{"id": <id>, "created": true|false}`, creating the route if new or replacing it if the `id` is already present.
- **FR-002**: The system MUST accept `GET /routes` and return **200 OK** with `{"routes": [...]}` containing all currently stored routes in insertion order (earliest first). When no routes exist, the value MUST be `{"routes": []}` (empty array, never null or missing).
- **FR-003**: The system MUST accept `DELETE /routes/{id}` and respond **200 OK** with `{"id": <id>, "deleted": true}` on success, or **404 Not Found** with `{"error": "route not found"}` if the id is unknown.

**Alert Submission & Routing**

- **FR-004**: The system MUST accept `POST /alerts` and respond **200 OK** with a body containing `alert_id`, `routed_to`, `suppressed`, `matched_routes`, and `evaluation_details`. The decision MUST be persisted (upsert by alert id).
- **FR-004a**: When a winning route is selected (routed or suppressed), `routed_to` MUST be a non-null object `{ "route_id": <winner.id>, "target": <winner.target> }`. The `target` MUST be a verbatim copy of the winning route's `target` (including type-specific fields; webhook's `headers` object MUST be included if present on the route).
- **FR-004b**: When the alert is suppressed, `routed_to` MUST still name the winning route and its target (NOT null). Only `suppressed: true` plus the `suppression_reason` string distinguish a suppressed response from a routed one.
- **FR-004c**: When no routes match, `routed_to` MUST be `null`, `matched_routes` MUST be `[]`, `suppressed` MUST be `false`, and `suppression_reason` MUST be absent.
- **FR-004d**: `POST /test` and `POST /reset` MUST respond **200 OK**. Non-existent resources on `GET /alerts/{id}` and `DELETE /routes/{id}` MUST respond **404 Not Found**.
- **FR-005**: When multiple routes match, the system MUST select the single route with the highest `priority` (numeric maximum) as the winner. Lower-priority matching routes MUST still appear in `matched_routes`.
- **FR-005a**: `matched_routes` MUST be an array of route ids ordered by `priority` descending; ties among matched routes MUST be broken by route insertion order (earliest first), producing a stable, deterministic order.
- **FR-006**: When multiple matched routes share the maximum priority, the winner MUST be the earliest-inserted among them (deterministic tie-break).
- **FR-007**: Re-posting an alert with an existing `id` MUST replace the prior persisted record in place (the alerts collection MUST NOT contain duplicates keyed by `id`). Each `POST /alerts` call — including re-submissions — IS a new evaluation event and MUST increment stats counters accordingly (see FR-025a). The evaluation uses the current route set and current suppression state at the time of the re-submission.
- **FR-008**: The `evaluation_details` object MUST report `total_routes_evaluated` (count of routes currently in the store at evaluation time, regardless of match outcome), `routes_matched` (size of `matched_routes`), `routes_not_matched` (= `total_routes_evaluated - routes_matched`), and `suppression_applied` (boolean: `true` iff the winner was suppressed, else `false`).
- **FR-008a**: The alert's optional `description` field, when present on input, MUST be preserved on the stored record.

**Condition Matching**

- **FR-009**: A `severity` condition MUST match when the alert's severity appears in the condition's list.
- **FR-010**: A `service` condition MUST support glob matching where `*` is the only wildcard (zero or more characters); the alert matches if any pattern in the list matches the alert's service. Patterns without `*` MUST match by exact equality.
- **FR-011**: A `group` condition MUST match when the alert's group is in the condition's list.
- **FR-012**: A `labels` condition MUST match when every key/value pair in the condition is present (and value-equal) in the alert's labels; the alert may have additional labels that are ignored.
- **FR-013**: An omitted condition field MUST impose no restriction (matches all values).
- **FR-014**: An empty `conditions: {}` object MUST match every alert.

**Suppression**

- **FR-015**: When the winning route has `suppression_window_seconds > 0` and a prior non-suppressed alert for the same `(route_id, service)` was routed within the window, the current alert MUST be recorded as `suppressed: true` and the response MUST include a `suppression_reason` string in the exact form: `Alert for service '<service>' on route '<route_id>' suppressed until <expiry_iso8601>`, where `<expiry_iso8601>` is the ISO 8601 UTC timestamp (with `Z` suffix) of the window expiry.
- **FR-016**: Suppression window timing MUST be driven by the alert's `timestamp` field, not by server wall-clock time.
- **FR-017**: The window for a `(route_id, service)` pair MUST begin at the `timestamp` of the most recent non-suppressed alert for that pair and end `suppression_window_seconds` later.
- **FR-018**: A suppressed alert MUST NOT reset or extend the suppression window.
- **FR-019**: Suppression MUST be scoped to `(route_id, service)`: alerts for a different service, or the same service on a different route, MUST NOT be suppressed by the current window.
- **FR-020**: `suppression_window_seconds: 0` and omission MUST be semantically identical (no suppression ever applies).

**Active Hours**

- **FR-021**: When a route defines `active_hours`, the system MUST convert the alert's `timestamp` (interpreted as an absolute instant) to the specified IANA timezone and MUST consider the route matched only when the local time satisfies `start ≤ local < end` (start inclusive, end exclusive).
- **FR-022**: Routes without `active_hours` MUST be considered active at all times.

**Query Endpoints**

- **FR-023**: `GET /alerts/{id}` MUST respond **200 OK** with the persisted routing result for that alert id in the same shape as the `POST /alerts` response, or **404 Not Found** with `{"error": "alert not found"}` if unknown.
- **FR-024**: `GET /alerts` MUST accept optional filters `service` (exact string match), `severity`, `routed` (boolean), and `suppressed` (boolean), combined with AND semantics, and return `{"alerts": [...], "total": <n>}` where `total` equals the size of the returned `alerts` array. When no alerts match (or none exist), the value MUST be `{"alerts": [], "total": 0}`. Alerts MUST be returned in submission order (order of first `POST /alerts` for that id; re-submissions preserve the original position).
- **FR-024a**: Filter query parameters MUST be lenient: an invalid value (e.g. `severity=urgent`, `routed=maybe`) MUST return an empty result set with `total: 0`, NOT a 400 error. (Strict validation applies only to request bodies.)
- **FR-025**: `GET /stats` MUST respond **200 OK** with `total_alerts_processed`, `total_routed`, `total_suppressed`, `total_unrouted`, and breakdowns `by_severity`, `by_route` (each entry containing `total_matched`, `total_routed`, `total_suppressed`), and `by_service`.
- **FR-025a**: Stats update rules per `POST /alerts` evaluation event (including re-submissions): increment `total_alerts_processed` by 1; increment `by_severity[alert.severity]` by 1; increment `by_service[alert.service]` by 1; for each route id in `matched_routes`, increment `by_route[id].total_matched` by 1; if routed (winner, not suppressed), increment `total_routed` AND `by_route[winner.id].total_routed`; if suppressed, increment `total_suppressed` AND `by_route[winner.id].total_suppressed`; if no routes matched, increment `total_unrouted`. Invariants: `total_alerts_processed = total_routed + total_suppressed + total_unrouted`; for every route, `total_matched ≥ total_routed + total_suppressed`.
- **FR-025b**: Initial stats (after process start or `POST /reset`) MUST be: all top-level counters `0`; `by_severity: {"critical": 0, "warning": 0, "info": 0}` (pre-populated zeros); `by_route: {}`; `by_service: {}`. Per-route entries MUST be created lazily on first match for that route.

**Dry-Run**

- **FR-026**: `POST /test` MUST return the same response shape as `POST /alerts` but MUST NOT persist the alert, MUST NOT create or update suppression records, and MUST NOT modify statistics.

**System**

- **FR-027**: `POST /reset` MUST clear all routes, all alerts, all suppression records, and all statistics (restoring initial stats per FR-025b), and MUST respond **200 OK** with `{"status": "ok"}`.

**Validation**

- **FR-028**: The system MUST return **400 Bad Request** with `{"error": <message>}` when an alert or route request body is missing any required field.
- **FR-028a**: The system MUST return **400 Bad Request** with `{"error": <message>}` when the request body is not valid JSON or the `Content-Type` does not indicate JSON.
- **FR-029**: The system MUST reject alerts whose `severity` is not one of `critical`, `warning`, `info` (400).
- **FR-030**: The system MUST reject routes whose `target.type` is not one of `slack`, `email`, `pagerduty`, `webhook` (400).
- **FR-031**: The system MUST reject routes whose `target` is missing the field required by its type (`channel` for slack, `address` for email, `service_key` for pagerduty, `url` for webhook) (400).
- **FR-031a**: Webhook targets MAY include an optional `headers` object whose values MUST all be strings; non-string values MUST be rejected (400).
- **FR-032**: The system MUST reject routes whose `active_hours.timezone` is not a valid IANA timezone (400).
- **FR-033**: The system MUST reject routes whose `active_hours.start` or `active_hours.end` is not a strict `HH:MM` 24-hour string matching `^[0-2][0-9]:[0-5][0-9]$` with hours `00`–`23` (400). Strings like `9:00`, `09:00:00`, and `24:00` MUST be rejected.
- **FR-034**: The system MUST reject alerts whose `timestamp` is not a valid ISO 8601 datetime that unambiguously represents an absolute instant (must include either `Z` or a timezone offset). Date-only strings (`2026-03-25`) and free-form text (`March 25`) MUST be rejected (400).
- **FR-035**: The system MUST reject routes whose `priority` is not an integer (400). Non-numeric values (`"high"`) and fractional numbers (`3.5`) MUST be rejected.
- **FR-036**: The system MUST reject routes whose `suppression_window_seconds` is negative (400). Non-integer values MUST also be rejected.

**Operational**

- **FR-037**: The service MUST be packaged as a single Docker container that builds from the repository root with `docker build -t alert-router .`.
- **FR-038**: The container MUST listen on port 8080 and MUST accept connections within 10 seconds of `docker run`.
- **FR-039**: All state MUST be held in memory within a single process (no external database).
- **FR-040**: All endpoints MUST accept and return JSON (`Content-Type: application/json`).

### Non-Functional Requirements

**Resiliency**

> Scope note: the exercise mandates a single in-memory process, so high-availability, replication, and durable persistence are out of scope by design. "Resiliency" here means the service survives bad input, partial failures within a request, and shutdown signals without losing state it can still serve or corrupting stats.

- **NFR-R-001**: Every request handler MUST be wrapped so that a thrown exception inside matcher / router / validator logic yields a **500 Internal Server Error** with `{"error": "internal error"}` — never an unhandled promise rejection, never a dropped socket. The process MUST remain alive and continue serving subsequent requests.
- **NFR-R-002**: The process MUST install handlers for `uncaughtException` and `unhandledRejection` that log the incident and keep the process alive (do not exit on non-fatal errors).
- **NFR-R-003**: The process MUST handle `SIGTERM` and `SIGINT` with a graceful shutdown: stop accepting new connections, let in-flight requests finish within a bounded drain window (default 5s), then exit with code 0.
- **NFR-R-004**: State mutations inside a single request MUST be atomic from the caller's perspective: a request MUST either fully update store + stats + suppressions consistently or make no visible change. (Node's single-threaded event loop provides this for synchronous sections; async I/O inside a mutation is not introduced.)
- **NFR-R-005**: A malformed request (`POST /alerts` with invalid body, bad JSON, bad content-type) MUST NOT leave partial state: no alert record created, no stats incremented, no suppression record touched.
- **NFR-R-006**: The service MUST expose a `GET /health` endpoint returning **200 OK** with `{"status": "ok"}` for liveness probing (Docker `HEALTHCHECK`, orchestrator readiness). This endpoint MUST NOT mutate state and MUST respond under 50ms.
- **NFR-R-007**: Request timeouts MUST be enforced: any handler taking longer than 30 seconds MUST be aborted with a 503 response, protecting the event loop from stuck handlers.

**Security**

> Scope note: the exercise does not require authentication or transport security (grading is loopback HTTP). "Security" here means safe handling of untrusted input, defence against obvious denial-of-service vectors, and a hardened container image suitable for running in production contexts.

- **NFR-S-001**: The service MUST enforce a JSON body size limit (default **1 MiB**) on every mutating endpoint. Bodies exceeding the limit MUST yield **413 Payload Too Large** with an `{"error": ...}` body; the server MUST NOT attempt to parse the body.
- **NFR-S-002**: The service MUST reject unexpected / oversized URL query strings (default max length **2 KiB**) with **414** or **400**.
- **NFR-S-003**: User-supplied keys (e.g. `labels` keys, `webhook.headers` keys) MUST be treated as data, never as object property paths: the implementation MUST use `Map` for dynamic collections or `Object.create(null)` / hasOwnProperty checks, so prototype-pollution payloads (`__proto__`, `constructor.prototype`) CANNOT mutate the prototype chain.
- **NFR-S-004**: Glob patterns MUST be executed by a vetted library (e.g. `minimatch`) or by a bounded pattern→regex compiler — the service MUST NOT use untrusted input in `eval`, `Function`, or `new RegExp(userInput)` without sanitisation.
- **NFR-S-005**: Error responses MUST NOT leak stack traces, file paths, or internal state to clients; the `error` string MUST be a stable, human-readable message (stack traces may be logged server-side but never returned).
- **NFR-S-006**: The Docker image MUST run as a non-root user (UID ≥ 1000), use a minimal base (`node:20-alpine` or `distroless`), expose only port 8080, and include no build toolchain or source maps in the final layer.
- **NFR-S-007**: The image MUST NOT ship with secrets, API keys, or hard-coded credentials. Environment variables used (if any — none required by spec) MUST be documented in the README.
- **NFR-S-008**: Dependencies MUST be pinned (exact versions in `package-lock.json`) and the image build MUST use `npm ci` (not `npm install`) to guarantee reproducibility.
- **NFR-S-009**: HTTP response headers MUST NOT leak framework identity beyond what the framework sets by default; `X-Powered-By` MUST be disabled if the framework emits it.
- **NFR-S-010**: Logs MUST NOT include full alert/route request bodies at info-level (avoid persisting potentially-sensitive `labels` or webhook `headers` in logs); debug-level logging that includes payloads MUST be off by default.

**Scalability**

> Scope note: the exercise is single-process / single-container, so horizontal scaling is not implemented here — it is addressed in the separate Kotlin/GCP design document. "Scalability" in this spec means: known algorithmic complexity, bounded memory, and an architecture that does not foreclose a future scale-out.

- **NFR-X-001**: The alert-evaluation path MUST be **O(R + M log M)** per alert, where `R` is the number of routes and `M` is the number of matched routes (R for linear condition evaluation; M log M for the sort that produces `matched_routes`). No nested per-route scans over alert history.
- **NFR-X-002**: The `GET /alerts` filter path MUST be at most **O(N)** in the number of stored alerts with small constants; no N² scans.
- **NFR-X-003**: The `GET /stats` path MUST be **O(1)** relative to alert count (stats are maintained incrementally on write, not recomputed on read).
- **NFR-X-004**: Route lookups by id MUST be **O(1)** (`Map<string, Route>`), as must alert lookups by id and suppression-record lookups by `(route_id, service)` composite key.
- **NFR-X-005**: Under a sustained submission rate the service MUST achieve at minimum **500 alerts/second** on a single core of a modern laptop (measured with 100 routes, mixed matching) — a floor chosen to verify the evaluator is not accidentally quadratic. This is a smoke target, not a production SLO.
- **NFR-X-006**: Memory usage MUST be bounded by three collections — routes, alerts, suppressions — each O(n) in their respective cardinalities, with no hidden caches or request-scoped memoization leaking across requests.
- **NFR-X-007**: The service layout MUST keep matching logic (matcher.ts), routing logic (router.ts), persistence (store.ts), and HTTP (routes/*.ts) separated so that a future version can replace the in-memory `store.ts` with a distributed backend (Redis, Firestore, Spanner) without touching matcher or router modules.
- **NFR-X-008**: The service MUST be stateless at the HTTP layer (no session cookies, no in-request globals), so that a future deployment can place N identical replicas behind a load balancer once the store is externalised.
- **NFR-X-009**: The implementation MUST document (in the Kotlin/GCP design) where per-tenant isolation, route indexing (e.g. inverted index on severity/group/label-keys), and sharding would be introduced for large route catalogues (>10k routes).
- **NFR-X-010**: Known current limits MUST be documented in the README: unbounded growth of the alerts collection (no eviction), single-process CPU bound, and in-memory volatility on restart.

### Key Entities

- **Route**: A routing rule with a unique `id`, a `conditions` object (any of severity, service, group, labels), a `target` with a type-specific payload, a `priority` integer, an optional non-negative `suppression_window_seconds`, and an optional `active_hours` (IANA timezone, `HH:MM` start, `HH:MM` end).
- **Alert**: A monitoring event with a unique `id`, a `severity` (`critical|warning|info`), a `service`, a `group`, an optional `description`, a required ISO 8601 `timestamp`, and optional `labels` (string-to-string map).
- **RoutingResult**: The persisted outcome of evaluating an alert: references the alert, records the winning route and target (or null), a `suppressed` flag with optional `suppression_reason`, the full list of matched route ids (priority-descending), and the `evaluation_details` counts.
- **SuppressionRecord**: Tracks the most recent non-suppressed routing for a `(route_id, service)` pair — the triggering alert's timestamp and the derived `expires_at` timestamp.
- **Stats**: Running counters (total processed, routed, suppressed, unrouted) plus breakdowns by severity, by service, and per-route (matched / routed / suppressed).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of the 70+ assertions in the grading script's 14 sections pass against the shipped container.
- **SC-002**: The container accepts TCP connections on port 8080 within 10 seconds of `docker run`.
- **SC-003**: Every validation scenario in User Story 9 returns HTTP 400 with a non-empty `error` message; no validation scenario ever causes a 500 or a silent acceptance.
- **SC-004**: For any sequence of alerts with timestamps within a route's suppression window, exactly one alert per `(route_id, service)` is recorded as routed and the remainder are recorded as suppressed until a timestamp beyond the window resets the cycle.
- **SC-005**: For any alert and any active-hours route, the match/no-match decision agrees with an independent wall-clock-free computation of the alert's local time in the route's timezone (validated against `America/New_York` and `Asia/Tokyo` as a non-DST-observing reference).
- **SC-006**: `POST /test` leaves `GET /alerts`, `GET /alerts/{id}`, `GET /stats`, and every suppression record bit-for-bit identical to their pre-call values.
- **SC-007**: After `POST /reset`, `GET /routes` returns `{"routes": []}`, `GET /alerts` returns `{"alerts": [], "total": 0}`, and `GET /stats` returns the initial stats shape per FR-025b, all without a container restart.
- **SC-008**: Posting the same alert `id` twice results in exactly one record returned by `GET /alerts/{id}` (the most recent) and no duplicate in the alerts list, while stats counters reflect two independent evaluation events.
- **SC-009**: For every `POST /alerts` evaluation event, the invariants `total_alerts_processed = total_routed + total_suppressed + total_unrouted` and `by_route[id].total_matched ≥ by_route[id].total_routed + by_route[id].total_suppressed` hold after the call returns.
- **SC-010**: Every suppressed response carries a `suppression_reason` string that matches the template `Alert for service '<service>' on route '<route_id>' suppressed until <iso8601_utc>` exactly — substring assertions against the grading script's expected message succeed.

**Non-functional measurable outcomes**

- **SC-R-001** *(resiliency)*: Fuzz-style submission of malformed JSON, oversized bodies, huge arrays, and deliberately pathological labels does not crash the process — after each malformed request the service still responds 200 to `GET /health` and correctly processes a follow-up valid request.
- **SC-R-002** *(resiliency)*: `SIGTERM` to the container results in a clean exit (exit code 0) within 6 seconds; no in-flight requests return truncated JSON.
- **SC-S-001** *(security)*: A `POST /routes` payload containing `__proto__`, `constructor`, or `prototype` keys in `labels` or `webhook.headers` does not mutate `Object.prototype`: `({}).polluted` remains undefined after the request.
- **SC-S-002** *(security)*: A `POST /alerts` body of 10 MiB is rejected with 413 without the server attempting to parse it (event loop remains responsive: `GET /health` responds in <50ms during the rejection).
- **SC-S-003** *(security)*: Container inspection (`docker inspect`) confirms the running user is non-root and the exposed port is 8080 only.
- **SC-X-001** *(scalability)*: Submitting 1,000 alerts against a store of 100 routes completes in under 2 seconds on a modern single core, with steady memory (no unbounded growth beyond the stored records themselves).
- **SC-X-002** *(scalability)*: The module dependency graph has no import from `matcher.ts` or `router.ts` into the HTTP layer (`routes/*.ts`), proving the routing engine is portable to a different transport or a different store.

## Assumptions

- In-memory storage only — state is discarded when the container restarts; no durability requirement.
- TypeScript on Node.js is the implementation language for this submission; a separate design document will describe a Kotlin + GCP equivalent for the hiring company's stack.
- Only `*` is supported as a glob wildcard in `service` patterns; full regex and `?`/character classes are out of scope.
- Port 8080 is hard-coded (not configurable) per the exercise spec.
- Deterministic priority-tie selection uses insertion order (first-inserted wins). This is documented in the README.
- `active_hours.start` is inclusive and `active_hours.end` is exclusive (standard half-open interval).
- `HH:MM` means exactly two digits for hours and two digits for minutes (`00:00`–`23:59`); `9:00`, `09:00:00`, and `24:00` are invalid.
- The grading script executes `POST /reset` between each of its 14 sections, so cross-section state leakage cannot mask bugs.
- A single-tenant, single-process deployment is assumed; there are no concurrency or high-availability requirements beyond serving the grading script correctly.
- Timezone and ISO 8601 parsing rely on the runtime's ICU/standard-library implementations; no custom timezone logic is hand-rolled.
- ISO 8601 acceptance: any form that represents an absolute instant (must include `Z` or a `±HH:MM`/`±HHMM` offset). Fractional seconds are permitted. Date-only strings and locale text are rejected.
- Query parameters are parsed leniently (invalid values → empty result set); request body JSON is parsed strictly (invalid → 400).
- Re-submitting an alert with an existing id is semantically a new evaluation: stats counters increment again, but the persisted record is updated in place (FR-007) so queries return a single, latest record per id.
- The `suppression_reason` string format is fixed (FR-015 / SC-010) to match the exercise document's exemplar exactly, reducing risk against substring-based graders.
- Non-functional defaults: JSON body limit **1 MiB**, URL/query limit **2 KiB**, request timeout **30 s**, graceful-shutdown drain **5 s**, health endpoint path `/health`. All are tunable via environment variables but have production-sensible defaults so the container runs correctly out-of-the-box.
- Security posture is "hardened defaults, no secrets": no authentication layer is added because the exercise does not require it and adding one without a use case would create noise. The README documents what would need to change to run this publicly (add auth, add TLS termination, restrict origins, etc.).
- Scalability NFRs describe the current single-process design and the module boundaries that keep a scale-out path open. The full scale-out story is in the separate Kotlin/GCP design document, which uses Cloud Run, Firestore/Spanner, Pub/Sub, and a route-indexing strategy for large catalogues.
