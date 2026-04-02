# Real-World Use Cases

Complete examples of workflows for common automation needs.

## 1. Content Generation Pipeline

**Workflow:** Blog post generation with review and publishing

```
Trigger: Topic + keywords
  ↓
Agent1: Generate outline
  ↓
Agent2: Write sections (parallel)
  ↓
Merge: Combine sections
  ↓
Agent3: Polish and review
  ↓
Channel Loop: "Approve for publishing?"
  ↓
Output: Save to blog system
```

**Cost:** ~$0.05-0.15 per post
**Time:** ~30-60 seconds
**Best Agent:** Claude Sonnet

**Implementation:**
```
Trigger (manual):
  - Prompt: "Topic for blog post?"
  - Output: ${topic}

Agent1 (Outline):
  - Prompt: "Create outline for: ${topic}"
  - Model: Claude Haiku (fast)

Agent2-3 (Sections - parallel):
  - Prompt: "Write section about: ${section}"
  - Multiple agents, one per section

Merge: Combine all sections

Agent3 (Polish):
  - Prompt: "Polish this article and add SEO: ${merged}"
  - Model: Claude Sonnet

Channel Loop:
  - Prompt: "Publish this article? ${article}"

Output:
  - Type: Webhook
  - Send to: Your blogging API
```

**Variations:**
- Add fact-checking agent
- Add image generation agent
- Add social media post generator
- Schedule daily posts

---

## 2. Code Review Automation

**Workflow:** Analyze code and suggest improvements

```
Trigger: GitHub PR
  ↓
Agent1: Security review (parallel)
Agent2: Performance review
Agent3: Code style review
  ↓
Merge: Combine reviews
  ↓
Condition: Found critical issues?
  ├─ Yes: Priority review needed
  └─ No: Standard review
```

**Cost:** ~$0.02-0.10 per PR
**Time:** ~10-30 seconds
**Best Agent:** Claude Sonnet

**Implementation:**
```
Trigger (webhook):
  - From: GitHub webhooks
  - Payload: PR code

Agent1 (Security):
  - Tools: [read, grep]
  - Prompt: "Security review of: ${code}"
  - Knowledge: Attach security guidelines

Agent2 (Performance):
  - Prompt: "Performance issues in: ${code}"

Agent3 (Style):
  - Prompt: "Code style issues in: ${code}"

Merge: Combine all three reviews

Condition: critical_issues > 0?
  
Output:
  - Type: GitHub comment
  - Post review on PR
```

**Requirements:**
- GitHub webhook configured
- Read access to PR code
- Knowledge base with coding standards

---

## 3. Customer Support Agent

**Workflow:** 24/7 support for common questions

```
Trigger: Customer question (email/chat)
  ↓
Knowledge: Search FAQ database
  ↓
Agent: Generate response using docs
  ↓
Condition: Found good answer?
  ├─ Yes: Send response
  └─ No: Escalate to human
```

**Cost:** ~$0.001-0.01 per query
**Time:** ~2-5 seconds
**Best Agent:** Claude Haiku

**Implementation:**
```
Trigger (webhook or Telegram):
  - From: Your support email/chat
  - Input: Customer question

Knowledge:
  - Base: "FAQ and Help"
  - Query: ${question}
  - Top K: 5 results

Agent:
  - Prompt: "Answer this question: ${question}
            Use these docs: ${knowledge}
            Be helpful and specific"
  - Model: Claude Haiku (cheap)

Condition:
  - Expression: confidence > 0.8
  
Output (yes path):
  - Type: Email/Chat
  - Send: Generated answer

Output (no path):
  - Type: Email
  - Send: "Escalating to human..."
```

**Knowledge base content:**
- FAQ documents
- Support documentation
- Troubleshooting guides
- Company policies

---

## 4. Data Processing Pipeline

**Workflow:** Extract, transform, load data

```
File: Load CSV
  ↓
Code: Parse and validate
  ↓
Agent: Transform with AI
  ↓
Code: Format for database
  ↓
Output: Save to database
```

