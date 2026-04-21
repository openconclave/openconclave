# openconclave-web-fetch-mcp

A minimal MCP server that fetches a URL with a real headless browser (so JavaScript-heavy sites work), extracts the main article via Mozilla Readability, and returns clean Markdown.

One tool. One payload. Browser closes between calls.

## Why not just `fetch()`?

Most modern sites render content with JavaScript after the initial HTML arrives. A raw `fetch()` returns `<div id="root"></div>` and a pile of script tags. You need a real browser to get the actual text.

## Why not full `playwright-mcp`?

That server registers 26+ tools, returns full accessibility trees per action, and can burn ~114 KB of tokens per typical task. This server exposes one tool (`web_fetch(url, maxBytes?)`) and returns ~5–15 KB of extracted Markdown.

Use `playwright-mcp` when the agent needs to click, type, log in, or navigate through multi-step flows. Use this when it just needs to read a page.

## Requirements

- **Node 20+** at runtime (Playwright's CDP pipe doesn't handshake cleanly under Bun on Windows — known incompatibility).
- Bun (or npm) for install and build.

## Install

```bash
cd tools/web-fetch-mcp
bun install                # or: npm install
bun run install-browser    # downloads Chromium (~150 MB, one-time per machine)
bun run build              # bundles index.ts → dist/index.js (Node-runnable)
```

## Register in OpenConclave

Add as an MCP tool node in the conclave editor, or register via the MCP registry UI with:

- **Launch command:** `node /abs/path/to/tools/web-fetch-mcp/dist/index.mjs`
- **Transport:** stdio

## Run directly (for testing)

```bash
bun run test               # uses tsx under Node; hits two real URLs + SSRF check
```

## Tool surface

```
web_fetch(url, maxBytes?)
  → Markdown string of the main article on the page
```

**Parameters:**
- `url` — absolute `http(s)` URL
- `maxBytes` — optional, default 100000, max 500000

**Behavior:**
- Blocks `localhost`, private IP ranges (`10/8`, `172.16/12`, `192.168/16`, `127/8`, `169.254/16`, IPv6 private)
- Uses `networkidle` wait strategy, 30s timeout
- Runs Readability on the rendered DOM; falls back to full HTML if Readability returns nothing
- Truncates at `maxBytes` and appends a `[truncated]` marker

## Limitations

- No authentication / cookies / session state
- No JS interaction (clicks, forms) — use `playwright-mcp` for that
- Single-shot per URL; no multi-page crawling
- Browser is started lazily and reused for the process lifetime; each tool call opens a new context
