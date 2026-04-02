# Workflow Editor Guide

The Workflow Editor is where you visually build your automated workflows.

## Editor Overview

![Workflow Editor](../03-workflow-editor.png)

The editor consists of three main areas:

### Left Panel: Node Types
- **Nodes section** — 7 node types to build with
- **Tools section** — 14+ MCP tools available in agents
- Easy drag-and-drop interface

### Center Canvas
- **Workflow visualization** — Your nodes and connections
- **Drag to pan** — Click and drag to move around
- **Zoom** — Scroll to zoom in/out
- **Auto-layout** — Organize nodes automatically

### Right Panel: Inspector
- **Node properties** — Edit label, engine, prompt, etc.
- **Connection settings** — Configure edge colors and routes
- **Context-sensitive** — Changes based on selected node

## Creating a Workflow

### 1. New Workflow

**Dashboard → Workflows → + New Workflow**

Enter a name and click Create.

**Naming tips:**
- Use descriptive names: "Daily Report Generator", not "Workflow1"
- Names become MCP tool names (snake_case), so keep them unique
- Can be changed later by editing the workflow

### 2. Add Your First Node

Click a node type in the left panel, then click on the canvas.

**Node appearances:**
- **Trigger** — Green pill shape (entry point)
- **Output** — Red pill shape (exit point)
- **Agent** — Blue rectangle
- **Condition** — Orange diamond
- **Code** — Purple square
- **Merge** — Blue rectangle with special icon
- **Channel Loop** — Orange rounded rectangle
- **File** — Teal square
- **Knowledge** — Teal square

### 3. Configure Each Node

Click any node to see its properties in the right inspector.

Each node type has different options (see [Node Types Guide](05-node-types.md)).

**Common properties:**
- **Label** — Display name (what you call it)
- **Description** — Optional notes
- **Engine** (for Agents) — Claude, Ollama, OpenAI, etc.
- **Prompt** (for Agents) — Instructions for the agent
- **Tools** (for Agents) — What tools the agent can access

### 4. Connect Nodes

**Drag from output handle to input handle:**
1. Click and hold the circular handle on the right of a node
2. Drag to the circular handle on the left of another node
3. Release to create a connection

**Arrow markers:**
- Directional arrows show flow
- Color indicates the connection source
- Cyan, blue, or purple colors distinguish different paths

**Valid connections:**
- Any node can connect to any other node (except Trigger input)
- Triggers only have outputs
- Outputs only have inputs
- Condition nodes route to different outputs

### 5. Save

Click **Save** button (top right).

**Keyboard shortcut:** Ctrl+S (or Cmd+S on Mac)

## Editing Workflows

### Selecting Nodes
- **Click** a node to select it
- **Selected node** highlights with blue border
- Inspector shows its properties
- Press **Delete** to remove

### Editing Connections
- **Click** a connection (arrow) to select it
- Inspector shows connection properties
- Press **Delete** to disconnect
- Change colors/routes in inspector

### Moving Nodes
- **Drag** selected node to new position
- **Shift+Drag** to move multiple selected nodes
- **Ctrl+A** to select all nodes

### Viewing Tools

Click **Tools** in the left panel to see all available MCP tools:

**Agent Tools:**
- **Bash** — Run shell commands
- **Read** — Read files
- **Write** — Write/create files
- **Edit** — Edit files
- **Grep** — Search files
- **Playwright** — Browser automation
- **And more...** — Telegram, Fetch, WebSearch, etc.

When you add an Agent node, it automatically gets tools based on:
1. The agent engine (Claude vs Ollama vs OpenAI)
2. Available MCP servers in your configuration
3. What tools it's allowed to use (configurable per node)

## Node Inspector Details

### Trigger Node Inspector
- **Label** — Name for this trigger
- **Type** — Manual, Cron, Webhook, Channel, Telegram, Chat
- **Prompt** (for manual) — Question to ask user
- **Cron expression** (for cron) — Schedule timing
- **Output variable name** — How trigger input is passed to next node

### Agent Node Inspector
- **Label** — Agent name
- **Engine** — Claude, Ollama, or OpenAI-compatible
- **Model** — Which model to use (from configured providers)
- **System Prompt** — Optional system instructions
- **Prompt** — Main task prompt
- **Temperature** — Creativity (0.0-2.0, default 1.0)
- **Max Tokens** — Response length limit
- **Tools** — Which tools the agent can use
- **Knowledge Base** — Attach knowledge bases for RAG

### Condition Node Inspector
- **JavaScript Expression** — Logic to evaluate
- **True Output Label** — Where to go if true
- **False Output Label** — Where to go if false
- **Output names** — Customize connection names

### Code Node Inspector
- **Runtime** — Python, Node.js, or Bash
- **Code** — Script to execute
- **Input variables** — What data comes in
- **Output variable** — What gets passed to next node

### Output Node Inspector
- **Label** — Output name
- **Type** — log, Telegram, file, etc.
- **Content** — What to output (can use variables)
- **Destination** — Where it goes (terminal, chat, file)

## Advanced Features

### Auto Layout

Click **Auto Layout** button to automatically arrange nodes.

**How it works:**
- Calculates optimal node positions
- Creates a hierarchical layout
- Aligns trigger at top, output at bottom
- Arranges parallel paths side-by-side

