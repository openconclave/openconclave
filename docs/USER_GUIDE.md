# OpenConclave User Guide

**Self-hosted AI agent orchestration with visual workflow automation**

Welcome to OpenConclave! This guide will help you get started with building, managing, and running AI workflows on your own machine.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Core Concepts](#core-concepts)
3. [Dashboard Overview](#dashboard-overview)
4. [Creating Workflows](#creating-workflows)
5. [Running Workflows](#running-workflows)
6. [Monitoring Execution](#monitoring-execution)
7. [Knowledge Bases](#knowledge-bases)
8. [Configuration](#configuration)
9. [Use Cases](#use-cases)
10. [FAQ](#faq)

## Quick Start

### Installation

**Option 1: Claude Code Plugin (Recommended)**
```bash
claude plugin install github:openconclave/openconclave
```
The server auto-starts and everything is configured automatically.

**Option 2: Standalone Installation**

macOS/Linux:
```bash
curl -fsSL https://openconclave.com/install.sh | bash
```

Windows (PowerShell):
```powershell
irm https://openconclave.com/install.ps1 | iex
```

**Option 3: Manual Setup**
```bash
git clone https://github.com/openconclave/openconclave.git
cd openconclave && bun install && bun start
```

Then open http://localhost:5173 in your browser.

### Your First Login

1. Navigate to http://localhost:5173
2. You'll see the Dashboard showing system statistics
3. All your workflows, runs, and settings are stored locally on your machine

## Core Concepts

### What is a Workflow?

A workflow is a visual pipeline that connects AI agents, code execution steps, and decision logic together. Think of it as a blueprint for automating multi-step tasks.

**Key Features:**
- **Visual Editor**: Drag-and-drop node-based interface
- **Multiple AI Engines**: Use Claude Code, Ollama, or OpenAI-compatible models
- **Local Execution**: Everything runs on your machine
- **Tool Access**: Agents can read/write files, run commands, browse the web
- **Intelligent Routing**: Agents choose their own path through the workflow

### Node Types

OpenConclave provides 9 different node types:

| Node | Purpose | Icon Color |
|------|---------|-----------|
| **Trigger** | Start a workflow (manual, cron, webhook, etc.) | Green |
| **Agent** | AI task execution with tool access | Blue |
| **Condition** | Branch logic based on expressions | Orange |
| **Code** | Run Python, Node.js, or Bash scripts | Purple |
| **Merge** | Combine parallel outputs into one | Cyan |
| **Channel Loop** | Pause workflow to ask Claude Code questions | Orange |
| **Output** | Deliver results (terminal, Telegram, log) | Red |
| **File** | Read a file from disk | Blue |
| **Knowledge** | Search knowledge bases semantically | Brown |

### Agent Types

Choose the right AI engine for each task:

1. **Claude Code (Claude 3.5 Sonnet/Haiku/Opus)**
   - Full MCP tool access
   - Multi-turn conversations
   - Best for complex reasoning
   - **Cost**: Token-based (varies by model)

2. **Ollama (Local)**
   - Free and private
   - Runs on your machine
   - Limited tool access via MCP bridge
   - **Cost**: $0 (your compute)

3. **OpenAI-Compatible (OpenRouter, Together AI, etc.)**
   - Any OpenAI-compatible provider
   - Configurable in Settings
   - Supports reasoning models
   - **Cost**: Provider-specific

## Dashboard Overview

The Dashboard gives you a quick overview of your OpenConclave instance.

![Dashboard](../01-dashboard.png)

### Dashboard Sections

**Operations Panel** (Top)
- System status: Shows if all systems are idle, running, etc.

**Statistics Cards** (Metrics Row)
- **Workflows**: Total number of workflows defined
- **Active**: Number of currently running workflows
- **Total Runs**: All executions across all workflows
- **Success Rate**: Percentage of successful runs
- **Cost**: Total API costs incurred

**Run Distribution** (Left Panel)
- Success: Percentage and count of successful runs
- Failed: Count of failed runs
- Cancelled: Count of cancelled runs

**Quick Launch** (Center Panel)
- Buttons to quickly start your most-used workflows
- Actions: Chat (for conversational workflows) or Start (for automated workflows)

**Schedules** (Right Panel)
- Shows active cron schedules
- "No schedules" when none are configured

**Recent Runs** (Bottom Left)
- Your 10 most recent workflow executions
- Click to view detailed run information
- Quick status indicators

**Latest Outputs** (Bottom Right)
- Most recent workflow results
- Shows rendered markdown output
- Links to full run details

## Creating Workflows

### Step 1: Start a New Workflow

1. Click **Workflows** in the sidebar
2. Click **+ New Workflow** button
3. You'll be taken to the visual editor

### Step 2: Add Nodes

The left sidebar shows all available nodes. Drag them onto the canvas:

1. Start with a **Trigger** node (required)
2. Add **Agent** nodes for AI tasks
3. Add **Condition** nodes for branching
4. Add **Code** nodes to run scripts
5. End with an **Output** node to deliver results

### Step 3: Connect Nodes

Click and drag from a node's output handle (right side) to another node's input handle (left side) to create connections.

**Connection Colors:**
- Cyan: Success/positive flow
- Blue: Standard flow
- Purple: Alternative paths

### Step 4: Configure Each Node

Click on a node to open its **Inspector Panel** on the right:

**Trigger Node Settings:**
- Type: Manual, Cron Schedule, Webhook, Telegram, etc.
- For Cron: Use preset buttons (Every 5m, Hourly, Daily, etc.)
- Add a description for when triggered

**Agent Node Settings:**
- Select AI Model (Claude Code, Ollama, or OpenAI-compatible)
- Write the task description (this becomes the system prompt)
- Configure model parameters (temperature, max tokens)
- Select MCP tools the agent can access
- Attach knowledge bases for semantic search

**Condition Node Settings:**
- Write JavaScript expressions
- Example: `input.success === true`
- Routes to different nodes based on result

**Code Node Settings:**
- Select language: Python, Node.js, or Bash
- Write your script
- Pass input as stdin or environment variables

**Output Node Settings:**
- Choose destination: Terminal, Telegram, or Log file
- Configure message format

### Step 5: Configure Node Names and Labels

- Click on a node's title to rename it
- Descriptive names help you understand the workflow
- Names become part of run event tracking

### Step 6: Save Your Workflow

Click **Save** in the top right corner. Your workflow is now saved and ready to run.

## Running Workflows

### From the Dashboard

1. Go to **Dashboard**
2. Look for your workflow in the **Quick Launch** section
3. Click **Chat** (for conversational workflows) or **Start** (for automated workflows)

### From the Workflows List

1. Go to **Workflows**
2. Find your workflow card
3. Click **Chat** or **Start** button

### From the Workflow Editor

1. Open your workflow
2. Click the **Chat** or **Start** button in the top right

### Chat Workflows

Some workflows are designed for conversation:

![Chat Interface](../08-chat.png)

1. The chat window opens in a new tab
2. Type your message at the bottom
3. The workflow processes your input through its agents
4. Results appear in the chat
5. You can continue the conversation for multi-turn interactions

### Start Workflows

Automated workflows run once when triggered:

1. Click **Start** to begin execution
2. A run is created and appears in the Runs list
3. You can track progress in real-time
4. Results appear on the Dashboard and in Runs

### Scheduled Workflows

Set up automatic execution with cron schedules:

1. In a Trigger node, select **Cron Schedule**
2. Choose a preset: Every 5 minutes, Hourly, Daily, Weekdays, etc.
3. Save the workflow
4. The workflow runs automatically on that schedule

## Monitoring Execution

### The Runs Page

View all workflow executions:

![Runs Page](../04-runs.png)

**Run List shows:**
- Status badge (running, success, failed, cancelled)
- Workflow name
- Run number
- Duration
- Cost (if any)
- Timestamp

**Filters and Search:**
- Filter by status
- Search by workflow name
- Sort by date

### Run Details

Click on any run to see detailed execution information:

![Run Details](../05-run-detail.png)

**Details Section shows:**
- Current status (running, success, failed)
- Trigger type (manual, webhook, cron, etc.)
- Duration (how long the run took)
- Agent Tasks (number of AI tasks executed)
- Cost (API costs for this run)
- Start time

**Agent Tasks Section:**
- Shows each task executed by an agent
- Click to expand and see:
  - Full task prompt
  - Agent response
  - Tools called
  - Thinking traces (for extended thinking models)

**Events Timeline:**
- Chronological log of everything that happened
- Grouped by node
- Shows:
  - Agent spawned/finished
  - Conditions evaluated
  - Code executed
  - Outputs sent
- Color-coded borders for different node types
- Time ranges for duration

**Observable Details:**
- Markdown-rendered task descriptions
- Expandable thinking blocks (Claude, Ollama, OpenAI)
- Cost tracking per task

## Knowledge Bases

Use knowledge bases for semantic search (RAG - Retrieval Augmented Generation).

### Setting Up a Knowledge Base

1. Go to **Knowledge** in the sidebar
2. Click **+ Create Knowledge Base**
3. Give it a name (e.g., "Product Documentation")
4. Choose embedding model (recommended: nomic-embed-text with Ollama)
5. Click **Create**

### Ingesting Documents

1. Click into your knowledge base
2. Click **+ Add Documents**
3. Upload files (PDF, TXT, Markdown, etc.)
4. Documents are automatically:
   - Split into chunks
   - Embedded using your selected model
   - Indexed for semantic search

![Knowledge Bases](../06-knowledge.png)

Example: An Atlas Knowledge Book with 870 documents and 1903 chunks.

### Using Knowledge in Workflows

**Method 1: Agent Tool**
- Add an Agent node
- Check "Attach knowledge bases" in the inspector
- The agent automatically gets a `search_knowledge` tool
- Agent can search by topic: "Find information about billing"

**Method 2: Knowledge Node**
- Add a Knowledge node to your workflow
- Configure search query
- Output returns matching documents
- Pass results to other nodes

## Configuration

### Settings Overview

![Settings](../07-settings.png)

### General Settings

**Telegram Bot Token**
- Required for Telegram triggers and outputs
- Get from @BotFather on Telegram
- Allows triggering workflows from mobile
- Send results to Telegram chats

**Ollama URL**
- Local Ollama API endpoint
- Default: http://localhost:11434
- Required if using Ollama agent nodes
- Install Ollama from https://ollama.ai

### AI Providers

**OpenAI** (Pre-configured)
- API endpoint: https://api.openai.com/v1
- API type: Responses API (or Chat Completions)

**Add Custom Provider**
Click **+ Add Provider**:
- **Provider Name**: Label for your config
- **Base URL**: API endpoint (e.g., https://api.together.xyz/v1)
- **API Type**: Choose format (Responses API or Chat Completions)
- **API Key**: Your authentication token
- Models are auto-discovered from provider

**Popular Providers:**
- OpenAI: https://api.openai.com/v1
- OpenRouter: https://openrouter.ai/api/v1
- Together AI: https://api.together.xyz/v1
- Groq: https://api.groq.com/openai/v1
- Anthropic (if Claude Code not available): https://api.anthropic.com/v1

## Use Cases

### 1. Code Review Assistant

**Workflow:**
1. Trigger: Manual (upload code)
2. Agent 1: Code Scanner (parallel)
3. Agent 2: Architecture Reviewer (parallel)
4. Merge: Combine findings
5. Condition: Check severity
6. Output: Send report

**Benefits:**
- Review multiple aspects simultaneously
- Consistent evaluation criteria
- Automated documentation

### 2. Documentation Generator

**Workflow:**
1. Trigger: Webhook (on code push)
2. Agent: Code Analyzer
3. Code Node: Format output
4. Agent: Markdown formatter
5. Output: Write to repo

**Benefits:**
- Auto-generate docs from code
- Keeps docs in sync
- Consistent formatting

### 3. Customer Support Agent

**Workflow:**
1. Trigger: Chat (conversational)
2. Agent: Support Assistant (with knowledge base)
3. Condition: Need escalation?
4. Channel Loop: Ask Claude Code (human)
5. Output: Send response to customer

**Benefits:**
- 24/7 automated support
- Knowledge base integration
- Human escalation when needed

### 4. Data Pipeline

**Workflow:**
1. Trigger: Cron (daily)
2. Code Node: Fetch data
3. Agent: Process/analyze
4. Condition: Quality check
5. Output: Store results

**Benefits:**
- Automated data processing
- Scheduled execution
- Multi-stage pipeline

### 5. Multi-Agent Game

**Workflow:**
1. Trigger: Manual
2. Agent 1: Game Master
3. Agent 2: Player 1
4. Agent 3: Player 2
5. Condition: Game over?
6. Channel Loop: If loop needed
7. Output: Results

**Benefits:**
- Agents interact with each other
- Complex workflows
- Entertainment and testing

## FAQ

### Q: Where is my data stored?
A: All data is stored locally in `.openconclave/` in your home directory. Nothing is sent to external servers.

### Q: How much does it cost?
A: OpenConclave is free. You only pay for API calls if you use Claude Code, OpenAI-compatible providers, or other paid services. Ollama is completely free.

### Q: Can I use multiple AI models in one workflow?
A: Yes! You can mix Claude Code, Ollama, and any OpenAI-compatible provider in the same workflow.

### Q: How do I schedule workflows?
A: Add a Trigger node, select "Cron Schedule," choose a preset (hourly, daily, etc.), and save. The workflow runs automatically.

### Q: Can workflows call other workflows?
A: Yes! Each workflow becomes an MCP tool that other workflows can call via agent tool access.

### Q: What if a run fails?
A: Failed runs appear in the Runs list with a "failed" badge. Click to view the error in Run Details. The Events timeline shows exactly where it failed.

### Q: Can I integrate with Telegram?
A: Yes! Add your Telegram Bot Token in Settings. You can trigger workflows from Telegram and send results to chats.

### Q: How do I add a knowledge base?
A: Go to Knowledge, click "Create Knowledge Base," upload documents, and attach it to Agent nodes. Agents can then search it with semantic queries.

### Q: What's the difference between Chat and Start buttons?
A: **Chat** opens a conversation interface for multi-turn interactions. **Start** runs the workflow once and returns results.

### Q: Can I see what agents are thinking?
A: Yes! In Run Details, expand Agent Tasks to see thinking traces, reasoning, and tool calls.

### Q: How do I monitor costs?
A: The Dashboard shows total cost. Each run displays per-run costs in Run Details.

### Q: Can I disable a workflow without deleting it?
A: Yes! Click the disable button on the workflow card. It won't run on schedule but you can still trigger it manually.

---

**Need help?** Check the [API Documentation](./architecture.md) or explore example workflows in the Quick Launch section on the Dashboard.
