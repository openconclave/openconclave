# AI Providers Guide

Complete reference for all AI engines supported by OpenConclave.

## Provider Overview

OpenConclave supports three categories:

1. **Claude Code** — Built into Claude agent SDK
2. **Ollama** — Free, private, local
3. **OpenAI-Compatible** — OpenAI, OpenRouter, Together AI, Groq, Gemini, etc.

## Claude Code Agent

**Best for:** Full-featured AI agent with complete tool access

### What You Get

✅ Full tools:
- bash — Run shell commands
- read — Read files
- write — Write files
- edit — Edit files
- grep — Search files
- Web Search
- And more MCP tools

✅ Features:
- Extended thinking (visible reasoning)
- Model selection (Haiku, Sonnet, Opus)
- Conversation memory (`resume` sessions)
- Multi-turn interactions
- Working directory awareness

✅ Cost:
- Pay per token to Anthropic
- Haiku: ~$0.80/1M input tokens
- Sonnet: ~$3/1M input tokens
- Opus: ~$15/1M input tokens

### Configuration

Auto-configured if using Claude Code plugin.

**Manual setup** (if not plugin):
1. Ensure Claude Code CLI installed
2. OpenConclave auto-discovers
3. If not, add manually in Settings:
   - Provider Type: Claude Code
   - No API key needed (uses Claude Code auth)

### Usage in Workflows

**In Agent node inspector:**
- Select "Claude" from Engine dropdown
- Choose model: Haiku, Sonnet, or Opus
- Configure tools (all enabled by default)
- Write your prompt

**Example:**
```
Engine: Claude
Model: Claude 3 Sonnet
Prompt: Analyze this code and suggest improvements
Tools: [bash, read, write, edit, grep]
```

### Best Practices

1. **Use Haiku for:**
   - Simple classifications
   - Quick summaries
   - Basic tool use
   - High-frequency tasks

2. **Use Sonnet for:**
   - Code analysis
   - Complex reasoning
   - Documentation generation
   - Most production workflows

3. **Use Opus for:**
   - Very complex reasoning
   - Multi-step analysis
   - Research tasks
   - When accuracy critical

4. **Leverage tools:**
   - Read files for context
   - Edit files for changes
   - Bash for system checks
   - Grep for searching

### Extended Thinking

Claude models support extended thinking (visible reasoning).

**How to use:**
1. Use Claude agent
2. Enable "Show thinking" in run details
3. See agent's reasoning process
4. Helps debug complex tasks

**Cost:** Slightly more tokens (50% overhead typical)

**When to use:**
- Complex problems
- Need transparency
- Debugging failing workflows
- Research and analysis

### Conversation Memory

Claude can remember previous messages in a session.

**How to use:**
1. Create Agent node
2. In inspector, enable "Resume session"
3. Session ID auto-created
4. Agent remembers previous exchanges

**Example workflow:**
```
Trigger: User question
  ↓
Agent (session-1): Answer question (remembers previous context)
  ↓
Output: Show answer
```

---

## Ollama Agent

**Best for:** Free, private, local AI (no costs, no internet)

### What You Get

✅ Free:
- Zero API costs
- Runs 100% locally
- No internet required
- Complete privacy

✅ Models:
- Llama 2 (7B, 13B, 70B)
- Mistral
- Neural-Chat
- Starling-LM
- 50+ models available

✅ Features:
- MCP tool bridge (can use Playwright, Fetch, etc.)
- Extended thinking support
- Conversation sessions

❌ Limitations:
- Slower than cloud models
- Requires local compute
- Lower quality for complex tasks

### Installation

**Install Ollama:**
```bash
# macOS / Linux
curl https://ollama.ai/install.sh | sh

# Or download from https://ollama.ai
```

**Start Ollama:**
```bash
ollama serve
# Runs at http://localhost:11434
```

**Pull a model:**
```bash
ollama pull llama2        # 7B model
ollama pull mistral       # Lighter weight
ollama pull neural-chat   # Good reasoning
ollama pull nomic-embed-text  # For knowledge bases
```

### Configuration

**In OpenConclave Settings:**
1. Enter Ollama URL: `http://localhost:11434`
2. Save
3. Models auto-discovered

**In workflow:**
1. Create Agent node
2. Select Engine: "Ollama"
3. Select Model (from dropdown)
4. Write prompt
5. Save

### Model Selection

| Model | Size | Speed | Quality | Best For |
|-------|------|-------|---------|----------|
| llama2 7B | 3.8GB | Fast | Okay | Simple tasks |
| mistral | 4.1GB | Faster | Good | Quick responses |
| neural-chat | 4.8GB | Fast | Better | Reasoning |
| llama2 13B | 7.4GB | Medium | Good | Complex tasks |
| openchat | 3.5GB | Fast | Fair | Quick answers |

