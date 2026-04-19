// Fastify JSON Schemas for request-body shape + enum validation.
// Cross-field semantic rules (IANA zones, HH:MM, ISO 8601 instants,
// integer priority, webhook header value types, prototype-pollution keys)
// live in ./validators.ts because JSON Schema can't express them cleanly.

export const routeBodySchema = {
  type: 'object',
  required: ['id', 'priority', 'conditions', 'target'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', minLength: 1 },
    // JSON Schema's `integer` support varies across toolchains; we accept
    // `number` here and enforce the integer constraint in validators.ts.
    priority: { type: 'number' },
    conditions: {
      type: 'object',
      additionalProperties: false,
      properties: {
        severity: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['critical', 'warning', 'info'],
          },
        },
        service: { type: 'array', items: { type: 'string' } },
        group: { type: 'array', items: { type: 'string' } },
        labels: {
          type: 'object',
          additionalProperties: { type: 'string' },
        },
      },
    },
    target: {
      oneOf: [
        {
          type: 'object',
          required: ['type', 'channel'],
          additionalProperties: false,
          properties: {
            type: { const: 'slack' },
            channel: { type: 'string', minLength: 1 },
          },
        },
        {
          type: 'object',
          required: ['type', 'address'],
          additionalProperties: false,
          properties: {
            type: { const: 'email' },
            address: { type: 'string', minLength: 1 },
          },
        },
        {
          type: 'object',
          required: ['type', 'service_key'],
          additionalProperties: false,
          properties: {
            type: { const: 'pagerduty' },
            service_key: { type: 'string', minLength: 1 },
          },
        },
        {
          type: 'object',
          required: ['type', 'url'],
          additionalProperties: false,
          properties: {
            type: { const: 'webhook' },
            url: { type: 'string', minLength: 1 },
            // Header-value string-type enforced in validators.ts.
            headers: { type: 'object' },
          },
        },
      ],
    },
    // Non-negative integer check lives in validators.ts.
    suppression_window_seconds: { type: 'number' },
    active_hours: {
      type: 'object',
      required: ['start', 'end', 'timezone'],
      additionalProperties: false,
      properties: {
        start: { type: 'string' },
        end: { type: 'string' },
        timezone: { type: 'string' },
      },
    },
  },
} as const;

export const alertBodySchema = {
  type: 'object',
  required: ['id', 'severity', 'service', 'group', 'timestamp'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', minLength: 1 },
    severity: {
      type: 'string',
      enum: ['critical', 'warning', 'info'],
    },
    service: { type: 'string', minLength: 1 },
    group: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    // ISO 8601 absolute-instant check lives in validators.ts.
    timestamp: { type: 'string' },
    labels: {
      type: 'object',
      additionalProperties: { type: 'string' },
    },
  },
} as const;
