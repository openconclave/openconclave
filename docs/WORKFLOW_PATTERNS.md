# Workflow Design Patterns & Best Practices

Learn how to design effective OpenConclave workflows using proven patterns and best practices.

## Table of Contents

1. [Basic Patterns](#basic-patterns)
2. [Advanced Patterns](#advanced-patterns)
3. [Best Practices](#best-practices)
4. [Common Pitfalls](#common-pitfalls)
5. [Performance Tips](#performance-tips)

## Basic Patterns

### 1. Sequential (Linear) Pipeline

**Flow:** Trigger → Agent 1 → Agent 2 → Agent 3 → Output

Use this when tasks must run one after another, with each task building on the previous output.

**Example: Blog Post Generator**
```
Trigger (Topic) → 
  Agent: Content Writer → 
  Agent: Editor (review/improve) → 
  Agent: Formatter (add markdown) → 
  Output: Write to file
```

**When to use:**
- Tasks are dependent on previous results
- Order matters
- Simple workflow with 2-5 steps
- Cost is not a constraint (sequential = more time)

### 2. Fan-Out / Fan-In (Parallel)

**Flow:** Trigger → [Agent 1, Agent 2, Agent 3] → Merge → Output

Use when multiple independent tasks can run simultaneously, then combine results.

**Example: Security Review**
```
Trigger (Code repo) →
  Agent: Pattern Scanner (parallel) ↘
  Agent: Vulnerability Checker (parallel) → 
  Agent: Architecture Reviewer (parallel) ↗
  Merge: Combine findings →
  Agent: Risk Classifier →
  Output: Report
```

**Benefits:**
- 3x faster than sequential
- Better resource utilization
- Parallel opinions on same input
- Merge combines results into object

**When to use:**
- Multiple independent analyses
- Same input, different perspectives
- Tasks can run in parallel
- Final decision needs combined input

### 3. Conditional Branching

**Flow:** Trigger → Agent → Condition → [Path A or Path B] → Output

Use when workflow must make decisions based on results.

**Example: Auto-Responder**
```
Trigger (Email) →
  Agent: Classify email →
  Condition: Is urgent? →
    True: Agent: Urgent Handler → Output: Call team
    False: Agent: Queue Responder → Output: Queue for later
```

**Condition Syntax:**
```javascript
// Simple boolean
input.priority === "high"

// Multiple conditions
input.sentiment === "angry" && input.complexity > 5

// Nested checks
input.errors.length > 0 && input.errors.some(e => e.severity === "critical")

// String contains
input.message.includes("password reset")

// Numeric comparisons
input.score > 0.8 && input.confidence > 0.7
```

**When to use:**
- Routing based on AI analysis
- Different handlers for different inputs
- Quality gates (pass/fail)
- Priority-based routing

### 4. Loop with Exit Condition

**Flow:** Trigger → Agent → Condition → [Loop Back or Continue] → Output

Use to repeat an agent's work until a goal is reached or max iterations exceeded.

**Example: Iterative Refinement**
```
Trigger (Rough draft) →
  Agent: Improve text →
  Condition: Quality >= 8/10? →
    No → Loop back to Agent
    Yes → Output: Final version
```

**Implementation:**
1. Add Condition node after Agent
2. Set condition to check quality/success
3. Create edge back to Agent for "continue loop"
4. Create edge forward to Output for "exit loop"

**Safety tips:**
- Always have an exit condition
- Add max iteration counter
- Log iteration count for debugging
- Consider cost (loops = more API calls)

## Advanced Patterns

### 1. Channel-In-The-Loop (Human Approval)

**Flow:** Trigger → Agent → Channel Loop → [Human responds] → Resume

Pause workflow to ask Claude Code user for input, then resume.

**Example: Deployment Pipeline**
```
Trigger (New release) →
  Agent: Test suite →
  Condition: All tests pass? →
    No → Output: Failed
    Yes → Agent: Build artifacts →
    Channel Loop: Ask "Ready to deploy to production?" →
    Agent: Deploy →
    Output: Confirmation
```

**Benefits:**
- Human-in-the-loop approval
- Keep automation going 90% of the time
- Ask for clarification on ambiguous tasks
- Cost-effective (skip expensive agent calls)

**Configuration:**
1. Add Channel Loop node in workflow
2. Configure question/prompt
3. Claude Code user sees prompt with context
4. Responds in Claude Code channel
5. Workflow resumes automatically

### 2. Multi-Agent Debate

**Flow:** Trigger → [Agent A (pro), Agent B (con)] → Merge → Condition → Output

Have different agents argue different sides, then judge or merge.

**Example: Code Architecture Review**
```
Trigger (New design) →
  Agent: Reviewer (favor new design) (parallel) ↘
  Agent: Reviewer (favor existing design) (parallel) →
  Agent: Judge (analyze both perspectives) →
  Output: Recommendation
```

**Benefits:**
- Reduces groupthink
- Catches blind spots
- More robust analysis
- Better for high-stakes decisions

### 3. Knowledge Base Retrieval

**Flow:** Trigger → Knowledge Node (search) → Agent (process results) → Output

Use structured knowledge from documents.

**Example: Customer Support**
```
Trigger (Customer question) →
  Knowledge: Search "customer question" →
  Agent: Format answer from docs →
  Condition: Found answer? →
    Yes → Output: Send to customer
    No → Channel Loop: Escalate to human
```

**Configuration:**
1. Create Knowledge Base in UI
2. Upload documents (PDF, TXT, Markdown)
3. Add Knowledge node to workflow
4. Pass customer question as input
5. Returns top semantic matches with scores
6. Agent formats and personalizes response

### 4. Scheduled Batch Processing

**Flow:** Trigger (Cron) → Code (Fetch data) → Agent (Process) → Output (Store)

Automate regular tasks that run on a schedule.

**Example: Daily Summary**
```
Trigger: Cron Daily 9am →
  Code: Fetch logs from last 24h →
  Agent: Analyze and summarize →
  Code: Format as email HTML →
  Output: Send via Telegram / Write file
```

**Configuration:**
1. Trigger node → Cron Schedule
2. Choose preset (Daily, Hourly, Weekdays, etc.)
3. Or custom: `0 9 * * *` (9am daily)
4. Save workflow
5. Runs automatically on schedule

### 5. Workflow Chaining (MCP Tool Calls)

**Flow:** Workflow A → [calls Workflow B as MCP tool] → Workflow C

Workflows become callable tools for other workflows and Claude Code.

**Example: Content Pipeline**
```
Workflow: Main Pipeline (Trigger) →
  Agent: Outline (calls Workflow: Outline Generator) →
  Agent: Write (calls Workflow: Content Writer) →
  Agent: Review (calls Workflow: Review Process) →
  Output: Final article
```

**Benefits:**
- Reusable workflow components
- Reduces duplication
- Easier testing and maintenance
- Claude Code can call your workflows

## Best Practices

### 1. Name Nodes Descriptively

Bad: "Agent 1", "Condition", "Code Node"
Good: "Content Writer", "Quality Check (8/10?)", "Format as Markdown"

Descriptive names help in:
- Run Details timeline (easier to find events)
- Collaboration (others understand purpose)
- Debugging (clearer which node failed)

### 2. Use Comments in Large Workflows

For complex workflows:
1. Add Code nodes with comments as documentation
2. Include decision logic explanations
3. Document expected input/output format

### 3. Design for Observability

**Include logging at key points:**
```
Trigger → 
  Agent (task) →
  Code (log result) →
  Condition →
  ...
```

**Benefits:**
- Easy to debug failures
- Track execution flow
- Monitor performance
- Audit trail

### 4. Handle Failures Gracefully

Don't let one failure cascade:

```
Agent A (might fail) →
  Condition: Did task succeed? →
    No → Agent (fallback/retry) → Continue
    Yes → Continue
```

Or use parallel agents:

```
Agent A (method 1) (parallel) ↘
Agent B (method 2) (parallel) → Merge → Pick best result
```

### 5. Optimize for Cost

**High-cost operations:**
- Multiple Claude 3.5 Sonnet calls
- Complex agent chains
- Large token outputs

**Cost optimization strategies:**

a) **Use cheaper models:**
```
Heavy lifting: Claude 3.5 Sonnet (expensive)
Simple tasks: Claude 3.5 Haiku (fast, cheap)
Local processing: Ollama (free)
```

b) **Reduce agent calls:**
```
Instead of: Multiple agents checking same thing
Use: One agent with detailed instructions + Condition
```

c) **Batch operations:**
```
Instead of: 100 API calls per item
Use: One agent processes all 100 items
```

d) **Use knowledge bases:**
```
Instead of: Agent reads and summarizes 50 files
Use: Knowledge base (pre-indexed) → Knowledge node
```

### 6. Test Workflows Before Production

1. Start with small/test data
2. Run manually first (don't schedule immediately)
3. Check Run Details for any errors
4. Verify output format is correct
5. Then enable cron schedule

### 7. Version Control Your Workflows

Since workflows are JSON, consider:
1. Export workflow configuration
2. Store in git
3. Comment with change log
4. Easy rollback if needed

### 8. Document Decision Logic

For Condition nodes, add context:

Instead of: `input.score > 0.5`
Better: `input.score > 0.5 // Threshold tuned for 80% precision`

This helps others (and future you) understand why thresholds exist.

## Common Pitfalls

### 1. Too Many Parallel Tasks

**Problem:**
```
Trigger →
  [Agent 1, Agent 2, Agent 3, Agent 4, Agent 5] →
  Merge
```
- Slow (waiting for slowest task)
- Expensive (all run regardless of results)
- Hard to debug (complexity)

**Solution:** Use parallel only for 2-3 truly independent analyses. Otherwise, keep sequential or add conditions.

### 2. Infinite Loops

**Problem:**
```
Agent → Condition (always true) → back to Agent
```
Workflow runs forever!

**Solution:**
1. Always have exit condition
2. Add iteration counter
3. Use `max_iterations` property
4. Log iteration count

### 3. Silent Failures

**Problem:** Agent fails silently, next nodes use empty input.

**Solution:**
```
Agent →
  Condition: Did agent succeed? →
    No → Output: Error / Channel Loop: Retry
    Yes → Continue
```

### 4. Oversized Merge Outputs

**Problem:**
```
Merge with 20 parallel inputs →
  Agent receives huge object, can't parse
```

**Solution:**
- Use Condition nodes to filter before merge
- Merge only what's needed
- Use Code node to transform merged output

### 5. Triggering Too Frequently

**Problem:** Cron set to every 1 minute, expensive!

**Solution:**
- Start with longer intervals (hourly, daily)
- Monitor first few runs
- Then optimize to necessary frequency

### 6. Unused Outputs

**Problem:** Workflow runs and produces output no one sees.

**Solution:**
1. Always have an Output node
2. Choose destination (Terminal, Telegram, File)
3. Verify output is being used

## Performance Tips

### 1. Cache Knowledge Bases

If using same knowledge base in multiple workflows:
- Index once, reuse many times
- Update documents, not whole base

### 2. Use Ollama for High-Volume Tasks

**Instead of:**
```
Trigger: Every 1 minute → Agent (Claude Sonnet) × 60 calls/hour
Cost: ~$1/hour
```

**Use:**
```
Trigger: Every 1 minute → Agent (Ollama) × 60 calls/hour
Cost: $0/hour (your compute)
```

For less complex tasks, Ollama is free.

### 3. Batch Similar Operations

**Instead of:**
```
Trigger → Agent processes 1 item → Output
Called 100 times
```

**Use:**
```
Trigger (batch 100 items) →
  Agent processes all 100 items →
  Output: All results
Called once
```

### 4. Parallel First, Then Sequential

Design workflow to run independent tasks in parallel first, then merge and refine:

```
Trigger →
  [Independent tasks] → Merge →
  Sequential refinement →
  Output
```

This is faster than all sequential.

### 5. Monitor Run Times

In Dashboard, check Recent Runs:
- Which workflows are slowest?
- Which consume most API calls?
- Optimize high-cost ones first

---

**Next Steps:**
- Study the example workflows in Quick Launch
- Experiment with small workflows
- Check Run Details after each execution
- Join the community for pattern sharing