### Performance Tips

**If Ollama is slow:**

1. **Use smaller model:**
   - 7B models = fast, lower quality
   - 13B models = balanced
   - 70B models = slow, high quality

2. **Reduce context:**
   - Shorter prompts = faster responses
   - Fewer tool calls
   - Smaller knowledge bases

3. **Add more RAM:**
   - 8GB minimum
   - 16GB recommended
   - 32GB for 70B models

4. **Check disk:**
   - SSD better than HDD
   - Models stored in `~/.ollama/models`
   - Ensure free space

5. **Close other apps:**
   - CPU/memory intensive
   - Stop other workloads
   - Dedicate machine if possible

### Tools with Ollama

Ollama gets MCP tool bridge:
- bash
- read
- write
- file operations
- Can call Playwright, Fetch, etc.

**Conversions:**
- MCP tools converted to Ollama format
- Ollama can invoke them
- Works seamlessly

### Best Use Cases

1. **Development/Testing:**
   - Free workflow testing
   - No API costs
   - Full privacy

2. **Frequent Tasks:**
   - Hourly cron jobs
   - Cost-intensive at scale
   - Ollama amortizes to $0

3. **Private/Sensitive Data:**
   - Healthcare
   - Legal
   - Financial
   - Data never leaves machine

4. **Offline Operations:**
   - No internet needed
   - Embedded systems
   - Secure environments

5. **Cost-Sensitive:**
   - Startups
   - Limited budgets
   - Hobbyists

---

## OpenAI-Compatible Providers

Generic OpenAI API compatible interface.

### Supported Providers

#### OpenAI (Official)

**Models:** GPT-4, GPT-4 Turbo, GPT-3.5-Turbo

**Setup:**
1. Go to https://platform.openai.com
2. Create account
3. Navigate to API keys
4. Create secret key
5. Copy in OpenConclave Settings

**Configuration:**
- Provider: OpenAI
- API Key: sk-...
- Base URL: (leave blank)
- API Type: Chat Completions

**Cost:**
- GPT-4: $0.03-0.06 input / $0.06-0.12 output
- GPT-3.5: $0.0005 input / $0.0015 output

**When to use:**
- Need best quality
- Complex reasoning
- Well-documented (everyone uses it)
- Enterprise support

#### OpenRouter

**Models:** 70+ models (Claude, Gemini, Llama, Mistral, etc.)

**Setup:**
1. Go to https://openrouter.ai
2. Sign up
3. Get API key from settings

**Configuration:**
- Provider: OpenAI-Compatible
- Base URL: https://openrouter.ai/api/v1
- API Key: sk-or-...
- API Type: Chat Completions

**Available models:**
- Anthropic Claude
- Google Gemini
- Meta Llama
- Mistral
- Groq
- And more

**Cost:**
- Varies by model
- Often cheaper than official providers
- Check model-specific pricing

**When to use:**
- Want to compare models
- Access models not via official providers
- Fallback provider
- Research purposes

#### Together AI

**Models:** Open source models, Reasoning models

**Setup:**
1. Go to https://together.ai
2. Sign up
3. Get API key

**Configuration:**
- Provider: OpenAI-Compatible
- Base URL: https://api.together.xyz/v1
- API Key: (your key)
- API Type: Chat Completions

**Notable models:**
- Llama
- Mistral
- Reasoning models (good for complex tasks)

**Cost:**
- Reasonable pricing
- Competitive with OpenRouter
- Pay per token

**When to use:**
- Want fast inference
- Reasoning models needed
- Cost optimization
- Open source preference

#### Groq

**Models:** LLaMA, Mixtral, Gemma

**Setup:**
1. Go to https://groq.com
2. Sign up
3. Get API key from console

**Configuration:**
- Provider: OpenAI-Compatible
- Base URL: https://api.groq.com/openai/v1
- API Key: gsk_...
- API Type: Chat Completions

**Key features:**
- EXTREMELY fast (best latency)
- Cheap pricing
- Good for simple tasks

**When to use:**
- Need very fast responses
- Budget conscious
- Real-time applications
- Simple to medium tasks

#### Gemini (Google)

**Models:** Gemini 1.5, Gemini Pro

**Setup:**
1. Go to https://cloud.google.com
2. Enable Generative AI API
3. Create API key
4. Use OpenAI-compatible endpoint

