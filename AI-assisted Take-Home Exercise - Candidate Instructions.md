
# Take-Home Exercise: Configurable Alert Routing Engine

## Before You Begin

This exercise is designed to assess how you build software with AI. That isn't a secondary consideration or a nice-to-have — it is the core skill under evaluation. We believe that the most effective engineers today are those who can think clearly about a problem, decompose it into well-scoped pieces, and drive an AI assistant through the full arc of implementation: from initial architecture through iterative refinement, debugging, and polish. That is what we are looking for.

To that end, this exercise is intentionally scoped beyond what any engineer could reasonably complete from scratch in the allotted time. **You have 2 hours.** The system described below involves routing logic, glob-based pattern matching, timezone-aware scheduling, temporal suppression windows, filtering, aggregation, and a complete REST API — all packaged in a Docker container. Completing this without making extensive, skillful use of AI is not realistic, and that is by design.

**You will be provided access to Claude for the duration of the exercise.** We will review your conversation history — not to judge individual prompts, but to understand how you work. We want to see how you broke the problem down, how you course-corrected when something wasn't right, how you decided what to delegate to AI versus what to think through yourself, and how you iterated toward a working system. We are looking for an AI-native development workflow: one where AI is a genuine co-builder, not an autocomplete engine you consult occasionally.

A few things this means in practice:

- **Don't treat the AI interaction as something to hide or minimize.** It's the point.
- **Don't try to paste the entire spec in a single prompt and hope for the best.** That rarely works for a system this complex, and the result is usually brittle. The candidates who do well are the ones who work through the problem in stages.
- **Do use AI for the things it's good at** — scaffolding boilerplate, generating repetitive code, catching edge cases you describe, writing tests — while you provide the judgment, sequencing, and architectural thinking.
- **Do iterate.** The first output is almost never the final output. Refining, testing, and feeding errors back into the conversation is a normal and expected part of the workflow.

Beyond AI fluency, we are also evaluating your design instincts, code organization, attention to correctness, and ability to produce a system that actually runs. The deliverable is a Docker image that we will build, start, and test against an automated suite. It either works or it doesn't — and that objectivity is intentional.

## Overview

Build a backend service that ingests monitoring alerts (via a REST API), evaluates them against user-defined routing rules, and produces routed notification outputs. The service must run in a single Docker container and expose a deterministic HTTP API that we will test against.

Choose any language you're comfortable with (Python, Go, TypeScript, Java, Rust, etc.).

---

## The System

You are building a simplified version of an alert routing engine (think: PagerDuty's routing rules, or Alertmanager's routing tree). The service accepts three kinds of input:

1. **Routing configurations** — rules that determine how alerts are routed
2. **Alerts** — incoming monitoring events to be evaluated
3. **Query endpoints** — to inspect routing decisions and system state

### Data Model

#### Alert (input)

```json
{
  "id": "alert-1234",
  "severity": "critical",
  "service": "payment-api",
  "group": "backend",
  "description": "Latency p99 > 2s for 5 minutes",
  "timestamp": "2026-03-25T14:30:00Z",
  "labels": {
    "region": "us-east-1",
    "environment": "production",
    "team": "payments"
  }
}
```

Fields:

- `id` (string, required): Unique alert identifier. Re-submitting the same ID updates the existing alert.
- `severity` (string, required): One of `critical`, `warning`, `info`.
- `service` (string, required): The originating service name.
- `group` (string, required): Logical grouping (e.g., `backend`, `frontend`, `infrastructure`).
- `description` (string, optional): Human-readable description.
- `timestamp` (string, required): ISO 8601 timestamp.
- `labels` (object, optional): Arbitrary key-value string pairs.

#### Routing Configuration