**Cost:** ~$0.01-0.05 per file
**Time:** ~5-15 seconds
**Best Agent:** Claude Haiku

**Implementation:**
```
File:
  - Path: "data/raw_input.csv"

Code (Python):
  ```python
  import csv
  import json
  rows = csv.DictReader(input_data)
  return json.dumps(list(rows))
  ```

Agent:
  - Prompt: "Standardize and clean this data: ${parsed}"
  - Tools: None needed

Code (Python):
  ```python
  data = json.loads(input_data)
  # Transform for database
  return json.dumps(transformed)
  ```

Output:
  - Type: Webhook
  - Send to: Database API
```

---

## 5. Report Generation

**Workflow:** Daily automated reports

```
Cron Trigger: Daily 8am
  ↓
Code: Fetch data from sources
  ↓
Agent: Analyze and summarize
  ↓
Agent: Generate report text
  ↓
Output: Email to team
```

**Cost:** ~$0.02-0.10 per report
**Time:** ~10-30 seconds
**Best Agent:** Claude Sonnet
**Frequency:** Daily

**Implementation:**
```
Trigger (Cron):
  - Schedule: "0 8 * * *" (8am daily)

Code:
  - Tools: [bash]
  - Fetch: Analytics, metrics, data

Agent1:
  - Prompt: "Analyze this data: ${data}"

Agent2:
  - Prompt: "Write executive summary: ${analysis}"

Output:
  - Type: Email
  - To: team@company.com
  - Subject: "Daily Report - ${date}"
```

**Customizations:**
- Multiple report types
- Different distributions
- Different schedules (weekly, monthly)
- Add charts/images

---

## 6. Lead Scoring

**Workflow:** Score and route leads

```
Trigger: New CRM lead
  ↓
Agent: Score lead quality
  ↓
Condition: Score > 80?
  ├─ High value: Add to sales
  └─ Low value: Nurture sequence
```

**Cost:** ~$0.001-0.01 per lead
**Time:** ~2-5 seconds
**Best Agent:** Claude Haiku

**Implementation:**
```
Trigger (webhook from CRM):
  - Input: Lead data

Agent:
  - Prompt: "Score this lead 0-100: ${lead_data}
            Consider: budget, need, timeline
            Return: {'score': N, 'reason': '...'}"

Condition:
  - Expression: score >= 80

Output (hot):
  - Type: Webhook
  - Send to: Sales team system

Output (warm):
  - Type: Email
  - Send nurture campaign
```

---

## 7. Document Summarization

**Workflow:** Summarize long documents

```
File: Load document
  ↓
Agent: Extract key points
  ↓
Agent: Create summary
  ↓
Output: Save summary
```

**Cost:** ~$0.01-0.10 per document
**Time:** ~10-30 seconds
**Best Agent:** Claude Sonnet (for quality)

**Implementation:**
```
File:
  - Path: documents/*.pdf
  
Agent1:
  - Prompt: "Extract 5-10 key points from: ${content}"

Agent2:
  - Prompt: "Create 1-page summary from: ${points}"

Output:
  - Type: File
  - Path: "summaries/summary.txt"
```

---

## 8. Email/Chat Triage

**Workflow:** Sort and route incoming messages

```
Trigger: Email/Chat
  ↓
Agent: Classify message
  ↓
Condition: Message type?
  ├─ Sales: Route to sales
  ├─ Support: Route to support
  └─ Urgent: Escalate to manager
```

**Cost:** ~$0.001 per message
**Time:** <1 second
**Best Agent:** Claude Haiku

**Implementation:**
```
Trigger (Email/Chat):
  - Webhook from email service

Agent:
  - Prompt: "Classify this message:
            'sales', 'support', 'feedback', 'urgent'"
  - Model: Haiku (fast, cheap)

Condition:
  - Type: switch (multiple outputs)
  - Routes: sales, support, urgent, etc.

Output nodes:
  - Each routes to appropriate team/system
```

---

## 9. Research & Competitive Analysis

**Workflow:** Research a topic with web search

```
Trigger: Topic to research
  ↓
Agent: Search web for information
  ↓
Agent: Analyze and summarize
  ↓
Output: Research report
```

