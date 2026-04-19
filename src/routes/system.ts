import type { FastifyPluginAsync } from 'fastify';
import type { Alert, InMemoryStore, RoutingResult } from '../types.js';
import { alertBodySchema } from '../schemas.js';
import { isValidIsoInstant, hasDangerousKey } from '../validators.js';
import type { Router } from '../router.js';

export interface SystemDeps {
  store: InMemoryStore;
  router: Router;
}

/**
 * Strip router-internal bookkeeping fields (`_alert`, `_submissionOrder`)
 * before serialising a RoutingResult to an API response. Mirrors the helper
 * in routes/alerts.ts — duplicated deliberately to avoid churning that file.
 */
function stripInternalFields(
  r: RoutingResult,
): Omit<RoutingResult, '_alert' | '_submissionOrder'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _alert, _submissionOrder, ...rest } = r;
  return rest;
}

const systemPlugin: FastifyPluginAsync<SystemDeps> = async (app, opts) => {
  const { store, router } = opts;

  // --- POST /test -----------------------------------------------------------
  // Dry run: same validation pipeline as POST /alerts, but
  // router.evaluate(..., {dryRun:true}) short-circuits before any store
  // mutation (verified by T020). We also explicitly do NOT call
  // store.upsertAlert — that's the whole point (FR-026).
  app.post(
    '/test',
    { schema: { body: alertBodySchema }, attachValidation: true },
    async (request, reply) => {
      if (request.validationError) {
        const msg =
          request.validationError.message &&
          request.validationError.message.length > 0
            ? request.validationError.message
            : 'invalid request body';
        return reply.code(400).send({ error: msg });
      }

      const body = request.body as Alert;

      if (!isValidIsoInstant(body.timestamp)) {
        return reply
          .code(400)
          .send({ error: 'timestamp must be an ISO 8601 absolute instant' });
      }

      if (
        body.labels !== undefined &&
        hasDangerousKey(body.labels as Record<string, unknown>)
      ) {
        return reply.code(400).send({ error: 'labels contains reserved key' });
      }

      const result = router.evaluate(body, { dryRun: true });
      return reply.code(200).send(stripInternalFields(result));
    },
  );
};

export default systemPlugin;
