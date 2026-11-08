#!/usr/bin/env bash
set -euo pipefail

# Docker can accept a connection before the process is ready, then reset it.
# Retry startup only; callers still run strict, non-retried smoke assertions.
url=${1:?Usage: wait-for-http.sh URL}
curl --fail --silent --show-error \
  --retry 15 --retry-delay 1 --retry-all-errors --retry-max-time 30 \
  --connect-timeout 2 --max-time 5 \
  "$url" --output /dev/null