**Configuration:**
- Provider: OpenAI-Compatible
- Base URL: https://generativelanguage.googleapis.com/v1/
- API Key: (your Gemini key)
- API Type: Chat Completions

**When to use:**
- Google integration needed
- Gemini-specific features
- Integration with Google Cloud

#### Custom OpenAI-Compatible

Any self-hosted or custom OpenAI-compatible API.

**Examples:**
- LM Studio (local)
- ollama (with OpenAI endpoint)
- vLLM (deployed)
- Custom APIs

**Configuration:**
- Provider: Custom OpenAI-Compatible
- Base URL: http://localhost:8000/v1
- API Key: (if required)
- API Type: Chat Completions

**Test locally:**
```bash
curl http://localhost:8000/v1/models
```

### Comparison Table

| Provider | Cost | Speed | Quality | Best For |
|----------|------|-------|---------|----------|
| Claude (OpenAI) | $$$ | Fast | Excellent | Complex reasoning |
| GPT-4 | $$ | Fast | Excellent | General purpose |
| Groq | $ | Fastest | Good | Real-time/simple |
| Together AI | $ | Fast | Good | Open models |
| OpenRouter | $-$$ | Fast | Varies | Model comparison |
| Ollama | Free | Slow | Fair | Local/testing |

### Batch Providers

Use multiple providers and switch between them:

**Example workflow:**
```
If task is complex:
  → Use Claude/GPT-4
Else if task is simple:
  → Use Groq/cheap model
Else:
  → Use Ollama (free)
```

**Implementation:**
1. Configure multiple providers
2. Create different Agent nodes
3. Use Condition to route
4. Optimize cost per task type

---

## Switching Providers

### Change Mid-Workflow

1. Edit workflow
2. Click Agent node
3. Change Engine dropdown
4. Select new provider
5. Choose model
6. Save workflow
7. Re-test

### Migrate Entire Workflow

1. Export workflow (JSON)
2. Find all Agent nodes
3. Change engine/model
4. Update prompts if needed
5. Re-import
6. Test

### Provider Failover

Set up fallback:

```
Try Agent1 (preferred provider)
  ↓
If error → Try Agent2 (fallback)
  ↓
If error → Use Ollama (free fallback)
```

**Implementation:**
```
Agent (provider 1) → Condition: success?
  → Yes: Continue
  → No: Try Agent (provider 2)
```

---

## Cost Optimization

### Per-Task Budgeting

**Simple task:** Use Haiku or Groq
- Budget: $0.001-0.01
- Typical: Classification, extraction

**Medium task:** Use Sonnet
- Budget: $0.01-0.10
- Typical: Analysis, writing

**Complex task:** Use Opus or GPT-4
- Budget: $0.05-0.50
- Typical: Research, design

**Frequent task:** Use Ollama
- Budget: $0.00
- Typical: Every hour/day

### Cost Tracking

**Dashboard:**
- Total cost card shows spending
- Click for breakdown by workflow

**Per-run:**
- Run details show cost
- Compare runs and workflows
- Identify expensive operations

**Monthly:**
- Check provider dashboards
- Set alerts/budgets
- Review trends

### Money-Saving Tips

1. **Use Haiku for everything possible**
   - 80% of tasks don't need Opus
   - Saves 10-15x cost

2. **Batch similar requests**
   - One agent call vs many
   - Reduces overhead

3. **Limit response length**
   - Set max_tokens
   - Reduces token usage

4. **Use Ollama for frequent jobs**
   - Free for 100th run
   - Amortizes quickly

5. **Cache results**
   - Store outputs
   - Re-use instead of re-running

6. **Choose right provider**
   - Groq: Cheap + fast
   - Claude: Best quality
   - Ollama: Free

---

## Troubleshooting Providers

### "Invalid API key"
- Copy entire key from provider
- Remove extra whitespace
- Verify in provider's dashboard
- Create new key if needed

### "Connection timeout"
- Check internet connection
- Check provider status page
- Try different provider
- Check firewall

### "No models found"
- Wait 30 seconds for discovery
- Reload page
- Check provider is saving
- Verify API key works

### "Rate limited"
- Slow down requests
- Use cheaper provider
- Upgrade provider account
- Add delays between requests

### Model not responding
- Check provider status
- Try different model
- Reduce complexity
- Check rate limits

---

## Next Steps

- ⚙️ [Settings Guide](08-settings.md) — Configure all providers
- 💡 [Common Patterns](10-patterns.md) — Build with multiple agents
- 🎯 [Use Cases](11-use-cases.md) — Real examples

---

**Mix and match providers to optimize cost and performance.** [Back to Index →](README.md)
