import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type {
  Alert,
  AlertFilters,
  InMemoryStore,
  RoutingResult,
} from '../types.js';
import { alertBodySchema } from '../schemas.js';
import { isValidIsoInstant, hasDangerousKey } from '../validators.js';
import type { Router } from '../router.js';

export interface AlertsDeps {
  store: InMemoryStore;
  router: Router;
}

/**
 * Strip router-internal bookkeeping fields (`_alert`, `_submissionOrder`)
 * before serialising a RoutingResult to an API response. `suppression_reason`
 * is preserved only when present — the router conditionally assigns it,
 * so the spread-rest preserves its presence/absence.
 */
function stripInternalFields(
  r: RoutingResult,
): Omit<RoutingResult, '_alert' | '_submissionOrder'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _alert, _submissionOrder, ...rest } = r;
  return rest;
}

const alertsPlugin: FastifyPluginAsync<AlertsDeps> = async (
  app: FastifyInstance,
  opts: AlertsDeps,
) => {
  const { store, router } = opts;

  // --- POST /alerts ---------------------------------------------------------
  app.post(
    '/alerts',
    {
      schema: { body: alertBodySchema },
      attachValidation: true,
    },
    async (request, reply) => {
      // Stage 1: Fastify JSON-schema validation (shape / enum / required).
      if (request.validationError) {
        const msg =
          request.validationError.message &&
          request.validationError.message.length > 0
            ? request.validationError.message
            : 'invalid request body';
        return reply.code(400).send({ error: msg });
      }

      const body = request.body as Alert;

      // Stage 2a: ISO 8601 absolute-instant check (JSON Schema allows any string).
      if (!isValidIsoInstant(body.timestamp)) {
        return reply
          .code(400)
          .send({ error: 'timestamp must be an ISO 8601 absolute instant' });
      }

      // Stage 2b: reject prototype-pollution vectors in labels.
      if (
        body.labels !== undefined &&
        hasDangerousKey(body.labels as Record<string, unknown>)
      ) {
        return reply.code(400).send({ error: 'labels contains reserved key' });
      }

      // NFR-R-005 / T034 validation atomicity: ALL checks above must pass
      // before we touch the store. Router.evaluate mutates stats +
      // suppressions; store.upsertAlert persists the result.
      const result = router.evaluate(body);
      store.upsertAlert(result);

      return reply.code(200).send(stripInternalFields(result));
    },
  );

  // --- GET /alerts ----------------------------------------------------------
  app.get<{
    Querystring: {
      service?: string;
      severity?: string;
      routed?: string;
      suppressed?: string;
    };
  }>('/alerts', async (request) => {
    const filters: AlertFilters = {
      service: request.query.service,
      severity: request.query.severity,
      routed: request.query.routed,
      suppressed: request.query.suppressed,
    };
    const results = store.listAlerts(filters);
    const alerts = results.map(stripInternalFields);
    return { alerts, total: alerts.length };
  });

  // --- GET /alerts/:id ------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/alerts/:id',
    async (request, reply) => {
      const { id } = request.params;
      const r = store.getAlert(id);
      if (!r) {
        return reply.code(404).send({ error: 'alert not found' });
      }
      return reply.code(200).send(stripInternalFields(r));
    },
  );
};

export default alertsPlugin;
