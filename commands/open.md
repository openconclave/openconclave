---
description: Open the OpenConclave editor in the default browser.
---

Read the actual port the OpenConclave server bound to. The server writes it to `${CLAUDE_PLUGIN_DATA}/port` on every startup; falls back to 4000 only if the file is missing (server hasn't started yet).

```sh
PORT=$(cat "${CLAUDE_PLUGIN_DATA}/port" 2>/dev/null || echo 4000)
```

Then open `http://localhost:$PORT` in the user's default browser using the appropriate shell command:

- Windows: `start http://localhost:$PORT`
- macOS: `open http://localhost:$PORT`
- Linux: `xdg-open http://localhost:$PORT`

Run the command via the Bash tool. If the browser opens, say "Opened the OpenConclave editor at http://localhost:$PORT." — nothing else. If the command fails, show the error and suggest the user open that URL manually.
