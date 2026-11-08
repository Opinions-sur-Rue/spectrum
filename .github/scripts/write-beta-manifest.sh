#!/usr/bin/env bash
# Assemble beta-images.json from the two digest-pinned image reference files.
#
# Environment: PREFIX, RELEASE_TAG, SOURCE_SHA, API_URL, PUBLIC_URL.
# Reads frontend-image.txt and backend-image.txt from the current directory.
set -euo pipefail

for name in PREFIX RELEASE_TAG SOURCE_SHA API_URL PUBLIC_URL; do
  [[ -n "${!name:-}" ]] || {
    echo "::error::$name is required" >&2
    exit 1
  }
done

for component in frontend backend; do
  reference=$(cat "$component-image.txt")
  if [[ ! "$reference" =~ ^"$PREFIX"-"$component"@sha256:[0-9a-f]{64}$ ]]; then
    echo "::error::$component reference is not a digest-pinned $PREFIX-$component image: $reference" >&2
    exit 1
  fi
done

jq -n --arg release "$RELEASE_TAG" --arg commit "$SOURCE_SHA" \
  --arg frontend "$(cat frontend-image.txt)" --arg backend "$(cat backend-image.txt)" \
  --arg api "$API_URL" --arg public "$PUBLIC_URL" \
  '{release: $release, commit: $commit, frontend: $frontend, backend: $backend, api_url: $api, public_url: $public}' \
  > beta-images.json
