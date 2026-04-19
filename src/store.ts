import type {
  Route,
  RoutingResult,
  SuppressionRecord,
  Stats,
  AlertFilters,
  InMemoryStore,
} from './types.js';

interface StoredRoute extends Route {
  _insertionOrder: number;
}

const VALID_SEVERITIES: ReadonlySet<string> = new Set(['critical', 'warning', 'info']);
const VALID_BOOL_FILTERS: ReadonlySet<string> = new Set(['true', 'false']);

export function createStore(): InMemoryStore {
  const routes = new Map<string, StoredRoute>();
  const alerts = new Map<string, RoutingResult>();
  let insertionCounter = 0;

  return {
    addRoute(r: Route): { id: string; created: boolean } {
      const existing = routes.get(r.id);
      const insertionOrder = existing ? existing._insertionOrder : insertionCounter++;
      routes.set(r.id, { ...r, _insertionOrder: insertionOrder });
      return { id: r.id, created: !existing };
    },
    listRoutes(): Route[] {
      return [...routes.values()];
    },
    getRoute(id: string): Route | undefined {
      return routes.get(id);
    },
    deleteRoute(id: string): boolean {
      return routes.delete(id);
    },
    routeCount(): number {
      return routes.size;
    },

    upsertAlert(r: RoutingResult): void {
      // Map preserves insertion order; setting an existing key keeps its position.
      alerts.set(r.alert_id, r);
    },
    getAlert(id: string): RoutingResult | undefined {
      return alerts.get(id);
    },
    listAlerts(f: AlertFilters): RoutingResult[] {
      if (f.severity !== undefined && !VALID_SEVERITIES.has(f.severity)) return [];
      if (f.routed !== undefined && !VALID_BOOL_FILTERS.has(f.routed)) return [];
      if (f.suppressed !== undefined && !VALID_BOOL_FILTERS.has(f.suppressed)) return [];

      const wantRouted = f.routed === 'true' ? true : f.routed === 'false' ? false : undefined;
      const wantSuppressed =
        f.suppressed === 'true' ? true : f.suppressed === 'false' ? false : undefined;

      return [...alerts.values()].filter((r) => {
        const a = r._alert;
        if (f.service !== undefined && a?.service !== f.service) return false;
        if (f.severity !== undefined && a?.severity !== f.severity) return false;
        if (wantRouted !== undefined) {
          const isRouted = r.routed_to !== null && !r.suppressed;
          if (isRouted !== wantRouted) return false;
        }
        if (wantSuppressed !== undefined && r.suppressed !== wantSuppressed) return false;
        return true;
      });
    },
    getSuppression(_route_id: string, _service: string): SuppressionRecord | undefined {
      throw new Error('not implemented');
    },
    setSuppression(_rec: SuppressionRecord): void {
      throw new Error('not implemented');
    },
    stats(): Stats {
      throw new Error('not implemented');
    },
    reset(): void {
      throw new Error('not implemented');
    },
  };
}
