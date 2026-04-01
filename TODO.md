# OpenConclave TODO

## Priority

- [ ] Package as `bunx openconclave` / `npx openconclave` — single command installs and runs the full platform (server + UI + MCP + channel)
- [ ] Package as Claude Code plugin — `/plugin install openconclave` for MCP tools + channel integration
- [ ] Error handling / retry policy on agent nodes
- [ ] Workflow templates — pre-built installable workflows
- [ ] Workflow versioning / history

## AI Engines

- [ ] **Custom provider system** — Settings page: Add Provider (name, base URL, API key). One OpenAI-compatible runtime handles all. Model list fetched live from `/v1/models`. Agent node picks provider + model from saved list.
- [ ] Built-in providers: Together AI, OpenRouter, OpenAI, Google Gemini, Groq, Mistral, Azure OpenAI, AWS Bedrock
- [ ] Together AI account already registered

## Features

- [ ] Webhook trigger implementation
- [ ] File output type
- [ ] Notification output type (browser push)
- [ ] Agent timeout handling
- [ ] Workflow import/export (JSON)
- [ ] Workflow duplication
- [ ] Node copy/paste in editor
- [ ] Search/filter on runs page
- [ ] Cost tracking per workflow (not just per run)
- [ ] Dark/light theme toggle

## Code Quality

- [ ] Client component tests (React Testing Library)
- [ ] API integration tests
- [ ] Expression evaluator: replace Function() with proper sandboxed parser
- [ ] Code node sandboxing (container/VM isolation)
- [ ] Environment variable sanitization for spawned processes

## MCP Bridge

- [ ] Schema validation on Ollama tool call arguments
- [ ] Handle hallucinated tool calls gracefully
- [ ] Connection pooling for MCP servers (reuse across runs)
- [ ] Extract as standalone package: `@openconclave/mcp-bridge`
