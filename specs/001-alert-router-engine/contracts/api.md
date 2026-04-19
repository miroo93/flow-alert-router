# API Contracts

Per-endpoint request/response shapes. Schemas align with [data-model.md](../data-model.md) and the functional requirements in [../spec.md](../spec.md). All requests and responses are `application/json; charset=utf-8`.

| Endpoint | Method | Status (happy) | Error statuses |
|---|---|---|---|
| `/health` | GET | 200 | — |
| `/reset` | POST | 200 | — |
| `/routes` | POST | 201 | 400, 413 |
| `/routes` | GET | 200 | — |
| `/routes/:id` | DELETE | 200 | 404 |
| `/alerts` | POST | 200 | 400, 413 |
| `/alerts` | GET | 200 | — |
| `/alerts/:id` | GET | 200 | 404 |
| `/stats` | GET | 200 | — |
| `/test` | POST | 200 | 400, 413 |

Internal-error fallback: any unhandled exception from any endpoint ⇒ `500 {"error": "internal error"}` via the Fastify error hook (NFR-R-001, NFR-S-005).

---

## `GET /health`

**Response 200**:
```json
{ "status": "ok" }
```

Must not touch state; must respond <50 ms (NFR-R-006).

---

## `POST /reset`

**Request**: empty body accepted.

**Response 200**:
```json
{ "status": "ok" }
```

Clears routes, alerts, suppressions, stats (FR-027).

---

## `POST /routes`

**Request body**:
```json
{
  "id": "route-1",
  "priority": 10,
  "conditions": {
    "severity": ["critical", "warning"],
    "service":  ["payment-*", "auth-service"],
    "group":    ["billing"],
    "labels":   { "environment": "production" }
  },
  "target": {
    "type": "slack",
    "channel": "#ops-alerts"
  },
  "suppression_window_seconds": 300,
  "active_hours": {
    "start": "09:00",
    "end":   "17:00",
    "timezone": "America/New_York"
  }
}
```

Required fields: `id`, `priority`, `conditions`, `target`. Everything else optional. `conditions: {}` matches every alert (FR-014).

**Target shapes** (one-of on `type`, additional required field per type):
- `{ "type": "slack",     "channel": string }`
- `{ "type": "email",     "address": string }`
- `{ "type": "pagerduty", "service_key": string }`
- `{ "type": "webhook",   "url": string, "headers"?: Record<string,string> }`  — all header values must be strings (FR-031a).

**Response 201**:
```json
{ "id": "route-1", "created": true }
```
`created: false` when the id already existed (FR-001 upsert).

**Response 400** — validation failures (see FR-028…036 + NFR-S-003 own-property check on labels):
```json
{ "error": "<description>" }
```

**Response 413** — body > 1 MiB (NFR-S-001).

---

## `GET /routes`

**Response 200**:
```json
{ "routes": [ /* Route, Route, ... in insertion order */ ] }
```

Empty: `{"routes": []}` — never null, never missing (FR-002).

---

## `DELETE /routes/:id`

**Response 200**:
```json
{ "id": "route-1", "deleted": true }
```

**Response 404**:
```json
{ "error": "route not found" }
```

---

## `POST /alerts`

**Request body**:
```json
{
  "id": "alert-123",
  "severity": "critical",
  "service":  "payment-api",
  "group":    "billing",
  "description": "Gateway 5xx spike",
  "timestamp": "2026-04-19T14:30:00Z",
  "labels": {
    "environment": "production",
    "region": "us-east-1"
  }
}
```

Required: `id`, `severity`, `service`, `group`, `timestamp`. `description` and `labels` optional. `timestamp` MUST include `Z` or a `±HH:MM` / `±HHMM` offset (FR-034).

**Response 200** — routed (not suppressed):
```json
{
  "alert_id": "alert-123",
  "routed_to": {
    "route_id": "route-1",
    "target": { "type": "slack", "channel": "#ops-alerts" }
  },
  "suppressed": false,
  "matched_routes": ["route-1", "route-7"],
  "evaluation_details": {
    "total_routes_evaluated": 5,
    "routes_matched": 2,
    "routes_not_matched": 3,
    "suppression_applied": false
  }
}
```

**Response 200** — suppressed (winner exists; no notification produced):
```json
{
  "alert_id": "alert-124",
  "routed_to": {
    "route_id": "route-1",
    "target": { "type": "slack", "channel": "#ops-alerts" }
  },
  "suppressed": true,
  "suppression_reason": "Alert for service 'payment-api' on route 'route-1' suppressed until 2026-04-19T14:35:00Z",
  "matched_routes": ["route-1", "route-7"],
  "evaluation_details": {
    "total_routes_evaluated": 5,
    "routes_matched": 2,
    "routes_not_matched": 3,
    "suppression_applied": true
  }
}
```

`suppression_reason` string format is fixed (FR-015, SC-010):
`Alert for service '<service>' on route '<route_id>' suppressed until <expiry_iso8601>`
— the expiry is the UTC ISO 8601 `Z`-suffixed window-expiry timestamp.

**Response 200** — no match:
```json
{
  "alert_id": "alert-125",
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

No `suppression_reason` key present (FR-004c).

**Response 400/413** — as for `POST /routes`.

---

## `GET /alerts`

**Query params** (all optional; combined with AND; lenient parsing per FR-024a):
- `service` — exact string match
- `severity` — `critical` | `warning` | `info`; invalid → empty set
- `routed` — `true` | `false`; invalid → empty set
- `suppressed` — `true` | `false`; invalid → empty set

**Response 200**:
```json
{
  "alerts": [ /* RoutingResult, ... in original submission order */ ],
  "total":  2
}
```

Empty: `{"alerts": [], "total": 0}` (never null / missing).

---

## `GET /alerts/:id`

**Response 200** — same shape as `POST /alerts` response body (the stored RoutingResult for that id).

**Response 404**:
```json
{ "error": "alert not found" }
```

---

## `GET /stats`

**Response 200**:
```json
{
  "total_alerts_processed": 7,
  "total_routed":           5,
  "total_suppressed":       1,
  "total_unrouted":         1,
  "by_severity": { "critical": 4, "warning": 2, "info": 1 },
  "by_route": {
    "route-1": { "total_matched": 5, "total_routed": 4, "total_suppressed": 1 }
  },
  "by_service": {
    "payment-api":  3,
    "auth-service": 2,
    "user-service": 2
  }
}
```

After `POST /reset` (FR-025b): all top-level counters `0`; `by_severity` pre-populated with all three zeros; `by_route` and `by_service` empty objects.

---

## `POST /test`

Same request shape as `POST /alerts`. Same response shape.

**Behavioural guarantees (FR-026 / SC-006)**:
- Alert NOT persisted — subsequent `GET /alerts/:id` for the test id ⇒ 404.
- Suppression records NOT mutated (neither created nor updated).
- `GET /stats` bit-for-bit identical pre- and post-call.
- Otherwise the routing decision uses the same matcher / priority / suppression-lookup path as `POST /alerts` (no drift).
