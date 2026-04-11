#!/usr/bin/env bash
# release-non-mac.sh — build and publish windows-x64 + linux-x64 + linux-arm64
# binaries. Runs on Windows (Git Bash) or Linux. Pair with release-macos.sh
# (which handles darwin signing/notarization) — both scripts upload to the
# same GitHub tag, so run order doesn't matter.
#
# One-time setup:
#   brew install gh     # or scoop/apt install gh
#   gh auth login
#
# Usage:
#   ./scripts/release-non-mac.sh v1.0.7
set -euo pipefail

VERSION="${1:?usage: $0 <version>   e.g. v1.0.7}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "▶ Bumping version to $VERSION"
bun run scripts/bump-version.ts "$VERSION"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# (target, binary-name-on-disk, asset-name-to-upload)
build_and_stage() {
  local TARGET="$1"
  local SRCNAME="$2"
  local ASSET="$3"

  echo ""
  echo "▶ [$TARGET] Building"
  bun run build:release -- --target "$TARGET"

  cp "$ROOT/dist/$TARGET/$SRCNAME" "$STAGE/$ASSET"
}

build_and_stage windows-x64 oc.exe oc.exe
build_and_stage linux-x64   oc    oc-linux-x64
build_and_stage linux-arm64 oc    oc-linux-arm64

echo ""
echo "▶ Publishing $VERSION to GitHub"
if ! gh release view "$VERSION" >/dev/null 2>&1; then
  gh release create "$VERSION" \
    --prerelease \
    --title "$VERSION" \
    --generate-notes
fi

gh release upload "$VERSION" \
  "$STAGE/oc.exe" \
  "$STAGE/oc-linux-x64" \
  "$STAGE/oc-linux-arm64" \
  --clobber

echo ""
echo "✓ Uploaded to $VERSION:"
echo "    oc.exe"
echo "    oc-linux-x64"
echo "    oc-linux-arm64"
echo "  Release: $(gh release view "$VERSION" --json url --jq .url)"
