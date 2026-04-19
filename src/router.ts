// Router reads from store, writes to store; matcher is pure.
// No fastify / no handler imports — see T021 boundary gate.
import { DateTime } from 'luxon';
import { isWithinActiveHours, matchesConditions } from './matcher.js';
import type { Alert, InMemoryStore, PerRouteStats, Route, RoutingResult } from './types.js';

export interface EvaluateOptions {
  dryRun?: boolean;
}

export interface Router {
  evaluate(alert: Alert, opts?: EvaluateOptions): RoutingResult;
}

function matchingRoutes(store: InMemoryStore, alert: Alert): Route[] {
  const matched: Route[] = [];
  for (const r of store.listRoutes()) {
    if (matchesConditions(r, alert) && isWithinActiveHours(r, alert)) {
      matched.push(r);
    }
  }
  // Stable sort by priority desc; ties fall back to insertion order (the
  // order yielded by store.listRoutes()).
  matched.sort((a, b) => b.priority - a.priority);
  return matched;
}

function toUtcIso(iso: string): string {
  return DateTime.fromISO(iso, { setZone: true })
    .toUTC()
    .toISO({ suppressMilliseconds: true }) as string;
}

function addSecondsUTC(iso: string, seconds: number): string {
  return DateTime.fromISO(iso, { setZone: true })
    .toUTC()
    .plus({ seconds })
    .toISO({ suppressMilliseconds: true }) as string;
}

function suppressionReason(service: string, route_id: string, expires_at_iso: string): string {
  // FR-015 exact template — do not change wording or quoting.
  return `Alert for service '${service}' on route '${route_id}' suppressed until ${expires_at_iso}`;
}

function perRoute(store: InMemoryStore, route_id: string): PerRouteStats {
  const s = store.stats();
  let entry = s.by_route[route_id];
  if (!entry) {
    entry = { total_matched: 0, total_routed: 0, total_suppressed: 0 };
    s.by_route[route_id] = entry;
  }
  return entry;
}

export function createRouter(store: InMemoryStore): Router {
  return {
    evaluate(alert: Alert, opts: EvaluateOptions = {}): RoutingResult {
      const dryRun = opts.dryRun === true;
      const matched = matchingRoutes(store, alert);
      const winner = matched[0];
      const totalRoutes = store.routeCount();

      let suppressed = false;
      let suppression_reason: string | undefined;

      if (winner) {
        const windowSeconds = winner.suppression_window_seconds ?? 0;
        if (windowSeconds > 0) {
          const alertUtc = toUtcIso(alert.timestamp);
          const existing = store.getSuppression(winner.id, alert.service);
          if (existing && alertUtc < existing.expires_at_iso) {
            // Inside an active window — suppress. Do NOT extend the window
            // (FR-019 landmine): leave the existing record untouched.
            suppressed = true;
            suppression_reason = suppressionReason(
              alert.service,
              winner.id,
              existing.expires_at_iso,
            );
          } else if (!dryRun) {
            // First non-suppressed alert for this (route, service) — start a new
            // window anchored at this alert's UTC-normalised timestamp.
            // Skipped on dry-run: /test must not mutate suppression state.
            const expires_at_iso = addSecondsUTC(alert.timestamp, windowSeconds);
            store.setSuppression({
              route_id: winner.id,
              service: alert.service,
              window_start_iso: alertUtc,
              expires_at_iso,
            });
          }
        }
      }

      const result: RoutingResult = {
        alert_id: alert.id,
        routed_to: winner
          ? { route_id: winner.id, target: winner.target }
          : null,
        suppressed,
        matched_routes: matched.map((r) => r.id),
        evaluation_details: {
          total_routes_evaluated: totalRoutes,
          routes_matched: matched.length,
          routes_not_matched: totalRoutes - matched.length,
          suppression_applied: suppressed,
        },
        _alert: alert,
      };
      if (suppression_reason !== undefined) {
        result.suppression_reason = suppression_reason;
      }

      if (dryRun) {
        // Dry-run short-circuits before any stats write — FR-026.
        return result;
      }

      // Stats updates (FR-025a). Per-match total_matched for every matching
      // route (losers included); winner-specific counters; global totals;
      // by_severity and by_service for every processed alert.
      const stats = store.stats();
      stats.total_alerts_processed += 1;
      stats.by_severity[alert.severity] += 1;
      stats.by_service[alert.service] = (stats.by_service[alert.service] ?? 0) + 1;
      for (const m of matched) {
        perRoute(store, m.id).total_matched += 1;
      }
      if (winner) {
        if (suppressed) {
          stats.total_suppressed += 1;
          perRoute(store, winner.id).total_suppressed += 1;
        } else {
          stats.total_routed += 1;
          perRoute(store, winner.id).total_routed += 1;
        }
      } else {
        stats.total_unrouted += 1;
      }

      return result;
    },
  };
}
