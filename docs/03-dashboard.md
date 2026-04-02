# Dashboard Overview

The Dashboard is your command center for OpenConclave. It provides at-a-glance insights into your workflow operations.

## Dashboard Layout

![Dashboard](../01-dashboard.png)

The dashboard has several sections:

## 1. Operations Status

Shows the current state of your OpenConclave system:

- **All systems idle** — No workflows are currently running
- **Running** — Shows how many workflows are executing
- Click to see which workflows are active

## 2. Five Stat Cards

### Workflows
Total number of workflows you've created.
- Shows count of active/disabled workflows
- Click to go to Workflows page

### Active
Number of workflows currently running.
- Real-time count updates
- Shows which nodes are executing

### Total Runs
Cumulative number of workflow executions.
- Includes all runs across all workflows
- Helpful for understanding usage patterns

### Success Rate
Percentage of runs that completed successfully.
- Formula: `successful_runs / total_runs × 100`
- Target: Aim for 95%+ if running in production
- Click to see failed runs

### Cost
Total API costs for all runs.
- Sums costs from Claude API, OpenAI, etc.
- Doesn't include local models (Ollama) — they're free
- Helps track your AI spending

## 3. Run Distribution Chart

A pie chart showing the breakdown of all runs by status:

- **Success** (green) — Completed without errors
- **Failed** (red) — Completed but with errors
- **Cancelled** (gray) — Manually stopped

**Hover over sections** to see counts and percentages.

**Common patterns:**
- High success rate = Stable, well-tested workflows
- High failure rate = Check error logs and adjust prompts
- High cancellation = Long-running workflows that are manually stopped

## 4. Quick Launch

Shortcuts to your 5 most frequently used workflows.

**How it works:**
- Click any workflow to run it immediately
- Updates automatically as you use workflows
- Perfect for workflows you run daily

**Example workflows in the demo:**
- Code explorer
- Claude Code Channel test
- Simple Chat With History
- Atlas Support
- Documentation Updater

**Tip:** Use this for workflows with manual triggers (no input prompts)

## 5. Schedules

Shows all active cron-scheduled workflows.

**Information displayed:**
- Workflow name
- Schedule (e.g., "Daily at 9am", "Every 5 minutes")
- Next run time
- Enable/disable toggle

**Common schedules:**
- Hourly — For monitoring tasks
- Daily — For daily reports or updates
- Weekdays — For business-day automation
- Custom cron — For specific timing needs

**Example workflows:**
- Daily standup report
- Every 30m: Check system health
- Weekdays 9am: Send team summary

## 6. Recent Runs

List of the 10 most recent workflow executions.

**Columns:**
- **Status** (icon) — Success/Failed/Cancelled
- **Workflow Name** — Click to see details
- **Run ID** — Unique identifier
- **Duration** — How long it took (e.g., "222.1s")
- **Cost** — API costs (e.g., "$0.0917")
- **Time** — When it ran (relative, e.g., "10:17 AM")

**Actions:**
- Click a run to see full details
- View logs, events, agent reasoning
- Download outputs

## 7. Latest Outputs

Most recent workflow outputs (last 5-10).

**Information:**
- **Workflow Name** — Which workflow produced it
- **Output Preview** — First 100+ characters
- **Timestamp** — When it was generated

**Use cases:**
- See latest report outputs
- Check recent agent responses
- Monitor workflow results in real-time

## Navigation from Dashboard

**Top-left menu:**
- 📊 **Dashboard** (current)
- 🔄 **Workflows** — Create and manage workflows
- ▶️ **Runs** — View all workflow executions
- 📚 **Knowledge** — Manage knowledge bases
- ⚙️ **Settings** — Configure AI providers and integrations

## Common Dashboard Tasks

### Monitor Workflow Health
1. Check Success Rate card
2. Look at Run Distribution chart
3. Review Recent Runs list
4. If success rate is low, click Failed runs to investigate

### Find a Recently Completed Workflow
1. Look at Recent Runs
2. Click on the run you want
3. See full details, logs, and outputs

### Run a Frequent Workflow
1. Look at Quick Launch
2. Click the workflow
3. It runs immediately (if no input needed)

### Check Scheduled Tasks
1. Look at Schedules section
2. See next run times
3. Disable if needed (toggle switch)
4. Click to edit schedule

### Review API Costs
1. Check Cost stat card for total
2. Click to see breakdown by workflow
3. Look at Recent Runs for individual costs
4. Adjust usage if needed

## Tips & Tricks

### 1. Export Data
- Right-click on chart → Save as image
- Copy run IDs for reference
- Share output previews with team

### 2. Monitor in Real-Time
- Refresh page every minute for latest stats
- Watch Active count to see live executions
- Check Recent Runs for just-completed workflows

### 3. Identify Problem Workflows
1. Look at Run Distribution
2. If many failures, click to filter failed runs
3. See which workflow(s) have issues
4. Edit and improve prompts

### 4. Cost Optimization
1. Check which workflows cost most
2. Switch to cheaper models where appropriate
3. Use Ollama for frequent low-impact tasks
4. Combine workflows to reduce runs

### 5. Capacity Planning
1. Look at Active count
2. If often >5 parallel runs, consider upgrading machine
3. Monitor during peak hours
4. Adjust schedules if conflicts occur

## Dashboard Metrics Explained

### Success Rate Calculation
```
Success Rate = (Successful Runs / Total Runs) × 100%

Example:
- Total Runs: 100
- Successful: 95
- Failed: 4
- Cancelled: 1
- Success Rate: 95%
```

### Cost Breakdown
- Claude API calls: Based on tokens
- OpenAI/Groq: Based on provider pricing
- Local models (Ollama): $0.00
- Knowledge base operations: Included in agent cost

### Duration
- Includes all node execution time
- Agent thinking time (if using extended thinking)
- Tool execution (Bash, Read, Write, etc.)
- Network latency

## Refreshing Data

**Dashboard auto-refreshes:**
- Every 10 seconds for active runs
- Every 30 seconds for stats
- Manually: Press F5 or click refresh icon

**To force a full refresh:**
- Press Ctrl+Shift+R (hard refresh)
- Clear browser cache
- Log out and back in

## What's Next?

- 📖 [Create Your First Workflow](02-first-workflow.md)
- 🎨 [Learn the Workflow Editor](04-workflow-editor.md)
- 📋 [Node Types Reference](05-node-types.md)
- 🎯 [See Use Case Examples](11-use-cases.md)

---

**Dashboard is your starting point. Now explore:** [Workflows →](04-workflow-editor.md)
