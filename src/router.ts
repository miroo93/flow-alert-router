// Router reads from store, writes to store; matcher is pure.
// No fastify / no handler imports — see T021 boundary gate.
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

export function createRouter(store: InMemoryStore): Router {
  return {
    evaluate(alert: Alert, _opts: EvaluateOptions = {}): RoutingResult {
      const matched = matchingRoutes(store, alert);
      const winner = matched[0];
      const totalRoutes = store.routeCount();

      const result: RoutingResult = {
        alert_id: alert.id,
        routed_to: winner
          ? { route_id: winner.id, target: winner.target }
          : null,
        suppressed: false,
        matched_routes: matched.map((r) => r.id),
        evaluation_details: {
          total_routes_evaluated: totalRoutes,
          routes_matched: matched.length,
          routes_not_matched: totalRoutes - matched.length,
          suppression_applied: false,
        },
        _alert: alert,
      };

      return result;
    },
  };
}