**Use when:**
- Your workflow gets messy
- Adding many nodes
- Want to reset positions

### Variables & Data Flow

Data flows through connections as JSON objects.

**Passing data:**
- Trigger outputs go into next node's input
- Agent responses become variables for next node
- Use `${variableName}` in prompts to access previous data
- Merge nodes combine multiple inputs into an object

**Example:**
```
Trigger → Agent outputs { ideas: [...] }
Agent prompt: "Refine these ideas: ${ideas}"
```

### Color-Coded Arrows

Arrow colors indicate the source connection:
- **Cyan** — From Trigger or early nodes
- **Blue** — From Agent nodes
- **Purple** — From Condition or Code nodes
- **Orange** — From special nodes (Merge, Channel Loop)

This helps visually trace the flow.

### Edge Persistence

When you save:
- Node positions are remembered
- Connection colors and routes are saved
- Zoom level and pan position are saved
- Everything reloads exactly as you left it

## Common Editing Tasks

### Change Node Label
1. Click node to select
2. In inspector, edit **Label** field
3. Save

### Remove a Node
1. Click node to select
2. Press **Delete**
3. All connections are removed
4. Save

### Reroute Connections
1. Click arrow (connection) to select
2. Press Delete to disconnect
3. Create new connection from different node
4. Save

### Add Conditional Logic
1. Add Condition node
2. Set JavaScript expression: `result.length > 100`
3. Connect True path to one node
4. Connect False path to another
5. Agent will output `true` or `false` to trigger routing

### Extract Data to Variables
1. Add Code node with language Python/Node/Bash
2. Parse the previous agent output
3. Return JSON object with extracted fields
4. Next node can use those fields

## Validation

Before saving, OpenConclave checks:
- ✅ Workflow has at least 1 Trigger
- ✅ Workflow has at least 1 Output
- ✅ All required fields are filled
- ✅ Node labels are unique
- ✅ No orphaned nodes (nodes not connected to the flow)

**If validation fails:**
- Error message tells you what's wrong
- Fix the issue
- Try saving again

## Testing & Debugging

### Run the Workflow
1. Click **Run** button (green, top right)
2. If Trigger has prompts, answer them
3. Workflow executes
4. Go to Runs page to see results

### View Execution Details
1. Go to **Runs** page
2. Click the run you want to debug
3. See:
   - Agent tasks and responses
   - Events timeline
   - Any errors or logs
   - Cost breakdown
   - Execution duration

### Agent Thinking
If using Claude or Ollama with thinking enabled:
- Click the Agent node in run details
- Expand "Thinking" section
- See the agent's reasoning process

## Workflow Templates

### Sequential Pattern
```
Trigger → Agent1 → Agent2 → Output
```

Each agent depends on previous output.

### Parallel Pattern
```
Trigger → [Agent1, Agent2, Agent3] → Merge → Output
```

All agents run simultaneously, then results are combined.

### Conditional Pattern
```
Trigger → Agent → Condition →┬→ Agent2 → Output
                              └→ Agent3 → Output
```

Different paths based on agent output.

### Loop Pattern
```
Trigger → Agent → Condition ──→ Output
            ↑        │
            └────────┘
```

Loops back if condition fails.

## Best Practices

### 1. Use Clear Labels
- "Generate Ideas" instead of "Agent1"
- "Check Output Quality" instead of "Condition1"
- Help future you understand the flow

### 2. Keep Workflows Focused
- One workflow = One job
- Don't try to do everything in one workflow
- Workflows can call other workflows as MCP tools

### 3. Test as You Build
- Add nodes one at a time
- Test after each group
- Check Run details for errors

### 4. Use Appropriate Models
- Simple tasks: Haiku
- Complex reasoning: Sonnet
- Research/planning: Opus
- Local only: Ollama

### 5. Validate Agent Output
- Add Code node after Agent
- Parse and validate JSON
- Return errors for invalid output
- Prevents cascading failures

### 6. Monitor Costs
- Check Run Details for each cost
- Use cheaper models when possible
- Batch related tasks
- Use Ollama for frequently-run tasks

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Save | Ctrl+S (Cmd+S) |
| Select All | Ctrl+A (Cmd+A) |
| Delete | Delete |
| Zoom In | Scroll Up |
| Zoom Out | Scroll Down |
| Pan | Click+Drag on canvas |
| Auto Layout | Click button |

## Troubleshooting

### Nodes Won't Connect
- Ensure you're dragging from right handle to left handle
- Both nodes must have inputs and outputs
- Trigger node has no input handle

### Workflow Won't Save
- Check validation errors (usually shown in error message)
- Ensure all required fields are filled
- Verify workflow has at least Trigger and Output

### Changes Not Appearing
- Click Save explicitly (Ctrl+S doesn't always auto-save)
- Refresh page if needed
- Check for error messages

### Performance Issues
- Too many nodes? Try simplifying
- Many parallel agents? Monitor system resources
- Large files? Check file read operations

## Next Steps

- 📋 [Node Types Reference](05-node-types.md) — Deep dive into each node type
- 💡 [Common Patterns](10-patterns.md) — Learn workflow design patterns
- 🎯 [Use Cases](11-use-cases.md) — See real workflow examples

---

**Ready to create workflows?** [Back to First Workflow →](02-first-workflow.md)
