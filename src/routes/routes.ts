import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { InMemoryStore, Route } from '../types.js';
import { routeBodySchema } from '../schemas.js';
import {
  isValidIanaTimezone,
  isValidHHMM,
  isValidIntegerPriority,
  isValidSuppressionWindow,
  areValidHeaderValues,
  hasDangerousKey,
} from '../validators.js';

export interface RoutesDeps {
  store: InMemoryStore;
}

/**
 * Strip store-internal bookkeeping fields (_insertionOrder) before
 * serialising a Route to an API response.
 */
function stripInternalFields(r: Route): Omit<Route, '_insertionOrder'> {
  const { _insertionOrder: _ignored, ...rest } = r;
  return rest;
}

const routesPlugin: FastifyPluginAsync<RoutesDeps> = async (
  app: FastifyInstance,
  opts: RoutesDeps,
) => {
  const { store } = opts;

  // --- POST /routes ---------------------------------------------------------
  app.post(
    '/routes',
    {
      schema: { body: routeBodySchema },
      attachValidation: true,
    },
    async (request, reply) => {
      // Stage 1: Fastify JSON-schema validation (shape / enum / required).
      if (request.validationError) {
        const msg =
          request.validationError.message && request.validationError.message.length > 0
            ? request.validationError.message
            : 'invalid request body';
        return reply.code(400).send({ error: msg });
      }

      // At this point the body matches routeBodySchema; narrow with a cast.
      const body = request.body as Route & {
        suppression_window_seconds?: number;
      };

      // Stage 2a: integer priority (JSON Schema accepts any number).
      if (!isValidIntegerPriority(body.priority)) {
        return reply.code(400).send({ error: 'priority must be an integer' });
      }

      // Stage 2b: suppression_window_seconds must be non-negative integer.
      if (
        body.suppression_window_seconds !== undefined &&
        !isValidSuppressionWindow(body.suppression_window_seconds)
      ) {
        return reply
          .code(400)
          .send({ error: 'suppression_window_seconds must be a non-negative integer' });
      }

      // Stage 2c: active_hours semantic checks.
      if (body.active_hours !== undefined) {
        const { start, end, timezone } = body.active_hours;
        if (!isValidHHMM(start)) {
          return reply
            .code(400)
            .send({ error: 'active_hours.start must be HH:MM (00:00–23:59)' });
        }
        if (!isValidHHMM(end)) {
          return reply
            .code(400)
            .send({ error: 'active_hours.end must be HH:MM (00:00–23:59)' });
        }
        if (!isValidIanaTimezone(timezone)) {
          return reply
            .code(400)
            .send({ error: 'active_hours.timezone must be a valid IANA zone' });
        }
      }

      // Stage 2d: webhook headers must be string-valued + free of dangerous keys.
      if (body.target.type === 'webhook') {
        const headers = body.target.headers as Record<string, unknown> | undefined;
        if (!areValidHeaderValues(headers)) {
          return reply
            .code(400)
            .send({ error: 'webhook headers must have string values' });
        }
        if (headers !== undefined && hasDangerousKey(headers)) {
          return reply
            .code(400)
            .send({ error: 'webhook headers contains reserved key' });
        }
      }

      // Stage 2e: reject prototype-pollution vectors in labels.
      if (
        body.conditions &&
        body.conditions.labels !== undefined &&
        hasDangerousKey(body.conditions.labels as Record<string, unknown>)
      ) {
        return reply.code(400).send({ error: 'labels contains reserved key' });
      }

      // All validation passed — upsert.
      const result = store.addRoute(body);
      return reply.code(201).send(result);
    },
  );

  // --- GET /routes ----------------------------------------------------------
  app.get('/routes', async () => {
    return { routes: store.listRoutes().map(stripInternalFields) };
  });

  // --- DELETE /routes/:id ---------------------------------------------------
  app.delete<{ Params: { id: string } }>('/routes/:id', async (request, reply) => {
    const { id } = request.params;
    const deleted = store.deleteRoute(id);
    if (!deleted) {
      return reply.code(404).send({ error: 'route not found' });
    }
    return reply.code(200).send({ id, deleted: true });
  });
};

export default routesPlugin;
