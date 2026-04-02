# Node Types Reference

OpenConclave includes 9 different node types for building workflows. This is the complete reference guide.

## 1. Trigger Node

**Shape:** Green pill  
**Purpose:** Start a workflow  
**Outputs:** User input or scheduled execution

### Trigger Types

#### Manual
User clicks Run button. Optionally prompts for input before execution.

**Inspector Settings:**
- **Prompt** (optional) — Question to ask user
- **Output Variable Name** — How the input is passed (default: `input`)

**Example:**
```
Trigger: "What topic should I research?"
↓
Agent uses ${input} in its prompt
```

#### Cron
Automatically runs on a schedule.

**Inspector Settings:**
- **Cron Expression** — Standard cron syntax or presets
- **Enabled/Disabled** — Toggle schedule on/off
- **Last Run Time** — When it last executed

**Cron Presets:**
- Every 5m, 10m, 15m, 30m
- Hourly
- Every 2h, 4h, 6h, 12h
- Daily (9am)
- Weekdays (9am)
- Weekends (10am)
- Weekly (Monday 9am)
- Monthly (1st of month)

**Custom Cron:**
```
0 9 * * * = Daily at 9am UTC
*/30 * * * * = Every 30 minutes
0 0 * * 1 = Weekly on Monday
```

**Runs with empty input** unless the trigger has a Prompt field.

#### Webhook
External systems can trigger via HTTP POST.

**Inspector Settings:**
- **Webhook URL** — Unique URL provided by OpenConclave
- **Accept JSON body** — Passed to next node

**How to use:**
1. Create workflow with Webhook trigger
2. Copy the webhook URL
3. Make POST request: `curl -X POST webhook-url -d '{"key":"value"}'`
4. Workflow runs with that JSON data

#### Channel
Triggered from Claude Code via the OpenConclave channel plugin.

**How to use:**
1. In Claude Code, import workflows: `workflows list`
2. Call workflow: `workflows trigger "workflow-name" '{"input":"data"}'`
3. Workflow executes
4. Results appear in Claude Code terminal

#### Telegram
Triggered from Telegram bot messages.

**Prerequisites:**
- Telegram Bot Token configured in Settings
- User has started a chat with your bot

**How to use:**
1. Start chat with your bot
2. Send a message
3. Workflow runs with message as input
4. Output can be sent back to Telegram

#### Chat
Triggered via the chat interface in OpenConclave.

**Inspector Settings:**
- **Chat History** — Optional context from previous messages

**Use for:**
- Interactive conversations
- Multi-turn agent interactions
- Testing prompts

### Outputs
All triggers output data that flows to the next node(s):
- `${input}` or custom variable name
- Use in downstream node prompts

---

## 2. Agent Node

**Shape:** Blue rectangle  
**Purpose:** AI task execution with tool access  
**Outputs:** Agent response (text, JSON, structured data)

### Agent Engines

#### Claude (Claude Code SDK)
Full-featured AI agent with complete tool access.

**Inspector Settings:**
- **Model** — Select haiku, sonnet, opus
- **System Prompt** — Optional system instructions
- **Prompt** — Main task
- **Temperature** — 0.0-2.0 (default 1.0)
- **Max Tokens** — Response length limit
- **Tools** — Select which tools to enable
- **Knowledge Bases** — Attach for RAG
- **Session** — Resume previous conversations

**Available Tools:**
- bash, read, write, edit, grep, web search, and more
- Runs in your project's working directory
- Full tool calling with retries

#### Ollama (Local LLM)
Free, private, runs 100% locally.

**Prerequisites:**
- Ollama installed and running
- Model pulled: `ollama pull llama2`
- Ollama URL configured in Settings

**Inspector Settings:**
- **Model** — Auto-discovered from Ollama
- **System Prompt** — Optional instructions
- **Prompt** — Task instructions
- **Temperature** — 0.0-2.0
- **Top K/P** — Sampling parameters
- **Thinking** — Enable extended thinking

**Available Tools:**
- bash, read, write, file operations
- Via MCP bridge
- No external API calls

#### OpenAI-Compatible
Any OpenAI-compatible provider (OpenAI, OpenRouter, Together AI, Groq, etc.)

