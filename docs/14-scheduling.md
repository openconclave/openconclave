# Scheduling & Automation

Run workflows automatically on a schedule using cron expressions.

## Quick Start

### Schedule a Workflow in 3 Steps

1. **Edit Workflow**
   - Open workflow editor
   - Click Trigger node

2. **Change Type to Cron**
   - Inspector: Change "Type" dropdown to "Cron"

3. **Select Schedule**
   - Choose preset (Daily, Hourly, etc.)
   - Or enter custom cron expression
   - Save

**Workflow runs automatically on your schedule!**

## Cron Presets

Quick buttons for common schedules:

| Button | Cron | When |
|--------|------|------|
| Every 5m | `*/5 * * * *` | Every 5 minutes |
| Every 10m | `*/10 * * * *` | Every 10 minutes |
| Every 30m | `*/30 * * * *` | Every 30 minutes |
| Hourly | `0 * * * *` | Every hour at :00 |
| Every 2h | `0 */2 * * *` | Every 2 hours |
| Every 6h | `0 */6 * * *` | Every 6 hours |
| Every 12h | `0 */12 * * *` | Every 12 hours |
| Daily 9am | `0 9 * * *` | Daily at 9:00 AM UTC |
| Daily 6pm | `0 18 * * *` | Daily at 6:00 PM UTC |
| Weekdays 9am | `0 9 * * 1-5` | Mon-Fri at 9:00 AM |
| Weekends 10am | `0 10 * * 0,6` | Sat-Sun at 10:00 AM |
| Weekly Monday | `0 9 * * 1` | Every Monday at 9:00 AM |
| Monthly 1st | `0 0 1 * *` | 1st of month at midnight |

## Custom Cron Expressions

Format: `minute hour day month day-of-week`

```
    minute (0-59)
    hour   (0-23)
    day    (1-31)
    month  (1-12)
    day-of-week (0-6, 0=Sunday)

0 9 * * *     = 9:00 AM every day
0 0 * * 0     = Midnight every Sunday
0 8-18 * * *  = Every hour 8am-6pm
0 9 * * 1-5   = 9am weekdays only
0 0 1 * *     = Midnight on 1st of month
*/15 * * * *  = Every 15 minutes
0 */3 * * *   = Every 3 hours
```

### Cron Builder

Use online tools to create expressions:
- https://crontab.guru
- https://cron.cronbase.com
- Search "cron expression builder"

**Tips:**
- Test expression before saving
- UTC timezone (not your local time)
- Adjust for your timezone manually

## Managing Schedules

### View Active Schedules

**Dashboard:**
1. Go to Dashboard
2. Look at "Schedules" section
3. See all scheduled workflows
4. See next run time

**Or:**
1. Open workflow editor
2. Click Trigger node
3. See schedule in inspector

### Enable/Disable Schedule

**In Editor:**
- Toggle "Enabled" checkbox
- Save

**On Dashboard:**
- Use toggle switch on schedule

### Edit Schedule

1. Open workflow editor
2. Click Trigger node
3. Change cron expression
4. Save

### Delete Schedule

1. Open workflow editor
2. Click Trigger node
3. Change Type from "Cron" to "Manual"
4. Save

## Timezone Considerations

⚠️ **Important:** All cron times are in **UTC**

### Examples

**Your timezone: EST (UTC-5)**

Want: 9:00 AM EST
Cron: `0 14 * * *` (2 PM UTC = 9 AM EST)

Want: 6:00 PM EST
Cron: `0 23 * * *` (11 PM UTC = 6 PM EST)

**Your timezone: PST (UTC-8)**

Want: 9:00 AM PST
Cron: `0 17 * * *` (5 PM UTC = 9 AM PST)

### Daylight Saving Time

DST changes affect calculations:
- March/April: Spring forward (adjust +1 hour)
- October/November: Fall back (adjust -1 hour)
- Consider adjusting schedule after DST changes

## Best Practices

### 1. Offset Times to Avoid Overload

**Bad:** All workflows at exact same time
```
Workflow1: Daily at 9:00
Workflow2: Daily at 9:00
Workflow3: Daily at 9:00
```

**Good:** Stagger by 5-10 minutes
```
Workflow1: Daily at 9:00 (0 9 * * *)
Workflow2: Daily at 9:05 (5 9 * * *)
Workflow3: Daily at 9:10 (10 9 * * *)
```

### 2. Test Before Scheduling

**Steps:**
1. Create and test manually
2. Verify output quality
3. Check costs
4. Then enable schedule

### 3. Monitor First Runs

After scheduling:
1. Watch Dashboard
2. Check Runs page when it executes
3. Verify output is correct
4. Review cost

### 4. Set Reasonable Intervals

**Avoid too frequent:**
- Every 1 minute = 1,440 runs/day
- Every 5 minutes = 288 runs/day
- Consider costs and load

