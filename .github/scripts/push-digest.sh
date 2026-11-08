#!/usr/bin/env bash
# Push an image tag and print only the registry-reported digest on stdout.
#
# Never derive this from `docker image inspect`: the pre-publish tag
# spectrum-beta-smoke:<component> also records a local RepoDigests entry whose
# repository name is not pullable from the registry.
set -euo pipefail

reference=${1:?Usage: push-digest.sh IMAGE:TAG}
status=0
output=$(docker push "$reference" 2>&1) || status=$?
printf '%s\n' "$output" >&2
if [[ "$status" -ne 0 ]]; then
  exit "$status"
fi

digest=$(printf '%s\n' "$output" |
  sed -n 's/.*digest: \(sha256:[0-9a-f]\{64\}\).*/\1/p' | tail -n1)
if [[ -z "$digest" ]]; then
  echo "::error::docker push reported no registry digest for $reference" >&2
  exit 1
fi

printf '%s\n' "$digest"
