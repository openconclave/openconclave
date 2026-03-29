#!/bin/bash
set -e

echo ""
echo "  ╔═══════════════════════════════════════╗"
echo "  ║      OpenConclave Local Install       ║"
echo "  ║  AI Agent Orchestration Platform      ║"
echo "  ╚═══════════════════════════════════════╝"
echo ""

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="${OPENCONCLAVE_DIR:-$HOME/.openconclave}"

# Check for bun
if ! command -v bun &> /dev/null; then
  echo ">> Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

echo ">> Bun $(bun --version) found"

# Copy repo to install dir (exclude node_modules and db files)
if [ "$SCRIPT_DIR" != "$INSTALL_DIR" ]; then
  echo ">> Copying to $INSTALL_DIR..."
  rm -rf "$INSTALL_DIR"
  mkdir -p "$INSTALL_DIR"
  rsync -a --exclude='node_modules' --exclude='*.db' --exclude='*.db-wal' --exclude='*.db-shm' --exclude='.openconclave-tmp' "$SCRIPT_DIR/" "$INSTALL_DIR/"
fi

cd "$INSTALL_DIR"

# Install dependencies
echo ">> Installing dependencies..."
bun install

# Create start command
mkdir -p "$HOME/.local/bin"
cat > "$HOME/.local/bin/openconclave" << SCRIPT
#!/bin/bash
cd "$INSTALL_DIR"
exec bun run start.ts "\$@"
SCRIPT
chmod +x "$HOME/.local/bin/openconclave"

# Add to PATH if needed
if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
  export PATH="$HOME/.local/bin:$PATH"
fi

# Configure Claude Code MCP + channel
CLAUDE_CONFIGURED=false
if command -v claude &> /dev/null; then
  echo ">> Configuring Claude Code integration..."

  # Claude Code uses ~/.claude.json for user-level MCP config
  CLAUDE_CONFIG="$HOME/.claude.json"

  if [ -f "$CLAUDE_CONFIG" ]; then
    # Merge into existing config
    node -e "
      const fs = require('fs');
      const config = JSON.parse(fs.readFileSync('$CLAUDE_CONFIG', 'utf8'));
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
      fs.writeFileSync('$CLAUDE_CONFIG', JSON.stringify(config, null, 2));
    " 2>/dev/null && CLAUDE_CONFIGURED=true
  else
    cat > "$CLAUDE_CONFIG" << MCPEOF
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
    CLAUDE_CONFIGURED=true
  fi
fi

echo ""
echo "  ╔═══════════════════════════════════════╗"
echo "  ║      ✅ OpenConclave installed!       ║"
echo "  ╚═══════════════════════════════════════╝"
echo ""
echo "  Start server:  openconclave"
echo "  UI:            http://localhost:5173"
echo "  API:           http://localhost:4000"
echo ""
if [ "$CLAUDE_CONFIGURED" = true ]; then
echo "  Claude Code:   MCP configured in ~/.claude.json"
echo "  With channel:  claude --dangerously-load-development-channels server:openconclave-channel"
else
echo "  Claude Code:   not found. Install it, then re-run this script."
fi
echo ""
