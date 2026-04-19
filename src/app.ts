import Fastify, { FastifyInstance } from 'fastify';
import { createStore } from './store.js';
import type { InMemoryStore } from './types.js';
import { createRouter } from './router.js';
import routesPlugin from './routes/routes.js';
import alertsPlugin from './routes/alerts.js';
import statsPlugin from './routes/stats.js';

export interface BuiltApp {
  app: FastifyInstance;
  store: InMemoryStore;
}

export function buildApp(): BuiltApp {
  const app = Fastify({
    bodyLimit: 1_048_576,
    logger: { level: 'info' },
    disableRequestLogging: false,
  });
  // Fastify 4 has X-Powered-By disabled by default; no extra step needed.

  const store = createStore();
  const router = createRouter(store);

  app.get('/health', async () => ({ status: 'ok' }));

  // Stream A: route CRUD handlers.
  app.register(routesPlugin, { store });
  // Stream B: alert ingest + query handlers.
  app.register(alertsPlugin, { store, router });
  // Stream C: stats read handler.
  app.register(statsPlugin, { store });

  return { app, store };
}
