# 11 — Dreamer and Indexer: a local Dreams-shaped pipeline in a day

**Date**: 2026-05-08
**What we built**: Two OC conclaves that together replicate the architecture of Anthropic's [Dreams API](https://platform.claude.com/docs/en/managed-agents/dreams), running entirely on local hardware against `gemma4:e4b` via Ollama.
**Why it's worth a beat of celebration**: Anthropic announced Dreams in beta on 2026-05-06. Two days later, OC has a working prototype of the same pattern, self-hosted, free at the margin, processing real OC development sessions.

## TL;DR

- **Dreamer** (conclave 52) — extracts a session `.jsonl` (Claude Code transcript) into a structured per-chunk `_summary.md` that preserves user pushback verbatim, captures agent backtracks, and quotes Claude's own self-summaries character-for-character.
- **Indexer** (conclave 53) — chunks a Dreamer summary on `---` boundaries, produces a per-chunk description + 5–10 keyword index with line-range references back into the source. Turns a 90 KB summary into a 3 KB grep-able catalog.
- Two engine fixes shipped to `rc/1.0.19` today as part of the work: the silently-failing Improve buttons (commit `7b29f23`) and the `MAX_CONCLAVE_ITERATIONS=100` ceiling that capped any loop-shaped pipeline at ~24 chunks (commit `5e6a64f`). Versions 1.0.24 and 1.0.25.
- The pipeline successfully processed the **2.4 MB Atlas3 session** (8 chunks, gemma4:e4b, structured extraction with verbatim user wording preserved including typos) and made it past chunk 20 of the **232 MB OC-development session** (run 562, ongoing) before context filled.

## How it compares to Anthropic Dreams

| | Anthropic Dreams (beta) | This (today) |
|---|---|---|
| **Status** | Research preview, requires access | Working in our repo, runs now |
| **Where it runs** | Anthropic cloud, billed Console credits | Local Ollama or Max subscription |
| **Header / dependency** | `dreaming-2026-04-21` beta header | None |
| **Input** | `memory_store` + up to 100 sessions | One `.jsonl` file (any size) |
| **Output** | New Anthropic memory store | Local `<sid>_summary.md` + `<sid>_index.md` |
| **Models supported** | `claude-opus-4-7`, `claude-sonnet-4-6` | Any OC engine: Claude (via Max), Ollama, OpenAI |
| **Multi-stage** | Single grader-style pipeline | Two conclaves: per-session Dreamer + per-summary Indexer (cross-session reducer pending) |

The architecture maps 1:1: read past sessions, produce an organized output. The implementation is everything Anthropic's hosted offering structurally cannot do — runs on your hardware, sees your data, costs nothing if you're already on Max.

## Architecture

### Dreamer (conclave 52)

```
trigger → strip & extract → chunker → Done? ─true─→ Output
                              ↑                      false
                              │                       │
                              └── writer ── Summarizer
```

**Key decisions:**

- **strip & extract** writes the cleaned `.md` to disk and returns only metadata via stdout (4 MB stdout cap forced this; cleantext for the OC-development session is 16 MB).
- **chunker** holds only `{position, totalChunks, targetTokens, sessionId}` in `OC_SESSION_DIR` scratch state. Re-derives chunks deterministically from the `.md` on every iteration. Default `8192` tokens per chunk.
- **Summarizer** uses a structured-extraction prompt with five fixed sections (`## User`, `## Agent actions`, `## Agent decisions and claims`, `## Self-summaries`, `## Outcome`). Verbatim quoting rule for user pushback ("preserve typos, fragmentary commands, repeated demands character-for-character") and for `[claude self-summary]` blocks.
- **writer** appends to `<sid>_summary.md` and **deletes `agent_*.jsonl` conversation files** in `OC_SESSION_DIR` between iterations. Without this, OC's Ollama adapter accumulates every prior chunk + summary into the next request and overruns gemma's 32k context after ~5 chunks.
- **Tool I/O minimization**: every `[assistant tool: NAME]` block becomes a bare marker (no input). Tool results capped at 500 chars. The thinking / text blocks around the markers tell the story of what was edited.

### Indexer (conclave 53)

```
trigger → chunker → Done? ─true─→ Output
            ↑                      false
            │                       │
            └── writer ── Indexer
```

**Key decisions:**

