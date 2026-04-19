import type { FastifyPluginAsync } from 'fastify';
import type { InMemoryStore } from '../types.js';

export interface StatsDeps {
  store: InMemoryStore;
}

/**
 * GET /stats — returns the live stats object (FR-025, FR-025b).
 * Fastify serialises the returned object as JSON; the live reference is
 * safe to hand out because serialisation copies primitives/nested objects
 * in place — external mutation via the response is not possible.
 */
const statsPlugin: FastifyPluginAsync<StatsDeps> = async (app, opts) => {
  const { store } = opts;

  app.get('/stats', async () => store.stats());
};

export default statsPlugin;
