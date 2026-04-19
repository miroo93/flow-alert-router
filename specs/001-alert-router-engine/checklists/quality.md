# Requirements Quality Checklist: Alert Routing Engine

**Purpose**: Unit tests for the spec and adjacent planning artifacts — validate requirements completeness, clarity, consistency, edge-case coverage, and measurability before `/speckit-tasks` / implementation.
**Created**: 2026-04-19
**Feature**: [spec.md](../spec.md) · adjacent: [plan.md](../plan.md), [data-model.md](../data-model.md), [contracts/api.md](../contracts/api.md), [quickstart.md](../quickstart.md)
**Scope**: 40 FR + 27 NFR + 10 SC + 8 NFR-SC across the spec, cross-referenced against CLAUDE.md invariants and the four supporting artifacts.

## Endpoint Coverage (Completeness)

- [ ] CHK001 Is there ≥1 FR for `POST /routes` behaviour and response shape? [Completeness, Spec §FR-001]
- [ ] CHK002 Is there ≥1 FR for `GET /routes` (including empty-state) response? [Completeness, Spec §FR-002]
- [ ] CHK003 Is there ≥1 FR for `DELETE /routes/:id` success AND 404 branches? [Completeness, Spec §FR-003]
- [ ] CHK004 Is there ≥1 FR for `POST /alerts` response shape covering routed, suppressed, and no-match variants? [Completeness, Spec §FR-004 / FR-004a / FR-004b / FR-004c]
- [ ] CHK005 Is there ≥1 FR for `GET /alerts` list with filters and empty state? [Completeness, Spec §FR-024]
- [ ] CHK006 Is there ≥1 FR for `GET /alerts/:id` success AND 404 branches? [Completeness, Spec §FR-023]
- [ ] CHK007 Is there ≥1 FR for `GET /stats` shape and post-reset baseline? [Completeness, Spec §FR-025 / FR-025b]
- [ ] CHK008 Is there ≥1 FR for `POST /test` dry-run isolation (no persist, no suppression mutation, no stats)? [Completeness, Spec §FR-026]
- [ ] CHK009 Is there ≥1 FR or NFR for `POST /reset` clearing routes + alerts + suppressions + stats? [Completeness, Spec §FR-027]
- [ ] CHK010 Is there an NFR for `GET /health` latency and state-immutability? [Completeness, Spec §NFR-R-006]

## Numeric Thresholds Stated (Clarity)

- [ ] CHK011 Is the JSON body limit stated as an exact byte count (1 MiB) in requirements and not as "reasonable"? [Clarity, Spec §NFR-S-001]
- [ ] CHK012 Is the URL/query-string limit stated as an exact byte count (2 KiB) in requirements? [Clarity, Spec §NFR-S-002]
- [ ] CHK013 Is the request-timeout threshold stated as an exact duration (30 s)? [Clarity, Spec §NFR-R-007]
- [ ] CHK014 Is the graceful-shutdown drain window stated as an exact duration (5 s) with the exit-code expectation? [Clarity, Spec §NFR-R-003 / SC-R-002]
- [ ] CHK015 Is the `GET /health` latency bound stated as an exact ms threshold (<50 ms)? [Clarity, Spec §NFR-R-006]
- [ ] CHK016 Is the container cold-start bound stated as an exact duration (10 s) with what "accepting connections" means? [Clarity, Spec §SC-002]
- [ ] CHK017 Is the throughput floor stated with exact route-count and workload composition (≥500 alerts/s, 100 routes, mixed matching)? [Clarity, Spec §NFR-X-005]
- [ ] CHK018 Is the "10k routes" scale threshold stated explicitly as the boundary where route-indexing guidance applies? [Clarity, Spec §NFR-X-009]

## Mandatory-Language Rigor (Clarity)

