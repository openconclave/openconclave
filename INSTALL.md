# OpenConclave — Installation Guide (Windows)

## 1. Build the binary

```powershell
cd C:\Users\beine\source\repos\openconclave
bun run build:release
```

Output: `dist/windows-x64/oc.exe` (single file, ~113 MB, includes server + UI + MCP)

## 2. Install

```powershell
.\dist\windows-x64\oc.exe install
```

This does:
- Copies binary to `~/.openconclave/bin/oc.exe`
- Adds `~/.openconclave/bin` to your PATH
- **Restart your terminal** after this step

## 3. Start the server

```powershell
oc
```

Open http://localhost:4000 in your browser. That's the full app (API + UI).

## 4. Claude Code integration (optional)

In Claude Code, run these commands:

```
/plugin marketplace add openconclave/claude-plugin
/plugin install openconclave-channel@openconclave
/plugin install openconclave-dev@openconclave
```

Then `/reload-plugins`.

### What each plugin does

| Plugin | What you get |
|--------|-------------|
| `openconclave-channel` | Conclave events + each conclave as a callable tool |
| `openconclave-dev` | Conclave management tools (list, create, update, delete) |

### Start Claude Code with channel events

```powershell
claude --dangerously-load-development-channels plugin:openconclave-channel@openconclave
```

This enables real-time `prompt:question` and `channel:output` events from conclaves.

## Subcommands

```
oc              # Start server (API + UI on :4000)
oc install      # Install binary + PATH
oc mcp          # MCP server (Claude Code spawns this via plugin)
oc channel      # Channel bridge (Claude Code spawns this via plugin)
```

## File locations

| What | Where |
|------|-------|
| Binary | `~/.openconclave/bin/oc.exe` |
| Database | `~/.openconclave/openconclave.db` (auto-created) |
| Plugins cache | `~/.claude/plugins/cache/openconclave/` |
| Plugin marketplace | `.claude-plugin/marketplace.json` in the repo |

## Dev mode (for contributors)

```powershell
cd C:\Users\beine\source\repos\openconclave
bun install
bun start
```

UI on http://localhost:5173, API on http://localhost:4000.
