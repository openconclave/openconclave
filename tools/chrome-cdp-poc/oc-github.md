# GitHub - openconclave/oc

**Where one agent isn't enough.**

Run multiple AI agents together — in pipelines, debates, and teams. They work in parallel, challenge each other, ask you questions mid-run, and remember what they learned. All on your machine.

[![Visual pipeline editor](https://github.com/openconclave/oc/raw/rc/1.0.13/docs/screenshot-editor.png)](https://github.com/openconclave/oc/blob/rc/1.0.13/docs/screenshot-editor.png)

* * *

## Install

[](#install)

# Windows
irm https://openconclave.com/install.ps1 | iex

# macOS / Linux
curl \-fsSL https://openconclave.com/install.sh | bash

Open [localhost:5173](http://localhost:5173/) → import a starter → hit **Run**.

No runtime dependencies. Single binary. [Manual install →](#manual-install)

* * *

## Try something

[](#try-something)

Browse the **[conclaves repo](https://github.com/openconclave/conclaves)** for ready-to-import starters — deep code reviews, multi-agent debates, decision-support tools, and more. Drop a `.json` file into your OC instance and run it.

**To import:** Conclaves → ⬇ Import → paste URL or drop the `.json` file → map provider roles → Run.

* * *

## Two ways to use it

[](#two-ways-to-use-it)

### Pipelines

[](#pipelines)

Chain agents into workflows with a visual editor. Agents run in parallel, merge results, branch on conditions, loop until tests pass, and pause to ask you questions.

[![Pipeline editor](https://github.com/openconclave/oc/raw/rc/1.0.13/docs/screenshot-editor.png)](https://github.com/openconclave/oc/blob/rc/1.0.13/docs/screenshot-editor.png)

```
Trigger → Agent → Output                          (simple)
Trigger → [Agent, Agent, Agent] → Merge → Agent   (parallel specialists)
Trigger → Agent → Condition → Agent ↺              (retry loop)
              ↕
         Channel Loop                               (ask Claude Code)
```

Use cases: code review, TDD pipelines, security audits, data validation, content generation with editorial review — anything where one perspective isn't enough and you want the system to learn over time.

### Discussions

[](#discussions)

Put agents in a room with a moderator. They debate, challenge each other, and build on ideas across multiple rounds. The moderator steers, summarizes, and ends with a verdict.

[![Agent discussion](https://github.com/openconclave/oc/raw/rc/1.0.13/docs/screenshot-discussion.png)](https://github.com/openconclave/oc/blob/rc/1.0.13/docs/screenshot-discussion.png)

Use cases: brainstorming, red-teaming, scenario planning, decision analysis, exploring a topic from multiple angles — or just entertainment.

* * *

## What makes this different

[](#what-makes-this-different)

**Agents learn across runs.** A knowledge base stores lessons from every run. Next time, agents consult those lessons before acting. Your pipelines get smarter the more you use them.

**Multiple models in one workflow.** Use Claude for deep reasoning, GPT for a second opinion, Ollama for local-only steps — in the same pipeline. Each agent picks its own model.

**Claude-in-the-loop.** When an agent hits an ambiguous decision, it pauses the pipeline and asks Claude Code via the channel loop. Claude Code answers from context — or escalates to you in the terminal. Not a checkbox approval — an intelligent intermediary that only bothers you when it actually needs to.

**Everything stays local.** Single binary, runs on your machine, your code never leaves your laptop. No cloud. No account.

**Pipelines become tools.** Every conclave exposes as an MCP tool. Claude Code can trigger your pipelines, receive results, and answer channel loop questions.

* * *

## Build your own

[](#build-your-own)

Drag nodes, draw connections, write system prompts.

**Node types:** Trigger · Agent · Condition · Code · Merge · Channel Loop · Output · File · Discussion · Knowledge

**AI engines:** Claude · OpenAI · Ollama · any OpenAI-compatible API

**Agent tools:** Bash · Read · Write · Edit · Glob · Grep · WebSearch · WebFetch · Knowledge Search · MCP tools

**Triggers:** Manual · Cron · Webhook · Telegram · Claude Code channel

**Knowledge bases:** Embed documents with Ollama, agents get `search_knowledge` as a tool. Agents can write lessons back — your pipeline improves with every run.

**Git isolation:** Pipelines that modify code run in worktrees. Your main branch is never touched.

* * *

## Requirements

[](#requirements)

-   **Ollama** — for local models and embeddings: `ollama pull nomic-embed-text`
-   **API keys** (optional) — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or any OpenAI-compatible provider
-   **Claude Code** (optional) — for the channel loop and conclave-as-MCP-tool integration. Two plugins: `openconclave-channel` (events, channel loop) and `openconclave-dev` (manage conclaves from Claude). See [openconclave/claude-plugin](https://github.com/openconclave/claude-plugin) for details.

> **⚠ Important — current install path:** The Claude Code plugin marketplace registration is still being finalized. Until it lands, load the plugins in dev mode every time you start Claude Code:
> 
> claude --dangerously-load-development-channels plugin:openconclave-channel@openconclave
> 
> Without these, conclave channel loops won't reach your Claude Code session and you can't manage conclaves from Claude.

## Manual install

[](#manual-install)

git clone https://github.com/openconclave/oc.git
cd oc && bun install && bun start

## Docs

[](#docs)

[Architecture](https://github.com/openconclave/oc/blob/rc/1.0.13/docs/architecture.md) · [Conclave composition](https://github.com/openconclave/oc/blob/rc/1.0.13/docs/conclave-composition.md) · [Security](https://github.com/openconclave/oc/blob/rc/1.0.13/security_guidance.md) · [Lab journal](https://github.com/openconclave/oc/blob/rc/1.0.13/.notes/README.md)

## License

[](#license)

MIT