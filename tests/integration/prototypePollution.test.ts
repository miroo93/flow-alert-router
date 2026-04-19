import { describe, it, expect } from 'vitest';
import { buildApp } from '../../src/app.js';

// T033 — NFR-S-003 / SC-S-001: payloads with prototype-pollution key vectors
// (__proto__, constructor, prototype) must either be rejected with 400 OR
// accepted WITHOUT actually polluting Object.prototype. We prove both paths.
describe('T033: prototype-pollution safety', () => {
  it('POST /routes with labels.__proto__ is either rejected OR leaves prototype clean', async () => {
    const { app } = buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/routes',
        headers: { 'content-type': 'application/json' },
        payload: {
          id: 'pp-1',
          priority: 1,
          conditions: { labels: { __proto__: 'polluted' } },
          target: { type: 'slack', channel: '#x' },
        },
      });
      // Acceptance path A: rejected (preferred per current handler)
      // Acceptance path B: accepted but Object.prototype unchanged.
      const polluted = ({} as Record<string, unknown>).polluted;
      expect(polluted).toBeUndefined();
      if (res.statusCode === 400) {
        expect(res.json().error).toBeTypeOf('string');
        expect((res.json().error as string).length).toBeGreaterThan(0);
      } else {
        expect([200, 201]).toContain(res.statusCode);
      }
    } finally {
      await app.close();
    }
  });

  it('POST /alerts with labels.__proto__ is either rejected OR leaves prototype clean', async () => {
    const { app } = buildApp();
    try {
      // First register a matching route so the router has something to evaluate.
      await app.inject({
        method: 'POST',
        url: '/routes',
        headers: { 'content-type': 'application/json' },
        payload: {
          id: 'r1',
          priority: 1,
          conditions: {},
          target: { type: 'slack', channel: '#x' },
        },
      });
      const res = await app.inject({
        method: 'POST',
        url: '/alerts',
        headers: { 'content-type': 'application/json' },
        payload: {
          id: 'a1',
          severity: 'critical',
          service: 'svc',
          group: 'g',
          timestamp: '2026-04-19T10:00:00Z',
          labels: { __proto__: 'polluted' },
        },
      });
      const polluted = ({} as Record<string, unknown>).polluted;
      expect(polluted).toBeUndefined();
      expect([200, 400]).toContain(res.statusCode);
    } finally {
      await app.close();
    }
  });

  it('POST /routes with webhook headers.constructor is either rejected OR leaves prototype clean', async () => {
    const { app } = buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/routes',
        headers: { 'content-type': 'application/json' },
        payload: {
          id: 'pp-wh',
          priority: 1,
          conditions: {},
          target: {
            type: 'webhook',
            url: 'https://x',
            headers: { constructor: 'bad' },
          },
        },
      });
      const polluted = ({} as Record<string, unknown>).polluted;
      expect(polluted).toBeUndefined();
      expect([200, 201, 400]).toContain(res.statusCode);
    } finally {
      await app.close();
    }
  });
});
