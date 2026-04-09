#!/bin/bash
set -euo pipefail

echo ""
echo "  ◆  O P E N C O N C L A V E  Installer"
echo ""

REPO="openconclave/oc"
VERSION="${1:-latest}"

# ── Detect OS and architecture ───────────────────────────────

OS=$(uname -s)
ARCH=$(uname -m)

case "$OS" in
  Darwin) PLATFORM_OS="darwin" ;;
  Linux)  PLATFORM_OS="linux" ;;
  *)      echo "  Unsupported OS: $OS"; exit 1 ;;
esac

case "$ARCH" in
  arm64|aarch64) PLATFORM_ARCH="arm64" ;;
  x86_64)        PLATFORM_ARCH="x64" ;;
  *)             echo "  Unsupported architecture: $ARCH"; exit 1 ;;
esac

PLATFORM="${PLATFORM_OS}-${PLATFORM_ARCH}"

# ── Resolve version ──────────────────────────────────────────

DOWNLOAD_DIR="$HOME/.openconclave/downloads"
mkdir -p "$DOWNLOAD_DIR"

if [ "$VERSION" = "latest" ]; then
  echo "  Fetching latest release..."
  VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed 's/.*"v\(.*\)".*/\1/')
  if [ -z "$VERSION" ]; then
    echo "  Failed to fetch latest version"
    exit 1
  fi
fi

echo "  Version: $VERSION"

# ── Download binary ──────────────────────────────────────────

ASSET_NAME="oc-${PLATFORM}"
DOWNLOAD_URL="https://github.com/$REPO/releases/download/v${VERSION}/${ASSET_NAME}"
BINARY_PATH="$DOWNLOAD_DIR/oc"

echo "  Downloading $ASSET_NAME..."
curl -fsSL "$DOWNLOAD_URL" -o "$BINARY_PATH"
chmod +x "$BINARY_PATH"

# macOS: remove quarantine attribute
if [ "$PLATFORM_OS" = "darwin" ]; then
  xattr -cr "$BINARY_PATH" 2>/dev/null || true
fi

# ── Run installer ────────────────────────────────────────────

echo "  Running installer..."
"$BINARY_PATH" install

# Cleanup
rm -f "$BINARY_PATH"

echo ""
echo "  Installation complete!"
echo ""