**Inspector Settings:**
- **Provider** — Select from configured providers
- **Model** — From provider's available models
- **API Key** — Required (stored securely)
- **Temperature** — 0.0-2.0
- **Max Tokens** — Response limit

**Supported Providers:**
- OpenAI (GPT-4, GPT-3.5)
- OpenRouter (70+ models)
- Together AI (open models)
- Groq (fast inference)
- Gemini (via compatible API)
- Custom OpenAI-compatible endpoints

### Common Properties

**Label** — Display name (e.g., "Validate Input", "Generate Report")

**Prompt** — Task instructions. Can use variables:
```
Analyze this code: ${codeContent}
Focus on: ${focusArea}
Output as JSON.
```

**Tools Selection** — Check which tools the agent can use:
- ☐ Bash
- ☐ Read
- ☐ Write
- ☐ Edit
- ☐ Grep
- ☐ Playwright
- ☐ Telegram
- ☐ etc.

**Knowledge Bases** — Attach for semantic search:
1. Create knowledge base in Knowledge page
2. Add documents/PDFs
3. Select here: Agent gets `search_knowledge` tool

### Output Routing

**Default:** Output goes to next connected node.

**Dynamic Routing:** Agent can choose next step:
1. Add Agent node
2. Agent uses `openconclave_next` tool: `{"next_step": "Process Results"}`
3. Workflow routes to node with that label
4. Configure fallback for failed routing

### Agent Best Practices

1. **Be Specific** — Clear, detailed prompts work better
2. **Use Variables** — `${variable}` for dynamic input
3. **Set Constraints** — "Output must be JSON", "Max 500 words"
4. **Handle Errors** — Expect retries for tool failures
5. **Cost Optimization:**
   - Use Haiku for simple tasks
   - Use Sonnet for complex reasoning
   - Use Ollama for frequent tasks
   - Batch related work

---

## 3. Condition Node

**Shape:** Orange diamond  
**Purpose:** Branch logic based on expressions  
**Outputs:** Two paths (true/false)

### Inspector Settings

**JavaScript Expression** — Evaluated against input:
```
// Examples:
result.length > 10  // Check array length
response.success === true  // Check boolean
value > 100 && value < 1000  // Range check
data.status === 'valid'  // String comparison
```

**True Output Label** — Where to go if expression is true  
**False Output Label** — Where to go if expression is false  

### Input Variables

Access previous node's output:
```
// If agent returned: { ideas: [...], count: 5 }
input.count > 3  // true, because count is 5
input.ideas.length > 10  // false, because only 5 ideas
```

### Conditional Patterns

**Simple Check:**
```
Agent → Condition: result.length > 0 →┬→ Process
                                       └→ Empty Input Error
```

**Range Validation:**
```
Agent → Condition: score > 0.5 && score < 1.0 →┬→ Good
                                                └→ Out of Range
```

**Type Checking:**
```
Condition: typeof input === 'string' →┬→ Continue
                                       └→ Format Error
```

**Nested Conditions:**
```
Condition1 → Condition2 → Condition3 → Continue
          ↘     ↓         ↘    ↓
           Error1        Error2
```

### Output Routing

Both paths (true/false) are required. You must connect:
1. One output to a true path node
2. One output to a false path node

---

## 4. Code Node

**Shape:** Purple square  
**Purpose:** Execute scripts (Python, Node.js, Bash)  
**Outputs:** Script result (stdout/stderr)

### Inspector Settings

**Runtime** — Select:
- **Python** — Python 3.x with common packages
- **Node.js** — JavaScript with npm packages
- **Bash** — Shell commands

**Code** — Script to execute

**Input Variables** — Access previous output:
```python
# Python example
import json
data = json.loads(input_data)  # from previous node
result = data['key'] * 2
print(json.dumps(result))
```

### Language Examples

**Python:**
```python
# Parse and transform data
import json
input_obj = json.loads(input_data)
output = {
    'count': len(input_obj),
    'doubled': input_obj['value'] * 2
}
print(json.dumps(output))
```

**Node.js:**
```javascript
const input = JSON.parse(process.stdin);
const result = {
    timestamp: new Date().toISOString(),
    processed: input.items.length > 0
};
console.log(JSON.stringify(result));
```