- [ ] CHK019 Does every FR use MUST / MUST NOT rather than "should" or "may"? [Clarity, Spec §Functional Requirements]
- [ ] CHK020 Does every NFR-R / NFR-S / NFR-X use MUST / MUST NOT for its normative claim? [Clarity, Spec §Non-Functional Requirements]
- [ ] CHK021 Are vague quantifiers ("some", "appropriate", "reasonable", "efficient", "fast") absent from normative text? [Ambiguity, Spec §all]
- [ ] CHK022 Are "active hours match/no-match" decisions described with the exact half-open interval language (start inclusive, end exclusive)? [Clarity, Spec §FR-021 / Edge Cases]
- [ ] CHK023 Is the glob semantics limited to `*` explicitly, with `?` and character classes explicitly out of scope? [Clarity, Spec §FR-010 / Assumptions]
- [ ] CHK024 Is "valid ISO 8601 datetime" defined by the absolute-instant requirement (Z or offset; date-only rejected)? [Clarity, Spec §FR-034 / Assumptions]
- [ ] CHK025 Is "valid HH:MM" pinned to a regex or equivalent ("^[0-2][0-9]:[0-5][0-9]$" with hour ≤ 23; "9:00"/"09:00:00"/"24:00" rejected)? [Clarity, Spec §FR-033]
- [ ] CHK026 Is `suppression_window_seconds: 0` explicitly stated as semantically identical to omission? [Clarity, Spec §FR-020]

## Exact-String & Shape Consistency (Consistency)

- [ ] CHK027 Is the `suppression_reason` template given verbatim and identical in spec FR-015, SC-010, and contracts/api.md? [Consistency, Spec §FR-015, §SC-010, Contracts §POST /alerts]
- [ ] CHK028 Is the error-body shape stated identically as `{"error": "<string>"}` across FR-003, FR-023, FR-028, NFR-R-001, and contracts/api.md? [Consistency]
- [ ] CHK029 Is the `GET /alerts` empty-state shape `{"alerts": [], "total": 0}` stated identically in FR-024 and contracts/api.md? [Consistency, Spec §FR-024]
- [ ] CHK030 Is the `GET /routes` empty-state shape `{"routes": []}` stated identically in FR-002 and contracts/api.md? [Consistency, Spec §FR-002]
- [ ] CHK031 Is the `POST /reset` response body `{"status": "ok"}` identical across FR-027 and contracts/api.md? [Consistency]
- [ ] CHK032 Does the priority-tie-break rule read identically across FR-005a, FR-006, Edge Cases, Assumptions, and data-model.md? [Consistency, Spec §FR-005a / FR-006]
- [ ] CHK033 Does the alert-upsert rule (FR-007) state the same "stats still increment on re-submission" language used in FR-025a and §SC-008? [Consistency]
- [ ] CHK034 Does CLAUDE.md's suppression-window invariant match FR-016 / FR-017 (alert-timestamp-driven, keyed `${routeId}:${service}`, starts from first non-suppressed alert)? [Consistency, CLAUDE.md §Architectural Invariants]
- [ ] CHK035 Are the three `POST /alerts` response variants in contracts/api.md (routed / suppressed / no-match) each anchored to a specific FR (FR-004a, FR-004b, FR-004c)? [Consistency, Contracts §POST /alerts]

## Stats Semantics (Consistency + Measurability)

- [ ] CHK036 Are the stats invariants in SC-009 stated identically in FR-025a (`processed = routed + suppressed + unrouted`; `route.total_matched ≥ route.total_routed + route.total_suppressed`)? [Consistency, Spec §FR-025a / §SC-009]
- [ ] CHK037 Is the "lazy per-route / per-service stat entry creation" rule stated explicitly (not inferred)? [Completeness, Spec §FR-025a / §FR-025b]
- [ ] CHK038 Is `by_severity` pre-populated with zeros at reset explicitly, with keys enumerated (`critical`, `warning`, `info`)? [Completeness, Spec §FR-025b]
- [ ] CHK039 Is `POST /test` explicitly named as not affecting any stats counter, in a requirement separate from the general dry-run rule? [Completeness, Spec §FR-026 / CLAUDE.md]
- [ ] CHK040 Is the data-model.md `Stats` interface consistent with the FR-025 field names (no field-name drift between FR and TypeScript type)? [Consistency, Data-model §Stats, Spec §FR-025]

