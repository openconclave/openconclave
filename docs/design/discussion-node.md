# Discussion Node

A new node type for multi-agent sequential conversation — a "round table" where connected agents speak one by one, each seeing the full conversation so far.

## Problem

Today, orchestrating a "round" where multiple agents speak in sequence — each seeing what came before — requires a Code node with 50-100 lines of Python that manually loops agents, builds prompts, calls the invoke API, and accumulates responses. This is the single most common pattern in multi-agent workflows and deserves a first-class node.

## Concept

A Discussion node is a **round table**. Connected agents speak one at a time, and each sees the full transcript when it's their turn. A **moderator** controls who speaks next and when the discussion ends.

The node is visually larger than a standard node. It has:

- **Agent edges** — standard incoming connections from agent nodes (the participants)
- **Moderator slot** — a dedicated drop zone inside the node body where the user drags in either a Code node or an Agent node to act as moderator. Empty by default — the user **must** fill it.

```
┌─────────────────────────────┐
│      Discussion Node        │
│  "Day Chat"                 │
│                             │
│  ┌───────────────────────┐  │
│  │   Moderator: (empty)  │  │  ← drop an Agent or Code node here
│  │   ┌─────┐             │  │
│  │   │ drop │             │  │
│  │   └─────┘             │  │
│  └───────────────────────┘  │
│                             │
│  Participants: 6 agents     │
│  Max rounds: 5              │
│                             │
│  ● input          output ●  │
└─────────────────────────────┘
       ▲  ▲  ▲  ▲  ▲  ▲
       │  │  │  │  │  │
    Agent edges (participants)
```

When a Code node is dropped into the moderator slot, it becomes a **code moderator** (deterministic rules). When an Agent node is dropped in, it becomes an **agent moderator** (LLM-driven). The dropped node is visually "nested" inside the Discussion node — it doesn't exist as a separate node on the canvas anymore.

Each participant agent receives a prompt composed of:

