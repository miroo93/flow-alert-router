// Router reads from store, writes to store; matcher is pure.
// No fastify / no handler imports — see T021 boundary gate.
import type { Alert, InMemoryStore, RoutingResult } from './types.js';

export interface EvaluateOptions {
  dryRun?: boolean;
}

export interface Router {
  evaluate(alert: Alert, opts?: EvaluateOptions): RoutingResult;
}

export function createRouter(_store: InMemoryStore): Router {
  return {
    evaluate(_alert: Alert, _opts: EvaluateOptions = {}): RoutingResult {
      throw new Error('not implemented');
    },
  };
}
