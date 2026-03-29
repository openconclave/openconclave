---
description: "Create an OpenConclave workflow from a natural language description. Use when the user wants to build a workflow, automate a task, orchestrate agents, set up a pipeline, or connect multiple AI steps together. Triggers on: 'create a workflow', 'build a workflow', 'automate', 'set up a pipeline', 'I want to orchestrate'."
argument-hint: "Describe what the workflow should do"
allowed-tools:
  - mcp__openconclave__create_workflow
  - mcp__openconclave__list_workflows
  - mcp__openconclave__get_workflow
---

# Create OpenConclave Workflow

You are designing and creating an OpenConclave workflow from the user's request. Your goal: translate their intent into a working workflow with proper node structure, then create it via MCP and give them the URL.

## Design Principles

**Single Responsibility**: Each agent does ONE thing well. Never create a "hero agent" that handles everything. Break complex tasks into focused steps.

**Don't oversimplify**: If the task has distinct phases (fetch, process, format, deliver), use separate nodes. A workflow with 1 agent is usually wrong.

**Don't over-engineer**: If 2 agents can do the job, don't use 5. Every node should earn its place. Ask: "would removing this node lose something?"

**Data flows forward**: Each node receives input from the previous node's output. Design prompts so agents output what the next node needs.

**Right tool for the job**:
- **Agent**: when you need AI reasoning, creativity, or tool use
- **Code**: when you need deterministic processing (parse CSV, call API, transform data)
- **Condition**: when you need branching based on a value
- **Merge**: when parallel branches need to combine before continuing
- **Output**: to deliver results (channel, telegram, log)

## Node Types Reference

### Trigger
Starts the workflow. Config:
- `type`: "manual" | "cron" | "webhook" | "channel" | "telegram"
- `prompt`: default input text (for manual/cron)
- `cron`: cron expression (for cron type, e.g., "0 9 * * *")
- `chatId`: Telegram chat ID (for telegram type)

### Agent
AI task execution. Config:
- `engine`: "claude" (default) or "ollama"
- `prompt`: what the agent should do — be specific, reference input
- `systemPrompt`: optional role/behavior instructions
- `model`: "haiku" (fast/cheap), "sonnet" (balanced), "opus" (powerful)
- `ollamaModel`: e.g., "qwen3.5:9b" (for ollama engine)
- `allowedTools`: ["Bash", "Read", "Write", "Grep", "WebFetch", "WebSearch"]
- `mcpServers`: ["playwright", "telegram-voice", "filesystem", "fetch"]
- `maxTurns`: limit agent iterations (default 25)

### Code
Script execution. Config:
- `runtime`: "python" | "node" | "bash"
- `code`: the script to run
- Input via stdin + $INPUT env var. Output via stdout.

### Condition
Branch logic. Config:
- `expression`: JavaScript expression evaluated against `input`
- Has "true" and "false" output handles
- Example: `typeof input === "string" && input.includes("error")`

### Merge
Combines parallel outputs. No config needed.
- Waits for ALL connected inputs
- Output: `{"Node Label 1": output1, "Node Label 2": output2, ...}`
- Keys are source node labels — make sure they're unique

### Output
Delivers results. Config:
- `type`: "claude-code" (channel to Claude Code session) | "telegram" (send to chat) | "log" (server console)
- `chatId`: for telegram type

## Workflow Patterns

**Sequential**: Trigger → Agent A → Agent B → Output
Use when each step depends on the previous.

**Parallel (fan-out/fan-in)**: Trigger → [A, B, C] → Merge → Output
Use when tasks are independent and can run simultaneously.

**Conditional**: Trigger → Agent → Condition → (true) Output A / (false) Agent B
Use when the next step depends on a result.

**Loop**: Trigger → Agent → Checker → Condition → (false) back to Agent / (true) Output
Use for iterative refinement. The checker must pass data back for the next iteration.

**Tap**: Agent → Output (main chain) + Agent → Logger (side effect)
Use for logging, notifications, or side effects without blocking the main flow.

## Prompt Writing for Agents

Good agent prompts:
- Reference input: "Read the file path from input and..."
- Specify output format: "Output only the JSON, no explanation"
- Be specific: "Extract the top 5 headlines with URLs" not "Summarize the page"
- One task: "Count the lines in the poem" not "Count lines, check rhyme, fix grammar"

Bad agent prompts:
- Vague: "Process the data"
- Multi-task: "Fetch the URL, parse the HTML, extract links, save to file, and send to Telegram"
- No input reference: "Write a poem" (what about? use the trigger input!)

## Model Selection Guide

- **Haiku**: fast, cheap. Good for: simple extraction, classification, formatting, yes/no checks
- **Sonnet**: balanced. Good for: code review, writing, analysis, most tasks
- **Opus**: powerful, slower. Good for: complex reasoning, deep analysis, architecture decisions
- **Ollama** (local): free, private. Good for: simple text tasks, when privacy matters, no internet needed

## Creating the Workflow

After designing the workflow:

1. Assign unique labels to every node (Agent A, Agent B, not Agent, Agent)
2. Use `create_workflow` MCP tool with all nodes and edges
3. Node positions: start trigger at {x: 0, y: 0}, space nodes 160px vertically, parallel nodes 240px horizontally
4. Edge IDs: use format "e1", "e2", etc.
5. After creation, give the user the URL: `http://localhost:5173/workflows/{id}`

## Process

1. Read the user's request
2. If critical info is missing (like: should it run on schedule? what model?), ask ONE focused question
3. Design the workflow following the principles above
4. Explain the design briefly: what each node does and why
5. Create it via MCP
6. Give the user the URL and suggest they test it
