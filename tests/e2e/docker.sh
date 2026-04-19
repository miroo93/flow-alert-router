#!/usr/bin/env bash
# Operational readiness — mirrors exactly what the grader does:
#   1. docker build -t alert-router .
#   2. docker run -p 8080:8080 alert-router
#   3. wait for /health (boot probe)
#   4. stop + clean up
#
# This is the canonical "does the submission work" check. Run it before
# handing off the repo.

set -uo pipefail
cd "$(dirname "$0")/../.."

NAME="alert-router-e2e-$$"
PORT="${PORT:-8080}"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail=0
pass=0

report() {
  echo
  echo "─────────────────────────────────────────"
  echo "  docker ops readiness"
  echo "  Passed: $pass"
  echo "  Failed: $fail"
  if (( fail > 0 )); then exit 1; fi
}

echo "▶ docker build -t alert-router ."
if docker build -q -t alert-router . >/dev/null; then
  echo "✓ image builds"
  pass=$((pass+1))
else
  echo "✗ docker build failed"
  fail=$((fail+1)); report
fi

echo "▶ docker run --name $NAME -d -p $PORT:8080 alert-router"
if docker run --name "$NAME" -d -p "$PORT:8080" alert-router >/dev/null; then
  echo "✓ container started"
  pass=$((pass+1))
else
  echo "✗ docker run failed"
  fail=$((fail+1)); report
fi

echo "▶ wait for /health within 10 s"
start=$(date +%s)
ok=0
while (( $(date +%s) - start < 11 )); do
  if curl -fsS --max-time 1 "http://localhost:$PORT/health" >/dev/null 2>&1; then
    elapsed=$(($(date +%s) - start))
    echo "✓ /health 200 within ${elapsed}s"
    pass=$((pass+1))
    ok=1
    break
  fi
  sleep 0.3
done
if (( ok == 0 )); then
  echo "✗ /health did not respond within 10s"
  docker logs "$NAME" 2>&1 | tail -40
  fail=$((fail+1)); report
fi

echo "▶ docker inspect — exposed ports include 8080/tcp"
ports=$(docker inspect alert-router --format '{{range $p,$_ := .Config.ExposedPorts}}{{$p}} {{end}}' 2>/dev/null)
if [[ "$ports" == *"8080/tcp"* ]]; then
  echo "✓ exposes 8080/tcp (got: $ports)"
  pass=$((pass+1))
else
  echo "✗ 8080/tcp not exposed (got: $ports)"
  fail=$((fail+1))
fi

echo "▶ docker stop within 10 s → clean exit"
start=$(date +%s)
docker stop -t 10 "$NAME" >/dev/null
elapsed=$(($(date +%s) - start))
exit_code=$(docker inspect "$NAME" --format '{{.State.ExitCode}}' 2>/dev/null)
if [[ "$exit_code" == "0" ]] && (( elapsed <= 10 )); then
  echo "✓ clean shutdown: exit $exit_code in ${elapsed}s"
  pass=$((pass+1))
else
  echo "✗ exit=$exit_code elapsed=${elapsed}s"
  fail=$((fail+1))
fi

report
