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
  // T031: per-request timeout budget. Production default is 30 s (NFR-R-007);
  // tests override via REQUEST_TIMEOUT_MS for CI speed.
  const TIMEOUT_MS = Number.parseInt(process.env.REQUEST_TIMEOUT_MS ?? '', 10);
  const requestTimeoutMs =
    Number.isFinite(TIMEOUT_MS) && TIMEOUT_MS > 0 ? TIMEOUT_MS : 30_000;

  const app = Fastify({
    bodyLimit: 1_048_576,
    logger: { level: 'info' },
    disableRequestLogging: false,
    // Socket-level belt-and-braces (NFR-R-007). Applies to real TCP sockets;
    // fastify.inject() does not exercise this path.
    connectionTimeout: 30_000,
  });
  // Fastify 4 has X-Powered-By disabled by default; no extra step needed.

  // T032: reject URLs/query strings > 2 KiB (NFR-S-002). Guards against
  // DoS via absurdly long URIs without touching the body path.
  const MAX_URL_BYTES = 2048;
  app.addHook('onRequest', (request, reply, done) => {
    const url = request.raw.url ?? '';
    if (Buffer.byteLength(url, 'utf8') > MAX_URL_BYTES) {
      reply.code(414).send({ error: 'request URI too long' });
      return;
    }
    done();
  });

  // T031: arm a per-request timer on each incoming request. If the handler
  // takes longer than the budget AND the reply is not yet sent, respond
  // 503 {error:'request timed out'}. Cleared on normal completion.
  // Caveat (documented in README "Known limitations" per NFR-R-007):
  // this wrapper only interrupts ASYNC handlers. A synchronous CPU-bound
  // handler cannot be preempted by Node's single-threaded event loop —
  // proper interruption of those would require a worker-thread pool.
  app.addHook('onRequest', (_request, reply, done) => {
    const timer = setTimeout(() => {
      if (!reply.sent) {
        reply.code(503).send({ error: 'request timed out' });
      }
    }, requestTimeoutMs);
    // Clear on successful send or connection close.
    reply.raw.on('finish', () => clearTimeout(timer));
    reply.raw.on('close', () => clearTimeout(timer));
    done();
  });

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
