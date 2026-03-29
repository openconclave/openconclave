# Agent Conversation Model

## Core Rules

1. **Trigger input** → injected into EVERY agent's system prompt as workflow context
2. **Agent has system prompt only** — no "prompt" field. The user message comes from input.
3. **Roles are perspective-dependent:**
   - This agent's outputs = `assistant`
   - Everything from other nodes = `user`
4. **Roles always alternate** — clean chat format

## Example: A-B-C Letter Game

### Trigger input: "Say next letter (A B C)"

### Agent 1 sees (turn 1):
```json
[
  {"role": "system", "content": "You are helpful assistant.\n\nWorkflow context: Say next letter (A B C)"},
  {"role": "user", "content": "Say next letter (A B C)"}
]
```
→ outputs "D"

### Agent 2 sees (turn 1):
```json
[
  {"role": "system", "content": "You are helpful assistant.\n\nWorkflow context: Say next letter (A B C)"},
  {"role": "user", "content": "D"}
]
```
→ outputs "E"

### Agent 1 sees (turn 2):
```json
[
  {"role": "system", "content": "You are helpful assistant.\n\nWorkflow context: Say next letter (A B C)"},
  {"role": "user", "content": "Say next letter (A B C)"},
  {"role": "assistant", "content": "D"},
  {"role": "user", "content": "E"}
]
```
→ outputs "F"

### Agent 2 sees (turn 2):
```json
[
  {"role": "system", "content": "You are helpful assistant.\n\nWorkflow context: Say next letter (A B C)"},
  {"role": "user", "content": "D"},
  {"role": "assistant", "content": "E"},
  {"role": "user", "content": "F"}
]
```
→ outputs "G"

## UI Changes Needed

- Agent node: rename "Prompt" → "System Prompt" (or keep existing systemPrompt field)
- Remove the "prompt" field from AgentConfig — input comes from workflow
- Trigger: "prompt" field is the initial workflow context

## Executor Changes

- Pass trigger payload through the entire run as workflow context
- Build conversation history per-agent with perspective-flipped roles
- Inject workflow context into every agent's system prompt
- Pass history to Claude CLI and Ollama as proper chat messages
