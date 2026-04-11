#!/usr/bin/env bash
# release-macos.sh — build, sign, notarize, and publish macOS binaries.
#
# One-time setup on your Mac:
#   1. Apple Developer membership ($99/yr).
#   2. Import your "Developer ID Application" certificate into Keychain.
#      Find the identity string:   security find-identity -v -p codesigning
#   3. Create an app-specific password at appleid.apple.com.
#   4. Store notary credentials in the keychain (one-time):
#        xcrun notarytool store-credentials oc-notary \
#          --apple-id you@example.com \
#          --team-id  TEAMID \
#          --password APP-SPECIFIC-PW
#   5. Install GitHub CLI and auth:   gh auth login
#
# Usage:
#   export OC_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
#   export OC_NOTARY_PROFILE="oc-notary"
#   ./scripts/release-macos.sh v1.0.7
set -euo pipefail

VERSION="${1:?usage: $0 <version>   e.g. v1.0.7}"
: "${OC_SIGNING_IDENTITY:?set OC_SIGNING_IDENTITY}"
: "${OC_NOTARY_PROFILE:?set OC_NOTARY_PROFILE}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENT="$ROOT/scripts/entitlements.plist"
if [ ! -f "$ENT" ]; then
  cat > "$ENT" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
</dict>
</plist>
PLIST
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

for ARCH in arm64 x64; do
  TARGET="darwin-$ARCH"
  ASSET="oc-$TARGET"
  OUT="$STAGE/$ASSET"

  echo ""
  echo "▶ [$TARGET] Building"
  bun run build:release -- --target "$TARGET"

  cp "$ROOT/dist/$TARGET/oc" "$OUT"

  echo "▶ [$TARGET] Signing"
  codesign --force --timestamp --options runtime \
    --entitlements "$ENT" \
    --sign "$OC_SIGNING_IDENTITY" \
    "$OUT"
  codesign --verify --deep --strict --verbose=2 "$OUT"

  echo "▶ [$TARGET] Notarizing (this takes 1–5 min)"
  ZIP="$STAGE/$ASSET.zip"
  ditto -c -k --keepParent "$OUT" "$ZIP"
  xcrun notarytool submit "$ZIP" \
    --keychain-profile "$OC_NOTARY_PROFILE" \
    --wait
done

echo ""
echo "▶ Publishing $VERSION to GitHub"
if ! gh release view "$VERSION" >/dev/null 2>&1; then
  gh release create "$VERSION" \
    --prerelease \
    --title "$VERSION" \
    --generate-notes
fi

gh release upload "$VERSION" \
  "$STAGE/oc-darwin-arm64" \
  "$STAGE/oc-darwin-x64" \
  --clobber

echo ""
echo "✓ Signed, notarized, and uploaded:"
echo "    oc-darwin-arm64"
echo "    oc-darwin-x64"
echo "  Release: $(gh release view "$VERSION" --json url --jq .url)"
