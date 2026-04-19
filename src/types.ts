// Domain type definitions for the alert routing engine.
// Mirrors specs/001-alert-router-engine/data-model.md. Pure types — no runtime code.

// ---------- Core unions ----------

export type Severity = 'critical' | 'warning' | 'info';

export type TargetType = 'slack' | 'email' | 'pagerduty' | 'webhook';

export type Target =
  | { type: 'slack'; channel: string }
  | { type: 'email'; address: string }
  | { type: 'pagerduty'; service_key: string }
  | { type: 'webhook'; url: string; headers?: Record<string, string> };

// ---------- Route ----------

export interface ActiveHours {
  /** "HH:MM", 00:00–23:59, inclusive start */
  start: string;
  /** "HH:MM", exclusive end */
  end: string;
  /** IANA zone, validated via luxon IANAZone.isValidZone */
  timezone: string;
}

export interface RouteConditions {
  /** OR within list; omitted = match all severities */
  severity?: Severity[];
  /** glob patterns with `*` wildcard (e.g. `payment-*`, `*-api`) */
  service?: string[];
  /** OR within list */
  group?: string[];
  /** subset match: alert.labels ⊇ this */
  labels?: Record<string, string>;
}

export interface Route {
  /** unique key, upserted */
  id: string;
  /** integer; higher wins */
  priority: number;
  /** `{}` matches every alert */
  conditions: RouteConditions;
  target: Target;
  /** integer ≥ 0; 0 ≡ omitted */
  suppression_window_seconds?: number;
  active_hours?: ActiveHours;
  /**
   * Store-internal monotonically-increasing counter for deterministic tie-break
   * when routes share the same priority. Not part of the public request/response
   * shape — excluded from serialisation at the route-handler layer.
   */
  _insertionOrder?: number;
}

// ---------- Alert ----------

export interface Alert {
  /** unique key, upserted */
  id: string;
  severity: Severity;
  service: string;
  group: string;
  /** preserved verbatim on the stored record */
  description?: string;
  /** ISO 8601 absolute instant: `Z` or `±HH:MM` offset required */
  timestamp: string;
  /** parsed into Map<string,string> internally (NFR-S-003) */
  labels?: Record<string, string>;
}

// ---------- RoutingResult ----------

export interface EvaluationDetails {
  /** = store.routes.size at eval time (FR-008) */
  total_routes_evaluated: number;
  /** = matched_routes.length */
  routes_matched: number;
  /** = total_routes_evaluated - routes_matched */
  routes_not_matched: number;
  /** = winner-was-suppressed */
  suppression_applied: boolean;
}

export interface RoutingResult {
  alert_id: string;
  /** null only when no matches */
  routed_to: { route_id: string; target: Target } | null;
  suppressed: boolean;
  /** FR-015 exact template */
  suppression_reason?: string;
  /** priority-desc, ties by insertion order */
  matched_routes: string[];
  evaluation_details: EvaluationDetails;

  /**
   * Internal bookkeeping — not serialised to API responses.
   * Used by GET /alerts list filtering by severity/service.
   */
  _alert?: Alert;
  /** First-insertion order (FR-024). Not serialised. */
  _submissionOrder?: number;
}

// ---------- Suppression ----------

export interface SuppressionRecord {
  route_id: string;
  service: string;
  /**
   * Window start = timestamp of the most recent NON-suppressed alert
   * (the triggering alert's ISO 8601 timestamp).
   */
  window_start_iso: string;
  /** ISO 8601 UTC with 'Z' — used verbatim in FR-015 message */
  expires_at_iso: string;
}

// ---------- Stats ----------

export interface PerRouteStats {
  total_matched: number;
  /** winner & not suppressed */
  total_routed: number;
  /** winner & suppressed */
  total_suppressed: number;
}

export interface Stats {
  total_alerts_processed: number;
  total_routed: number;
  total_suppressed: number;
  total_unrouted: number;
  /** pre-populated `{critical:0, warning:0, info:0}` */
  by_severity: Record<Severity, number>;
  /** lazy; per-route entry created on first match */
  by_route: Record<string, PerRouteStats>;
  /** lazy */
  by_service: Record<string, number>;
}

// ---------- Store ----------

export interface AlertFilters {
  service?: string;
  /** raw string; lenient per FR-024a */
  severity?: string;
  /** raw 'true' | 'false'; lenient */
  routed?: string;
  /** raw 'true' | 'false'; lenient */
  suppressed?: string;
}

export interface InMemoryStore {
  // Routes
  /** upsert; `created=false` on replace */
  addRoute(r: Route): { id: string; created: boolean };
  /** insertion order */
  listRoutes(): Route[];
  getRoute(id: string): Route | undefined;
  /** false if not present */
  deleteRoute(id: string): boolean;
  /** for evaluation_details */
  routeCount(): number;

  // Alerts
  /** preserves original submission order */
  upsertAlert(r: RoutingResult): void;
  getAlert(id: string): RoutingResult | undefined;
  listAlerts(filters: AlertFilters): RoutingResult[];

  // Suppression
  getSuppression(route_id: string, service: string): SuppressionRecord | undefined;
  setSuppression(rec: SuppressionRecord): void;

  // Stats
  /** live reference; router mutates */
  stats(): Stats;

  // Lifecycle
  /** FR-027 */
  reset(): void;
}