## Landmine Edge-Case Coverage (Edge Cases)

- [ ] CHK041 Is there a dedicated FR/scenario for "suppression window expiry → subsequent alert routes again AND new window starts from that alert's timestamp"? [Edge Case, Spec §FR-017 / US 4 Scenario 3]
- [ ] CHK042 Is there a dedicated FR/scenario for "alert on a different service during an active suppression window is NOT suppressed"? [Edge Case, Spec §FR-019 / US 4 Scenario 4]
- [ ] CHK043 Is there a scenario that pins `active_hours` start-boundary MATCH and end-boundary NO-MATCH (inclusive/exclusive) explicitly? [Edge Case, Spec §US 5 Scenarios 4-5 / Edge Cases]
- [ ] CHK044 Is there a requirement that `evaluation_details.total_routes_evaluated` equals store size even when zero routes match? [Edge Case, Spec §FR-008 / §US 2 Scenario 3]
- [ ] CHK045 Is the `POST /test` state-isolation scenario pinned against a pre-existing suppression record (not just against an empty store)? [Edge Case, Spec §US 7 Scenario 3]
- [ ] CHK046 Is the "re-post alert by id preserves original submission order in `GET /alerts`" behaviour stated explicitly (not just implied by upsert)? [Edge Case, Spec §FR-024]
- [ ] CHK047 Is "strict request-body validation vs lenient query-param validation" stated explicitly as contrasting rules (FR-028 vs FR-024a)? [Clarity, Spec §FR-024a / §FR-028]
- [ ] CHK048 Is the deterministic ordering of `matched_routes` (priority-desc, tie-break by insertion order) explicitly stated, with tie-break direction defined? [Clarity, Spec §FR-005a]
- [ ] CHK049 Is `conditions: {}` explicitly called out as matching every alert (not left as inferred from "omitted fields match all")? [Edge Case, Spec §FR-014]
- [ ] CHK050 Is the "extra labels on alert are ignored; missing/mismatched required label causes no-match" rule stated in both directions? [Edge Case, Spec §FR-012 / §US 3 Scenarios 4-5]

## Validation Surface (Completeness)

- [ ] CHK051 Does every validation scenario (severity, target.type, target required field, webhook header value types, IANA tz, HH:MM, ISO 8601, priority integer, negative suppression window) map to a distinct FR (FR-028…FR-036)? [Completeness, Spec §Validation]
- [ ] CHK052 Is "request body is not valid JSON" or "wrong Content-Type" explicitly a 400 (FR-028a), distinct from missing-field 400? [Completeness, Spec §FR-028a]
- [ ] CHK053 Are the distinct bad-`HH:MM` forms enumerated explicitly (`9:00`, `09:00:00`, `24:00`) rather than left to "malformed"? [Clarity, Spec §FR-033]
- [ ] CHK054 Is "webhook headers non-string value → 400" stated explicitly (FR-031a), not left to the shape schema? [Completeness, Spec §FR-031a]
- [ ] CHK055 Is "no validation failure leaves partial state" stated as a dedicated NFR (NFR-R-005), not left to FR-028 alone? [Completeness, Spec §NFR-R-005]
- [ ] CHK056 Is the prototype-pollution rejection behaviour for `__proto__` / `constructor` / `prototype` keys stated in both the spec (NFR-S-003) and anchored to a measurable outcome (SC-S-001)? [Completeness, Spec §NFR-S-003 / §SC-S-001]

## Non-Functional Measurability (Measurability)

