# 01 — Building the Code Review Conclave

**Conclave**: 9 "Code Review" (`oc_review`)
**Runs this entry covers**: 44, 45
**Commits from this arc**: `e754f27` (manual fix pass applying 12 bugs)

## Objective

Build a code review pipeline that does **depth** reviews, not shallow passes, and that uses the Dev Book (KB 1) as a shared brain: every specialist must search the KB before forming an opinion, and new lessons get written back so the next review is smarter.

The working hypothesis: **a code review system that compounds project-specific knowledge every run** is the one thing a single-LLM tool structurally cannot replicate. If it works, it's the "why OC" story.

## What we built

11 agents in 5 phases:

1. **Facts** (3 agents, parallel): Context Reader maps structure / exports / imports; Usage Analyst greps each exported symbol across the repo and flags dead code; KB Searcher does a broad KB sweep using file name, imports, symbols.
2. **Specialists** (5 agents, parallel): Correctness / Security / Tests / Conventions / Design. All Sonnet. **None** can access WebSearch or WebFetch — only Best Practices does.
3. **Best Practices** (1 agent, Sonnet + WebSearch + WebFetch + Bash for KB writes): KB-first → web-second → writes durable lessons back to KB 1.
4. **Lead Reviewer** (Sonnet + Ask User channel loop): dedupes, severity-tags, asks the user only when specialists genuinely contradict.
5. **Writer** (Haiku): saves markdown to `.reviews/<timestamp>-<file>.md`.

Invariants baked in from the start:

- **One writer to KB 1: Best Practices.** Many readers, single author. Keeps the KB from becoming a log.
- **Specialists must cite KB before flagging anything.** If the Dev Book contradicts their instinct, the KB wins.
- **Every finding gets a severity tag**: `blocker` / `major` / `minor` / `nit`. No untagged findings.

## First runs

**Run 44 — runtime.ts (559 lines)**: 1 blocker, 2 major, 4 minor, 3 nits.
The blocker: `abortSignal` declared on `AgentRunOptions`, destructured in `runClaudeAgent`, and then silently dropped — never forwarded to the SDK's `query()`. Any caller using cancellation would hang the pool slot permanently.

**Run 45 — llm-call.ts (379 lines)**: 2 blockers, 6 major, 3 minor, 3 nits.
Blockers: (1) `jsonSchemaToZod` had unbounded recursion — under `async_hooks` (OpenTelemetry, APM), a stack overflow bypasses try/catch and exits the Node process; (2) `JSON.parse(providerRow.value)` on the OpenAI path was cast to a shape with no runtime validation — a DB row with `baseUrl: "http://169.254.169.254"` would turn the server into an SSRF proxy to cloud metadata.

Both runs produced genuinely sharp findings with concrete locations, specific failure modes, and proposed fixes. Severity calibration matched my own reading of the files.

## The manual fix pass

I applied 12 of the real bugs in one commit (`e754f27`):
- 3 blockers: `abortSignal` wiring, `jsonSchemaToZod` depth limit, SSRF `providerSchema` validation
- 9 majors: env allowlist via `buildSubprocessEnv`, `mkdirSync 0o700`, `invokeDebug` empty guard, `mcpServers` key alignment, `toolState` first-wins, `toolShape.describe()` unconditional, `z.enum` safety, llm-call abort controller, llm-call env allowlist

Intentionally **deferred** all minors and nits. The "bug fix doesn't need surrounding cleanup" rule from CLAUDE.md applied.

## Observations

- **First-run quality was high**. 19 total findings across two files, every one defensible, no obvious hallucinations.
- **The oc-dev MCP plugin is the right abstraction** for building conclaves. Writing `scripts/build-code-review.ts` by hand was a workaround the user correctly flagged as tech debt — by the end of the session we moved new conclaves to `create_conclave` calls.
- **Ripgrep didn't work inside the compiled OC binary** on early runs (a separate bunfs extraction issue in the SDK). Specialists fell back to Read-only code walking, which is slower but produced correct output.

## Conclusions

The shape of the pipeline is right. KB-first discipline plus targeted Best Practices web research is a meaningfully different approach from "one big LLM reads the file and comments". The question next: does the write-back loop actually make subsequent runs better, or did we get lucky on the first pass?

## Next

Re-run the same reviews on the same files to verify my fixes held, and see whether the richer KB surfaces new findings the first pass missed. Covered in entry 02.
