import { describe, it, expect, beforeEach } from 'vitest';
import { createStore } from '../../src/store.js';
import type { Route } from '../../src/types.js';

const baseRoute = (overrides: Partial<Route> = {}): Route => ({
  id: 'r1',
  priority: 10,
  conditions: {},
  target: { type: 'slack', channel: '#ops' },
  ...overrides,
});

describe('store.routes', () => {
  let store: ReturnType<typeof createStore>;
  beforeEach(() => {
    store = createStore();
  });

  it('addRoute returns {created:true} on first insert and {created:false} on re-post', () => {
    expect(store.addRoute(baseRoute({ id: 'r1' }))).toEqual({ id: 'r1', created: true });
    expect(store.addRoute(baseRoute({ id: 'r1', priority: 99 }))).toEqual({ id: 'r1', created: false });
  });

  it('listRoutes preserves insertion order', () => {
    store.addRoute(baseRoute({ id: 'a' }));
    store.addRoute(baseRoute({ id: 'b' }));
    store.addRoute(baseRoute({ id: 'c' }));
    expect(store.listRoutes().map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('re-posted route keeps its original insertion position (tie-break anchor)', () => {
    store.addRoute(baseRoute({ id: 'a', priority: 1 }));
    store.addRoute(baseRoute({ id: 'b', priority: 2 }));
    store.addRoute(baseRoute({ id: 'c', priority: 3 }));
    // Re-post 'a' with a new priority; its position in iteration order must stay first.
    store.addRoute(baseRoute({ id: 'a', priority: 100 }));
    const ids = store.listRoutes().map((r) => r.id);
    expect(ids).toEqual(['a', 'b', 'c']);
    expect(store.getRoute('a')?.priority).toBe(100);
  });

  it('deleteRoute returns false for unknown id and true after successful remove', () => {
    expect(store.deleteRoute('ghost')).toBe(false);
    store.addRoute(baseRoute({ id: 'r1' }));
    expect(store.deleteRoute('r1')).toBe(true);
    expect(store.getRoute('r1')).toBeUndefined();
    expect(store.deleteRoute('r1')).toBe(false);
  });

  it('routeCount reflects current size', () => {
    expect(store.routeCount()).toBe(0);
    store.addRoute(baseRoute({ id: 'a' }));
    store.addRoute(baseRoute({ id: 'b' }));
    expect(store.routeCount()).toBe(2);
    store.deleteRoute('a');
    expect(store.routeCount()).toBe(1);
  });

  it('getRoute returns the stored record or undefined', () => {
    expect(store.getRoute('r1')).toBeUndefined();
    store.addRoute(baseRoute({ id: 'r1', priority: 42 }));
    expect(store.getRoute('r1')?.priority).toBe(42);
  });
});