```json
{
  "id": "route-1",
  "conditions": {
    "severity": ["critical", "warning"],
    "group": ["backend"],
    "labels": {
      "environment": "production"
    }
  },
  "target": {
    "type": "slack",
    "channel": "#backend-oncall"
  },
  "priority": 10,
  "suppression_window_seconds": 300,
  "active_hours": {
    "timezone": "America/New_York",
    "start": "09:00",
    "end": "17:00"
  }
}
```

Fields:

- `id` (string, required): Unique route identifier.
- `conditions` (object, required): Matching criteria (see Matching Rules below).
- `target` (object, required): Where to route. Has `type` (one of `slack`, `email`, `pagerduty`, `webhook`) and type-specific fields (see below).
- `priority` (integer, required): Higher number = higher priority. When multiple routes match, the highest priority route wins.
- `suppression_window_seconds` (integer, optional, default 0): After an alert matches this route, suppress duplicate alerts for the same `service` on this route for this many seconds. Duplicates are determined by matching `service` — if an alert with the same `service` has already been routed through this route within the window, suppress it.
- `active_hours` (object, optional): If present, this route only matches during the specified time window. If absent, the route is always active.

**Target type fields:**

- `slack`: requires `channel` (string)
- `email`: requires `address` (string)
- `pagerduty`: requires `service_key` (string)
- `webhook`: requires `url` (string) and optional `headers` (object of string key-value pairs)

### Matching Rules

An alert matches a route's conditions if **all** specified condition fields match:

- **`severity`**: The alert's severity must be in the provided list.
- **`service`**: The alert's service must be in the provided list. Supports glob patterns (e.g., `"payment-*"` matches `"payment-api"` and `"payment-worker"`).
- **`group`**: The alert's group must be in the provided list.
- **`labels`**: Every key-value pair in the condition's labels must exist in the alert's labels. The alert may have additional labels not mentioned in the condition.

