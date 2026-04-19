# Research & Library Rationale

**Feature**: Configurable Alert Routing Engine — see [plan.md](./plan.md) / [spec.md](./spec.md).

Scope: rationale for each third-party dependency, plus judgement calls surfaced for plan review.

## Library choices

### Fastify v4 (HTTP framework)
**Decision**: Fastify v4 over raw `node:http` or Express.
**Rationale**: native JSON-schema validation (AJV) covers ~80% of the validation surface in spec §Validation (FR-028…036) without hand-rolled request parsing; `bodyLimit` (NFR-S-001), `setErrorHandler` (NFR-R-001), graceful `close()` (NFR-R-003), and `disableRequestLogging: true` (NFR-S-010) are one-liners; default omits `X-Powered-By` (NFR-S-009). Schema-compiled fast path comfortably exceeds the 500 alerts/s smoke target (NFR-X-005).
**Alternatives**: raw `node:http` (too much hand-rolled validation for a 2-hour budget); Express (slower, AJV not native, `X-Powered-By` on by default).

### minimatch (service-glob engine)
**Decision**: `minimatch` with `{nobrace: true, noext: true, nonegate: true, dot: true}`.
**Rationale**: spec restricts globs to a single `*` wildcard on `service` values (FR-010). `minimatch` compiles the pattern to a vetted regex — satisfies NFR-S-004's ban on `new RegExp(userInput)`. Disabling brace-expansion, extglob, and negation keeps behaviour aligned with the spec (`*` only; no `?`, no character classes).
**Alternatives**: hand-rolled `pattern → regex` with `\*` → `.*` and other chars `RegExp.escape`'d — a 15-line function, arguably fewer deps. Rejected because a vetted library reduces security review surface and matches the NFR-S-004 intent exactly. Surfaced as a judgement call below.

### luxon (timezone conversion)
**Decision**: `luxon` `DateTime.fromISO(ts, { setZone: true }).setZone(tz).toFormat('HH:mm')` for active-hours evaluation; `IANAZone.isValidZone(tz)` for validation (FR-032).
**Rationale**: Node's built-in `Intl.DateTimeFormat` can format in an IANA zone but has no clean "is this a valid zone name" API (`formatToParts` + try/catch works but is ugly); luxon's `IANAZone.isValidZone` is one call. Luxon's ISO 8601 parser correctly treats `Z`-suffixed and offset-bearing strings as absolute instants (FR-034), and rejects date-only strings. Bounds the DST/historical-zone correctness risk called out in SC-005.
**Alternatives**: `Intl.DateTimeFormat` only (zone validation ugly); `date-fns-tz` (larger surface); hand-rolled `Date.toLocaleString('en-CA', {timeZone})` (parsing the result back is fragile).

## Judgement calls for plan review

These are decisions where either option is defensible; recording the chosen path and why, flagged for reviewer override:

1. **Fastify vs raw `node:http`**
   - Chose Fastify. Buys AJV JSON-schema, body-limit, graceful close, error hooks. Cost: ~2 MB in node_modules and one framework dep. Alt: raw http is ~150 more LOC of request parsing + validation plumbing; acceptable but eats into the 2-hour budget.
2. **minimatch vs hand-rolled `*`→regex**
   - Chose minimatch. See §minimatch above. A hand-rolled compiler would be smaller, but the security-review argument (NFR-S-004) is easier to defend with a library.
3. **luxon vs `Intl.DateTimeFormat`**
   - Chose luxon for `IANAZone.isValidZone` and clean ISO 8601 parsing. `Intl`-only path is viable (~30 extra LOC) but pushes complexity into `validators.ts`.
4. **AJV strict-mode posture**
   - Plan: run AJV in default strict-mode. Any schema keyword it rejects will trigger a fix rather than loosening the schema.
5. **Request timeout enforcement (NFR-R-007)**
   - Plan: rely on Fastify's `connectionTimeout` (30 s) as the primary mechanism; handler-level timeout wrapper skipped unless smoke tests show stuck handlers. Alt: explicit per-route `Promise.race` wrapper — cleaner but more code for a risk that shouldn't materialise given the handlers are all sync + in-memory.

## Kotlin/GCP judgement call (separate deliverable)

6. **Firestore vs Spanner for the GCP design doc**
   - Recommend Firestore as the first production step (fast to start, document-shaped fits Route/Alert JSON, cheap below ~1k QPS). Migrate route catalogue to Spanner when (a) >10k routes, or (b) >5k alert-evals/s — Spanner's horizontal scale + real indexes on severity/group/label-keys matter there. Alerts collection can stay Firestore-native with TTL. Full rationale in `docs/kotlin-gcp-design.md`.

## Non-library decisions (already in plan)

- **Fastify JSON-schema for shape/enum, `validators.ts` for cross-field** — AJV can express most of FR-028…036 declaratively, but IANA zone validity, strict `HH:MM` bounds (hour ≤ 23), ISO 8601 absolute-instant-only (reject date-only), and "all webhook header values are strings" need custom checks. Keeping them in `validators.ts` makes them unit-testable without an HTTP client.
- **Insertion-order tie-break via `Map`** — JavaScript's `Map` iteration order is insertion order by spec. Relied on for FR-002 (routes list), FR-005a (matched_routes tie-break), FR-006 (winner tie-break), FR-024 (alerts list order).