**Cost:** ~$0.05-0.20 per research
**Time:** ~30-60 seconds (includes web search)
**Best Agent:** Claude Sonnet

**Implementation:**
```
Trigger (manual):
  - Prompt: "Topic to research?"

Agent1:
  - Tools: [web_search]
  - Prompt: "Search for information about: ${topic}"

Agent2:
  - Prompt: "Analyze and summarize findings: ${research}"

Output:
  - Type: Log or File
  - Content: Full research report
```

---

## 10. Multi-Language Translation

**Workflow:** Translate content to multiple languages

```
Trigger: Text to translate
  ↓
Agent1: Translate to Spanish (parallel)
Agent2: Translate to French
Agent3: Translate to German
  ↓
Merge: Combine translations
  ↓
Output: Save all versions
```

**Cost:** ~$0.01-0.05 per translation
**Time:** ~5-10 seconds (parallel)
**Best Agent:** Claude Haiku

**Implementation:**
```
Trigger (manual):
  - Prompt: "Text to translate?"
  - Input: ${text}

Agent1:
  - Prompt: "Translate to Spanish: ${text}"

Agent2:
  - Prompt: "Translate to French: ${text}"

Agent3:
  - Prompt: "Translate to German: ${text}"

Merge:
  - Combines all three translations

Output:
  - Type: File or Webhook
  - Format: { spanish, french, german }
```

---

## 11. Expense Approval Workflow

**Workflow:** Approve business expenses

```
Trigger: Expense submission
  ↓
Agent: Validate expense
  ↓
Condition: Valid?
  ├─ No: Reject
  └─ Yes: Next approval
  ↓
Channel Loop: Manager approval
  ↓
Agent: Process approved expense
  ↓
Output: Send confirmation
```

**Cost:** ~$0.01-0.05 per expense
**Time:** Depends on human response
**Best Agent:** Claude Haiku

---

## 12. Security Threat Analysis

**Workflow:** Analyze potential security threats

```
Trigger: Security event
  ↓
Agent1: Extract indicators (parallel)
Agent2: Check threat database
Agent3: Assess impact
  ↓
Merge: Combine analysis
  ↓
Condition: Severity?
  ├─ Critical: Alert security team immediately
  ├─ High: Log and review
  └─ Low: Archive
```

**Cost:** ~$0.02-0.10 per analysis
**Best Agent:** Claude Sonnet (security expertise)
**Time:** ~10-20 seconds

---

## Starting Your Own Use Case

**Steps to implement any use case:**

1. **Identify the flow:**
   - Input → Processing → Output
   - Are steps sequential or parallel?

2. **Map to node types:**
   - Trigger → How does it start?
   - Agents → What decisions/processing?
   - Conditions → Any branching?
   - Output → Where do results go?

3. **Design the workflow:**
   - Sketch on paper or Miro
   - Test with simple example
   - Add error handling

4. **Implement:**
   - Create nodes
   - Write prompts
   - Configure agents
   - Test with real data

5. **Monitor:**
   - Check costs
   - Monitor execution time
   - Verify outputs
   - Optimize prompts

6. **Deploy:**
   - Enable scheduling if needed
   - Set up monitoring
   - Document for team
   - Consider backups

---

## Cost Examples

| Use Case | Per-Run | Frequency | Monthly |
|----------|---------|-----------|---------|
| Content Generation | $0.10 | 1x/day | $3 |
| Code Review | $0.05 | 10x/day | $15 |
| Support (Haiku) | $0.001 | 100x/day | $3 |
| Report | $0.05 | 1x/day | $1.50 |
| Lead Scoring | $0.005 | 50x/day | $7.50 |
| **Total** | - | - | ~$30 |

---

## Next Steps

- 💡 [Common Patterns](10-patterns.md) — Learn workflow design patterns
- ⚙️ [Settings](08-settings.md) — Configure for your use case
- 🎯 [Troubleshooting](16-troubleshooting.md) — Debug issues

---

**Ready to build? Pick a use case and start automating!** [Back to Index →](README.md)
