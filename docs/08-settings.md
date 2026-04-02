# Settings & Configuration

The Settings page lets you configure AI providers, integrations, and system preferences.

## Accessing Settings

**Go to:** Left sidebar → **Settings** → or top-right menu if available

![Settings](../07-settings.png)

## Configuration Sections

### General Settings

#### Telegram Bot Token

Enable workflows to send messages to and be triggered by Telegram.

**What it does:**
- Allows workflows to send results to Telegram
- Enables triggers to be activated from Telegram
- Receives messages from Telegram and uses as input

**How to set up:**

1. **Create a Telegram bot:**
   - Open Telegram
   - Search for [@BotFather](https://t.me/botfather)
   - Send: `/start`
   - Send: `/newbot`
   - Answer questions about your bot
   - Receive bot token (looks like: `1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh`)

2. **Add to OpenConclave:**
   - Go to Settings
   - Paste token in "Telegram Bot Token" field
   - Click Save
   - Test by sending message to bot in Telegram

3. **Use in workflows:**
   - Create trigger with type "Telegram"
   - Create output with type "Telegram"
   - Workflows can now interact with Telegram

**Telegram Limitations:**
- One bot per OpenConclave instance
- Only you can use the bot (unless configured for group)
- Token is private (like an API key)

**Troubleshooting:**
- Can't find @BotFather? Use search on Telegram
- Invalid token? Copy entire token from BotFather
- Not receiving messages? Check bot is started in Telegram
- Telegram slow? Check OpenConclave server is running

#### Ollama URL

Configure local AI models via Ollama.

**What it does:**
- Lets you use free, private AI models
- No API keys or costs
- Models run on your machine
- Completely offline capable

**Prerequisites:**
1. **Install Ollama:** https://ollama.ai
2. **Pull a model:** `ollama pull llama2`
3. **Ollama runs at:** `http://localhost:11434` (by default)

**How to set up:**
1. Verify Ollama is running: `ollama serve`
2. Go to Settings
3. Enter: `http://localhost:11434`
4. Click Save
5. Reload workflows page

**Supported Models:**
- llama2 (7B, 13B, 70B)
- mistral
- neural-chat
- starling-lm
- And many more

**Pull models:**
```bash
ollama pull llama2
ollama pull mistral
ollama pull nomic-embed-text  # For knowledge base embeddings
```

**Check installed models:**
```bash
curl http://localhost:11434/api/tags
```

**Troubleshooting:**
- "Connection refused"? Start Ollama: `ollama serve`
- "No models found"? Pull a model: `ollama pull llama2`
- "Very slow"? Check model size (7B vs 13B vs 70B)
- "Out of memory"? Use smaller model or more RAM

### AI Providers

Configure which AI services you want to use.

**Available providers:**
- Claude Code (auto-configured if using plugin)
- OpenAI
- OpenRouter (70+ models)
- Together AI
- Groq
- Gemini
- Custom OpenAI-compatible endpoints

#### Add a Provider

**Click: "+ Add Provider"**

**Form:**
1. **Provider Type** — Select from dropdown
2. **Display Name** — What you call it (e.g., "My OpenAI")
3. **API Key** — Your secret key (stored securely)
4. **Base URL** — For OpenAI-compatible (optional)
5. **API Type** — "Responses API" or "Chat Completions"

**Click Save**

#### OpenAI

**How to get API key:**
1. Go to https://platform.openai.com
2. Sign up or log in
3. Click API keys (left sidebar)
4. Click "Create new secret key"
5. Copy the key

**Configuration:**
- **Provider Type:** OpenAI
- **API Key:** Your secret key
- **Base URL:** (leave blank for default)
- **API Type:** Responses API (best) or Chat Completions

**Pricing:**
- GPT-4: ~$0.06/1k tokens
- GPT-3.5: ~$0.002/1k tokens

#### OpenRouter

**Advantages:**
- 70+ models available
- Good fallback provider
- Reasonable prices

**How to get API key:**
1. Go to https://openrouter.ai
2. Sign up
3. Copy API key from settings

**Configuration:**
- **Provider Type:** OpenRouter
- **API Key:** Your API key
- **Base URL:** https://openrouter.ai/api/v1
- **API Type:** Chat Completions

#### Together AI

**Advantages:**
- Fast inference
- Reasoning models (Appel Thinker)
- Competitive pricing

**How to get API key:**
1. Go to https://together.ai
2. Sign up
3. Find API keys in settings

**Configuration:**
- **Provider Type:** Together AI
- **API Key:** Your API key
- **Base URL:** https://api.together.xyz/v1
- **API Type:** Chat Completions

#### Groq

**Advantages:**
- Extremely fast
- Cheap pricing
- Good for simple tasks

**How to get API key:**
1. Go to https://groq.com
2. Sign up with email
3. Get API key from console

**Configuration:**
- **Provider Type:** Groq
- **API Key:** Your API key
- **Base URL:** https://api.groq.com/openai/v1
- **API Type:** Chat Completions

#### Custom OpenAI-Compatible

For any OpenAI-compatible API (self-hosted, etc.)

**Configuration:**
- **Provider Type:** Custom
- **Base URL:** Your API endpoint (e.g., http://localhost:8000)
- **API Key:** If required
- **API Type:** Choose based on provider

**Example: LM Studio**
```
Base URL: http://localhost:1234/v1
API Key: not-needed
API Type: Chat Completions
```

#### Manage Providers

**Edit Provider:**
1. Click edit icon (pencil) next to provider
2. Update fields
3. Click Save

**Delete Provider:**
1. Click delete icon (trash) next to provider
2. Confirm deletion
3. Workflows using this provider will fail

**Switch Providers:**
1. Edit workflow
2. Click Agent node
3. Change "Engine" dropdown to different provider
4. Select model from new provider
5. Save workflow

## Advanced Configuration

### Embedding Models

Used for knowledge base search.

**Available:**
- nomic-embed-text (recommended, free)
- OpenAI embeddings (paid)

**Change:**
1. Go to Settings
2. Select embedding model
3. Save
4. Existing KBs show "needs re-embedding" warning
5. Click to re-embed (costs money for paid models)

### Model Selection

**When Agent node created:**
- Model dropdown shows available models
- Models from all configured providers
- Select which model to use per agent

**Best practices:**
- Haiku for simple tasks
- Sonnet for reasoning
- Opus for complex analysis
- Ollama for frequent tasks

### Environment Variables

For custom configuration or secrets:

**Access via code nodes:**
```python
import os
api_key = os.environ.get('MY_API_KEY')
```

**Set in settings** (encrypted storage):
- Key: `MY_API_KEY`
- Value: `secret123`

## API Keys Security

### Storing Keys Safely

**OpenConclave:**
- ✅ Keys stored encrypted in database
- ✅ Never logged or displayed in clear
- ✅ Only used for API calls
- ✅ Secure storage at rest

**Best practices:**
1. **Use provider-specific keys** not master accounts
2. **Set spending limits** on provider accounts
3. **Rotate keys periodically**
4. **Monitor usage** on provider dashboards
5. **Use dedicated accounts** if possible

### API Key Rotation

1. Create new key on provider
2. Update in Settings
3. Test workflows
4. Delete old key on provider
5. Confirm workflows still work

## Troubleshooting Configuration

### "Connection refused" to Ollama
- Check Ollama is running: `ollama serve`
- Check URL is correct: `http://localhost:11434`
- Check port 11434 is open
- Restart OpenConclave

### "Invalid API key"
- Copy entire key (including dashes)
- Remove whitespace
- Verify in provider's dashboard
- Re-create new key if needed
- Test API key separately

### Telegram not working
- Verify token is correct
- Try sending message to bot
- Check bot @BotFather permissions
- Restart OpenConclave

### Models don't appear
- Check provider is saved
- If Ollama: `ollama pull model-name`
- Reload page (Cmd/Ctrl + R)
- Check Settings are saved

### Performance issues
- Check provider status page
- Switch to faster provider (e.g., Groq)
- Use smaller models (Haiku vs Opus)
- Check network speed

## Managing Your Settings

### Export Settings
Right-click → Export Settings (saves as JSON, keys redacted)

### Backup Settings
1. Copy `.openconclave/db/db.sqlite` regularly
2. Settings stored in database
3. Restore by replacing database file

### Reset to Defaults
⚠️ Careful! This removes all configuration.

1. Delete `.openconclave/db/db.sqlite`
2. Restart server
3. Fresh database created
4. Reconfigure all settings

## Cost Optimization

### Choosing Providers

**For cost optimization:**
1. Use Ollama for frequent tasks (free)
2. Use Haiku for simple tasks ($0.001-0.01 per call)
3. Use Sonnet for reasoning ($0.01-0.05 per call)
4. Use Opus only when needed ($0.05-0.15 per call)
5. Batch similar tasks together

**Provider comparison:**
- OpenAI: Reliable, expensive
- Groq: Fast, cheap
- Together AI: Balanced
- OpenRouter: Many options
- Ollama: Free but local-only

### Monitor Usage

**Check in Settings:**
- Providers configured
- Keys are valid
- Usage on provider dashboards

**Track costs:**
- Dashboard shows total
- Runs show per-execution cost
- Review expensive workflows

### Budget Alerts

Set spending limits:
1. Go to provider dashboard (OpenAI, Groq, etc.)
2. Set monthly budget
3. Alerts when approaching limit
4. OpenConclave will notify you

## Integration with Claude Code

**If using as Claude Code plugin:**

Settings are auto-populated:
- Claude model auto-detected
- Channel auto-connected
- No manual configuration needed

**To reconfigure:**
- Edit Settings in OpenConclave web UI
- Changes apply immediately
- Restart Claude Code to reload

## Security Considerations

### What Gets Stored

**In `.openconclave/`:**
- Workflows (JSON)
- Database (SQLite)
- Agent sessions
- Outputs
- Logs

**In Settings:**
- API keys (encrypted)
- URLs (plaintext)
- Telegram token (encrypted)

### Data Isolation

- Each instance has own `.openconclave/` folder
- Settings not shared between instances
- Isolated from main system

### Network

- OpenConclave local-only (localhost:5173)
- API calls to providers only
- Agent code execution on your machine
- Files stay on your disk

## Next Steps

- 🤖 [AI Providers Guide](09-ai-providers.md) — Detailed provider setup
- 💡 [Common Patterns](10-patterns.md) — Build workflows
- 🎯 [Use Cases](11-use-cases.md) — Real examples

---

**Proper configuration is key to successful workflows.** [Back to Index →](README.md)
