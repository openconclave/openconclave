# Common Workflow Patterns

Learn proven workflow design patterns for different automation scenarios.

## Pattern 1: Sequential Processing

**Use case:** Tasks that depend on previous step output

```
Trigger → Agent1 → Agent2 → Agent3 → Output
```

**How it works:**
1. Agent1 runs, produces output
2. Agent2 uses Agent1's output as input
3. Agent3 uses Agent2's output
4. Continue until Output node

**Example: Document Review Pipeline**
```
Trigger: Upload document
  ↓
Agent1: Extract key points
  ↓
Agent2: Analyze extracted points
  ↓
Agent3: Generate summary
  ↓
Output: Save summary to file
```

**Implementation:**
1. Add Trigger node (type: file upload)
2. Add Agent1 with prompt: "Extract key points from: ${input}"
3. Add Agent2 with prompt: "Analyze these points: ${agent1_output}"
4. Add Agent3 with prompt: "Summarize: ${agent2_output}"
5. Add Output node
6. Connect in sequence

**Advantages:**
- Each step builds on previous
- Clear data flow
- Easy to understand
- Simple error handling

**Disadvantages:**
- Total time = sum of all steps
- One failure stops pipeline
- Can't parallelize steps

**When to use:**
- Steps are dependent
- Order matters
- Output of one feeds next
- Simple linear workflows

---

## Pattern 2: Parallel Processing

**Use case:** Multiple independent tasks that can run simultaneously

```
Trigger →┬→ Agent1 ─→┐
         ├→ Agent2 ─→┼→ Merge → Output
         └→ Agent3 ─→┘
```

**How it works:**
1. Trigger sends input to multiple agents
2. All agents run at same time
3. Merge node waits for all to complete
4. Combines results into single object

**Example: Multi-Perspective Analysis**
```
Trigger: Business decision "${decision}"
  ↓
Agent1 (Financial): Analyze financial impact
Agent2 (Legal): Check legal implications
Agent3 (Marketing): Assess marketing angle
  ↓
Merge: Combine all perspectives
  ↓
Agent4: Make recommendation based on analysis
  ↓
Output: Show recommendation
```

**Implementation:**
1. Add Trigger node
2. Add 3+ Agent nodes
3. Connect Trigger to each Agent
4. Add Merge node
5. Connect all Agents to Merge
6. Continue from Merge
7. Save

**Advantages:**
- Total time = slowest agent only
- Uses multiple perspectives
- Efficient for independent tasks
- Can handle many parallel agents

**Disadvantages:**
- More complex workflow
- Need to merge results
- Harder to debug
- Resource intensive

**When to use:**
- Tasks are independent
- Want faster execution
- Need multiple viewpoints
- Have system resources

**Cost calculation:**
- Sequential: $0.01 + $0.01 + $0.01 = $0.03 (3s total)
- Parallel: $0.01 + $0.01 + $0.01 = $0.03 (1s total, but simultaneous)
- Same cost, 3x faster!

---

## Pattern 3: Conditional Branching

**Use case:** Different actions based on conditions

```
Trigger → Agent → Condition →┬→ Process A
                              └→ Process B
```

**How it works:**
1. Agent produces output
2. Condition evaluates JavaScript expression
3. Routes to true or false path
4. Each path continues independently

**Example: Lead Scoring**
```
Trigger: New lead data
  ↓
Agent: Extract and analyze lead info
  ↓
Condition: score > 80?
  → Yes: Hot lead path
      ↓
      Agent: Schedule demo
      ↓
      Output: Send to sales team
  → No: Nurture lead path
      ↓
      Agent: Send welcome email
      ↓
      Output: Add to nurture campaign
```

**Implementation:**
1. Add Trigger, Agent nodes
2. Add Condition node
3. Set expression: `result.score > 80`
4. Create two paths from condition
5. Add different agents/outputs to each path
6. Connect and save

