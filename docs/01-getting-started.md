# Getting Started with OpenConclave

This guide will help you install and set up OpenConclave on your machine.

## Installation

### Option 1: Claude Code Plugin (Recommended)

The easiest way to get started. OpenConclave runs as a Claude Code plugin with zero configuration.

```bash
claude plugin install github:openconclave/openconclave
```

**What happens automatically:**
- ✅ Server starts in the background
- ✅ MCP tools auto-register with Claude Code
- ✅ Channel auto-connects for workflows to send messages to Claude Code
- ✅ Web UI available at http://localhost:5173
- ✅ Server gracefully shuts down when Claude Code exits

**Verify installation:**
- Open http://localhost:5173 in your browser
- You should see the OpenConclave dashboard
- Check the Claude Code terminal for the server startup message

### Option 2: Standalone Installation

Install OpenConclave as a standalone service on your machine.

**macOS / Linux:**
```bash
curl -fsSL https://openconclave.com/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://openconclave.com/install.ps1 | iex
```

**What's installed:**
- OpenConclave binary
- Systemd service (Linux) or LaunchAgent (macOS)
- Automatic startup on system boot
- Web UI at http://localhost:5173

### Option 3: Manual/Development Setup

For developers who want to work with the source code.

**Prerequisites:**
- Node.js 18+ or Bun runtime
- Git

**Steps:**
```bash
git clone https://github.com/openconclave/openconclave.git
cd openconclave

# Install dependencies
bun install

# Start the server
bun start

# Open in browser
open http://localhost:5173
```

**For development:**
```bash
# Terminal 1: Start the server in watch mode
cd packages/server && bun run dev

# Terminal 2: Start the client in watch mode
cd packages/client && bun run dev
```

## Initial Setup

### 1. First Access

Open http://localhost:5173 in your browser. You should see:

![Dashboard](../01-dashboard.png)

The dashboard displays:
- Operational stats (workflows, active runs, success rate)
- Run distribution chart
- Quick launch buttons
- Active schedules
- Latest workflow outputs

### 2. Configure AI Providers

Before running workflows, configure at least one AI provider in Settings.

**Go to: Settings → AI Providers**

**Available Providers:**
- **Claude Code** — Included automatically if using plugin
- **Ollama** — Free, private, runs locally
- **OpenAI** — Use your API key
- **OpenRouter, Together AI, Groq** — Any OpenAI-compatible provider

**To add a provider:**
1. Click "Add Provider"
2. Select provider type
3. Enter API key and base URL (if needed)
4. Click Save

See [AI Providers Guide](09-ai-providers.md) for detailed setup instructions.

### 3. (Optional) Set Up Telegram

Enable workflow triggers and outputs via Telegram.

**Go to: Settings → Telegram Bot Token**

1. Create a bot using [@BotFather](https://t.me/botfather) on Telegram
2. Copy the bot token
3. Paste in Settings → Telegram Bot Token
4. Save

See [Telegram Integration Guide](15-telegram.md) for more details.

### 4. (Optional) Configure Ollama

Use free, private AI models with Ollama.

**Prerequisites:**
- [Install Ollama](https://ollama.ai)
- Pull a model: `ollama pull llama2` (or your preferred model)
- Ollama runs at `http://localhost:11434` by default

**In OpenConclave:**
1. Go to Settings → Ollama URL
2. Enter the Ollama endpoint (default: `http://localhost:11434`)
3. Save

Models are auto-discovered when you create Agent nodes.

## File Structure

OpenConclave stores all data in your project under `.openconclave/`:

```
.openconclave/
├── db/                    # SQLite database
│   └── db.sqlite
├── outputs/               # Workflow outputs (text, logs)
├── sessions/              # Agent conversation histories
├── tmp/                   # Temporary files
└── instructions/          # Custom instructions for agents
```

**Important:** This folder is automatically created and managed by OpenConclave.

## Troubleshooting Installation

### Port Already in Use

If port 5173 is already in use:

**On macOS/Linux:**
```bash
# Find process using port 5173
lsof -i :5173

# Kill the process
kill -9 <PID>
```

**On Windows:**
```powershell
netstat -ano | findstr :5173
taskkill /PID <PID> /F
```

### Server Doesn't Start

**Check logs:**
```bash
# Check if server is running
curl http://localhost:5173

# View system logs
journalctl -u openconclave -f  # Linux
log stream --predicate 'process == "openconclave"'  # macOS
```

### Missing Node Modules

```bash
# Reinstall dependencies
bun install

# Clear cache and reinstall
rm -rf node_modules bun.lock
bun install
```

### Database Issues

If the database becomes corrupted:

```bash
# Backup current database
mv .openconclave/db/db.sqlite .openconclave/db/db.sqlite.backup

# Server will create a fresh database on next start
bun start
```

## Verification Checklist

After installation, verify everything works:

- [ ] http://localhost:5173 opens in browser
- [ ] Dashboard loads with stats (even if 0 workflows)
- [ ] Can navigate to all pages (Dashboard, Workflows, Runs, Knowledge, Settings)
- [ ] Server status shows "Server connected" (bottom left)
- [ ] At least one AI provider configured in Settings
- [ ] (Optional) Ollama configured if planning to use local models

## Next Steps

🎉 Installation complete! Now:

1. **[Create Your First Workflow](02-first-workflow.md)** (5 minutes)
2. **[Learn the Workflow Editor](04-workflow-editor.md)**
3. **[Explore Node Types](05-node-types.md)**
4. **[See Use Case Examples](11-use-cases.md)**

## Getting Help

- 📚 [Full Documentation Index](README.md)
- 🐛 [Troubleshooting Guide](16-troubleshooting.md)
- 🔐 [Security Guidance](17-security.md)
- 💬 GitHub Discussions (coming soon)

---

**Next:** [Create Your First Workflow →](02-first-workflow.md)
