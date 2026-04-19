// Router reads from store, writes to store; matcher is pure.
// No fastify / no handler imports — see T021 boundary gate.
import { DateTime } from 'luxon';
import { isWithinActiveHours, matchesConditions } from './matcher.js';
import type { Alert, InMemoryStore, Route, RoutingResult } from './types.js';

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

export function createRouter(store: InMemoryStore): Router {
  return {
    evaluate(alert: Alert, _opts: EvaluateOptions = {}): RoutingResult {
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
          } else {
            // First non-suppressed alert for this (route, service) — start a new
            // window anchored at this alert's UTC-normalised timestamp.
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

      return result;
    },
  };
}
