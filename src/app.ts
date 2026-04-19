import Fastify, { FastifyInstance } from 'fastify';
import { createStore } from './store.js';
import type { InMemoryStore } from './types.js';
import routesPlugin from './routes/routes.js';

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

  app.get('/health', async () => ({ status: 'ok' }));

  // Stream A: route CRUD handlers.
  app.register(routesPlugin, { store });

  return { app, store };
}
