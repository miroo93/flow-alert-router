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

export function createStore(): InMemoryStore {
  const routes = new Map<string, StoredRoute>();
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

    upsertAlert(_r: RoutingResult): void {
      throw new Error('not implemented');
    },
    getAlert(_id: string): RoutingResult | undefined {
      throw new Error('not implemented');
    },
    listAlerts(_f: AlertFilters): RoutingResult[] {
      throw new Error('not implemented');
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
