# Channel-in-the-Loop Guide

Interactive workflows that pause and ask Claude Code for input.

## What is Channel-in-the-Loop?

A workflow pattern where:
1. Workflow runs and reaches a decision point
2. Sends a question to Claude Code
3. Workflow pauses and waits
4. You respond in Claude Code terminal
5. Response becomes input to next workflow step
6. Workflow resumes

**Perfect for:**
- Approval workflows
- Interactive decisions
- Human-in-the-loop AI
- Context-aware automation

## How It Works

### Behind the Scenes

```
OpenConclave Workflow          Claude Code Terminal
(running)
    ↓
Channel Loop node
    ↓
Send question ─────────────→ Display: "Question here?"
    ↓
Wait (paused)
    ↓
              ← User types: "yes"
    ↓
Receive response
    ↓
Resume with response as input
    ↓
Continue workflow
```

### Message Format

When a workflow asks a question, you see in Claude Code:

```
[OpenConclave] Workflow: "Proposal Analyzer"
Sender Node: "Approval Gate"

Question: "Should we approve this proposal?
         Budget: $50,000
         Timeline: Q2 2024"

Channel: proposals/wait-for-approval

Respond with: yes/no (or custom format specified)
```

## Using Channel Loop Nodes

### Creating a Channel Loop Node

**In Workflow Editor:**
1. Click **Channel Loop** in left panel
2. Click canvas to place
3. Orange rounded rectangle appears
4. Configure in inspector

### Inspector Settings

**Label:** Display name
- "Approval Gate"
- "Budget Check"
- "Manager Review"

**Prompt:** Question to ask
- Can use variables: `${variable}`
- Can be multi-line
- Be specific and clear

**Output Variable Name:** How response flows
- Default: `response`
- Use in next node: `${response}`

### Example: Simple Approval

**Prompt:**
```
Review this proposal:

Title: ${proposal.title}
Budget: $${proposal.budget}
Timeline: ${proposal.timeline}

Approve? Respond with: yes or no
```

**When executed:**
1. Workflow reaches Channel Loop
2. Shows prompt with variables filled in
3. You respond: "yes" or "no"
4. Response becomes `${response}`
5. Next node uses: `if(response === 'yes')`

## Use Cases

### 1. Approval Workflows

```
Trigger: Expense or Change Request
  ↓
Agent: Generate recommendation
  ↓
Channel Loop: "Manager, approve?"
  ↓
Condition: response === 'approve'
  ├─ Yes: Process request
  └─ No: Reject with reason
```

**Prompt:**
```
Review this ${type}:

${summary}

Please approve or reject.
Respond: "approve" or "reject"
```

### 2. Clarification Questions

```
Agent: Generate interpretation
  ↓
Channel Loop: "Is this correct?"
  ↓
Agent: Use response to refine
```

**Prompt:**
```
I understood your request as:

${interpretation}

Is this correct?
- yes, continue
- no, I need to clarify...
```

### 3. Decision Points

```
Agent: Analyze options
  ↓
Channel Loop: "Pick an option"
  ↓
Agent: Execute chosen option
```

**Prompt:**
```
Three options for you:

1. ${option1}
2. ${option2}
3. ${option3}

Which do you prefer? (1, 2, or 3)
```

### 4. Code Review Approval

```
Agent: Generate code review
  ↓
Channel Loop: "Approve changes?"
  ↓
Agent: Merge if approved
```

### 5. Content Approval

```
Agent: Generate content
  ↓
Channel Loop: "Approve for publishing?"
  ↓
Output: Publish if approved
```

## Best Practices

### 1. Be Clear in Prompts

**Bad:**
```
What do you think?
```

**Good:**
```
Should we proceed with this proposal?
Budget: ${budget}
Timeline: ${timeline}
Respond: yes or no
```

### 2. Expect Specific Responses

**Design prompts that expect:**
- Short responses: "yes/no", "approve/reject"
- Structured responses: "1, 2, or 3"
- Reasons: "yes because..."
- Scores: "1-10 quality rating"

**Handle in next node:**
```javascript
// Extract yes/no
if (response.toLowerCase().includes('yes')) { ... }

// Extract number
let score = parseInt(response);

// Multiple answers
let parts = response.split('|');
```

### 3. Handle Invalid Responses

Use a Condition node to validate:

```javascript
// Check if response is valid
response && response.length > 0

// Check for specific values
response === 'yes' || response === 'no'

// Check if it's a number
!isNaN(response)
```

### 4. Provide Context

Always include relevant information in the prompt:

```
Decision needed for: ${item_name}
Current status: ${status}
Impact if approved: ${impact}
Cost: ${cost}
Timeline: ${timeline}

What do you recommend?
```

### 5. Use in Critical Points

Place Channel Loop at decision points where:
- Human judgment is valuable
- Approval is required
- Fallback decision needed
- Cost or risk is high

## Advanced Usage

### Multi-Stage Approvals

```
Agent1: Generate recommendation
  ↓
Channel Loop: Reviewer 1
  ↓
Channel Loop: Reviewer 2 (if needed)
  ↓
Channel Loop: Final approval
```

### Conditional Channel Loops

```
Agent: Analyze
  ↓
Condition: Confidence > 90%?
  ├─ High: Auto-approve
  └─ Low: Ask human
```

### Retry After Rejection

```
Agent: Generate plan
  ↓
Channel Loop: "Approve?"
  ↓
Condition: response === 'no'
  ├─ Yes: Go back to Agent (retry)
  └─ No: Continue
```

