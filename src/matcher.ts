// Pure matcher — no store, no framework imports. See T021 boundary gate.
import type { Alert, Route } from './types.js';

export function matchesConditions(_route: Route, _alert: Alert): boolean {
  throw new Error('not implemented');
}
