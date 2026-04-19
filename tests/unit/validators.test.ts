import { describe, it, expect } from 'vitest';
import {
  isValidIanaTimezone,
  isValidHHMM,
  isValidIsoInstant,
  isValidIntegerPriority,
  isValidSuppressionWindow,
  areValidHeaderValues,
  hasDangerousKey,
} from '../../src/validators';

describe('isValidIanaTimezone (FR-031)', () => {
  it('accepts common IANA zones', () => {
    expect(isValidIanaTimezone('America/New_York')).toBe(true);
    expect(isValidIanaTimezone('Asia/Tokyo')).toBe(true);
    expect(isValidIanaTimezone('Europe/London')).toBe(true);
  });

  it('accepts UTC (canonical uppercase)', () => {
    expect(isValidIanaTimezone('UTC')).toBe(true);
  });

  it('rejects lowercase utc (case-sensitive per IANA spec)', () => {
    expect(isValidIanaTimezone('utc')).toBe(false);
  });

  it('rejects fictional / invalid zones', () => {
    expect(isValidIanaTimezone('Mars/Phobos')).toBe(false);
    expect(isValidIanaTimezone('')).toBe(false);
    expect(isValidIanaTimezone('Not/A/Zone')).toBe(false);
  });
});

describe('isValidHHMM (FR-032)', () => {
  it('accepts valid HH:MM values', () => {
    expect(isValidHHMM('09:00')).toBe(true);
    expect(isValidHHMM('23:59')).toBe(true);
    expect(isValidHHMM('00:00')).toBe(true);
    expect(isValidHHMM('12:30')).toBe(true);
  });

  it('rejects non-zero-padded single-digit hours', () => {
    expect(isValidHHMM('9:00')).toBe(false);
  });

  it('rejects values with seconds', () => {
    expect(isValidHHMM('09:00:00')).toBe(false);
  });

  it('rejects out-of-range hour', () => {
    expect(isValidHHMM('24:00')).toBe(false);
    expect(isValidHHMM('99:00')).toBe(false);
  });

  it('rejects out-of-range minute', () => {
    expect(isValidHHMM('09:60')).toBe(false);
    expect(isValidHHMM('09:99')).toBe(false);
  });

  it('rejects empty / garbage', () => {
    expect(isValidHHMM('')).toBe(false);
    expect(isValidHHMM('abc')).toBe(false);
  });
});

describe('isValidIsoInstant (FR-034)', () => {
  it('accepts Z suffix', () => {
    expect(isValidIsoInstant('2026-04-19T10:00:00Z')).toBe(true);
  });

  it('accepts +00:00 offset', () => {
    expect(isValidIsoInstant('2026-04-19T10:00:00+00:00')).toBe(true);
  });

  it('accepts negative offset', () => {
    expect(isValidIsoInstant('2026-04-19T10:00:00-05:00')).toBe(true);
  });

  it('accepts fractional seconds with Z', () => {
    expect(isValidIsoInstant('2026-04-19T10:00:00.123Z')).toBe(true);
  });

  it('rejects date-only strings (no absolute instant)', () => {
    expect(isValidIsoInstant('2026-04-19')).toBe(false);
  });

  it('rejects local-time strings with no offset', () => {
    expect(isValidIsoInstant('2026-04-19T10:00:00')).toBe(false);
  });

  it('rejects free-form date text', () => {
    expect(isValidIsoInstant('March 25')).toBe(false);
    expect(isValidIsoInstant('not-a-date')).toBe(false);
    expect(isValidIsoInstant('')).toBe(false);
  });
});

describe('isValidIntegerPriority (FR-035)', () => {
  it('accepts positive, zero, and negative integers', () => {
    expect(isValidIntegerPriority(3)).toBe(true);
    expect(isValidIntegerPriority(0)).toBe(true);
    expect(isValidIntegerPriority(-1)).toBe(true);
    expect(isValidIntegerPriority(1_000_000)).toBe(true);
  });

  it('rejects non-integer numbers', () => {
    expect(isValidIntegerPriority(3.5)).toBe(false);
    expect(isValidIntegerPriority(0.1)).toBe(false);
  });

  it('rejects non-number types', () => {
    expect(isValidIntegerPriority('high' as unknown as number)).toBe(false);
    expect(isValidIntegerPriority(null as unknown as number)).toBe(false);
    expect(isValidIntegerPriority(undefined as unknown as number)).toBe(false);
    expect(isValidIntegerPriority(true as unknown as number)).toBe(false);
  });

  it('rejects NaN and Infinity', () => {
    expect(isValidIntegerPriority(NaN)).toBe(false);
    expect(isValidIntegerPriority(Infinity)).toBe(false);
    expect(isValidIntegerPriority(-Infinity)).toBe(false);
  });
});

describe('isValidSuppressionWindow (FR-036)', () => {
  it('accepts zero and positive integers', () => {
    expect(isValidSuppressionWindow(0)).toBe(true);
    expect(isValidSuppressionWindow(300)).toBe(true);
    expect(isValidSuppressionWindow(86400)).toBe(true);
  });

  it('rejects negative values', () => {
    expect(isValidSuppressionWindow(-1)).toBe(false);
  });

  it('rejects non-integers', () => {
    expect(isValidSuppressionWindow(3.5)).toBe(false);
  });

  it('rejects non-number types', () => {
    expect(isValidSuppressionWindow('300' as unknown as number)).toBe(false);
    expect(isValidSuppressionWindow(null as unknown as number)).toBe(false);
  });

  it('rejects NaN / Infinity', () => {
    expect(isValidSuppressionWindow(NaN)).toBe(false);
    expect(isValidSuppressionWindow(Infinity)).toBe(false);
  });
});

describe('areValidHeaderValues (FR-031a)', () => {
  it('accepts undefined (optional field)', () => {
    expect(areValidHeaderValues(undefined)).toBe(true);
  });

  it('accepts all-string maps', () => {
    expect(areValidHeaderValues({ 'X-Auth': 'token' })).toBe(true);
    expect(
      areValidHeaderValues({ 'X-Auth': 'token', 'X-Trace': 'abc' })
    ).toBe(true);
    expect(areValidHeaderValues({})).toBe(true);
  });

  it('rejects non-string values', () => {
    expect(areValidHeaderValues({ 'X-Count': 1 as unknown as string })).toBe(
      false
    );
    expect(
      areValidHeaderValues({ 'X-Thing': { x: 1 } as unknown as string })
    ).toBe(false);
    expect(
      areValidHeaderValues({ 'X-Null': null as unknown as string })
    ).toBe(false);
  });
});

describe('hasDangerousKey (NFR-S-003 — prototype pollution guard)', () => {
  it('flags own __proto__ key (as produced by JSON.parse)', () => {
    // The literal `{ __proto__: 'x' }` sets the prototype instead of creating
    // an own property, so it can't exercise this guard. A real attack vector
    // is a JSON request body; JSON.parse preserves __proto__ as an own key.
    const payload = JSON.parse('{"__proto__":"x"}') as Record<string, unknown>;
    expect(hasDangerousKey(payload)).toBe(true);
  });

  it('flags constructor key', () => {
    expect(hasDangerousKey({ constructor: 'x' })).toBe(true);
  });

  it('flags prototype key', () => {
    expect(hasDangerousKey({ prototype: 'x' })).toBe(true);
  });

  it('accepts safe keys', () => {
    expect(hasDangerousKey({ safe: 'x', env: 'prod' })).toBe(false);
    expect(hasDangerousKey({})).toBe(false);
  });
});
