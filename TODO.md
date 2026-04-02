# OpenConclave TODO

## Priority

- [ ] Package as `bunx openconclave` / `npx openconclave` — single command installs and runs the full platform (server + UI + MCP + channel)
- [ ] Error handling / retry policy on agent nodes
- [ ] Workflow templates — pre-built installable workflows
- [ ] Workflow versioning / history

## AI Engines

- [x] **Custom provider system** — Settings page: Add Provider (name, base URL, API key). OpenAI-compatible runtime. Model list fetched live from `/v1/models`. Agent node picks provider + model.
- [ ] Built-in providers: Together AI, OpenRouter, OpenAI, Google Gemini, Groq, Mistral, Azure OpenAI, AWS Bedrock

## RAG / Knowledge Bases

- [x] Ollama embeddings (`/api/embed` with `nomic-embed-text`)
- [x] SQLite vector store (pure JS cosine similarity, no extensions)
- [x] Text chunking (recursive character splitter with overlap)
- [x] Ingestion API (file path or raw text, SHA-256 dedup)
- [x] Search API (embed query → cosine similarity → top-K)
- [x] `search_knowledge` built-in agent tool
- [x] Knowledge Bases management page (`/knowledge`)
- [x] Agent inspector KB picker (multi-select checkboxes)
- [x] Knowledge workflow node (search KB as a pipeline step)
- [ ] Document type parsers (PDF, DOCX, HTML, CSV)
- [ ] Smart chunking (markdown-aware, code-aware)
- [ ] Auto-sync / directory watcher for knowledge bases
- [ ] Visual tool snapping (drag KBs/tools onto agent nodes as chips)

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
