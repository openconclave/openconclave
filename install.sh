#!/bin/bash
set -e

echo ""
echo "  ╔═══════════════════════════════════════╗"
echo "  ║      OpenConclave Installer           ║"
echo "  ║  AI Agent Orchestration Platform      ║"
echo "  ╚═══════════════════════════════════════╝"
echo ""

INSTALL_DIR="${OPENCONCLAVE_DIR:-$HOME/.openconclave-app}"
REPO="https://github.com/openconclave/openconclave.git"

# ── Check prerequisites ──────────────────────────────────────

if ! command -v git &> /dev/null; then
  echo "  [!] Git is required. Install from https://git-scm.com"
  exit 1
fi

if ! command -v bun &> /dev/null; then
  echo "  >> Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

echo "  >> Bun $(bun --version) found"

# ── Clone or update ──────────────────────────────────────────

if [ -d "$INSTALL_DIR/.git" ]; then
  echo "  >> Updating existing installation..."
  cd "$INSTALL_DIR"
  git pull --quiet
else
  if [ -d "$INSTALL_DIR" ]; then
    echo "  >> Removing old installation..."
    rm -rf "$INSTALL_DIR"
  fi
  echo "  >> Cloning OpenConclave..."
  git clone --depth 1 "$REPO" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# ── Install dependencies ─────────────────────────────────────

echo "  >> Installing dependencies..."
cd "$INSTALL_DIR"
bun install --silent

# ── Create start command ─────────────────────────────────────

mkdir -p "$HOME/.local/bin"
cat > "$HOME/.local/bin/openconclave" << SCRIPT
#!/bin/bash
cd "$INSTALL_DIR"
exec bun start "\$@"
SCRIPT
chmod +x "$HOME/.local/bin/openconclave"

# Add to PATH if needed
if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
  SHELL_RC="$HOME/.bashrc"
  [ -f "$HOME/.zshrc" ] && SHELL_RC="$HOME/.zshrc"
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$SHELL_RC"
  export PATH="$HOME/.local/bin:$PATH"
  echo "  >> Added ~/.local/bin to PATH (restart shell to apply)"
fi

# ── Configure Claude Code MCP ────────────────────────────────

CLAUDE_CONFIGURED=false
if command -v claude &> /dev/null; then
  echo "  >> Configuring Claude Code integration..."

  CLAUDE_DIR="$HOME/.claude"
  mkdir -p "$CLAUDE_DIR"
  MCP_CONFIG="$CLAUDE_DIR/.mcp.json"

  if [ -f "$MCP_CONFIG" ]; then
    # Merge into existing config
    bun -e "
      const fs = require('fs');
      const config = JSON.parse(fs.readFileSync('$MCP_CONFIG', 'utf8'));
      config.mcpServers = config.mcpServers || {};
      config.mcpServers['openconclave'] = {
        command: 'bun',
        args: ['run', '$INSTALL_DIR/packages/server/src/mcp/server.ts'],
        cwd: '$INSTALL_DIR'
      };
      config.mcpServers['openconclave-channel'] = {
        command: 'bun',
        args: ['run', '$INSTALL_DIR/packages/server/src/channel/openconclave-channel.ts'],
        cwd: '$INSTALL_DIR'
      };
      fs.writeFileSync('$MCP_CONFIG', JSON.stringify(config, null, 2));
    "
  else
    cat > "$MCP_CONFIG" << MCPEOF
{
  "mcpServers": {
    "openconclave": {
      "command": "bun",
      "args": ["run", "$INSTALL_DIR/packages/server/src/mcp/server.ts"],
      "cwd": "$INSTALL_DIR"
    },
    "openconclave-channel": {
      "command": "bun",
      "args": ["run", "$INSTALL_DIR/packages/server/src/channel/openconclave-channel.ts"],
      "cwd": "$INSTALL_DIR"
    }
  }
}
MCPEOF
  fi
  CLAUDE_CONFIGURED=true
fi

# ── Done ─────────────────────────────────────────────────────

echo ""
echo "  ╔═══════════════════════════════════════╗"
echo "  ║      ✅ OpenConclave installed!       ║"
echo "  ╚═══════════════════════════════════════╝"
echo ""
echo "  Start:     openconclave"
echo "  Or:        cd $INSTALL_DIR && bun start"
echo ""
echo "  UI:        http://localhost:5173"
echo "  API:       http://localhost:4000"
echo ""
if [ "$CLAUDE_CONFIGURED" = true ]; then
echo "  Claude Code MCP: configured in ~/.claude/.mcp.json"
echo "  With channel:    claude --dangerously-load-development-channels server:openconclave-channel"
else
echo "  Claude Code: not found. Install it, then re-run this script."
fi
echo ""
