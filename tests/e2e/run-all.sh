#!/usr/bin/env bash
# tests/e2e/run-all.sh — mirror the grader's 14-section evaluation.
#
# Usage:
#   tests/e2e/run-all.sh                # run boot + all 14 grader sections
#   tests/e2e/run-all.sh --with-docker  # also run tests/e2e/docker.sh (build + run + stop)
#   tests/e2e/run-all.sh --only s03,s07 # run only the listed sections
#
# Env:
#   ALERT_ROUTER_URL  Base URL (default http://localhost:8080).
#
# Assumes the service is reachable (or will be within 10s) at the base URL,
# unless --with-docker is passed, which builds the image and runs it itself.

set -uo pipefail
cd "$(dirname "$0")"

WITH_DOCKER=0
ONLY=""
prev=""
for arg in "$@"; do
  case "$arg" in
    --with-docker) WITH_DOCKER=1 ;;
    --only=*) ONLY="${arg#--only=}" ;;
    *)
      if [[ "$prev" == "--only" ]]; then ONLY="$arg"; fi
      ;;
  esac
  prev="$arg"
done

# id|label|cmd
SECTIONS=(
  "boot|Boot probe (/health within 10 s)|node boot.mjs"
  "s01|§1  Route CRUD|node s01-route-crud.mjs"
  "s02|§2  Input validation|node s02-input-validation.mjs"
  "s03|§3  Basic routing|node s03-basic-routing.mjs"
  "s04|§4  Label matching|node s04-label-matching.mjs"
  "s05|§5  Glob matching|node s05-glob-matching.mjs"
  "s06|§6  Suppression windows|node s06-suppression-windows.mjs"
  "s07|§7  Active hours & timezones|node s07-active-hours.mjs"
  "s08|§8  Alert re-submission|node s08-alert-resubmission.mjs"
  "s09|§9  Query & filtering|node s09-query-filtering.mjs"
  "s10|§10 Stats|node s10-stats.mjs"
  "s11|§11 Dry-run POST /test|node s11-dry-run.mjs"
  "s12|§12 Omitted conditions|node s12-omitted-conditions.mjs"
  "s13|§13 Priority|node s13-priority.mjs"
  "s14|§14 Full reset|node s14-full-reset.mjs"
)

passed=()
failed=()
skipped=()

if (( WITH_DOCKER == 1 )); then
  echo "═══════════════════════════════════════════════════════════"
  echo "▶  docker build + run + ops readiness"
  echo "═══════════════════════════════════════════════════════════"
  if bash docker.sh; then
    passed+=("docker — ops readiness")
  else
    failed+=("docker — ops readiness")
    # Docker failure means nothing downstream will work — bail here.
    echo
    echo "docker.sh failed; aborting e2e (run without --with-docker once a server is up)."
    exit 1
  fi
  echo
  echo "(docker.sh tears its own container down; start your own server now if you want"
  echo " to keep running the grader sections against a fresh boot)"
  echo
fi

for row in "${SECTIONS[@]}"; do
  IFS='|' read -r id label cmd <<< "$row"
  if [[ -n "$ONLY" ]] && ! [[ ",$ONLY," == *",$id,"* ]]; then
    skipped+=("$id — $label (--only filter)")
    continue
  fi

  echo "═══════════════════════════════════════════════════════════"
  echo "▶  $label"
  echo "═══════════════════════════════════════════════════════════"
  if eval "$cmd"; then
    passed+=("$id — $label")
  else
    failed+=("$id — $label")
  fi
  echo
done

echo "═══════════════════════════════════════════════════════════"
echo "  E2E summary"
echo "═══════════════════════════════════════════════════════════"
echo "  Passed:  ${#passed[@]}"
echo "  Failed:  ${#failed[@]}"
echo "  Skipped: ${#skipped[@]}"
if (( ${#failed[@]} > 0 )); then
  echo
  echo "Failed sections:"
  for f in "${failed[@]}"; do echo "  ✗ $f"; done
fi

exit $(( ${#failed[@]} > 0 ? 1 : 0 ))
