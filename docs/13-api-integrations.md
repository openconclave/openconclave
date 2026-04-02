# API & Integrations Guide

Connect OpenConclave with external systems and services.

## Integration Types

### 1. MCP Tools

Model Context Protocol tools that workflows can access.

**Available Tools:**
- **Bash** — Run shell commands
- **Read** — Read files
- **Write** — Write/create files
- **Edit** — Edit file contents
- **Grep** — Search files
- **Web Search** — Search the internet
- **Playwright** — Browser automation
- **Telegram** — Send messages
- **Fetch** — Make HTTP requests
- **WebSearch** — Search web

**Configured in:** Settings → AI Providers

**Used in:** Agent nodes automatically get access

### 2. Webhooks

External systems trigger workflows or receive results.

**Types:**
- **Incoming Webhooks** — External system triggers workflow
- **Outgoing Webhooks** — Workflow sends data to external system

#### Incoming Webhooks

**Use for:** External systems triggering workflows

**Example: GitHub Push → Workflow**
```
GitHub → Push event → Webhook URL
              ↓
        OpenConclave Workflow starts
              ↓
         Process code changes
```

**To trigger via webhook:**

1. Create Trigger with type: Webhook
2. Copy webhook URL
3. External system POSTs to this URL
4. Payload becomes workflow input

**Example cURL:**
```bash
curl -X POST https://openconclave/api/webhooks/abc123 \
  -H "Content-Type: application/json" \
  -d '{"event":"push","branch":"main"}'
```

#### Outgoing Webhooks

**Use for:** Send workflow results to external systems

**In Output node:**
- Type: Webhook
- URL: External API endpoint
- Method: POST, PUT, or PATCH
- Headers: Custom headers
- Body: JSON payload

**Example:**
```
Workflow Output Node:
  Type: Webhook
  URL: https://your-app.com/api/results
  Body: { "status": "${status}", "data": "${data}" }
```

### 3. File I/O

Read from and write to files on disk.

**Read Files:**
1. Use File node in workflow
2. Specify file path
3. Content becomes node input
4. Next agent uses content

**Write Files:**
1. Use Output node with type: File
2. Specify output path
3. Workflow results saved

**Use cases:**
- Load configuration files
- Read templates
- Save reports
- Process CSV/JSON files

### 4. External APIs

Use Code nodes to call external APIs.

**Example: Call REST API**
```python
import requests
import json

response = requests.post(
    'https://api.example.com/endpoint',
    headers={'Authorization': f'Bearer {token}'},
    json={'data': input_data}
)

result = response.json()
return json.dumps(result)
```

### 5. Email Integration

Send workflow results via email.

**Method 1: Output Node**
- Type: Email (if configured)
- To: Email address
- Subject: Customizable
- Body: Workflow results

**Method 2: Code Node**
```python
import smtplib
from email.mime.text import MIMEText

msg = MIMEText(input_data)
msg['Subject'] = 'Workflow Result'
msg['From'] = 'workflows@company.com'
msg['To'] = 'user@company.com'

# Send via SMTP
```

### 6. Telegram Integration

Already covered in [Settings](08-settings.md) and [Telegram](15-telegram.md)

### 7. Database Integration

Connect to databases for read/write operations.

**Method: Code Node**

**PostgreSQL Example:**
```python
import psycopg2
import json

conn = psycopg2.connect(
    "dbname=mydb user=postgres password=secret"
)
cur = conn.cursor()
cur.execute("INSERT INTO results (data) VALUES (%s)", 
            (json.dumps(input_data),))
conn.commit()
cur.close()
conn.close()

return json.dumps({"status": "saved"})
```

**MongoDB Example:**
```python
from pymongo import MongoClient
import json

client = MongoClient('mongodb://localhost:27017/')
db = client['mydb']
collection = db['results']
result = collection.insert_one(input_data)

return json.dumps({"id": str(result.inserted_id)})
```

## Common Integration Patterns

### Pattern: Poll External Data

```
Cron Trigger: Every hour
  ↓
Code: Fetch from API
  ↓
Agent: Process results
  ↓
Output: Save or send
```

**Implementation:**
```python
# Code node
import requests

response = requests.get(
    'https://api.data-source.com/latest',
    headers={'api-key': 'your-key'}
)

return response.text
```

### Pattern: Receive External Event

```
Webhook Trigger: GitHub Push
  ↓
Agent: Analyze changes
  ↓
Output: Post comment on GitHub
```

**GitHub Webhook Setup:**
1. GitHub Settings → Webhooks
2. Payload URL: Your webhook URL
3. Events: Push, Pull Request, etc.
4. Active: ✓

### Pattern: Update External System

```
Trigger: Manual
  ↓
Agent: Process data
  ↓
Output: Webhook to Slack
```