**Bash:**
```bash
#!/bin/bash
# Parse and process
echo "Processing..."
wc -l < input.txt
```

### stdin/stdout

- **stdin** — Receives previous node's JSON output
- **stdout** — Script output becomes next node's input
- **stderr** — Appears in run logs (warnings/errors)

### Use Cases

1. **Data Transformation**
   - Parse complex JSON
   - Transform formats
   - Extract specific fields

2. **Validation**
   - Check data integrity
   - Verify formats
   - Sanitize input

3. **Calculation**
   - Math operations
   - Aggregations
   - Statistical analysis

4. **Integration**
   - Call local APIs
   - Process files
   - Run system commands

---

## 5. Merge Node

**Shape:** Blue rectangle with merge icon  
**Purpose:** Combine parallel outputs  
**Outputs:** Merged object with all inputs

### When to Use

After parallel processing, merge results before next stage.

```
Trigger →┬→ Agent1 ─→┐
         ├→ Agent2 ─→┼→ Merge → Output
         └→ Agent3 ─→┘
```

### Inspector Settings

**Output Object Structure:**
- Each input becomes a key
- Key names are node labels

**Example:**
If you have three agents: "Brainstorm", "Evaluate", "Rank"
```json
{
  "brainstorm": "5 ideas generated...",
  "evaluate": "Ideas scored...",
  "rank": "Ranked by quality..."
}
```

### Output Usage

In downstream nodes, access merged data:
```
${merge.brainstorm}  // Access first agent output
${merge.evaluate}    // Access second output
${merge.rank}        // Access third output
```

---

## 6. Channel Loop Node

**Shape:** Orange rounded rectangle  
**Purpose:** Pause workflow and ask Claude Code  
**Outputs:** Claude Code response

### How It Works

1. Workflow sends a question to Claude Code via channel
2. Workflow pauses and waits
3. You (in Claude Code) read the question and respond
4. Response is passed to next node
5. Workflow resumes

### Inspector Settings

**Prompt** — Question to ask (can use variables):
```
Should we proceed with: ${proposal}?
Respond with: "yes" or "no"
```

**Output Variable Name** — How response flows to next node

### Use Cases

1. **Human Review**
   - Ask for approval before proceeding
   - Validate agent output
   - Get human input on decisions

2. **Clarification**
   - Ask user for more details
   - Confirm ambiguous data
   - Request specification

3. **Conditional Routing**
   - Ask which path to take
   - User decides next steps
   - Human-in-the-loop approval

### Example Workflow

```
Agent: Generate 3 options
         ↓
Channel Loop: "Pick option: ${options}"
         ↓
         (pause - wait for Claude Code response)
         ↓
Agent: "Implement selected option: ${response}"
         ↓
Output: Show results
```

### Message Format

Messages appear in Claude Code with metadata:
```
[OpenConclave] Workflow: "Code Reviewer"
Sender: "Review Agent"
Question: "Should we approve these changes?"
```

---

## 7. Output Node

**Shape:** Red pill  
**Purpose:** Deliver results  
**Outputs:** End of workflow

### Output Types

#### Log
Send to OpenConclave logs (default).

**Inspector Settings:**
- **Content** — What to output (can use variables)
- **Format** — Plain text or markdown

**Appears in:**
- Run details on Runs page
- Dashboard latest outputs
- Logs section

#### Telegram
Send message to Telegram chat.

**Prerequisites:**
- Telegram Bot Token configured
- User has started chat with bot

