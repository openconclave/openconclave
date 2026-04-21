# OpenConclave

**Where one agent isn't enough.**

Run multiple AI agents together — in pipelines, debates, and teams. They work in parallel, challenge each other, ask you questions mid-run, and remember what they learned. All on your machine.

<p align="center">
  <img src="docs/screenshot-editor.png" alt="Visual pipeline editor" width="100%">
</p>

---

## Install

**As a Claude Code plugin (recommended):**

```
/plugin marketplace add openconclave/oc
/plugin install openconclave@openconclave
```

Starts the OC server automatically, wires up MCP tools for managing conclaves, and delivers conclave events to your Claude Code session as notifications. Run `/openconclave:open` (or visit [localhost:4000](http://localhost:4000)) to open the editor.

Requires [Bun](https://bun.sh) on your PATH. See [Claude Code plugin](#claude-code-plugin) below for details.

**Standalone binary** (no Claude Code required):

```powershell
# Windows
irm https://openconclave.com/install.ps1 | iex

# macOS / Linux
curl -fsSL https://openconclave.com/install.sh | bash
```

Open [localhost:4000](http://localhost:4000) → import a starter → hit **Run**. No runtime dependencies. Single binary. [Manual install →](#manual-install)

---

## Try something

Browse the **[conclaves repo](https://github.com/openconclave/conclaves)** for ready-to-import starters — deep code reviews, multi-agent debates, decision-support tools, and more. Drop a `.json` file into your OC instance and run it.

**To import:** Conclaves → ⬇ Import → paste URL or drop the `.json` file → map provider roles → Run.

---

## Two ways to use it

### Pipelines

Chain agents into workflows with a visual editor. Agents run in parallel, merge results, branch on conditions, loop until tests pass, and pause to ask you questions.

<p align="center">
  <img src="docs/screenshot-editor.png" alt="Pipeline editor" width="80%">
</p>

```
Trigger → Agent → Output                          (simple)
Trigger → [Agent, Agent, Agent] → Merge → Agent   (parallel specialists)
Trigger → Agent → Condition → Agent ↺              (retry loop)
              ↕
         Channel Loop                               (ask Claude Code)
```

Use cases: code review, TDD pipelines, security audits, data validation, content generation with editorial review — anything where one perspective isn't enough and you want the system to learn over time.

### Discussions

Put agents in a room with a moderator. They debate, challenge each other, and build on ideas across multiple rounds. The moderator steers, summarizes, and ends with a verdict.

<p align="center">
  <img src="docs/screenshot-discussion.png" alt="Agent discussion" width="80%">
</p>

Use cases: brainstorming, red-teaming, scenario planning, decision analysis, exploring a topic from multiple angles — or just entertainment.

---

## What makes this different

**Agents learn across runs.** A knowledge base stores lessons from every run. Next time, agents consult those lessons before acting. Your pipelines get smarter the more you use them.

**Multiple models in one workflow.** Use Claude for deep reasoning, GPT for a second opinion, Ollama for local-only steps — in the same pipeline. Each agent picks its own model.

**Claude-in-the-loop.** When an agent hits an ambiguous decision, it pauses the pipeline and asks Claude Code via the channel loop. Claude Code answers from context — or escalates to you in the terminal. Not a checkbox approval — an intelligent intermediary that only bothers you when it actually needs to.

**Everything stays local.** Single binary, runs on your machine, your code never leaves your laptop. No cloud. No account.

**Pipelines become tools.** Every conclave exposes as an MCP tool. Claude Code can trigger your pipelines, receive results, and answer channel loop questions.

---

## Build your own

Drag nodes, draw connections, write system prompts.

**Node types:** Trigger · Agent · Condition · Code · Merge · Channel Loop · Output · File · Discussion · Knowledge

**AI engines:** Claude · OpenAI · Ollama · any OpenAI-compatible API

**Agent tools:** Bash · Read · Write · Edit · Glob · Grep · WebSearch · WebFetch · Knowledge Search · MCP tools

**Triggers:** Manual · Cron · Webhook · Telegram · Claude Code channel

**Knowledge bases:** Embed documents with Ollama, agents get `search_knowledge` as a tool. Agents can write lessons back — your pipeline improves with every run.

**Git isolation:** Pipelines that modify code run in worktrees. Your main branch is never touched.

---

## Requirements

- **Ollama** — for local models and embeddings: `ollama pull nomic-embed-text`
- **API keys** (optional) — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or any OpenAI-compatible provider
- **Bun** — required when installing via the Claude Code plugin (the plugin runs OC from source). The standalone binary install doesn't need it.
- **Claude Code** (optional) — for the plugin workflow described below.

## Claude Code plugin

The plugin is a single-package install that bundles the OC server, the editor UI, and the MCP surface for managing conclaves from Claude. It replaces the older pair of plugins (`openconclave-channel` + `openconclave-dev`).

### What it does

- **Starts the server automatically** via a Claude Code background monitor. Your editor is live at `http://localhost:4000` for the duration of the session.
- **Exposes an MCP server** named `openconclave` with tools to list/create/update conclaves, trigger runs, manage the scheduler, and respond to blocked runs.
- **Delivers conclave events as notifications.** When a conclave emits output or asks Claude a question, the server writes the full payload to disk and prints a single-line pointer to stdout. Claude Code delivers that line as a notification; Claude reads the file and — for prompts — answers via the `respond_to_prompt` MCP tool.
- **Ships one slash command**, `/openconclave:open`, that opens the editor in your default browser.

### Plugin storage

Data lives at `~/.claude/plugins/data/openconclave-openconclave/`, per [Anthropic's plugin data guidance](https://code.claude.com/docs/en/plugins-reference#persistent-data-directory). This path:

- **Survives plugin updates** — your conclaves, runs, KBs, and session history don't move when the plugin version bumps.
- **Is auto-deleted on full uninstall** unless you pass `--keep-data` to `claude plugin uninstall`.

**First-run migration:** if you previously installed the standalone `oc` CLI and have data at `~/.openconclave/`, the plugin's SessionStart hook copies `openconclave.db`, `sessions/`, `outputs/`, and `instructions/` into the plugin data dir the first time. The legacy directory is left in place — downgrading back to the standalone CLI still works.

### Uninstall

```
claude plugin uninstall openconclave@openconclave
```

By default this also removes the plugin data dir (conclaves, runs, KBs). Pass `--keep-data` to preserve it if you plan to reinstall.

```
claude plugin uninstall openconclave@openconclave --keep-data
```

### Troubleshooting

- **Port 4000 in use** — the monitor tries to detect an existing OC server and attaches instead of binding a second one. If you still see `EADDRINUSE`, another process owns `:4000`; stop it and `/reload-plugins`.
- **UI is 404** — the client bundle didn't build. The SessionStart hook runs `bun install` + `bun run --filter client build` on the first session; if it fails (no Bun, offline), the server runs but has no UI. Check stderr.
- **`/doctor` shows `CLAUDE_PLUGIN_ROOT missing`** — you have a stale root `.mcp.json` from an older plugin version. Remove it; MCP config lives inline in `.claude-plugin/plugin.json` now.

## Manual install

```bash
git clone https://github.com/openconclave/oc.git
cd oc && bun install && bun start
```

## Docs

[Architecture](docs/architecture.md) · [Conclave composition](docs/conclave-composition.md) · [Security](security_guidance.md) · [Lab journal](.notes/README.md)


## License

MIT
