# OpenConclave

Self-hosted AI agent orchestration with visual workflow automation.

![editor](docs/03-workflow-editor.png)

## What is it?

OpenConclave lets you wire up AI agents into visual workflows — drag nodes, draw connections, hit Run. Agents can use Claude, Ollama, or any OpenAI-compatible provider in the same workflow. Everything runs on your machine.

Workflows can pause to ask you questions, send results to Claude Code, trigger on a schedule, and call each other as MCP tools.

## Install

**Manual:**
```bash
git clone https://github.com/openconclave/oc.git
cd openconclave && bun install && bun start
```

Open http://localhost:5173

## Features

- **Visual workflow editor** — 8 node types, auto-layout, arrow markers, pill-shaped entry/exit nodes
- **Multi-engine agents** — Claude (via Agent SDK), Ollama, and any OpenAI-compatible provider in the same workflow
- **RAG / Knowledge Bases** — ingest documents, embed with Ollama, semantic search via built-in agent tool
- **Channel-in-the-loop** — workflows pause, ask Claude Code a question, wait for your response
- **Workflows as MCP tools** — every workflow becomes a tool Claude Code can discover and call
- **Agent invoke API** — code nodes call agents by ID via HTTP, with structured tool definitions and enum validation
- **Dynamic routing** — agents choose their own path via tool calls
- **Cron scheduling** — run workflows on a schedule with preset patterns
- **Telegram integration** — trigger workflows from mobile, send results to chats
- **Ollama MCP bridge** — local models use Playwright, web fetch, and other MCP tools
- **Run observability** — markdown-rendered tasks, events grouped by node, cost tracking, thinking traces
- **Crash recovery** — interrupted runs detected and marked on server restart

## Node Types

| Node | Purpose |
|------|---------|
| **Trigger** | Start a workflow (manual, cron, webhook, channel, telegram, chat) |
| **Agent** | AI task with tool access (Claude, Ollama, or OpenAI-compatible) |
| **Condition** | Branch logic with expressions |
| **Code** | Run Python, Node.js, or Bash scripts |
| **Merge** | Wait for all parallel inputs, combine into object |
| **Channel Loop** | Pause workflow, ask Claude Code, resume on response |
| **Output** | Deliver results (log, Claude Code channel, Telegram) |
| **File** | Read a file from disk as node input |

## Example Workflows

**[Mafia Game](examples/mafia-game/)** — 9 AI agents playing social deduction. Code nodes orchestrate agents sequentially via `/api/agents/invoke`, with dynamic tool definitions (enums for valid targets), information isolation per role, and a game loop via condition nodes. Works with Claude, Ollama, and OpenAI agents.

**Security Review** — parallel code scanner + architecture reviewer, merge findings, classify risks, generate report

**UI Dev Team** — planner picks a task, developer implements, reviewer checks, tester validates with Playwright, committer pushes — each agent can ask Claude Code questions via channel loop

**Number Guessing Game** — two Ollama agents (Game Master + Guesser) play against each other in a loop

## RAG / Knowledge Bases

Agents can search your documents using semantic similarity:

1. Pull an embedding model: `ollama pull nomic-embed-text`
2. Go to `/knowledge` in the UI — create a knowledge base, ingest files
3. Attach knowledge bases to Agent nodes in the inspector

Agents automatically get a `search_knowledge` tool when knowledge bases are available.

## Documentation

- [Getting Started](docs/01-getting-started.md)
- [First Workflow](docs/02-first-workflow.md)
- [Node Types](docs/05-node-types.md)
- [AI Providers](docs/09-ai-providers.md)
- [Knowledge Bases](docs/07-knowledge-bases.md)
- [Workflow Patterns](docs/10-patterns.md)
- [Channel Loop](docs/12-channel-loop.md)
- [Scheduling](docs/14-scheduling.md)
- [API Integrations](docs/13-api-integrations.md)
- [What is OpenConclave](WHAT_IS_OPENCONCLAVE.md) — design philosophy
- [Security Guidance](security_guidance.md) — threat model and mitigation checklist

## Acknowledgements

Built with [Claude Code](https://claude.ai/code) by Anthropic. Inspired by the workflow automation ideas in [n8n](https://n8n.io) and [Langflow](https://langflow.org).

## License

MIT
