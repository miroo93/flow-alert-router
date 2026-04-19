import Fastify, { FastifyInstance } from 'fastify';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    bodyLimit: 1_048_576,
    logger: { level: 'info' },
    disableRequestLogging: false,
  });
  // Fastify 4 has X-Powered-By disabled by default; no extra step needed.
  app.get('/health', async () => ({ status: 'ok' }));
  return app;
}
