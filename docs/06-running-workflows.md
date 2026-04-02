# Running & Monitoring Workflows

This guide covers how to execute workflows and monitor their progress and results.

## Running a Workflow

### Manual Execution

**From Dashboard:**
1. Go to Dashboard
2. Scroll to "Quick Launch"
3. Click the workflow name
4. Workflow runs immediately

**From Workflows Page:**
1. Go to Workflows
2. Click the workflow card
3. Click **Start** button (green play icon)
4. Workflow runs

**From Within Editor:**
1. Open workflow in editor
2. Click **Run** button (top right)
3. Workflow executes

### Responding to Prompts

If the Trigger has a Prompt configured:

1. Run button opens a dialog
2. Answer the prompt question
3. Click Continue/Run
4. Workflow executes with your input

**Example:**
- Trigger Prompt: "What topic should I research?"
- You enter: "Machine Learning"
- Agent receives: `${input} = "Machine Learning"`
- Agent uses in prompt: "Write about ${input}"

### Scheduled Execution

Workflows run automatically on a schedule.

**Configure in Editor:**
1. Click Trigger node
2. Change Type to "Cron"
3. Select preset or enter cron expression
4. Save

**Examples:**
- Every hour at :00 — `0 * * * *`
- Daily at 9am — `0 9 * * *`
- Weekdays at 9am — `0 9 * * 1-5`
- Every 30 minutes — `*/30 * * * *`

**View Active Schedules:**
- Dashboard → Schedules section
- Shows next run time
- Toggle on/off
- Edit or delete

### Webhook Triggers

External systems call your workflow via HTTP.

**Webhook URL:**
1. Create workflow with Webhook trigger
2. Editor shows: "Webhook URL: https://..."
3. Share with external system
4. They POST to that URL

**Example cURL:**
```bash
curl -X POST https://your-openconclave/api/webhooks/abc123 \
  -H "Content-Type: application/json" \
  -d '{"topic": "AI", "depth": "advanced"}'
```

### Telegram Triggers

Control workflows from your phone.

**Prerequisites:**
- Bot Token configured in Settings
- You've started a chat with the bot

**To trigger:**
1. Open Telegram chat with your bot
2. Send a message
3. Workflow executes with message as input

## Monitoring Execution

### Live Execution View

While a workflow is running:

1. Go to Runs page
2. The running workflow appears at top with "running" badge
3. Animated pulsing nodes show which are executing
4. Click to see live details

**Information displayed:**
- Status (running, success, failed)
- Elapsed time
- Which nodes are active
- Cost accruing

### Run Details Page

View complete execution information.

![Run Detail](../05-run-detail.png)

**Access:**
1. Go to Runs page
2. Click a run

**Displays:**
- **Status** — Running/Success/Failed/Cancelled
- **Trigger** — How it was started (manual/cron/telegram)
- **Duration** — Total execution time
- **Agent Tasks** — Each agent's prompt and response
- **Events Timeline** — Step-by-step execution log
- **Cost** — API costs breakdown
- **Outputs** — Final results

### Agent Tasks Section

See what each agent did.

**Expandable task cards showing:**
- Agent name (label)
- Prompt sent
- Tools used
- Response received
- Duration
- Cost
- Any errors

**Click to expand:**
- See full prompt
- See full response
- View tool calls
- View errors with stack traces

### Events Timeline

Detailed log of every action.

**Events include:**
- "Agent spawned"
- "Tool called: read_file"
- "Agent finished with response"
- "Routing to next node"
- "Cost: $0.01"
- Timestamps for each

**Color coding:**
- Green border — Success
- Red border — Error
- Orange border — Warning
- Blue border — Information

**Grouped by node:**
- Events are grouped under their source node
- Easier to trace which node caused issues

### Run Metadata

At top of run details:

**Status Badge** — Current state:
- 🟡 **running** — Workflow is executing
- 🟢 **success** — Completed successfully
- 🔴 **failed** — Encountered an error
- ⚫ **cancelled** — Manually stopped

**Start Time** — When execution began

**Duration** — How long it took (or elapsed time if running)

**Cost** — Total API costs for this run

## Monitoring Multiple Runs

### Runs Page

View all workflow executions.

![Runs](../04-runs.png)

**Columns:**
- **Status** — Success/Failed/Cancelled
- **Workflow Name** — Which workflow ran
- **Run ID** — Unique identifier
- **Duration** — Execution time
- **Cost** — API cost for this run
- **Time** — When it ran (e.g., "10:17 AM")

**Filtering/Sorting:**
- Click column header to sort
- Filter by status (button near top)
- Filter by workflow name (search)

**Actions per run:**
- Click row to see details
- Click "Stop" to cancel if running
- Right-click for more options

### Dashboard Runs Section

Quick overview of recent runs.

**Shows:**
- 10 most recent runs
- Status indicator
- Workflow name
- Duration
- Cost
- Time

**View all:**
- Click "View all" link
- Goes to Runs page

