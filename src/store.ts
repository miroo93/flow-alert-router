// Stub for TDD Red phase — will be filled in green commits T010–T013.
import type {
  Route,
  RoutingResult,
  SuppressionRecord,
  Stats,
  AlertFilters,
  InMemoryStore,
} from './types.js';

export function createStore(): InMemoryStore {
  return {
    addRoute(_r: Route): { id: string; created: boolean } {
      throw new Error('not implemented');
    },
    listRoutes(): Route[] {
      throw new Error('not implemented');
    },
    getRoute(_id: string): Route | undefined {
      throw new Error('not implemented');
    },
    deleteRoute(_id: string): boolean {
      throw new Error('not implemented');
    },
    routeCount(): number {
      throw new Error('not implemented');
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
