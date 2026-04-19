import Fastify, { FastifyInstance } from 'fastify';
import { createStore } from './store.js';
import type { InMemoryStore } from './types.js';
import { createRouter } from './router.js';
import routesPlugin from './routes/routes.js';
import alertsPlugin from './routes/alerts.js';
import statsPlugin from './routes/stats.js';
import systemPlugin from './routes/system.js';

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

  // T030: global error fallback. Any thrown exception → 500 {"error":"internal error"}.
  // Client-caused errors Fastify tags with a 4xx statusCode (e.g. 413 body-too-large,
  // 400 schema validation via throw) pass through unchanged. Real 500s log the raw
  // error via app.log but MUST NOT leak the message or stack in the response body.
  app.setErrorHandler((err, _request, reply) => {
    const code = err.statusCode ?? 500;
    if (code >= 500) {
      app.log.error({ err }, 'unhandled exception');
      return reply.code(500).send({ error: 'internal error' });
    }
    const msg = err.message && err.message.length > 0 ? err.message : 'bad request';
    return reply.code(code).send({ error: msg });
  });

  const store = createStore();
  const router = createRouter(store);

  app.get('/health', async () => ({ status: 'ok' }));

  // Stream A: route CRUD handlers.
  app.register(routesPlugin, { store });
  // Stream B: alert ingest + query handlers.
  app.register(alertsPlugin, { store, router });
  // Stream C: stats read handler.
  app.register(statsPlugin, { store });
  // Stream D: POST /test (dry run) + POST /reset.
  app.register(systemPlugin, { store, router });

  return { app, store };
}