1. A **topic** (static text or templated from input)
2. A **role briefing** per agent (from agent's own system prompt)
3. The full **transcript** of everything said so far
4. An optional **structured output tool** so responses have a predictable shape

The node outputs the collected responses as an array, plus the full transcript.

## Moderator

The moderator is the brain of the discussion. It controls two things:

1. **Who speaks next** — pick the next agent, or end the discussion
2. **When to stop** — exit rule that ends the round table

The moderator can be **code** (deterministic, fast, no LLM call) or an **agent** (adaptive, intelligent, costs an LLM call per turn).

### Code Moderator (default)

A lightweight rules engine evaluated after each speech. No LLM calls — just expressions.

```yaml
moderator:
  type: "code"

  # Who speaks next. Options:
  #   "round-robin"  — cycle through agents in order
  #   "random"       — random order each round, everyone speaks once
  #   "fixed"        — same order every round
  nextSpeaker: "round-robin"

  # Exit condition — evaluated after each complete round.
  # Has access to: responses, transcript, round, input
  exitWhen: "round >= 3"

  # Safety cap — always stops here regardless of exitWhen
  maxRounds: 10
```

#### Exit expression examples

| Expression | Meaning |
|---|---|
| `round >= 3` | Stop after 3 rounds |
| `responses.every(r => r.structured.sentiment === 'agree')` | Stop when all agents agree |
| `responses.length >= 12` | Stop after 12 total speeches |
| `input.budget <= 0` | Stop when external budget exhausted |

### Agent Moderator

An actual agent node that sees the transcript and decides what happens next. Evaluated after every speech (not just after each round).

```yaml
moderator:
  type: "agent"
  agentNodeId: "agent_moderator_123"

  # Safety cap — agent can't keep the discussion going forever
  maxRounds: 10
```

The moderator agent receives the transcript and a structured tool:

```yaml
tool:
  name: "moderate"
  description: "Decide what happens next in the discussion"
  schema:
    type: object
    properties:
      action:
        type: string
        enum: [call_next, call_specific, end_discussion]
        description: "What to do next"
      nextAgent:
        type: string
        description: "Agent name to call on (required if action is call_specific)"
      summary:
        type: string
        description: "Summary of the discussion (required if action is end_discussion)"
    required: [action]
```

**Actions:**

| Action | Behavior |
|---|---|
| `call_next` | Continue with the next agent in order |
| `call_specific` | Call on a specific agent by name — "Soren, what's your response to that?" |
| `end_discussion` | Stop the discussion, include summary in output |

This enables adaptive conversations: the moderator can react to what's being said, call out specific agents to respond, and decide when the group has reached a conclusion.

#### Agent moderator prompt template

```
# Discussion Moderator — Round {{round}}

You are moderating a discussion about: {{input.topic}}

## Participants
{{agentList}}

## Transcript
{{transcript}}

---

Decide what happens next. You can:
- **call_next**: continue with the next speaker in order
- **call_specific**: call on a specific agent to respond (use when someone was referenced or should defend themselves)
- **end_discussion**: end the discussion if consensus is reached or enough has been said
```

## Configuration

The Discussion node's config lives partly in the node itself and partly in the slotted moderator.

### Discussion Node Config

```yaml
type: discussion
config:
  # Prompt template for participants.
  # Variables: {{agentName}}, {{input}}, {{transcript}}, {{round}}
  prompt: |
    {{input.topic}}

    {{transcript}}

    You are {{agentName}}. Give your perspective in 2-3 sentences.

  # Optional: only include connected agents matching a filter expression
  # Variables: agentId, agentName, input
  filter: "input.alive[agentId] === true"

  # Optional: structured output tool agents must use
  tool:
    name: "respond"
    description: "Provide your response"
    schema:
      type: object
      properties:
        message:
          type: string
          description: "Your response"
        sentiment:
          type: string
          enum: [agree, disagree, neutral]
      required: [message]

  # Safety cap — always required
  maxRounds: 5
```

Participants are determined by **edges** — any agent node connected to the Discussion node is a participant. No explicit agent list in config.

### Moderator Slot

The moderator is not config — it's a **slotted node**. Stored in the workflow definition as a child reference:

```yaml
moderator:
  # If a Code node was dropped in:
  type: "code"
  nodeId: "code_mod_123"  # reference to the embedded code node

  # If an Agent node was dropped in:
  type: "agent"
  nodeId: "agent_mod_456"  # reference to the embedded agent node
```

#### Code Moderator (slotted Code node)

The code receives the current discussion state as input and must output a moderation decision:

```python
# Input: { responses, transcript, round, input }
# Output: { action, nextAgent?, summary? }

import json, sys
data = json.load(sys.stdin)

if data["round"] >= 3:
    print(json.dumps({"action": "end_discussion", "summary": "Done after 3 rounds"}))
else:
    print(json.dumps({"action": "call_next"}))
```

Or for simpler cases, a one-liner expression mode in the code node:

```yaml
# Expression mode — no full script needed
nextSpeaker: "random"
exitWhen: "round >= 3"
```

#### Agent Moderator (slotted Agent node)

The agent node in the slot is a regular agent with its own system prompt and model config. At each turn it receives the transcript and a structured tool (see Moderator section above for the `moderate` tool schema).

## Input / Output

### Input

Any JSON object. Accessible in the prompt template as `{{input}}` or `{{input.fieldName}}`.

### Output

```json
{
  "responses": [
    {
      "agentId": "agent_123",
      "agentName": "Rowan",
      "round": 1,
      "message": "I think we should...",
      "structured": { "message": "I think we should...", "sentiment": "agree" }
    }
  ],
  "transcript": "**Rowan:** I think we should...\n\n**Elara:** Building on that...",
  "moderatorSummary": "The group agreed on approach X after 2 rounds.",
  "rounds": 2,
  "exitReason": "condition_met",
  "input": { "...original input passed through..." }
}
```

`exitReason` values: `"condition_met"` | `"moderator_ended"` | `"max_rounds"` | `"no_agents"`

The `input` field is passed through so downstream nodes can access the original state alongside the discussion results.

## Execution Flow

### Code Moderator

```
round = 0
loop:
  round++
  Determine agent list (resolve agents, apply filter, apply order per nextSpeaker)
  For each agent:
    Build prompt: render template with {{input}}, {{agentName}}, {{transcript}}
    Invoke agent via /api/agents/invoke with optional tool
    Append response to transcript and responses array
  Evaluate exitWhen expression
    If true → exit with "condition_met"
  If round >= maxRounds → exit with "max_rounds"
Output { responses, transcript, rounds, exitReason, input }
```

### Agent Moderator

```
round = 0, agentQueue = ordered agent list
loop:
  Take next agent from queue
  If queue empty → round++, refill queue, check maxRounds
  Build prompt, invoke agent, append to transcript
  Invoke moderator agent with transcript
  Switch on moderator action:
    call_next     → continue (next from queue)
    call_specific → push named agent to front of queue
    end_discussion → exit with "moderator_ended" + summary
  If round >= maxRounds → exit with "max_rounds"
Output { responses, transcript, moderatorSummary, rounds, exitReason, input }
```

## Examples

### Code Review Round

Three reviewer agents discuss a PR diff. Code moderator, 1 round.

```yaml
agents: ["agent_reviewer1", "agent_reviewer2", "agent_reviewer3"]
prompt: |
  Review this code change:

  ```
  {{input.diff}}
  ```

  Prior reviews:
  {{transcript}}

  You are {{agentName}}. Provide your review.
tool:
  name: "review"
  schema:
    type: object
    properties:
      verdict: { type: string, enum: [approve, request_changes, comment] }
      comments: { type: string }
    required: [verdict, comments]
moderator:
  type: "code"
  nextSpeaker: "fixed"
  exitWhen: "round >= 1"
```

### Brainstorm with Consensus Exit

All agents brainstorm until everyone agrees, max 5 rounds.

```yaml
agents: "all"
prompt: |
  Topic: {{input.topic}}

  Discussion so far:
  {{transcript}}

  You are {{agentName}}. Add a new idea or support an existing one.
tool:
  name: "respond"
  schema:
    type: object
    properties:
      idea: { type: string }
      sentiment: { type: string, enum: [new_idea, support, disagree] }
    required: [idea, sentiment]
moderator:
  type: "code"
  nextSpeaker: "random"
  exitWhen: "responses.filter(r => r.round === round).every(r => r.structured.sentiment === 'support')"
  maxRounds: 5
```

### Moderated Debate

An agent moderator runs a debate, calling on specific agents to respond to each other.

```yaml
agents: ["agent_pro", "agent_con", "agent_neutral"]
prompt: |
  Debate topic: {{input.topic}}

  {{transcript}}

  You are {{agentName}}. Make your argument or respond to what was said.
moderator:
  type: "agent"
  agentNodeId: "agent_debate_moderator"
  maxRounds: 4
```

### Filtered Discussion (Mafia-style)

Only agents marked alive in state participate.

```yaml
agents: "all"
filter: "input.players.find(p => p.nodeId === agentId && p.alive)"
prompt: |
  Day {{input.day}} Discussion.
  {{transcript}}
  You are {{agentName}}. Share your thoughts.
moderator:
  type: "code"
  nextSpeaker: "random"
  exitWhen: "round >= 1"
```

## How This Replaces Manual Code

| Mafia Game Node | Discussion Node Equivalent |
|---|---|
| Day Chat Engine (95 lines Python) | 1 Discussion node, code moderator, filter for alive players |
| Night Mafia Engine chat portion (80 lines) | 1 Discussion node, code moderator, filter for mafia faction |

The vote tallying and state mutation still need a Code or Vote node — Discussion only handles the conversation round.

## UI

### Canvas Node

The Discussion node is a **larger node** on the canvas — roughly 2x the height of a standard node. It has two visual zones:

**Top: Node header**
- Title ("Day Chat", "Code Review", etc.)
- Subtitle showing participant count: "6 agents connected"
- Standard input/output handles on left and right

**Center: Moderator slot**
- A bordered drop zone inside the node body
- **Empty state:** dashed border, "Drop moderator here" label, dimmed icon
- **Code moderator filled:** shows a small Code node chip inside — label, language icon, and the `exitWhen` expression as a one-liner preview
- **Agent moderator filled:** shows a small Agent node chip inside — agent name and avatar/icon

**Bottom: Config summary**
- Max rounds badge
- Filter expression (if set), truncated

```
┌─────────────────────────────────┐
│  ◎ Day Chat Discussion          │
│  6 agents · random order        │
│                                 │
│  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐  │
│  │  ⚙ Code Moderator         │  │
│  │  exit: round >= 3          │  │
│  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘  │
│                                 │
│  max 5 rounds                   │
│  ● input              output ●  │
└─────────────────────────────────┘
```

### Drag-and-drop behavior

- User drags a Code node or Agent node from the palette (or from the canvas) into the moderator slot
- The dropped node is **absorbed** into the Discussion node — it's no longer a standalone node on the canvas
- Clicking the moderator chip opens the moderator's config in the inspector (code editor for Code, agent settings for Agent)
- A small ✕ button on the chip ejects the moderator back out (or deletes it), returning the slot to empty state
- The Discussion node is **invalid** (red border, can't run) until the moderator slot is filled

### Inspector Panel

When the Discussion node is selected, the inspector shows:

1. **Topic / Prompt template** — text editor with template variable hints
2. **Participants** — list of connected agents with reorder handles (for fixed order mode)
3. **Filter** — optional expression field
4. **Structured output** — optional tool schema editor (same as agent tool config)
5. **Moderator** — embedded inspector for the slotted node:
   - If Code: code editor + `exitWhen` field + `nextSpeaker` dropdown + `maxRounds`
   - If Agent: agent config (model, system prompt) + `maxRounds`
6. **Max rounds** — safety cap, always visible

## Implementation Scope

### Server

- New node type `discussion` in the workflow engine executor
- Reuse existing `agentInvoke` infrastructure for both participants and agent moderator
- Template rendering (simple mustache-style variable substitution)
- Filter expression evaluation (reuse condition node's expression evaluator)
- Code moderator: execute slotted code node after each turn, parse action from output
- Agent moderator: invoke slotted agent node after each turn, parse structured tool call
- Resolve participant list from incoming edges (agent nodes only)

### Client

- New **larger** node component in the canvas (2x height of standard nodes)
- **Moderator slot** — drop zone with drag-and-drop handling:
  - Accept Agent or Code nodes from palette or canvas
  - Absorb dropped node into the Discussion node (remove from canvas, store as child)
  - Eject button to release the moderator back out
  - Visual chip showing moderator type and preview
- Validation: red border / warning when moderator slot is empty
- Inspector panel with embedded moderator config section
- Node palette entry

### Shared

- Add `discussion` to the `NodeType` union
- Add `DiscussionNodeConfig` type
- Add `moderator` field to node data: `{ type: "code" | "agent", nodeId: string }`
- Concept of **child nodes** (nodes embedded inside other nodes) — this is new to the data model