**Condition Examples:**
```javascript
// String comparison
result.status === 'approved'

// Number comparison
value > 100

// Multiple conditions
score > 0.5 && score < 1.0

// Array length
items.length > 0

// Type checking
typeof input === 'string'

// Complex logic
(result.priority === 'high') && (result.team === 'sales')
```

**Advantages:**
- Route based on logic
- Handle different cases
- Simple decision making
- Clear branching

**Disadvantages:**
- Only two paths (use nested conditions for more)
- Must connect both paths
- Complex logic gets hard to read

**When to use:**
- Binary decisions
- Different processing paths
- Error handling
- Quality gates

---

## Pattern 4: Looping

**Use case:** Repeat until condition is met

```
Trigger → Agent → Condition → ┌─→ Retry
                  (false)     └←┘
                    ↓
                  (true)
                    ↓
                  Output
```

**How it works:**
1. Agent produces output
2. Condition evaluates
3. If false, loop back to Agent
4. Agent tries again with new input
5. Repeat until true condition

**Example: Data Validation Loop**
```
Trigger: User input
  ↓
Agent: Validate and clean data
  ↓
Condition: Valid?
  → No: Ask user to re-enter (loop)
  → Yes: Continue to processing
```

**Implementation:**
1. Add Trigger node
2. Add Agent node
3. Add Condition node
4. Connect Condition false back to Agent
5. Continue from true path
6. Save

**Example: Retry Pattern**
```
Trigger: Start
  ↓
Agent: Call flaky API
  ↓
Condition: Success?
  → No: Retry (loop back)
  → Yes: Process result
```

**Loop Variables:**
Use Code node to track attempts:
```python
attempts = int(input.get('attempts', 0)) + 1
if attempts > 3:
    raise Exception("Max retries exceeded")
output = {'data': input.data, 'attempts': attempts}
```

**Advantages:**
- Handle retries
- Validate data
- Iterative refinement
- Flexible

**Disadvantages:**
- Infinite loop risk (set max iterations!)
- Hard to debug
- Token usage accumulates
- Cost per retry

**When to use:**
- Need retries
- Data validation
- Iterative refinement
- Self-correcting workflows

**⚠️ Critical:** Add max iteration limit!
```javascript
// In condition, track attempts
attempts < 3  // Only retry 3 times
```

---

## Pattern 5: Error Handling

**Use case:** Gracefully handle failures

```
Trigger → Agent → Condition: Did it fail?
                  ├─ Yes → Error handling
                  └─ No → Continue
```

**How it works:**
1. Try primary action
2. Condition checks for errors
3. If error, route to error handler
4. Error handler fixes or reports

**Example: Error Recovery**
```
Trigger: Data to process
  ↓
Agent: Process data (might fail)
  ↓
Condition: Has error?
  → Yes:
      ↓
      Agent: Generate error report
      ↓
      Output: Send alert
  → No:
      ↓
      Output: Success message
```

**Implementation:**
```javascript
// In agent, return error object
{
  "success": false,
  "error": "API returned 500",
  "data": null
}

// In condition
condition: !result.success  // True if error

// False path goes to error handler
```

**Advantages:**
- Resilient workflows
- Clear error paths
- Can retry or fallback
- User communication

**Disadvantages:**
- More complex
- More branches
- Harder to test all paths

**When to use:**
- Reliability is important
- Want graceful failures
- External API calls
- Production workflows

---

## Pattern 6: Fan-Out/Fan-In (Map-Reduce)

**Use case:** Process collection with multiple agents, then combine

```
Trigger → Code: Split → [Agent1, Agent2, ...] → Merge → Output
                items     (one per item)
```

**How it works:**
1. Code node splits input into items
2. Create Agent for each item
3. All agents process items simultaneously
4. Merge combines results

**Example: Bulk Content Review**
```
Trigger: List of articles
  ↓
Code: Split articles into list
  ↓
Agent (×N): Review each article in parallel
  ↓
Merge: Combine all reviews
  ↓
Output: Generate report
```

**Implementation:**
```python
# Code node: split into items
items = input.split('\n')
for item in items:
    # Queue for processing
    # (actual parallel processing handled by workflow)

# Create multiple Agent nodes connected in parallel
# Each gets one item
```