**Inspector Settings:**
- **Chat ID** — Where to send (usually user's)
- **Content** — Message text (supports markdown)

#### Claude Code
Send result back to Claude Code terminal.

**Prerequisites:**
- Running as Claude Code plugin
- Channel configured

**Inspector Settings:**
- **Message** — What to display
- **Include Results** — Attach full run output

#### File
Save to file on disk.

**Inspector Settings:**
- **File Path** — Where to save (relative to project)
- **Content** — What to write
- **Format** — Text or JSON

#### Webhook
Send to external HTTP endpoint.

**Inspector Settings:**
- **URL** — Webhook URL (external service)
- **Method** — POST, PUT, or PATCH
- **Headers** — Custom headers
- **Body** — JSON payload

### Output Variables

Use `${variable}` syntax to include data:
```
Status: ${status}
Ideas: ${ideas.join(', ')}
Cost: $${cost.toFixed(2)}
```

### Multiple Outputs

Add multiple Output nodes for:
- Send to log AND Telegram
- Save to file AND display in terminal
- Different formats for different audiences

---

## 8. File Node

**Shape:** Teal square  
**Purpose:** Read file from disk  
**Outputs:** File content

### Inspector Settings

**File Path** — Relative to project root or absolute path:
```
./docs/README.md
/home/user/project/data.json
C:\Users\user\Documents\config.txt
```

**Encoding** — UTF-8 (default) or other

**Output** — File content passed to next node

### Use Cases

1. **Configuration Loading**
   - Read config files
   - Load environment settings
   - Pull API keys from files

2. **Template Files**
   - Load prompt templates
   - Read HTML templates
   - Pull content from storage

3. **Data Processing**
   - Read CSV/JSON data
   - Process documents
   - Load knowledge

### Example Workflow

```
File: Load "prompt-template.txt"
  ↓
Agent: "Enhance this template: ${fileContent}"
  ↓
Output: "Enhanced prompt.txt"
```

---

## 9. Knowledge Node

**Shape:** Teal square  
**Purpose:** Search knowledge bases  
**Outputs:** Relevant documents

### Prerequisites

- At least one knowledge base created in Knowledge page
- Documents indexed with embeddings

### Inspector Settings

**Knowledge Base** — Select which to search  
**Query** — What to search for (can use variables):
```
Find documents about: ${topic}
```

**Top K** — Number of results (default 5)

### Output Format

Returns matching documents:
```json
[
  {
    "document": "filename.pdf",
    "chunk": "Extracted text content...",
    "similarity": 0.92
  },
  ...
]
```

### Use Cases

1. **RAG (Retrieval Augmented Generation)**
   - Search documents for context
   - Feed to agent for better answers
   - Combine with knowledge

2. **Document Analysis**
   - Find related documents
   - Extract relevant information
   - Answer document-based questions

3. **Compliance**
   - Check policy documents
   - Find regulatory references
   - Verify against guidelines

### Example Workflow

```
Trigger: "What's the company policy on ${topic}?"
  ↓
Knowledge: Search knowledge base for "${topic}"
  ↓
Agent: "Answer based on: ${knowledgeResults}"
  ↓
Output: Policy answer
```

---

## Node Type Comparison

| Node | Shape | Inputs | Outputs | Purpose |
|------|-------|--------|---------|---------|
| Trigger | Green Pill | 0 | 1 | Start workflow |
| Agent | Blue Rect | 1 | 1+ | AI execution |
| Condition | Orange Diamond | 1 | 2 | Branch logic |
| Code | Purple Square | 1 | 1 | Script execution |
| Merge | Blue Rect | 2+ | 1 | Combine outputs |
| Channel | Orange Rect | 1 | 1 | Ask Claude Code |
| Output | Red Pill | 1 | 0 | Deliver results |
| File | Teal Square | 0 | 1 | Read file |
| Knowledge | Teal Square | 0 | 1 | Search docs |

---

## Tips for Choosing Nodes

**When to use Code node:**
- Need to transform data
- Do calculations
- Validate complex logic
- Parse unstructured text

**When to use Condition node:**
- Simple true/false logic
- Route based on values
- Check length/types
- Validate ranges

**When to use Merge node:**
- Running multiple agents in parallel
- Combining results
- Need all outputs together

**When to use Channel Loop node:**
- Need human approval
- Want user to make decisions
- Require additional input
- Interactive workflows

**When to use Knowledge node:**
- Have documents to search
- Need context for agents
- Doing RAG
- Document-based Q&A

---

## Next Steps

- 🎨 [Workflow Editor](04-workflow-editor.md) — Learn editor features
- 💡 [Common Patterns](10-patterns.md) — Learn workflow designs
- 🎯 [Use Cases](11-use-cases.md) — See real examples

---

**Master all nodes, build anything!** [Back to Guide Index →](README.md)