If a condition field is **omitted**, it matches all values for that field (i.e., it's not filtered on).

### Routing Logic

When an alert is submitted:

1. Evaluate all routing configurations against the alert.
2. Collect all matching routes.
3. If `active_hours` is set on a route, check whether the alert's timestamp falls within the active window (in the specified timezone). If not, the route does not match.
4. Order matching routes by `priority` (descending).
5. The **highest priority** matching route is the one that "wins" — this is the route that produces the notification.
6. If the winning route has a suppression window, check if the same `service` has already been routed through this specific route within the window. If so, suppress (no notification produced, but record the suppression).
7. If no routes match, the alert is recorded as "unrouted."

**Important**: Only the single highest-priority matching route produces a notification. Lower-priority matches are recorded as "evaluated but not selected."

---

## API Specification

All endpoints accept and return JSON. The service must listen on port **8080**.

### Routes Management

#### `POST /routes`

Create or update a routing configuration.

**Request body**: A routing configuration object (see above).

**Response** (201 Created):

```json
{
  "id": "route-1",
  "created": true
}
```

If the route ID already exists, replace it and return `{"id": "route-1", "created": false}`.

#### `GET /routes`

List all routing configurations.

**Response** (200 OK):

```json
{
  "routes": [ /* array of route objects */ ]
}
```

#### `DELETE /routes/{id}`

Delete a routing configuration.

**Response** (200 OK):

```json
{
  "id": "route-1",
  "deleted": true
}
```

Return 404 if not found: `{"error": "route not found"}`.

---

### Alert Submission

#### `POST /alerts`

Submit an alert for routing evaluation.

**Request body**: An alert object (see above).

**Response** (200 OK):

```json
{
  "alert_id": "alert-1234",
  "routed_to": {
    "route_id": "route-1",
    "target": {
      "type": "slack",
      "channel": "#backend-oncall"
    }
  },
  "suppressed": false,
  "matched_routes": ["route-1", "route-3"],
  "evaluation_details": {
    "total_routes_evaluated": 5,
    "routes_matched": 2,
    "routes_not_matched": 3,
    "suppression_applied": false
  }
}
```

If suppressed:

```json
{
  "alert_id": "alert-1234",
  "routed_to": {
    "route_id": "route-1",
    "target": {
      "type": "slack",
      "channel": "#backend-oncall"
    }
  },
  "suppressed": true,
  "suppression_reason": "Alert for service 'payment-api' on route 'route-1' suppressed until 2026-03-25T14:35:00Z",
  "matched_routes": ["route-1"],
  "evaluation_details": {
    "total_routes_evaluated": 5,
    "routes_matched": 1,
    "routes_not_matched": 4,
    "suppression_applied": true
  }
}
```

If unrouted:

```json
{
  "alert_id": "alert-1234",
  "routed_to": null,
  "suppressed": false,
  "matched_routes": [],
  "evaluation_details": {
    "total_routes_evaluated": 5,
    "routes_matched": 0,
    "routes_not_matched": 5,
    "suppression_applied": false
  }
}
```

---

### Query Endpoints

#### `GET /alerts/{id}`

Get the routing result for a specific alert.

**Response** (200 OK): The same structure as the `POST /alerts` response for that alert.

Return 404 if not found: `{"error": "alert not found"}`.

#### `GET /alerts?service={service}&severity={severity}&routed={true|false}&suppressed={true|false}`

List alerts with optional filters. All query parameters are optional.

- `service`: Filter by service name (exact match).
- `severity`: Filter by severity.
- `routed`: If `true`, only alerts that were routed. If `false`, only unrouted alerts.
- `suppressed`: If `true`, only suppressed alerts. If `false`, only non-suppressed alerts.

**Response** (200 OK):

```json
{
  "alerts": [ /* array of alert result objects */ ],
  "total": 42
}
```

#### `GET /stats`

Return aggregate statistics.

**Response** (200 OK):

```json
{
  "total_alerts_processed": 150,
  "total_routed": 120,
  "total_suppressed": 18,
  "total_unrouted": 12,
  "by_severity": {
    "critical": 30,
    "warning": 80,
    "info": 40
  },
  "by_route": {
    "route-1": {
      "total_matched": 45,
      "total_routed": 40,
      "total_suppressed": 5
    }
  },
  "by_service": {
    "payment-api": 25,
    "user-service": 18
  }
}
```

#### `POST /test`

Dry-run an alert against current routing configurations **without** recording it or affecting suppression state.

**Request body**: An alert object.

**Response** (200 OK): Same structure as `POST /alerts` response, but with no side effects.

---

### System

#### `POST /reset`

Clear all state (routes, alerts, suppression windows, stats). Return `{"status": "ok"}`.

---

## Validation Requirements

The service must return `400 Bad Request` with an `{"error": "..."}` body for:

- Missing required fields on alerts or routes.
- Invalid `severity` values (must be one of `critical`, `warning`, `info`).
- Invalid `target.type` values.
- Invalid `active_hours` format (start/end must be HH:MM, timezone must be a valid IANA timezone).
- Invalid ISO 8601 timestamps.
- `priority` not being an integer.
- `suppression_window_seconds` being negative.

---

## Deliverables

Please submit your solution in one of the following ways:

### Option 1 — GitHub repository (preferred)

Send us a link to a public GitHub repository containing your solution.

### Option 2 — Zip archive

Send us a `.zip` file containing your project.

### Requirements

Regardless of how you submit, your solution must include:

1. Any source code required to build and run your project.
2. **A `Dockerfile`** at the repository root that builds and runs the service.
3. **A `README.md`** explaining:
    - Your language/framework choice and why.
    - How to build and run: `docker build -t alert-router . && docker run -p 8080:8080 alert-router`
    - Any design decisions worth noting.

The container must start, listen on port 8080, and be ready to accept requests within 10 seconds of `docker run`.

---

## What We're Evaluating

|Dimension|What we look for|
|---|---|
|**AI collaboration**|How you decomposed the problem, the quality of your prompts, how you iterated when things didn't work, whether you used AI strategically vs. pasting everything at once.|
|**Correctness**|We will run an automated test suite against your container. The spec above is the contract.|
|**Code quality**|Readable, well-structured code. Reasonable separation of concerns. We don't expect perfection in 2 hours, but we expect thoughtfulness.|
|**Edge cases**|Glob matching, timezone handling, suppression window expiry, re-submitted alert IDs, concurrent route evaluation.|
|**Operational readiness**|Does the Docker image build cleanly? Does it start fast? Are errors handled gracefully?|

---

## Tips

- **Start with the core loop**: get `POST /routes`, `POST /alerts`, and the basic matching logic working first. Then layer on suppression, active hours, filtering, and stats.
- **Use AI strategically**: Break the problem into pieces. Don't try to generate the entire system in one prompt. Iterate — get something running, test it, then expand.
- **In-memory storage is fine**: You do not need a database. This is a single-process, in-memory system.
- **Test as you go**: Use `curl` or a simple script to verify behavior incrementally.
- **Timezones are tricky**: Lean on your language's standard library or a well-known library. Don't hand-roll timezone logic.
- **Glob matching**: You only need to support `*` as a wildcard character in service name patterns (e.g., `payment-*`). You do not need full regex support.

---

## How We Will Test Your Submission

When you submit your repository, here is exactly what happens:

1. We clone your repo and run `docker build -t alert-router .` from the root.
2. We run `docker run -p 8080:8080 alert-router` and wait for the service to be ready (it must accept connections within 10 seconds).
3. We execute an automated test script against `http://localhost:8080`. The script uses `curl` and `jq` — nothing exotic.
4. We review the results, then read your code and your Claude conversation history.

**The test script runs 70+ individual assertions across 14 test sections.** Each section resets your service's state via `POST /reset` before running, so failures in one section don't cascade into others. The sections cover:

- **Route CRUD**: creating, listing, updating (re-POST with existing ID), deleting, and 404 on missing routes.
- **Input validation**: missing required fields, invalid severity values, bad timestamps, invalid target types, negative suppression windows, invalid timezones, malformed time formats.
- **Basic routing**: an alert matching multiple routes is routed to the highest priority one; unrouted alerts return `null`; `matched_routes` and `evaluation_details` counts are correct.
- **Label matching**: all condition labels must be present in the alert; extra labels on the alert are fine; missing or wrong label values mean no match.
- **Glob matching**: patterns like `payment-*`, `auth-*`, and `*-api` are tested against various service names, including non-matching cases.
- **Suppression windows**: first alert routes normally; second alert for the same service within the window is suppressed; an alert after the window expires routes again; a different service within the same window is not suppressed.
- **Active hours & timezones**: alerts with timestamps that fall inside and outside a route's active hours window (tested with `America/New_York` timezone conversions, including boundary times).
- **Alert re-submission**: posting an alert with an existing ID updates the record.
- **Query & filtering**: `GET /alerts/{id}`, 404 for missing alerts, filtering by `service`, `severity`, `routed`, `suppressed`, combined filters, and the `total` field.
- **Stats**: all aggregate counters (`total_alerts_processed`, `total_routed`, `total_suppressed`, `total_unrouted`), plus `by_severity`, `by_service`, and `by_route` breakdowns.
- **Dry-run (`POST /test`)**: returns correct routing result, does not persist the alert, does not affect suppression state, does not affect stats.
- **Omitted conditions**: a route with an empty `conditions` object matches all alerts.
- **Priority with multiple matching routes**: three routes at different priorities all match; highest wins; all three appear in `matched_routes`.
- **Full reset**: after `POST /reset`, routes, alerts, and stats are all empty/zeroed.

**Our recommendation**: before you submit, test your own service with `curl` against several of these scenarios. The ones that most commonly trip people up are suppression window expiry (pay attention to timestamps, not wall-clock time), timezone conversion for active hours, and the `evaluation_details` counts. If those work, you're in good shape.