**Alternative: Loop approach**
```
Code: Get first item
  ↓
Agent: Process item
  ↓
Condition: More items?
  → Yes: Get next, loop back
  → No: Done
```

**Advantages:**
- Process many items fast
- Parallel execution
- Clean split/merge model
- Scalable

**Disadvantages:**
- More complex setup
- Resource intensive
- Hard to debug
- Many parallel agents

**When to use:**
- Process collections
- Batch processing
- Map-reduce tasks
- Parallel analysis

---

## Pattern 7: Channel-in-the-Loop

**Use case:** Workflow pauses to ask human for input

```
Trigger → Agent → Channel Loop: Ask human → Agent → Output
                   (pause)   (you respond)   (resume)
```

**How it works:**
1. Workflow runs normally
2. Channel Loop node pauses
3. Question sent to Claude Code
4. You (in Claude Code) respond
5. Response becomes next node's input
6. Workflow resumes

**Example: Code Review Approval**
```
Trigger: Code to review
  ↓
Agent: Generate review comments
  ↓
Channel Loop: "Approve these changes?"
         (pause - wait for your response)
  ↓
Agent: If approved, merge code
  ↓
Output: Show merge result
```

**Implementation:**
1. Add Channel Loop node
2. Set prompt: "Should we proceed? ${variable}"
3. Connect to agent that uses response
4. Agent accesses response from channel

**Examples:**
```
"Should we schedule for: ${date}?"
"Is this recommendation acceptable? ${recommendation}"
"Do you approve changes to: ${file}?"
```

**Advantages:**
- Human-in-the-loop
- Approval workflows
- Interactive automation
- Context-aware decisions

**Disadvantages:**
- Blocks workflow
- Requires user response
- Can't schedule purely
- Depends on availability

**When to use:**
- Need approvals
- Want human oversight
- Decision workflows
- Important changes

---

## Pattern 8: Knowledge Base Search

**Use case:** Find relevant documents before processing

```
Trigger → Knowledge: Search → Agent: Use context → Output
                      (RAG)
```

**How it works:**
1. Knowledge node searches documents
2. Returns relevant chunks with scores
3. Agent gets search results
4. Agent uses for context in response

**Example: Support Ticket Resolution**
```
Trigger: Customer question
  ↓
Knowledge: Search "Knowledge Base" for "${question}"
  ↓
Agent: "Answer using: ${results}"
  ↓
Output: Send answer to customer
```

**Implementation:**
1. Create knowledge base with docs
2. Add Knowledge node to workflow
3. Set query: "${question}"
4. Connect to Agent
5. Agent prompt: "Use these documents: ${knowledge}"

**Advantages:**
- Accurate, document-based answers
- Current information
- Proper citations
- Consistent with docs

**Disadvantages:**
- Requires knowledge base
- Search costs money (with paid embeddings)
- May not find everything
- Quality depends on documents

**When to use:**
- Have document collection
- Need accurate answers
- Document-based Q&A
- Support/help systems

---

## Pattern 9: Dynamic Routing

**Use case:** Agent chooses next step

```
Trigger → Agent → Agent chooses: "next_node" → Route
                                   (tool call)
```

**How it works:**
1. Agent receives input
2. Agent analyzes and decides next step
3. Agent calls `openconclave_next` tool
4. Specifies which node to go to next
5. Workflow routes accordingly

**Example: Smart Classifier**
```
Trigger: Email "${content}"
  ↓
Agent: "Classify this email and choose:
         - To 'Spam Folder' if spam
         - To 'Urgent' if urgent
         - To 'Follow-up' if needs response"
  ↓
Routes to chosen node
```

**Implementation:**
1. Agent prompt instructs to call `openconclave_next`
2. Agent sees available next node options
3. Agent calls tool with chosen next node
4. Workflow routes accordingly

**Agent prompt example:**
```
Analyze this request and route appropriately:

If urgent: Call openconclave_next("Urgent Handler")
If spam: Call openconclave_next("Spam Filter")
If normal: Call openconclave_next("Standard Process")
```

