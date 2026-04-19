# Data Model — Alert Routing Engine

TypeScript interfaces for all domain entities. These live in [src/types.ts](../../src/types.ts) once scaffolded. Kept here to anchor the plan review.

## Core unions

```ts
export type Severity = 'critical' | 'warning' | 'info';

export type TargetType = 'slack' | 'email' | 'pagerduty' | 'webhook';

export type Target =
  | { type: 'slack';     channel: string }
  | { type: 'email';     address: string }
  | { type: 'pagerduty'; service_key: string }
  | { type: 'webhook';   url: string; headers?: Record<string, string> };
```

## Route

```ts
export interface ActiveHours {
  start: string;       // "HH:MM", 00:00–23:59, strict
  end: string;         // "HH:MM", exclusive bound
  timezone: string;    // IANA zone, validated via luxon IANAZone.isValidZone
}

export interface RouteConditions {
  severity?: Severity[];                 // OR within list; omitted = match all severities
  service?: string[];                    // glob patterns with * wildcard
  group?: string[];                      // OR within list
  labels?: Record<string, string>;       // subset match: alert.labels ⊇ this
}

export interface Route {
  id: string;                            // unique key, upserted
  priority: number;                      // integer, higher wins
  conditions: RouteConditions;           // {} matches every alert
  target: Target;
  suppression_window_seconds?: number;   // integer ≥ 0; 0 ≡ omitted
  active_hours?: ActiveHours;
  // Internal: populated by store on insert, used for deterministic tie-break:
  // insertionOrder: number;  // monotonically increasing; not serialised to API
}
```

Notes:
- `insertionOrder` is a store-internal counter; it is NOT part of the request/response shape. The store exposes list operations in insertion order via `Map` iteration, so consumers don't see the field directly.
- Re-posting an existing route replaces the record AND preserves the original `insertionOrder` (FR-001 / FR-006 consistency — a re-posted route keeps its tie-break position; confirm during implementation against the grading suite, adjust if needed).

## Alert

```ts
export interface Alert {
  id: string;                            // unique key, upserted
  severity: Severity;
  service: string;
  group: string;
  description?: string;                  // preserved verbatim on the stored record
  timestamp: string;                     // ISO 8601 absolute instant: Z or ±HH:MM offset required
  labels?: Record<string, string>;       // parsed into Map<string,string> internally (NFR-S-003)
}
```

## RoutingResult (persisted outcome of a POST /alerts evaluation)

```ts
export interface EvaluationDetails {
  total_routes_evaluated: number;   // = store.routes.size at eval time (FR-008)
  routes_matched: number;           // = matched_routes.length
  routes_not_matched: number;       // = total_routes_evaluated - routes_matched
  suppression_applied: boolean;     // = winner-was-suppressed
}

export interface RoutingResult {
  alert_id: string;
  routed_to: { route_id: string; target: Target } | null;  // null only when no matches
  suppressed: boolean;
  suppression_reason?: string;      // FR-015 exact template
  matched_routes: string[];         // priority-desc, ties by insertion order
  evaluation_details: EvaluationDetails;

  // Internal bookkeeping (not serialised to response):
  // _alert: Alert;            // for GET /alerts list filtering by severity/service
  // _submissionOrder: number; // first-insertion order (FR-024)
}
```

The response shape for `POST /alerts`, `POST /test`, and `GET /alerts/:id` is the subset with no underscore-prefixed fields.

## SuppressionRecord

```ts
export interface SuppressionRecord {
  route_id: string;
  service: string;
  // Window start = timestamp of the most recent NON-suppressed alert.
  // Window end   = window_start + route.suppression_window_seconds.
  window_start_iso: string;  // triggering alert's ISO 8601 timestamp
  expires_at_iso: string;    // ISO 8601 UTC with 'Z' — used verbatim in FR-015 message
}
```

Keyed by composite `${route_id}:${service}` in `store.suppressions` (`Map<string, SuppressionRecord>`), per the CLAUDE.md architectural invariant.

## Stats

```ts
export interface PerRouteStats {
  total_matched: number;
  total_routed: number;       // winner & not suppressed
  total_suppressed: number;   // winner & suppressed
}

export interface Stats {
  total_alerts_processed: number;
  total_routed: number;
  total_suppressed: number;
  total_unrouted: number;
  by_severity: Record<Severity, number>;                // pre-populated {critical:0, warning:0, info:0}
  by_route: Record<string, PerRouteStats>;              // lazy; per-route entry created on first match
  by_service: Record<string, number>;                   // lazy
}
```

Initial value (after process start or `POST /reset`, per FR-025b):

```ts
const INITIAL_STATS: Stats = {
  total_alerts_processed: 0,
  total_routed: 0,
  total_suppressed: 0,
  total_unrouted: 0,
  by_severity: { critical: 0, warning: 0, info: 0 },
  by_route: {},
  by_service: {},
};
```

Invariants (checked by spec SC-009):

- `total_alerts_processed = total_routed + total_suppressed + total_unrouted`
- For every route: `total_matched ≥ total_routed + total_suppressed`

## InMemoryStore interface

```ts
export interface InMemoryStore {
  // Routes
  addRoute(r: Route): { id: string; created: boolean };   // upsert; created=false on replace
  listRoutes(): Route[];                                   // insertion order
  getRoute(id: string): Route | undefined;
  deleteRoute(id: string): boolean;                        // false if not present
  routeCount(): number;                                    // for evaluation_details

  // Alerts
  upsertAlert(r: RoutingResult): void;                     // preserves original submission order
  getAlert(id: string): RoutingResult | undefined;
  listAlerts(filters: AlertFilters): RoutingResult[];

  // Suppression
  getSuppression(route_id: string, service: string): SuppressionRecord | undefined;
  setSuppression(rec: SuppressionRecord): void;

  // Stats
  stats(): Stats;                                          // live reference; router mutates

  // Lifecycle
  reset(): void;                                           // FR-027
}

export interface AlertFilters {
  service?: string;
  severity?: string;     // raw string; lenient per FR-024a
  routed?: string;       // raw 'true' | 'false'; lenient
  suppressed?: string;   // raw 'true' | 'false'; lenient
}
```

The store is the single mutation boundary. `matcher.ts` is pure (no store access); `router.ts` reads `store.listRoutes()` + `store.getSuppression(...)` and writes `store.upsertAlert(...)` / `store.setSuppression(...)` / `store.stats()`. `routes/*.ts` does not touch the internal Maps directly.