- **chunker** splits the source `_summary.md` on `\n\n---\n\n` separators (1:1 with Dreamer's per-chunk sections). Computes line ranges per chunk so the index can reference source positions.
- **chunker** tolerates source growth — if Dreamer is still appending to the summary, the indexer ignores chunks beyond its frozen `totalChunks`. Lets you debug a live pipeline.
- **Indexer agent** prompt: produce exactly two lines, `**Description:**` (1–2 sentences, past tense) and `**Keywords:**` (5–10 comma-separated identifiers, lowercase unless source uses specific case). No preamble, no commentary.
- **writer** appends to `<sid>_index.md` with chunk position and line range references: `## chunk N → _summary.md lines X–Y`.

### Sample output (chunk 1, run 564, gemma4:e4b)

```md
## chunk 1  →  _summary.md lines 78–121

**Description:** The agent debugged the OpenConclave channel plugin integration,
initially addressing format issues in `.mcp.json` and proxy architecture.
Ultimately, the debugging session concluded that the MCP tools were functional,
but the main problem was failing to receive channel messages (notifications),
pointing to a potential WebSocket failure.
**Keywords:** openconclave-channel, plugin:openconclave-channel@openconclave-marketplace,
.mcp.json, mcpServers, WebSocket, channel:output, channel-proxy.ts
```

Specific identifiers preserved (`mcpServers`, `channel:output`, `EADDRINUSE`, `process.kill(pid, 0)`, workflow IDs like `l5Vpj9bT8tYkkTaxGWwbf`). Future grep on any of those lands in the right chunk in seconds.

## Engineering notes (the bugs we found and fixed)

These are what made the pipeline real. Each is documented for the next time we trip on it.

### 1. Improve buttons silently failed (commit `7b29f23`, v1.0.24)

The UI's Improve buttons posted `channel:improve-*` events that the OC MCP plugin tried to deliver via `server.notification({ method: "notifications/claude/channel" })`. Claude Code has no surface for that custom MCP method, so events disappeared.

Fix: routes now also emit a `channel:output` plugin event at `runId=0` via `maybeEmitPluginEvent` — same path real conclave outputs use. Directive constructors moved from `openconclave-channel.ts` into `channel.ts`.

### 2. `MAX_CONCLAVE_ITERATIONS = 100` ceiling (commit `5e6a64f`, v1.0.25)

The graph walker capped any conclave at 100 total node firings. A 30-chunk Dreamer run ≈ 120 firings → `Exceeded max iterations (100)`.

Fix: removed the cap entirely. Agent-level limits (`maxTurns`, timeouts) cover the LLM-cost runaway case; pure code-node infinite loops cost only CPU and are observable + cancellable. The 100 ceiling was paranoid defense against a class of bugs that's free to leave running for a few seconds.

### 3. Conversation history bloat in Ollama adapter

OC's `agentSessions` map keys conversation history by node id. Same agent node called multiple times in a loop (chunker → Summarizer → writer → chunker) accumulates every prior chunk + summary in the next request. The Summarizer's `agent_*.jsonl` grew to 90 KB after 4 iterations and would overrun gemma's 32k context after ~5.

Workaround: writer deletes `agent_*.jsonl` files in `OC_SESSION_DIR` after each summary write, forcing the next iteration to start fresh.

Right fix (TODO): add a `stateless: boolean` field to `AgentConfig`. When true, `executeAgent` ignores `agentSessions` and always starts fresh. Pipeline-loop summarizers should be stateless by default.

### 4. 4 MB stdout cap on code nodes

`CODE_NODE_OUTPUT_CAP_BYTES` truncates code-node stdout. Strip & extract was emitting `{ cleanText, meta }` with cleanText up to 16 MB on the OC-development session. Hit the cap.

Fix: strip & extract writes the `.md` to disk and returns only `{ sessionId, outputPath, meta }` via stdout. Chunker re-reads the `.md` from disk on every iteration (including the first). State holds only position; cleantext never flows through stdout or memory across iterations.

### 5. Re-chunking determinism

Chunker re-reads source on every iteration and re-chunks. If `target_tokens` changes between iterations, chunk count differs → assertion fires. Same problem if the source `.md` itself changes mid-run.

Defense: state stores `targetTokens`. Re-chunk uses the stored value, not the env var, so changing `CHUNK_TOKENS` mid-run doesn't break a running pipeline.

For Indexer specifically: source `_summary.md` is *expected* to grow (Dreamer is still appending). Indexer truncates the re-chunk to original `totalChunks` — ignores new sections, indexes only what was there at first iteration.

## Validating the meta-thesis

The OC-development session (`d465fb51-...`, 232 MB, started 2026-03-30, our literal first day of OC) was fed back through the pipeline. Reading the produced summary:

- **Today's Ollama-conversation-history bug** (item 3 above) is the **same bug class** documented in chunks 7–9 of the dream summary, day 1. *"For Ollama, there are two conversation histories... independent and potentially conflicting."*
- **Today's `_callerCwd` precedence issue** in `Workspace.fromTrigger` is the **same architectural problem** worked through in chunks 6–8 of day 1.
- **The `__chatTerminal` sentinel** in graph-walker.ts:510 is documented at its birth in chunk 11 of day 1, with the exact reasoning ("chat trigger has both an out handle and an in handle... when it receives a response back, it should emit `chat:response` and stop").

Three places where today's debugging hours could have been minutes if the index existed at the time. **The recurrence pattern that motivates the Dreams thesis is empirically present in our own development data.**

## What's next

1. **Cross-session reducer (stage 3)** — a third conclave that consumes many `_summary.md` files and produces a curated lessons document. The natural input scope: 770+ session files in `~/.claude/projects/<project-encoded>/`, ~400 MB raw, ~5–7 MB summary corpus after Dreamer, fits comfortably in one Claude Opus call for synthesis.
2. **`PreToolUse` hook for proactive index lookup** — the realized value of the index/summary depends entirely on retrieval at decision time. A hook that searches `_index.md` files when about to Edit / Write a relevant file would put the archive in front of the agent without requiring "I should consult memory" judgment. This is the highest-leverage missing piece.
3. **Engine TODOs** — `stateless` agent config flag, `_callerCwd` precedence inversion, code-node `__routeTo` routing (mirror the agent pattern). All small, all unblock pipeline patterns.
4. **Validation harness** — measure whether feeding produced summaries/indexes back into a future Claude session actually changes behavior at decision time. Anthropic's Harvey case study claims ~6× completion-rate improvement; we have zero analog evidence yet.

## Honest limits

- **n=1 session validated end-to-end** at modest size (2.4 MB). The 232 MB OC-development session ran past chunk 20 today; full run is many hours and pending.
- **Quality of per-session output is meaningfully better than expected** but still drifts: tool action lists vary in faithfulness chunk-to-chunk, Self-summaries section sometimes misclassifies agent text, file paths get inferred-from-context where the source had bare markers.
- **No evidence of behavioral uplift** — the pipeline produces useful artifacts. Whether reading them changes future-Claude's actions is the question we haven't answered.
- **Hardware-bound at scale** — gemma4:e4b on RTX 4060 Ti at 2–6 sec per chunk works for sessions in the low-megabyte range. The 232 MB session at full chunk count (~430 chunks) is a multi-hour overnight run. Sonnet via Max would be both faster and higher-quality, at the cost of dropping the local-only property.
- **The cross-session reducer doesn't exist yet.** Without it, we have a pile of per-session artifacts and no curated knowledge document.

## Files of record

- `packages/server/src/routes/channel.ts` — Improve-button fix
- `packages/server/src/engine/graph-walker.ts` — iteration cap removal
- Conclave 52 (Dreamer) and 53 (Indexer) — created via `mcp__plugin_openconclave_openconclave__create_conclave`, all node code stored in DB
- `packages/server/src/agent/ollama.ts:130-141` — the conversation-history-from-disk pattern that necessitated the writer's `agent_*.jsonl` cleanup
- This file — `.notes/11-dreamer-and-indexer.md`

## What it feels like

Anthropic shipped Dreams in their cloud on 2026-05-06. We shipped a working analog on local hardware on 2026-05-08. **The architecture isn't magic, the implementation isn't theirs alone, and the per-session pattern works at the size we've tested.** The piece that turns archive into capability — the cross-session reducer + the retrieval hook — is the next session's work, not this one's.

But the pipeline runs. The summary captures real signal. The index makes that signal retrievable. **And the meta-test — Dreamer reading our own development history — already shows the pattern of bug recurrence the whole exercise was meant to catch.**

That's a real day.
