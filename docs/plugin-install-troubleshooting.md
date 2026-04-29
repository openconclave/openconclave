# Plugin install troubleshooting — UI shows 404 after fresh install

The OC plugin's web UI (http://localhost:4000) returns 404 if `packages/client/dist/index.html` is missing in the plugin install location. The server's `/api/*` endpoints still work; only the static client assets fail to serve.

A fresh `git clone` does not include `packages/client/dist/` (it is gitignored as a build artifact), so the dist must be built on the install machine. From plugin v1.0.19 onward, `scripts/plugin-server.sh` does this automatically on first launch when `dist/index.html` is absent.

If the UI is 404 after a fresh install, walk these three checks in order.

## 1. Confirm the install has the first-run build fix

```bash
grep -A2 "First-run client build" \
  ~/.claude/plugins/cache/openconclave/openconclave/1.0.19/scripts/plugin-server.sh
```

If that grep returns nothing, the install is from before commit `7aff939` and does not auto-build. Fix:

```
/plugin
```

uninstall the OC plugin, then reinstall from the marketplace. The new clone will include the fix.

## 2. Check `server.log` for a build failure

`plugin-server.sh` runs with `set -euo pipefail`. If the first-run build fails, the script exits 1 and the server never starts. Read the log:

```bash
tail -60 ~/.claude/plugins/data/openconclave-openconclave/server.log
```

Common failure causes:

- **`bun: command not found`** — the Claude Code monitor subprocess inherits a stripped PATH on macOS or Windows. The script has a Windows PATH-rebuild branch (`case "${OS:-}" in Windows_NT) ...`); macOS does not yet have an equivalent. Workaround: ensure `bun` is on the system-wide PATH (`/usr/local/bin/bun` or symlink there), not just your shell's PATH.
- **`bun install` network failure** — proxy, firewall, or offline. Retry on a network with access to `registry.npmjs.org`.
- **Vite build errors** — usually a Node/Bun version mismatch. The repo expects Bun 1.3+; check with `bun --version`.

## 3. Manual repair when install is otherwise correct

When the install location is intact but `dist/` is missing for any reason (build was skipped, killed mid-run, or the script doesn't fire), run the build manually:

```bash
cd ~/.claude/plugins/cache/openconclave/openconclave/1.0.19
bun install
cd packages/client && bun run build
```

Verify `dist/index.html` now exists:

```bash
ls ~/.claude/plugins/cache/openconclave/openconclave/1.0.19/packages/client/dist/
```

Then restart the OC server so it picks up the new static-serve route. The static-serve check runs once at startup; building `dist/` after the server is running has no effect until restart. From inside Claude Code:

```
/reload-plugins
```

or quit and relaunch Claude Code.

## After repair: verify the UI works

```bash
curl -sI http://localhost:4000/
```

Expected: `HTTP/1.1 200 OK` with `Content-Type: text/html`. If still 404, the server picked up before `dist/` existed — restart again.

## Reporting a Mac-specific PATH issue

If `server.log` shows `bun: command not found` on macOS, that is a Mac-side regression of the same PATH-stripping bug the Windows branch handles. File an issue with:

- `which bun` and `echo $PATH` from your interactive shell
- The full `tail -100` of `server.log`
- macOS version

A `case "${OS:-}" in Darwin)` branch in `scripts/plugin-server.sh` would fix it the same way the Windows branch does — by reading the user's `/etc/paths`, `~/.zshrc`-derived PATH, or `launchctl getenv PATH`.
