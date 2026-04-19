// Pure matcher — no store, no framework imports. See T021 boundary gate.
import { minimatch } from 'minimatch';
import type { Alert, Route, RouteConditions } from './types.js';

const MINIMATCH_OPTS = { nobrace: true, noext: true, nonegate: true } as const;

function compileGlob(pattern: string): RegExp {
  // NEVER `new RegExp(userInput)` — minimatch.makeRe returns false for invalid patterns.
  const re = minimatch.makeRe(pattern, MINIMATCH_OPTS);
  if (re === false) {
    // Unreachable for the whitelist of glob chars validators permit, but guard anyway:
    // treat invalid pattern as matching nothing rather than throwing at match time.
    return /^\0$/;
  }
  return re;
}

function matchesService(patterns: readonly string[], service: string): boolean {
  for (const p of patterns) {
    if (compileGlob(p).test(service)) return true;
  }
  return false;
}

function matchesLabels(required: Record<string, string>, actual: Alert['labels']): boolean {
  for (const [k, v] of Object.entries(required)) {
    if (!actual || actual[k] !== v) return false;
  }
  return true;
}

export function matchesConditions(route: Route, alert: Alert): boolean {
  const c: RouteConditions = route.conditions;

  if (c.severity !== undefined && !c.severity.includes(alert.severity)) return false;
  if (c.service !== undefined && !matchesService(c.service, alert.service)) return false;
  if (c.group !== undefined && !c.group.includes(alert.group)) return false;
  if (c.labels !== undefined && !matchesLabels(c.labels, alert.labels)) return false;

  return true;
}
