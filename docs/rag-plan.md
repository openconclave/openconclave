# RAG Plan for OpenConclave (Local, Easy-First)

Based on the existing codebase architecture: Ollama integration, MCP bridge, SQLite/Drizzle, built-in agent tools.

---

## Phase 1: Zero-Code RAG via MCP (Easiest Win)

**Effort: ~1 hour | Impact: Immediate RAG for agents**

Already have full MCP bridge support. There are existing open-source MCP servers for RAG:

- **mcp-rag** or similar — MCP server that does chunking + embedding + retrieval
- **mcp-memory** — several memory/knowledge MCP servers listed on the official MCP registry

**What to do:**
1. Find a suitable RAG MCP server that uses local embeddings (Ollama) and local storage (SQLite or filesystem)
2. Register it in OpenConclave's MCP server table
3. Agents immediately get `search_documents`, `index_document` etc. as tools

**Pros:** Zero code changes, works today
**Cons:** No UI integration, no visual workflow node, relies on third-party MCP server quality

---

## Phase 2: Ollama Embeddings + SQLite Vector Store (Core Foundation)

**Effort: ~2-3 days | Impact: Native local RAG**

Everything stays local, no external services.

### 2a. Ollama Embeddings
- Ollama already supports `/api/embed` endpoint
- Add a helper function in `packages/server/src/agent/ollama.ts`:
  ```
  generateEmbedding(model: string, text: string) → number[]
  ```
- Default model: `nomic-embed-text` (good quality, fast, 768 dims)
- User pulls it once: `ollama pull nomic-embed-text`

### 2b. SQLite Vector Store
- Use **`sqlite-vec`** extension (works with bun:sqlite, pure SQLite)
- New Drizzle tables:
  - `knowledge_bases` — id, name, embedding_model, chunk_size, chunk_overlap, created_at
  - `documents` — id, knowledge_base_id, filename, source_path, content_hash, created_at
  - `chunks` — id, document_id, content, metadata_json, embedding (BLOB), chunk_index
- Vector search via `vec_distance_cosine()` SQL function

### 2c. Ingestion API
- `POST /api/knowledge/:id/ingest` — accepts file path or text
- Pipeline: read file → split into chunks → embed each → store in chunks table
- Text splitter: recursive character splitter (paragraph → sentence → word boundaries)
- Configurable chunk_size (default 512 tokens) and overlap (default 50 tokens)

### 2d. Search API
- `POST /api/knowledge/:id/search` — query string → embed → vector search → return top-K chunks
- Returns: `{ results: [{ content, score, metadata, document }] }`

### 2e. Built-in Agent Tool
- Add `search_knowledge` to `builtin-tools.ts`
- Parameters: `{ query: string, knowledge_base?: string, top_k?: number }`
- Agents can search knowledge bases during execution
- Add `knowledgeBases?: string[]` to `AgentConfig` — agent node knows which KBs to search

---

## Phase 3: Knowledge Base UI (Settings Page)

**Effort: ~2 days | Impact: User-friendly management**

### 3a. Settings Page Section
- New tab/section in settings: "Knowledge Bases"
- List knowledge bases with doc count, chunk count, last updated
- Create new KB: name, embedding model (dropdown from Ollama), chunk size, overlap
- Per KB: drag-and-drop file upload, or browse filesystem
- Show ingestion progress, document list with delete option

### 3b. Agent Node Inspector
- Add a "Knowledge Bases" multi-select in the agent inspector panel
- Selected KBs → `search_knowledge` tool auto-injected with KB filter

---

## Phase 4: RAG Workflow Node (Visual)

**Effort: ~2 days | Impact: RAG as composable workflow step**

### 4a. New Node Type: `knowledge`
- Add to `NODE_TYPES` in shared constants
- Config: `{ knowledgeBaseId: string, query: "input" | "custom", customQuery?: string, topK: number }`
- Takes input text → runs vector search → outputs retrieved chunks as context
- Can be placed before an Agent node to inject context

### 4b. Visual Design
- New node color (e.g., `node-knowledge` — warm amber/gold)
- Icon: `BookOpen` or `Database` from lucide
- Shows KB name and doc count as subtitle

### 4c. Execution
- New `executeKnowledge()` in `packages/server/src/engine/nodes/knowledge.ts`
- Input: upstream text (or custom query expression)
- Output: formatted context string with source attribution

---

## Phase 5: Document Processing Pipeline (Advanced)

**Effort: ~3 days | Impact: Handle real-world documents**

### 5a. File Type Parsers
- PDF → text (via `pdf-parse` or similar Bun-compatible lib)
- Markdown → plain text (strip formatting)
- HTML → text (cheerio)
- CSV → structured text (row-per-chunk or column-aware)
- Code files → function-level chunks (tree-sitter or regex-based)

### 5b. Smart Chunking
- Markdown-aware: split on headings, preserve structure
- Code-aware: split on function/class boundaries
- Metadata preservation: source file, page number, heading path

### 5c. Auto-Sync / Watch
- Optional: watch a directory, auto-ingest new/changed files
- Content hash comparison to skip unchanged files
- Could be a trigger type: "Knowledge Updated" → re-run workflow

---

## Phase 6: Visual Tool Snapping (UX Polish)

**Effort: ~3 days | Impact: Beautiful UX**

React Flow parent-child nodes for visual tool attachment:

- Knowledge bases, MCP servers, and built-in tools rendered as small "chip" nodes
- Drag from palette → drop onto agent → snaps as child node with `parentId`
- Visually stacked on the right edge of the agent node
- Removing = drag off or delete
- Replaces both the tool checkboxes AND the KB multi-select with a unified visual metaphor

---

## Recommended Order

```
Phase 1 (MCP shortcut)      → try today, see if quality is good enough
Phase 2 (native foundation)  → build this regardless, it's the core
Phase 3 (KB management UI)   → makes Phase 2 usable
Phase 4 (workflow node)      → makes RAG composable in workflows
Phase 5 (doc processing)     → handles real documents beyond .txt
Phase 6 (visual snapping)    → UX polish, the "wow factor"
```

Phase 2 is the most important — once you have local embeddings + SQLite vector search + agent tool, everything else builds on it.