**Typical intervals:**
- Monitoring: Every 5-15 minutes
- Reports: Daily or hourly
- Backups: Daily or weekly
- Cleanup: Weekly or monthly

### 5. Handle Long-Running Workflows

If workflow takes longer than schedule interval:

**Example:**
- Schedule: Every hour
- Duration: 45 minutes
- Problem: Overlapping executions

**Solutions:**
1. Use longer interval (e.g., every 2 hours)
2. Optimize workflow (make it faster)
3. Run in parallel but add deduplication

## Troubleshooting

### Schedule Not Running

**Issue:** Scheduled time passed but workflow didn't run

**Causes:**
- Schedule disabled
- Trigger type not Cron
- Cron expression incorrect
- Server not running

**Fix:**
1. Verify enabled: ✓ checkbox
2. Check Type: Should be "Cron"
3. Verify cron expression (use crontab.guru)
4. Verify server is running
5. Check server logs

### Running at Wrong Time

**Issue:** Workflow runs at unexpected time

**Causes:**
- Timezone confusion (UTC vs local)
- Cron expression wrong
- DST change not accounted for

**Fix:**
1. Calculate expected time (crontab.guru)
2. Check against UTC
3. Adjust for your timezone
4. Test with manual run

### Workflow Takes Too Long

**Issue:** Execution time exceeds interval

**Example:**
- Scheduled every 30 minutes
- Takes 35 minutes to run
- Each run starts before previous finishes

**Solutions:**
1. Increase interval
2. Parallelize workflow
3. Optimize prompts (shorter responses)
4. Use cheaper/faster models
5. Add caching

### Cost Explosion

**Issue:** Scheduled workflows cost too much

**Causes:**
- Too frequent schedule
- Workflow is expensive
- Accumulates quickly

**Fix:**
1. Reduce frequency
2. Use cheaper models
3. Optimize workflow
4. Combine related tasks

## Monitoring

### Dashboard Stats

Track scheduled executions:
- **Total Runs** card — Includes scheduled
- **Run Distribution** — Shows success rate
- **Cost card** — Includes schedule costs

### Per-Workflow Cost

**Monthly estimate:**
```
Cost per run: $0.05
Frequency: Daily (30 runs/month)
Monthly: $0.05 × 30 = $1.50

Cost per run: $0.01
Frequency: Hourly (730 runs/month)
Monthly: $0.01 × 730 = $7.30
```

### Alerts & Notifications

Currently no built-in alerts, but consider:
1. Send result to email/Telegram
2. Add Channel Loop for approvals
3. Monitor Run failures

## Advanced Patterns

### Distributed Scheduling

Avoid server overload:
```
Workflow1: Daily 9:00
Workflow2: Daily 9:05
Workflow3: Daily 9:10
Workflow4: Daily 9:15
```

### Conditional Scheduling

```
Cron Trigger → Condition: Is it a business day?
  ├─ Yes: Process
  └─ No: Skip
```

```javascript
// In Condition node
const now = new Date();
const day = now.getDay();
day !== 0 && day !== 6  // True for weekdays
```

### Cascade Scheduling

One workflow triggers another:
```
Main Trigger (9am) → Agent → Output: Webhook
                              ↓
                         Secondary workflow
                         (triggered by webhook)
```

### Failure Handling

Add error handling for scheduled workflows:
```
Cron Trigger → Agent → Condition: Success?
  ├─ Yes: Output success
  └─ No: Output error/retry/alert
```

## Migration from Other Systems

### From Cron Jobs (Linux/Mac)

Linux/Mac cron example:
```
0 9 * * * /path/to/script.sh
```

OpenConclave equivalent:
- Schedule: Daily at 9:00 (UTC adjusted)
- Trigger: Cron
- Agent: Does what script.sh did

### From Scheduled Tasks (Windows)

Windows Task Scheduler example:
- Trigger time: 9:00 AM daily

OpenConclave equivalent:
- Schedule: 0 9 * * * (if UTC aligned)
- Or adjust for UTC offset

### From Zapier/IFTTT

Zapier schedule:
- Every 15 minutes

OpenConclave equivalent:
- Schedule: */15 * * * *

## Performance Tips

### Reduce Execution Time

1. **Use Haiku** instead of Sonnet for simple tasks
2. **Set max_tokens** to limit response length
3. **Parallelize** independent tasks
4. **Cache results** instead of re-computing

### Reduce Cost

1. **Use Ollama** for frequent tasks (free)
2. **Reduce frequency** if possible
3. **Batch similar** tasks together
4. **Use cheaper provider** (Groq, OpenRouter)

## Next Steps

- 💡 [Common Patterns](10-patterns.md) — See scheduling patterns
- 🎯 [Use Cases](11-use-cases.md) — Real examples
- 📱 [Telegram Integration](15-telegram.md) — Trigger from phone

---

**Scheduling enables truly hands-free automation.** [Back to Index →](README.md)
