#!/bin/bash
set -e

echo ""
echo "  ╔═══════════════════════════════════════╗"
echo "  ║      OpenConclave Installer           ║"
echo "  ║  AI Agent Orchestration Platform      ║"
echo "  ╚═══════════════════════════════════════╝"
echo ""

INSTALL_DIR="${OPENCONCLAVE_DIR:-$HOME/.openconclave}"
REPO="https://github.com/openconclave/openconclave.git"

# Check for bun
if ! command -v bun &> /dev/null; then
  echo ">> Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

echo ">> Bun $(bun --version) found"

# Clone or update
if [ -d "$INSTALL_DIR" ]; then
  echo ">> Updating existing installation..."
  cd "$INSTALL_DIR"
  git pull --quiet
else
  echo ">> Cloning OpenConclave..."
  git clone --depth 1 "$REPO" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# Install dependencies
echo ">> Installing dependencies..."
bun install --silent

# Create start script
mkdir -p "$HOME/.local/bin"
cat > "$HOME/.local/bin/openconclave" << 'SCRIPT'
#!/bin/bash
cd "$HOME/.openconclave"
exec bun run start.ts "$@"
SCRIPT
chmod +x "$HOME/.local/bin/openconclave"

# Install Claude Code plugin if claude is available
if command -v claude &> /dev/null; then
  echo ">> Setting up Claude Code MCP integration..."

  # Add MCP server to user settings
  CLAUDE_DIR="$HOME/.claude"
  mkdir -p "$CLAUDE_DIR"

  MCP_CONFIG="$CLAUDE_DIR/.mcp.json"
  if [ -f "$MCP_CONFIG" ]; then
    # Merge into existing config using bun
    bun -e "
      const fs = require('fs');
      const config = JSON.parse(fs.readFileSync('$MCP_CONFIG', 'utf8'));
      config.mcpServers = config.mcpServers || {};
      config.mcpServers['openconclave'] = {
        command: 'bun',
        args: ['run', '$INSTALL_DIR/packages/server/src/mcp/server.ts']
      };
      config.mcpServers['openconclave-channel'] = {
        command: 'bun',
        args: ['run', '$INSTALL_DIR/packages/server/src/channel/openconclave-channel.ts']
      };
      fs.writeFileSync('$MCP_CONFIG', JSON.stringify(config, null, 2));
    "
  else
    cat > "$MCP_CONFIG" << MCPEOF
{
  "mcpServers": {
    "openconclave": {
      "command": "bun",
      "args": ["run", "$INSTALL_DIR/packages/server/src/mcp/server.ts"]
    },
    "openconclave-channel": {
      "command": "bun",
      "args": ["run", "$INSTALL_DIR/packages/server/src/channel/openconclave-channel.ts"]
    }
  }
}
MCPEOF
  fi
fi

echo ""
echo "  ✅ OpenConclave installed!"
echo ""
echo "  Start:    openconclave"
echo "  Or:       cd $INSTALL_DIR && bun start"
echo ""
echo "  UI:       http://localhost:5173"
echo "  API:      http://localhost:4000"
echo ""
if command -v claude &> /dev/null; then
echo "  Claude Code MCP: configured"
echo "  Channel: run with --dangerously-load-development-channels server:openconclave-channel"
fi
echo ""
