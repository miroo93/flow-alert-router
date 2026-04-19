# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Context

This is a **2-hour take-home exercise**: build a configurable alert routing engine as a single Dockerized HTTP service on port 8080. The full requirements are in [AI-assisted Take-Home Exercise - Candidate Instructions.md](AI-assisted%20Take-Home%20Exercise%20-%20Candidate%20Instructions.md) — treat it as the authoritative spec. Evaluation is an automated curl/jq suite with 70+ assertions across 14 sections; the container must start within 10 seconds.

Primary stack: **TypeScript on Node.js 20**, packaged in a single Docker container. The hiring company uses **Kotlin + GCP**, so a separate `docs/kotlin-gcp-design.md` (design-only, no implementation) captures what the equivalent system would look like on their stack.

## Spec-Driven Development Workflow

This repo uses the Spec Kit workflow (see [.specify/workflows/speckit/workflow.yml](.specify/workflows/speckit/workflow.yml)). All feature artifacts live under `specs/NNN-feature-name/`:

- `spec.md` — user stories, functional requirements, success criteria (from `/speckit-specify`)
- `plan.md` — tech stack, structure, phases (from `/speckit-plan`)
- `tasks.md` — parallelizable task list (from `/speckit-tasks`)
- `data-model.md`, `contracts/`, `research.md`, `quickstart.md` — supporting artifacts
- Templates live in [.specify/templates/](.specify/templates/)

When extending the system, follow the full cycle: `/speckit-specify` → review → `/speckit-plan` → review → `/speckit-tasks` → `/speckit-implement`. Do NOT skip the spec phase — the exercise tests correctness against a fixed contract.

## Architectural Invariants

These are contract-level requirements from the exercise doc. Violating any of them will fail the automated test suite:

- **Port 8080, in-memory only** — no database. State is `Map<string, T>` inside a single process; `POST /reset` clears everything.
- **Alert IDs are upserted** — re-submitting the same `id` replaces the prior routing result (does not duplicate).
- **Priority ties**: highest-priority matching route wins; ALL matching routes (including losers) appear in `matched_routes`.
- **Suppression windows are driven by `alert.timestamp`, not wall-clock** — compare ISO 8601 timestamps, not `Date.now()`. Key by `${routeId}:${service}`. Window starts from the first NON-suppressed alert.
- **Active hours use IANA timezones** — convert `alert.timestamp` (UTC) to the route's zone, then compare `HH:MM`. Boundary: start inclusive, end exclusive.
- **Glob matching**: `*` wildcard only, applied to `service` conditions (e.g. `payment-*`, `*-api`). No full regex.
- **Condition semantics**: omitted field = match all; empty `conditions: {}` = match all alerts; `labels` condition is a subset check (alert may have extras).
- **`POST /test` is a dry run** — must not persist the alert, not modify suppression state, not touch stats.
- **Stats are updated on `POST /alerts` only**, never on `POST /test`. `by_route[id].total_matched` counts every match, `total_routed` only the winner (non-suppressed), `total_suppressed` only when winner was suppressed.
- **`evaluation_details.total_routes_evaluated`** is the total number of routes in the store, not just matches.
- **Validation returns 400 with `{"error": "..."}`** for: missing required fields, invalid severity/target.type, bad ISO 8601, bad IANA timezone, non-HH:MM active_hours, non-integer priority, negative suppression_window_seconds.

## Common Commands

Filled in once scaffolding exists (see `specs/*/quickstart.md`). Canonical evaluation commands from the exercise:

```bash
docker build -t alert-router .
docker run -p 8080:8080 alert-router
```

The container must accept connections on `http://localhost:8080` within 10 seconds.

## Working With AI on This Exercise

- The Claude conversation history is **part of the evaluation**. Decompose the problem; don't paste the whole spec in one prompt.
- Use sub-agents for parallel work (e.g. route handlers vs. matcher vs. Dockerfile) — this is the intended workflow, not a shortcut.
- Test incrementally with `curl` against the 14 test-section scenarios as you build; suppression-window expiry, timezone conversion, and `evaluation_details` counts are the known landmines.