**Output Configuration:**
```
Type: Webhook
URL: https://hooks.slack.com/services/YOUR/WEBHOOK/URL
Method: POST
Body: {
  "text": "Workflow complete: ${status}",
  "status": "${status_code}"
}
```

### Pattern: Sync Data Between Systems

```
Trigger: Daily cron
  ↓
Code: Fetch from source
  ↓
Code: Transform format
  ↓
Code: Push to destination
```

## Specific Integrations

### GitHub

**Integration:** Webhook trigger + API output

**Setup:**
1. Repository Settings → Webhooks
2. Add webhook with your URL
3. Select events: Push, PR, etc.
4. Workflow receives push events

**Send results back:**
- Use Code node with GitHub API
- Create comments, issues, etc.

### Slack

**Send messages:**
```
Output: Webhook
URL: Your Slack incoming webhook
Body: { "text": "Message here" }
```

**Receive/trigger:**
- Use Telegram as bridge
- Or webhook from Slack API

### Jira

**Create issues:**
```
Output: Webhook
URL: https://your-jira.com/rest/api/3/issue
Headers: { "Authorization": "Bearer token" }
Body: {
  "fields": {
    "project": {"key": "PROJ"},
    "summary": "${summary}",
    "description": "${description}"
  }
}
```

### Notion

**Add to database:**
```python
import requests
import json

data = {
  "parent": {"type": "database_id", "database_id": "..."},
  "properties": {
    "Name": {"title": [{"text": {"content": input_data}}]},
    "Status": {"select": {"name": "Done"}}
  }
}

response = requests.post(
  "https://api.notion.com/v1/pages",
  headers={"Authorization": "Bearer " + token},
  json=data
)
```

### Zapier

**Connect via webhooks:**
1. Create Zapier Zap
2. Use webhook trigger
3. Point to OpenConclave workflow URL
4. Trigger workflows from Zapier

## API Security

### Protecting Your Webhooks

**Current state:**
- Webhooks are public URLs
- Anyone with URL can trigger

**Best practices:**
1. Use unguessable IDs
2. Validate payloads
3. Use HTTPS
4. Rate limit if possible
5. Monitor access logs

**In Code node:**
```python
# Verify webhook signature
import hmac
import hashlib

signature = request.headers.get('X-Webhook-Signature')
expected = hmac.new(
    b'your-secret',
    msg=request.body,
    digestmod=hashlib.sha256
).hexdigest()

if not hmac.compare_digest(signature, expected):
    raise Exception("Invalid signature")
```

### API Keys Security

**Storage:**
- Store in Settings (encrypted)
- Never in code
- Never in logs

**Access:**
```python
import os
api_key = os.environ.get('API_KEY_NAME')
```

**Rotation:**
1. Create new key in provider
2. Update in OpenConclave Settings
3. Test with new key
4. Delete old key

### Rate Limiting

**Prevent abuse:**
- Use Code node to add delays
- Implement exponential backoff
- Check provider rate limits

```python
import time

for attempt in range(3):
    try:
        response = make_api_call()
        break
    except RateLimitError:
        wait_time = 2 ** attempt  # Exponential backoff
        time.sleep(wait_time)
```

## Testing Integrations

### Test Webhook

**Use curl:**
```bash
curl -X POST https://your-webhook-url \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'
```

**Check Run Details:**
1. Go to Runs page
2. Find the workflow run
3. View logs and outputs

### Test External API

**In Code node:**
```python
import requests

response = requests.get('https://api.example.com')
print(f"Status: {response.status_code}")
print(f"Response: {response.text}")

return response.text
```

**Check output in Run Details**

### Monitor Integration Health

**Dashboard:**
- Check Run Distribution
- Monitor for failures
- Track costs

**Logs:**
- Go to Runs page
- Check Events Timeline
- Look for API errors

## Troubleshooting

### Webhook not triggering

**Issue:** External system calls webhook but workflow doesn't run

**Causes:**
- Wrong URL
- Wrong method (not POST)
- Firewall blocking
- Payload format wrong

**Fix:**
1. Test with curl
2. Check firewall rules
3. Verify payload format
4. Check server logs

### API call fails

**Issue:** Code node can't reach external API

**Causes:**
- API down
- Wrong URL
- Wrong authentication
- Network issues

**Fix:**
1. Test API with curl
2. Verify credentials
3. Check network
4. Use try/except in Code node

### Results not saved

**Issue:** Output node webhook doesn't send data

**Causes:**
- Webhook URL wrong
- External system not accepting
- Payload format wrong
- Rate limited

**Fix:**
1. Test webhook URL directly
2. Check external system logs
3. Verify payload format
4. Add error handling

## Next Steps

- 💡 [Common Patterns](10-patterns.md)
- 🎯 [Use Cases](11-use-cases.md)
- 🔐 [Security](17-security.md)

---

**Integrations unlock unlimited possibilities.** [Back to Index →](README.md)
