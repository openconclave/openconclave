# Troubleshooting Guide

Solutions for common problems and how to diagnose issues.

## Table of Contents

1. [Installation & Startup](#installation--startup)
2. [Workflow Issues](#workflow-issues)
3. [Agent & AI Problems](#agent--ai-problems)
4. [Performance Issues](#performance-issues)
5. [Integration Problems](#integration-problems)
6. [Data & Storage](#data--storage)
7. [Getting Help](#getting-help)

## Installation & Startup

### Issue: "Server not running" when opening http://localhost:5173

**Diagnosis:**
1. Check if OpenConclave process is running:
   ```bash
   # On macOS/Linux
   ps aux | grep openconclave
   
   # On Windows
   tasklist | findstr openconclave
   ```

2. Check if port 5173 is in use:
   ```bash
   # macOS/Linux
   lsof -i :5173
   
   # Windows
   netstat -ano | findstr :5173
   ```

**Solutions:**

**If not running:**
```bash
# Manual startup
cd openconclave && bun start
```

**If port is in use:**
- Kill the process using port 5173
- Wait 10 seconds
- Restart OpenConclave

**If you see "Port already in use" error:**
- Another OpenConclave instance is running
- Stop all instances: `pkill -f "bun start"` (macOS/Linux)
- Wait 5 seconds and restart

### Issue: "Cannot find node modules" error

**Solution:**
```bash
cd openconclave
bun install
bun start
```

### Issue: Installation script fails on Linux/macOS

**Try manual installation:**
```bash
git clone https://github.com/openconclave/openconclave.git
cd openconclave
bun install
bun start
```

**If bun is not installed:**
```bash
curl -fsSL https://bun.sh/install | bash
# Then try again
```

---

## Workflow Issues

### Issue: Workflow won't save

**Possible causes:**

1. **Invalid node configuration**
   - Check node inspector (right panel)
   - All required fields should be filled
   - Look for red error indicators

2. **Network issue**
   - Check browser console (F12) for errors
   - Verify "Server connected" indicator at bottom left is green
   - Refresh page and try again

3. **Unsupported characters**
   - Workflow names: Use alphanumeric, spaces, hyphens
   - Avoid: special characters, emoji
   - Max length: 100 characters

**Solution:**
1. Check browser console (F12) for error message
2. Look for red underlines or error icons on nodes
3. Click each node and verify all required settings:
   - Trigger: Has type selected
   - Agent: Has model and prompt
   - Condition: Has JavaScript expression
   - Code: Has language and script
4. Click Save again

### Issue: Workflow runs but produces no output

**Possible causes:**

1. **Missing Output node**
   - Workflows need an Output node to deliver results
   - Without it, results are stored but not sent anywhere

2. **Output configured incorrectly**
   - Check Output node settings
   - Verify destination is set (Terminal, File, Telegram)
   - Check file path is valid

3. **Run failed silently**
   - Check run status in Runs page
   - Click run to see detailed error

**Solution:**
1. Ensure workflow ends with an Output node
2. Configure output destination properly
3. Check Run Details (Runs → click run) for error messages
4. Look at Events timeline to see where execution stopped

### Issue: Nodes are disconnected or edges disappear

**Possible causes:**

1. **Page refresh/browser issue**
   - Refresh the page (Ctrl/Cmd + R)
   - Check if connections are restored

2. **Invalid connection**
   - Node output handles are on the right
   - Input handles are on the left
   - Ensure you're connecting in correct direction

3. **Node was deleted**
   - Check if accidentally deleted
   - Edge deletion is automatic

**Solution:**
1. Refresh the page
2. Reconnect nodes by dragging from output to input
3. Save workflow
4. If problem persists, try exporting and re-creating workflow

### Issue: "Tool_name must be unique" error

**Cause:** Workflow name generates non-unique tool name in snake_case.

**Solution:**
1. Rename workflow to be unique
2. Example: "Code explorer" → "Code explorer v2"
3. Save workflow

---

## Agent & AI Problems

### Issue: Agent returns empty response

**Possible causes:**

1. **Invalid prompt**
   - Prompt is too vague or empty
   - Model couldn't understand task
   - Input data is malformed

2. **Model configuration**
   - Model isn't loaded (for Ollama)
   - API key is invalid
   - Rate limit exceeded

3. **Tool access denied**
   - Agent doesn't have required tool selected
   - MCP server crashed

**Solution:**

1. **Check the Run Details:**
   - Go to Runs → click the run
   - Expand "Agent Tasks"
   - Read the full response (might not be empty)
   - Check any error messages

2. **Test agent in isolation:**
   - Create simple workflow: Trigger → Agent → Output
   - Test with same prompt
   - See if issue is the agent or the workflow

3. **Check model is working:**
   - For Claude: Verify API key in Settings
   - For Ollama: Ensure server running (`ollama serve`)
   - For OpenAI-compatible: Test endpoint with curl

4. **Review prompt:**
   - Make it more specific
   - Provide examples
   - Break into steps
   - Add context/data needed

### Issue: "Model not found" error

**For Ollama:**
```bash
# List available models
ollama list

# Pull a model
ollama pull mistral
ollama pull neural-chat
```

Check Settings → Ollama URL is correct (usually http://localhost:11434)

**For OpenAI-compatible:**
1. Go to Settings
2. Add Provider with correct base URL
3. Verify API key is valid
4. Check model name exists with that provider

### Issue: Agent is slow or timing out

**Possible causes:**

1. **Model is processing large input**
   - Token count too high
   - Waiting for response

2. **API rate limiting**
   - Too many requests
   - Wait before retrying

3. **Network issue**
   - Connection to API is slow
   - Timeout threshold too low

**Solutions:**

1. **Reduce input size:**
   - Use Knowledge Base instead of passing full documents
   - Truncate long texts
   - Process in batches

2. **Check API status:**
   - Is API service down?
   - Check provider status page
   - Try with different model

3. **Increase timeout:**
   - Edit Agent node timeout setting (if available)
   - Or just wait, runs will eventually complete

### Issue: Agent keeps calling same tool repeatedly

**Cause:** Infinite tool loop - agent can't figure out next step.

**Solution:**

1. **Review agent prompt:**
   - Make instructions clearer
   - Specify when to use each tool
   - Add success criteria

2. **Check tool output:**
   - Is tool returning expected format?
   - Does agent understand the response?
   - Add error handling

3. **Simplify the task:**
   - Give agent fewer tools
   - One tool at a time
   - Verify tool works in isolation

4. **Add fail-safe:**
   ```
   Agent → Condition: Loop count > 5?
     Yes → Output: Error
     No → Continue
   ```

---

## Performance Issues

### Issue: Workflows are slow

**Diagnosis:**

1. Check Run Details timeline
   - Which node takes longest?
   - Sequential or parallel?

2. Monitor costs
   - Dashboard shows total cost
   - Each run shows per-node cost

**Solutions for slow sequential workflows:**

1. **Run agents in parallel where possible:**
   ```
   Bad: Agent A → Agent B → Agent C (3x time)
   Good: [Agent A, Agent B, Agent C] → Merge (1x time)
   ```

2. **Use faster models:**
   - Claude Haiku: 2-3x faster than Sonnet
   - Ollama: Instant responses (local)
   - Prune expensive operations

3. **Batch similar operations:**
   - Instead of 10 separate agents
   - One agent processing 10 items

### Issue: Dashboard is slow

**Possible causes:**

1. **Too many runs in database**
   - Thousands of runs slow down dashboard
   - Consider archiving old runs

2. **Browser issue**
   - Too many tabs open
   - Browser cache full
   - Insufficient RAM

**Solutions:**

1. **Clear old data:**
   ```bash
   # Warning: This deletes old runs
   # Backup first: copy ~/.openconclave/
   rm ~/.openconclave/db.sqlite
   # Server will recreate empty database
   ```

2. **Restart browser:**
   - Close and reopen OpenConclave
   - Clear browser cache

3. **Check system resources:**
   - Is disk full?
   - Is RAM low?
   - Close other applications

---

## Integration Problems

### Issue: Telegram integration not working

**Symptoms:**
- Telegram trigger doesn't fire
- Telegram output doesn't send

**Diagnosis:**

1. **Check bot token in Settings:**
   - Go to Settings → General → Telegram Bot Token
   - Should be filled and not showing error

2. **Verify bot is responsive:**
   ```bash
   # Test bot token (replace YOUR_TOKEN)
   curl https://api.telegram.org/botYOUR_TOKEN/getMe
   ```
   Should return bot info, not error.

3. **Check trigger/output configuration:**
   - Trigger: Chat ID should be set
   - Output: Chat ID should be set

**Solutions:**

1. **Get correct bot token:**
   - Message @BotFather on Telegram
   - Send `/newbot`
   - Follow prompts to create bot
   - Copy token from response
   - Paste in OpenConclave Settings

2. **Grant permissions:**
   - Start conversation with your bot
   - Send `/start`
   - This "activates" the bot

3. **Test trigger:**
   - Go to workflow with Telegram trigger
   - Open Run Details
   - Should see Telegram events

### Issue: Webhook trigger doesn't work

**Diagnosis:**

1. Get webhook URL from Trigger node inspector
   - Format: `http://your-machine:5173/webhook/{workflow_id}`

2. Test the webhook:
   ```bash
   curl -X POST http://localhost:5173/webhook/{workflow_id} \
     -H "Content-Type: application/json" \
     -d '{"test": "data"}'
   ```

3. Check if webhook is accessible:
   - Ensure firewall allows traffic
   - If remote, check port forwarding
   - Use ngrok for tunneling if needed

**Solutions:**

1. **Local testing:**
   - Use localhost URLs
   - Test with curl first

2. **Remote testing:**
   - Use ngrok: `ngrok http 5173`
   - Use public URL from ngrok
   - Update webhook in external service

3. **Verify in Run Details:**
   - Trigger webhook runs
   - Check if input data received
   - Look for errors in Events timeline

---

## Data & Storage

### Issue: Workflows or runs disappeared

**Possible causes:**

1. **Database corruption**
2. **Accidental deletion**
3. **Hard drive failure**

**Prevention:**
```bash
# Backup regularly
cp -r ~/.openconclave/ ~/.openconclave-backup-$(date +%Y%m%d)/

# Store in multiple locations
```

**Recovery:**

1. **Check if data still exists:**
   ```bash
   ls -la ~/.openconclave/
   # Should see: db.sqlite, data/, sessions/, etc.
   ```

2. **Restore from backup:**
   ```bash
   cp -r ~/.openconclave-backup-20260402/* ~/.openconclave/
   # Restart server
   ```

3. **If corrupted:**
   - Backup current .openconclave
   - Delete db.sqlite
   - Restart (creates fresh database)
   - Lose workflow/run history but can recreate

### Issue: Storage quota exceeded / disk full

**Symptoms:**
- New runs fail
- Can't create workflows
- "Disk full" errors

**Solutions:**

1. **Check disk space:**
   ```bash
   df -h ~
   du -sh ~/.openconclave/
   ```

2. **Clear old data:**
   - Keep only recent runs (last 100)
   - Delete unused workflows
   - Delete test data

3. **Move to larger drive:**
   ```bash
   # Backup
   cp -r ~/.openconclave/ /path/to/larger/drive/
   # Update symlink
   rm -r ~/.openconclave/
   ln -s /path/to/larger/drive/.openconclave ~/.openconclave/
   ```

---

## Getting Help

### Before Asking for Help

1. **Check Run Details:**
   - Expand all sections
   - Read error messages carefully
   - Check Events timeline

2. **Check browser console:**
   - F12 → Console tab
   - Screenshot any red errors
   - Copy full error message

3. **Restart everything:**
   - Kill OpenConclave process
   - Wait 10 seconds
   - Restart: `bun start`
   - Try again

4. **Simplify the workflow:**
   - Remove nodes one by one
   - Find which one causes problem
   - Test in isolation

### Gathering Diagnostics

If asking for help, collect:

1. **Workflow JSON:**
   - Export workflow from editor
   - Share (hide sensitive data)

2. **Run Details:**
   - Screenshot of Run Details page
   - Full error message
   - Timeline of events

3. **System info:**
   ```bash
   bun --version
   node --version
   uname -a  # macOS/Linux
   ```

4. **Log files:**
   ```bash
   tail -100 ~/.openconclave/logs/error.log
   ```

### Reporting Issues

- **GitHub Issues:** github.com/openconclave/openconclave/issues
- **Include:**
  - What you were trying to do
  - Steps to reproduce
  - Expected vs actual behavior
  - Screenshots/logs
  - System info

---

**Still stuck?** Try the [FAQ in the User Guide](./USER_GUIDE.md#faq) or check example workflows in the Dashboard's Quick Launch section.