**Prompt (on retry):**
```
Your previous proposal was rejected.
Feedback: ${feedback}

Please revise and resubmit.
```

### Feedback Loop

```
Agent: Generate
  ↓
Channel Loop: "Feedback?"
  ↓
Condition: Has feedback?
  ├─ Yes: Go back to Agent with feedback
  └─ No: Done
```

## Responding in Claude Code

### How to See Workflow Questions

If using Claude Code plugin:
1. Workflow runs and reaches Channel Loop
2. Question appears in Claude Code terminal
3. Look for: `[OpenConclave]` message

### Responding to Questions

**In Claude Code terminal:**
```
> respond "yes"
```

Or if using Claude Code UI, there may be an input field.

### Response Formats

**Simple responses:**
```
yes
no
approve
reject
1
```

**Longer responses:**
```
yes, because the budget is reasonable
```

**Structured responses:**
```
yes|proceed immediately|high priority
```

## Troubleshooting

### Question Not Appearing

**Issue:** No prompt in Claude Code

**Causes:**
- Claude Code not running
- Plugin not installed
- Channel not configured

**Fix:**
1. Verify Claude Code is running
2. Check Settings → Telegram configuration
3. Restart Claude Code
4. Check server logs

### Workflow Keeps Waiting

**Issue:** Workflow stuck after Channel Loop

**Causes:**
- Response not received
- Invalid response format
- Connection lost

**Fix:**
1. Check your response in Claude Code
2. Verify response matches expected format
3. Check for errors in logs
4. Manually continue or timeout

### Response Not Used Properly

**Issue:** Response sent but workflow behaves wrong

**Causes:**
- Response format wrong
- Next node doesn't handle properly
- Condition logic incorrect

**Fix:**
1. Check exact response you sent
2. Verify in next node what's expected
3. Add debugging Condition node
4. Print `${response}` to see actual value

## Timing & Timeouts

### How Long Does It Wait?

By default, workflows wait indefinitely for response.

**Options:**
1. Answer quickly (while terminal is open)
2. Take your time (system stays paused)
3. Leave and come back (still waiting)

### Timeout Configuration

Currently no timeout, but consider:
- Most workflows should have timeout
- Set in future versions
- For now, manually stop if stuck

**Stop a waiting workflow:**
1. Go to Runs page
2. Click "Stop" on running workflow
3. Workflow cancelled

## Integration with Automation

### Use with Cron

Channel Loops work with cron triggers:

```
Cron Trigger: Daily 9am
  ↓
Agent: Generate daily report
  ↓
Channel Loop: "Publish?"
  ↓
Output: Publish if approved
```

**In this case:**
- Workflow runs daily
- You see question at 9am
- You approve/reject
- Action taken

### Use with Webhooks

External systems can trigger workflows with Channel Loops:

```
External API → Trigger workflow
            ↓
          Agent
            ↓
          Channel Loop ← You approve
            ↓
          Resume
```

## Security & Permissions

### Who Can Respond?

Currently:
- You (whoever is running Claude Code)
- Only in your Claude Code terminal

### Future Considerations

- Multi-user approval flows
- Different permission levels
- Audit trails
- Scheduled approvals

---

## Examples

### Example 1: Expense Approval

**Workflow:**
```
Trigger: Employee submits $${amount} expense
  ↓
Agent: Validate expense (check policy)
  ↓
Condition: Amount > $1000?
  ├─ Yes: Manager approval needed
  │   ↓
  │   Channel Loop: "Manager, approve?"
  │   ↓
  │   Condition: response === 'yes'
  └─ No: Auto-approve
```

**Channel Loop Prompt:**
```
Expense Approval Request

Employee: ${employee_name}
Amount: $${amount}
Category: ${category}
Description: ${description}
Business Purpose: ${purpose}

Manager, please approve or reject.
Respond: "yes" or "no"
```

### Example 2: Content Review

**Workflow:**
```
Trigger: Generated content
  ↓
Agent: Generate blog post
  ↓
Channel Loop: "Review quality?"
  ↓
Condition: response starts with 'yes'
  ├─ Yes: Publish
  └─ No: Send for editing
```

**Channel Loop Prompt:**
```
Content Review

Title: ${title}
Preview: ${preview_text}

Does this meet quality standards?
- yes, publish as-is
- no, needs revision
- yes, but edit first

Your choice:
```

### Example 3: Decision Making

**Workflow:**
```
Trigger: Business decision needed
  ↓
Agent: Analyze three options
  ↓
Channel Loop: "Pick option"
  ↓
Agent: Execute chosen option
```

**Channel Loop Prompt:**
```
Strategy Decision

Option 1: Aggressive growth
- High reward: 40% growth potential
- High risk: Market dependent
- Timeline: 6-12 months

Option 2: Steady growth
- Moderate reward: 15% growth
- Low risk: Reliable
- Timeline: 12+ months

Option 3: Hold position
- No growth
- No risk
- Preserve resources

Which strategy? (1, 2, or 3)
```

---

## Next Steps

- 💡 [Common Patterns](10-patterns.md) — See Channel Loop in patterns
- 🎯 [Use Cases](11-use-cases.md) — Examples using Channel Loops
- ⚙️ [Settings](08-settings.md) — Configure for Channel

---

**Channel-in-the-loop creates powerful human-AI collaboration.** [Back to Index →](README.md)
