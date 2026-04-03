# Mafia Game — 9 AI Agents Playing Social Deduction

A full 9-player Mafia game running as a single OpenConclave workflow. No custom game engine — the game logic lives entirely in Python code nodes that orchestrate agent nodes via the `/api/agents/invoke` endpoint.

## What This Demonstrates

- **Code nodes calling agents programmatically** — Python code nodes invoke agent nodes via HTTP, controlling who speaks when and what context they receive
- **Dynamic tool definitions** — each agent call includes structured tools (enums for valid targets), so agents return machine-readable actions instead of free text
- **Information isolation** — code nodes filter game state per player: town sees public events only, mafia sees teammate chat, detective sees investigation results
- **Game loop via condition nodes** — the workflow loops Day → Night → Day until a win condition is met, using condition nodes to check `winner !== null`
- **Multi-engine support** — agents can run on Claude (haiku/sonnet/opus), Ollama (local), or OpenAI-compatible providers. The game logic doesn't change.

## Workflow Structure

```
Trigger
  │
  ▼
Role Distribution (code/python)
  │   Shuffles roles, assigns to 9 agent nodes
  ▼
Day Chat Engine (code/python)  ◄─────────────────┐
  │   Calls each living agent with day_speech tool │
  ▼                                                │
Day Vote Engine (code/python)                      │
  │   Calls each agent with day_vote tool (enum)   │
  │   Tallies votes, eliminates player              │
  ▼                                                │
Post-Day Check (condition)                         │
  │ winner !== null?                               │
  ├─ true → Channel Output                        │
  ▼ false                                          │
Night Mafia Engine (code/python)                   │
  │   Calls mafia agents with mafia_action tool    │
  │   Resolves kill vote                           │
  ▼                                                │
Night Town Engine (code/python)                    │
  │   Detective: investigate tool → guilty/innocent │
  │   Doctor: protect tool                         │
  │   Resolves night kill (saved if protected)     │
  ▼                                                │
Post-Night Check (condition)                       │
  │ winner !== null?                               │
  ├─ true → Channel Output                        │
  └─ false ────────────────────────────────────────┘
```

## Nodes

| Node | Type | Purpose |
|------|------|---------|
| Trigger | trigger | Manual start |
| Role Distribution | code (python) | Randomly assigns 1 godfather, 2 mafia, 1 detective, 1 doctor, 4 townspeople |
| Day Chat Engine | code (python) | Sequential agent speeches — each sees prior speeches |
| Day Vote Engine | code (python) | Sequential agent votes — each sees prior votes. Tally + elimination |
| Night Mafia Engine | code (python) | Mafia members chat + vote on kill target |
| Night Town Engine | code (python) | Detective investigates, doctor protects, resolves night kill |
| Post-Day Check | condition | `input.winner !== null` — exits loop if game over |
| Post-Night Check | condition | Same check after night phase |
| Agent 1–9 | agent | LLM agents called via `/api/agents/invoke` |
| Channel Output | output | Sends final game state to Claude Code channel |

## How Agents Are Called

Code nodes don't use workflow edges to reach agents. Instead they call the HTTP endpoint:

```python
def call_agent(node_id, prompt, tools=None):
    body = {
        "workflowId": int(os.environ["OC_WORKFLOW_ID"]),
        "runId": int(os.environ["OC_RUN_ID"]),
        "nodeId": node_id,
        "prompt": prompt
    }
    if tools:
        body["tools"] = tools
    req = urllib.request.Request(
        f"{os.environ['OC_API_URL']}/api/agents/invoke",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read())
    if "tool_call" in result:
        return result["tool_call"]["input"]
    return result["output"]
```

Each call logs an agent task in the run, so every speech/vote/action is observable in the run detail page.

## Dynamic Tools

Instead of parsing free text, agents receive structured tool definitions with enums:

```python
# Voting — agent must pick from valid living players
tool = {
    "name": "day_vote",
    "description": "Cast your vote to eliminate a player",
    "input_schema": {
        "type": "object",
        "properties": {
            "player_name": {
                "type": "string",
                "enum": ["Agent 1", "Agent 3", "Agent 5"],  # only valid targets
            },
            "reasoning": {"type": "string"}
        },
        "required": ["player_name"]
    }
}
```

The invoke endpoint routes to the appropriate engine:
- **Claude**: dynamic MCP server serves the tools, agent calls them via standard MCP
- **Ollama**: tools passed directly to `/api/chat`
- **OpenAI**: tools passed as function definitions to chat completions

## Information Filtering

Each player only sees what their role allows:

| Role | Sees | Hidden |
|------|------|--------|
| Townsperson | Public speeches, votes, elimination results, night kill announcements | Mafia chat, investigation results, protection targets |
| Mafia | All public info + teammate identities + mafia night chat | Investigation results, protection targets |
| Detective | All public info + own investigation results | Mafia chat, other players' night actions |
| Doctor | All public info + own protection history | Mafia chat, investigation results |

The Godfather appears **innocent** to detective investigations.

## Game Rules

- **9 players**: 1 Godfather, 2 Mafia, 1 Detective, 1 Doctor, 4 Townspeople
- **Day phase**: All living players speak (sequential, seeing prior speeches), then vote (sequential, seeing prior votes). Plurality eliminates; ties = no elimination.
- **Night phase**: Mafia chat and vote to kill a town player. Detective investigates one player. Doctor protects one player (can't repeat).
- **Win conditions**: Town wins when all mafia eliminated. Mafia wins when mafia >= town. Draw if day > 10.

## Running

1. Import `workflow.json` or create the workflow manually
2. Set agent engine/model on all 9 agent nodes (e.g., `claude/haiku`, `ollama/qwen3.5:9b`)
3. Trigger the workflow
4. Watch the run detail page — each agent task shows the prompt and response

A full game typically runs 2-4 day/night cycles with 20-50+ agent calls.
