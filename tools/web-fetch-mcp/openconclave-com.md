# OpenConclave — Orchestrate AI Agents Visually

// DOCTRINE

## The Doctrine

penConclave lets you build, run, and manage multi-agent workflows visually. Connect AI agents, code execution, external tools, and human-in-the-loop decision points into automated pipelines — all from a drag-and-drop editor or programmatically via Claude Code.

01

### VISUAL EDITOR

Drag-and-drop workflow builder with 9 node types, auto-layout, directional arrows, and live execution visualization. Build complex agent pipelines without writing orchestration code.

02

### MULTI-ENGINE

Claude Code (via Agent SDK), Ollama, and any OpenAI-compatible provider in the same workflow. Mix models freely across nodes. MCP bridge gives local models access to Playwright, Fetch, and more.

03

### SELF-HOSTED

Everything stays on your machine. SQLite database, local file storage, no cloud dependencies. Your data never leaves your computer unless you explicitly send it.

// ARCHITECTURE

## The Architecture

### // 9 NODE TYPES

Start a workflow — manual, cron, webhook, channel, Telegram, or chat

IN: 0OUT: 1

AI task execution with tool access — Claude Code, Ollama, or OpenAI-compatible

IN: 1OUT: 1+

Branch logic with JavaScript expressions — true/false routing

IN: 1OUT: 2

Execute Python, Node.js, or Bash scripts — stdin/stdout piping

IN: 1OUT: 1

Combine parallel outputs into a single object for downstream nodes

IN: 2+OUT: 1

Pause workflow, ask Claude Code a question, resume on response

IN: 1OUT: 1

Deliver results — log, Telegram, Claude Code channel, file, or webhook

IN: 1OUT: 0

Read a file from disk as node input — relative or absolute paths

IN: 0OUT: 1

Search knowledge bases with semantic similarity for RAG workflows

IN: 0OUT: 1

### // 3 AI ENGINES

RECOMMENDED

#### Claude Code

Direct Agent SDK integration with full tool access — bash, read, write, edit, grep, web search, and MCP tools. Extended thinking with visible reasoning. Multi-turn conversation persistence via resume sessions.

-   Haiku ~$0.80/1M tokens
-   Sonnet ~$3/1M tokens
-   Opus ~$15/1M tokens

FREE & LOCAL

#### Ollama

Zero API costs, runs 100% locally, complete privacy. MCP tool bridge gives local models access to Playwright, Fetch, and other tools. Multi-turn conversation persistence via JSONL session files.

-   Llama, Mistral, 50+ models
-   8GB RAM minimum
-   GPU acceleration supported

UNIVERSAL

#### OpenAI-Compatible

Any provider: OpenAI, OpenRouter, Together AI, Gemini, Groq, or custom endpoints. Responses API and Chat Completions modes. Multi-turn conversation persistence via JSONL session files.

-   GPT-4, Gemini, Groq
-   Model auto-discovery
-   Custom endpoints supported

### // WORKFLOW PATTERNS

SequentialA → B → C → D

Tasks that depend on previous step output

ParallelA → \[B, C, D\] → Merge

Independent tasks running simultaneously

ConditionalA → Condition → B / C

Branch based on JavaScript expressions

LoopingA → B → Condition → A

Repeat until condition is met

Channel LoopA → Ask Human → B

Pause for human decisions

Dynamic RouteA → Agent Chooses → B

Agent picks its own next step

// INSTALLATION

## The Installation

Three paths to enlightenment. Choose the one that fits your workflow.

```
$curl -fsSL https://openconclave.com/install.sh | bash
```

Downloads the binary, installs to ~/.openconclave/bin, adds to PATH. Then run: oc

### // HOW IT WORKS

01

#### Build

Drag nodes onto the canvas. Connect triggers, agents, conditions, and outputs into a workflow.

02

#### Configure

Set each agent's model, prompt, tools, and knowledge bases. Mix Claude Code, Ollama, and OpenAI freely.

03

#### Execute

Run manually, on a schedule, or via webhook. Watch live execution with pulsing nodes and real-time events.

04

#### Observe

Review markdown-rendered tasks, thinking traces, cost tracking, and event timelines grouped by node.

// CARDINALS

## The Cardinals

### // CAPABILITIES

01

#### WORKFLOWS AS MCP TOOLS

Every workflow auto-generates a tool name and becomes callable by Claude Code. Dynamic tool registration via MCP protocol.

02

#### KNOWLEDGE BASES & RAG

Ingest documents, embed with Ollama, semantic search via built-in agent tool or dedicated Knowledge node. Agents answer based on your documents, not just training data.

03

#### CHANNEL-IN-THE-LOOP

Workflows pause, send questions to Claude Code with full context metadata, wait for your response, then resume. Perfect for approval gates.

04

#### CRON SCHEDULING

Run workflows on a schedule with preset buttons — every 5 minutes, hourly, daily, weekdays, weekly, monthly. Custom cron expressions supported.

05

#### CRASH RECOVERY

Interrupted runs detected and marked on server restart. Pending prompts cleaned up on cancellation. Server self-terminates when Claude Code exits.

06

#### RUN OBSERVABILITY

Markdown-rendered agent tasks, events grouped by node, cost tracking, thinking traces from Claude, Ollama, and OpenAI reasoning summaries.

07

#### AGENT INVOKE API

Code nodes call agents by ID via HTTP with structured tool definitions and enum validation. Enables dynamic multi-agent orchestration where code controls agent execution.

08

#### EXTENDED THINKING

Visible reasoning across all engines — Claude thinking blocks, Ollama think tags, OpenAI reasoning summaries, and Together AI reasoning fields.

### // USE CASES

Content Generation~$0.05-0.15/post

Code Review Automation~$0.02-0.10/PR

Customer Support Agent~$0.001-0.01/query

Data Processing Pipeline~$0.01-0.05/file

Daily Report Generation~$0.02-0.10/report

Research & Analysis~$0.05-0.20/research

### // TECH STACK

BunHonoDrizzle ORMSQLiteReact 19React Flow v12Tailwind CSS v4VitestTypeScriptMCP ProtocolWebSocket