**Advantages:**
- AI decides routing
- Flexible paths
- No hardcoded conditions
- Intelligent decisions

**Disadvantages:**
- Requires proper prompting
- Can be unreliable
- Hard to debug
- May cost more tokens

**When to use:**
- Complex routing logic
- AI decision making
- Many possible next steps
- Need flexibility

---

## Pattern 10: Scheduled Batch Processing

**Use case:** Run workflow on schedule to process batches

```
Cron Trigger (daily) → Agent: Process batch → Output: Save results
```

**How it works:**
1. Schedule is set on Trigger
2. Trigger automatically fires on schedule
3. Workflow processes a batch of items
4. Results saved or sent

**Example: Daily Report**
```
Cron Trigger: Daily at 9am
  ↓
Agent: Compile analytics for yesterday
  ↓
Agent: Generate report
  ↓
Output: Email to team
```

**Implementation:**
1. Edit Trigger node
2. Change type to "Cron"
3. Select schedule: "Daily 9am" or custom
4. Save and enable

**Cron examples:**
```
0 9 * * *           = Daily at 9am
0 */6 * * *         = Every 6 hours
0 9 * * 1-5         = Weekdays at 9am
0 0 1 * *           = 1st of month
*/30 * * * *        = Every 30 minutes
0 0 * * 0           = Weekly Sunday midnight
```

**Advantages:**
- Fully automated
- No user interaction
- Consistent timing
- Cost predictable

**Disadvantages:**
- No input control
- Scheduled at fixed times
- May need to wait
- Can't manually adjust

**When to use:**
- Regular reports
- Batch processing
- Periodic tasks
- Monitoring jobs

---

## Combining Patterns

**Advanced example: Multi-pattern workflow**

```
Trigger (Cron) → Code: Split items
                    ↓
             [Agent (Parallel)]
                    ↓
                  Merge
                    ↓
              Condition: Quality check
             ↙ (fail)        ↘ (success)
        Retry loop      Channel Loop: Approve?
             ↓            ↙ (no)      ↘ (yes)
          Agent          Error      Agent: Publish
             ↓          Handler        ↓
          Output         Output      Output
```

This workflow:
1. Runs on schedule (Cron Trigger)
2. Splits work in parallel (Fan-out)
3. Merges results (Merge)
4. Checks quality (Condition)
5. Retries if needed (Loop)
6. Asks for approval (Channel)
7. Publishes (Output)

**Advantages:**
- Robust
- Efficient
- Intelligent
- Production-ready

**Disadvantages:**
- Complex
- Hard to debug
- Resource intensive
- Harder to maintain

---

## Tips for Choosing Patterns

**Questions to ask:**
1. Are tasks dependent or independent?
   - Dependent → Sequential
   - Independent → Parallel

2. Do you need decisions?
   - Yes → Conditional branching

3. Do you need to try again?
   - Yes → Looping

4. Do you need human input?
   - Yes → Channel-in-the-loop

5. Do you need documents?
   - Yes → Knowledge base search

6. Do you need agent to decide?
   - Yes → Dynamic routing

7. Do you need scheduling?
   - Yes → Cron trigger

8. Do you need batch processing?
   - Yes → Combine with Code node

---

## Testing Patterns

Before deploying:

1. **Test manually** — Run with test data
2. **Check costs** — Review run details
3. **Monitor timing** — Is it fast enough?
4. **Verify outputs** — Are results correct?
5. **Plan edge cases** — What if something breaks?
6. **Schedule test** — If using cron, verify schedule
7. **Monitor first runs** — Check errors in logs

---

## Next Steps

- 🎯 [Use Cases](11-use-cases.md) — Real-world examples using these patterns
- ⚙️ [Settings](08-settings.md) — Configure for optimization
- 💡 [Troubleshooting](16-troubleshooting.md) — Debug issues

---

**Master these patterns and build any automation you can imagine.** [Back to Index →](README.md)