- [ ] CHK057 Can every SC-R/S/X item be verified without reading source code (curl-observable or `docker inspect`-observable)? [Measurability, Spec §Non-functional measurable outcomes]
- [ ] CHK058 Is SC-R-001 pinned to a specific follow-up-request expectation (health responds + next valid request succeeds)? [Measurability, Spec §SC-R-001]
- [ ] CHK059 Is SC-R-002's "clean exit within 6 s, no truncated JSON" stated in terms the grader can check (exit code + response integrity)? [Measurability, Spec §SC-R-002]
- [ ] CHK060 Is SC-S-002's 10 MiB rejection test stated with concurrent `/health` responsiveness as the proof it wasn't parsed? [Measurability, Spec §SC-S-002]
- [ ] CHK061 Is SC-X-001's 1,000 alerts × 100 routes under 2 s stated with the hardware envelope (single core of a modern laptop)? [Measurability, Spec §SC-X-001]
- [ ] CHK062 Is SC-X-002's module-boundary claim stated as a checkable dependency-graph property (no imports from `matcher.ts`/`router.ts` into `routes/*`)? [Measurability, Spec §SC-X-002]
- [ ] CHK063 Is the NFR-X-001 complexity claim (O(R + M log M) per alert) stated with the symbols defined (R = route count, M = matched count)? [Clarity, Spec §NFR-X-001]

## Traceability & Artifact Consistency (Consistency)

- [ ] CHK064 Does every interface in data-model.md (Route, Alert, RoutingResult, SuppressionRecord, Stats, InMemoryStore) trace to a named FR or spec §Key Entity? [Traceability, Data-model §all]
- [ ] CHK065 Does every endpoint in contracts/api.md cite the FR(s) that define its behaviour? [Traceability, Contracts §all]
- [ ] CHK066 Does every landmine in quickstart.md (suppression expiry, active-hours boundary, total_routes_evaluated, /test isolation) map to a spec FR or SC? [Traceability, Quickstart §3-6]
- [ ] CHK067 Do the architectural decisions in plan.md §"Architectural Decisions (locked)" each cite the NFR(s) they satisfy? [Traceability, Plan §Architectural Decisions]
- [ ] CHK068 Do the enumerated R/S/X tasks in plan.md each cite the originating NFR and a measurable SC (where one exists)? [Traceability, Plan §Resiliency / Security / Scalability]
- [ ] CHK069 Does CLAUDE.md's "Architectural Invariants" list agree with spec FRs on every bullet, with no invariant absent from the spec? [Consistency, CLAUDE.md §Architectural Invariants]
- [ ] CHK070 Is the Assumptions section in spec.md the single source for implementation-defined choices (tie-break direction, HH:MM strictness, active-hours half-open), with no conflicting statement elsewhere? [Consistency, Spec §Assumptions]

## Dependencies & Scope (Assumptions)

- [ ] CHK071 Is the "in-memory only, single process" scope stated as an FR AND acknowledged in the scalability NFR scope note? [Consistency, Spec §FR-039 / §NFR-X scope note]
- [ ] CHK072 Is the separate Kotlin/GCP deliverable named as out-of-scope for the running service, with its location fixed? [Completeness, Spec §Assumptions / CLAUDE.md]
- [ ] CHK073 Are all environment variables the service consults explicitly enumerated (none required for baseline) or explicitly "none"? [Completeness, Spec §NFR-S-007 / §Assumptions]
- [ ] CHK074 Is "no authentication required" stated explicitly as a scope boundary rather than silently omitted? [Clarity, Spec §NFR-S scope note]
- [ ] CHK075 Is the 9-endpoint surface enumerated in exactly one place (or identically in each place it appears) without an endpoint appearing only in one artifact? [Consistency, Spec / Contracts]

## Notes

- Traceability convention: every item cites either a specific FR/NFR/SC ID or an artifact §section, or uses `[Gap]` when asking whether a requirement is missing.
- This checklist is a **requirements-quality audit**, not an implementation checklist. Each item evaluates whether the spec (and adjacent planning artifacts) are well-written — not whether the running service behaves correctly. Behaviour is the grading script's job.
- Check items off as verified: `[x]`. Log any `[Gap]` / `[Ambiguity]` / `[Conflict]` findings inline for the author to address before `/speckit-tasks`.