## Cost Tracking

### Per-Run Cost

In Run Details, cost includes:
- Claude API tokens (if using Claude)
- OpenAI API costs (if using OpenAI)
- Other provider costs
- Knowledge base search costs
- Does NOT include Ollama (free)

### Total Cost

**Dashboard Stat Card:**
- "Cost" card shows total across all runs
- Running total for current session
- Helpful for budgeting

**Cost Breakdown:**
- Click Cost card on dashboard
- See which workflows cost most
- Identify expensive operations

### Optimization Tips

1. **Use Cheaper Models**
   - Haiku for simple tasks
   - Sonnet for reasoning
   - Ollama for frequent tasks (free)

2. **Reduce API Calls**
   - Combine related tasks
   - Use parallel processing efficiently
   - Avoid unnecessary retries

3. **Limit Response Length**
   - Set max_tokens in Agent inspector
   - Reduces token usage
   - Faster responses

4. **Cache Results**
   - Use Code node to store results
   - Avoid re-running expensive agents
   - Build lookup tables

## Handling Errors

### Common Errors

**Agent fails with tool error:**
- Check tool configuration in Settings
- Verify API keys are correct
- Check tool permissions

**Agent doesn't complete:**
- Check max_tokens limit
- Try increasing it
- Check prompt for infinite loops

**Workflow times out:**
- Agents running too long
- Too many parallel agents
- Check system resources

**Connection errors:**
- Ollama/provider not running
- Network issues
- Check Settings configuration

### Debugging Failed Runs

1. **Go to Runs page**
2. **Click the failed run**
3. **Look at Events Timeline**
4. **Find the error event:**
   - Red border = error
   - See error message
   - Check full stack trace

5. **Fix the issue:**
   - Adjust prompt
   - Check input data
   - Verify configuration
   - Update node settings

6. **Try again:**
   - Run workflow again
   - Verify it succeeds

### Retry Strategy

**Manual retry:**
1. Go to Runs page
2. Click failed run
3. Click "Retry" button (if available)
4. Workflow re-runs with same inputs

**Automatic retry:**
1. Some tools auto-retry on failure
2. Agents retry tool calls up to 3 times
3. Check Events for "Retry" events

## Performance Monitoring

### Execution Time

**Monitor in Run Details:**
- Duration for each node
- Total workflow time
- Identify slow nodes

**Expected times:**
- Simple agents: 2-10 seconds
- Complex reasoning: 10-30 seconds
- Parallel execution: slower agents
- Knowledge search: 1-3 seconds

### System Resources

**Watch for:**
- CPU usage (check system monitor)
- Memory usage
- Disk I/O
- Network bandwidth

**Optimization:**
- Don't run too many parallel workflows
- Use appropriate models for task
- Monitor system load
- Scale if needed

### Cost per Run

**Typical costs:**
- Simple Haiku agent: $0.001-0.01
- Complex Sonnet: $0.01-0.10
- Ollama: $0.00
- Knowledge search: $0.001-0.01

## Cancelled Runs

### Manual Cancellation

Click **Stop** button on running workflow.

**When to cancel:**
- Took too long
- Wrong input was provided
- Cost is too high
- Need to change something

### Auto-Cancellation

Runs may auto-cancel if:
- Server crashes (marked "interrupted")
- Parent process exits
- System runs out of resources

## Run History

### View Past Runs

**Runs Page:**
- Shows last 100 runs
- Sorted by date (newest first)
- Filter by status/workflow

**Cleanup:**
- Old runs are archived
- Queries on large history may slow down
- Exported outputs are preserved

### Export/Share Runs

**Share run details:**
1. Open run
2. Click "Share" button
3. Copy link or export JSON
4. Share with team

**Export format:**
```json
{
  "id": "run-123",
  "workflow": "Idea Generator",
  "status": "success",
  "duration": 15.3,
  "cost": 0.025,
  "timestamp": "2024-04-02T10:17:00Z",
  "tasks": [...]
}
```

## Best Practices

### 1. Monitor First Run
- Run new workflows manually first
- Check results carefully
- Verify costs are reasonable
- Then enable scheduling

### 2. Set Cost Limits
- Know your budget
- Track spending
- Use cheaper models where possible
- Set reminders for cost reviews

### 3. Test Before Scheduling
- Manual run = test environment
- Verify output quality
- Check error handling
- Then schedule

### 4. Review Failures
- Don't ignore failed runs
- Read error messages
- Fix root cause
- Prevent future failures

### 5. Monitor Performance
- Track execution times
- Identify slow nodes
- Optimize expensive operations
- Balance quality vs. cost

## Next Steps

- 📚 [Knowledge Bases Guide](07-knowledge-bases.md)
- ⚙️ [Settings & Configuration](08-settings.md)
- 💡 [Common Patterns](10-patterns.md)

---

**Executing workflows successfully requires understanding their behavior.** [Back to Index →](README.md)
