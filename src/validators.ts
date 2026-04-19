// Cross-field / semantic validators that JSON Schema cannot cleanly express.
// Kept pure and side-effect-free so they can be exercised in isolation.

import { DateTime, IANAZone } from 'luxon';

/**
 * FR-031 — Route.active_hours.timezone must be a valid IANA zone.
 * Uses luxon's IANAZone.isValidZone for membership, but enforces
 * IANA case-sensitivity on top (luxon normalises case; the IANA spec does
 * not — e.g. `UTC` is canonical, `utc` is not a valid zone name).
 */
export function isValidIanaTimezone(zone: string): boolean {
  if (typeof zone !== 'string' || zone.length === 0) return false;
  if (!IANAZone.isValidZone(zone)) return false;
  // Luxon preserves input case in .name; enforce IANA case-sensitivity
  // by comparing to the canonical form resolved by Intl.
  try {
    const canonical = Intl.DateTimeFormat('en-US', {
      timeZone: zone,
    }).resolvedOptions().timeZone;
    return canonical === zone;
  } catch {
    return false;
  }
}

/**
 * FR-032 — Route.active_hours.start / end must be `HH:MM`, zero-padded,
 * 00:00–23:59.
 */
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export function isValidHHMM(value: string): boolean {
  if (typeof value !== 'string') return false;
  return HHMM_RE.test(value);
}

/**
 * FR-034 — Alert.timestamp must be an ISO 8601 absolute instant.
 * Luxon parses date-only strings as local midnight and marks them valid;
 * we reject those explicitly by requiring `T` + (`Z` or `±HH:MM` offset).
 */
const OFFSET_OR_Z_RE = /(Z|[+-]\d{2}:?\d{2})$/;
export function isValidIsoInstant(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (!value.includes('T')) return false;
  if (!OFFSET_OR_Z_RE.test(value)) return false;
  const dt = DateTime.fromISO(value, { setZone: true });
  return dt.isValid;
}

/**
 * FR-035 — Route.priority must be a finite integer (pos / zero / neg all ok).
 */
export function isValidIntegerPriority(n: unknown): boolean {
  return (
    typeof n === 'number' &&
    Number.isFinite(n) &&
    Number.isInteger(n)
  );
}

/**
 * FR-036 — Route.suppression_window_seconds must be a non-negative integer.
 */
export function isValidSuppressionWindow(n: unknown): boolean {
  return (
    typeof n === 'number' &&
    Number.isFinite(n) &&
    Number.isInteger(n) &&
    n >= 0
  );
}

/**
 * FR-031a — Route.target (webhook).headers values must be strings.
 * undefined is allowed because headers is optional on webhook targets.
 */
export function areValidHeaderValues(
  headers: Record<string, unknown> | undefined
): boolean {
  if (headers === undefined) return true;
  if (headers === null || typeof headers !== 'object') return false;
  for (const key of Object.keys(headers)) {
    if (typeof headers[key] !== 'string') return false;
  }
  return true;
}

/**
 * NFR-S-003 — Reject payloads whose OWN enumerable keys include the classic
 * prototype-pollution vectors. Inherited keys (e.g. Object.prototype.constructor)
 * are ignored because Object.keys only returns own properties.
 * Consumed by T033's pollution guard middleware.
 */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export function hasDangerousKey(obj: Record<string, unknown>): boolean {
  if (obj === null || typeof obj !== 'object') return false;
  return Object.keys(obj).some((k) => DANGEROUS_KEYS.has(k));
}
