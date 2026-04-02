# Knowledge Bases & RAG

Knowledge Bases enable Retrieval Augmented Generation (RAG) — giving your AI agents access to search through your documents for context.

## What is RAG?

RAG = **Retrieval Augmented Generation**

**How it works:**
1. You have documents (PDFs, text files, etc.)
2. Documents are split into chunks and indexed
3. Agent can search for relevant chunks
4. Agent uses chunks as context in its response
5. Agent provides better, more accurate answers

**Why use it:**
- Agents answer based on YOUR documents, not training data
- Up-to-date information (knowledge bases are current)
- Accurate citations and references
- Custom knowledge for specific domains
- Compliance with proprietary information

## Quick Start

### 1. Create a Knowledge Base

**Go to:** Knowledge page → **+ Create Knowledge Base**

**Enter:**
- **Name:** e.g., "Company Handbook", "Atlas Documentation"
- **Description:** What this knowledge base contains
- **Embedding Model:** Select from available (default: nomic-embed-text)

**Click Create**

### 2. Upload Documents

**In the knowledge base:**
1. Click **Upload Files**
2. Select PDF, TXT, MD, or DOCX files
3. Files are processed:
   - Split into chunks
   - Embedded into vectors
   - Indexed for search

**What happens:**
- Files are parsed and split into ~500 token chunks
- Each chunk is embedded using the embedding model
- Stored in the knowledge base
- Ready for agent searches

### 3. Attach to Agent

**In Workflow Editor:**
1. Click Agent node
2. In inspector, scroll to "Knowledge Bases"
3. Check the knowledge base(s) to attach
4. Save workflow

**Result:** Agent automatically gets `search_knowledge` tool

### 4. Use in Workflows

**Agent prompt:**
```
Use the search_knowledge tool to find:
"${query}"

Then answer based on: ${searchResults}
```

**Or simply:**
```
Answer this question using available knowledge bases:
"${question}"
```

Agent will automatically search and use results.

## Knowledge Base Page

![Knowledge](../06-knowledge.png)

### Overview

Shows all your knowledge bases.

**For each knowledge base:**
- Name
- Document count (e.g., "870 docs")
- Chunk count (e.g., "1903 chunks")
- Embedding model used

**Actions:**
- Click to edit/view details
- Click arrow to expand details
- Delete button (⛔) to remove

### Knowledge Base Details

Click a knowledge base to see:
- **Total documents** — Files uploaded
- **Total chunks** — Text segments created
- **Embedding model** — Which model for embeddings
- **Upload date**
- **Documents list:**
  - File name
  - File size
  - Chunks in file
  - Upload time
  - Delete button per file

### Upload Files

Click **Upload Files** to add documents.

**Supported formats:**
- **PDF** (.pdf) — Parsed with text extraction
- **Text** (.txt) — Direct ingestion
- **Markdown** (.md) — Structured text
- **Word** (.docx) — Converted to text
- **More formats** — Coming soon

**File size limits:**
- Individual file: 50 MB
- Total per base: 500 MB (configurable)

**Upload process:**
1. Files are uploaded to server
2. Content extracted and parsed
3. Split into chunks
4. Chunks embedded into vectors
5. Stored in database
4. Ready for search

**Time required:**
- Small files: seconds
- Large files: 1-2 minutes
- Large knowledge bases: 5-10 minutes

## Embedding Models

Embeddings convert text into vectors for semantic search.

### Available Models

**nomic-embed-text** (recommended)
- Fast
- Accurate for most use cases
- Runs locally if Ollama enabled
- Free

**OpenAI embedding** (if configured)
- Highly accurate
- Requires API key
- Costs ~$0.0001 per document

**Ollama embedding models:**
- Local and free
- Requires Ollama running
- Pull model: `ollama pull nomic-embed-text`

### Changing Models

1. Go to Settings
2. Select embedding model
3. Knowledge bases using old model show "needs re-embedding"
4. Click to re-embed with new model

**Cost note:**
- Re-embedding large knowledge bases costs money
- Plan model selection carefully
- Test with small KB first

## Using Knowledge in Workflows

### Search Tool

Agents get automatic `search_knowledge` tool when KB attached.

**Usage in agent:**
```
Use search_knowledge to find documents about ${topic}
```

**Tool returns:**
```json
[
  {
    "document": "handbook.pdf",
    "chunk": "Relevant text excerpt...",
    "score": 0.92
  },
  ...
]
```

### Knowledge Node

Alternatively, use explicit Knowledge node.

**In workflow editor:**
1. Add Knowledge node
2. Select which KB to search
3. Enter search query (can use variables)
4. Output connects to other nodes

**Better for:**
- Standalone search nodes
- Conditional search logic
- Reusable search patterns

### Examples

**Customer support:**
```
Trigger: Customer question "${question}"
   ↓
Knowledge: Search "Company FAQs" for "${question}"
   ↓
Agent: "Answer based on: ${searchResults}"
   ↓
Output: Send to Telegram
```

**Code documentation lookup:**
```
Trigger: "How do I ${task}?"
   ↓
Knowledge: Search "Code Documentation"
   ↓
Agent: "Provide code example for: ${knowledge}"
   ↓
Output: Log with example code
```

**Compliance checking:**
```
Agent: Generate policy document
   ↓
Knowledge: "Search policies for compliance"
   ↓
Condition: Found violations?
   └─ Yes → Output: "Violations found"
   └─ No → Output: "Compliant"
```

## Best Practices

### 1. Organize Documents

**Create separate KBs for:**
- Product documentation
- Company policies
- Code examples
- Research papers
- Training materials

**Naming convention:**
- "Product-Docs-2024"
- "Company-Handbook"
- "CodeSnippets"
- Descriptive, clear names

### 2. Document Quality

**Use clean documents:**
- Remove images (text-only extracts)
- Proofread for OCR errors
- Remove redundant content
- Organize with headers

**Structure:**
- Use clear sections
- Number important items
- Bold key terms
- Use consistent formatting

### 3. Chunk Optimization

Default chunk size: ~500 tokens

**If agents complain:**
- Chunks too small? Chunks missing context
- Chunks too large? Relevance scores suffer
- Adjust in Settings if available

### 4. Update Frequency

**Keep KBs current:**
- Delete old documents when updated
- Re-upload newer versions
- Track modification dates
- Schedule regular reviews

### 5. Test Searches

**Before using in production:**
1. Use Knowledge node standalone
2. Test different queries
3. Check relevance of results
4. Adjust documents if needed
5. Then attach to agents

### 6. Monitor Costs

**Search costs:**
- Embedding: ~$0.0001 per search
- Using free models: $0.00
- Budget depends on search frequency

**Scale considerations:**
- 10,000 documents reasonable
- 100,000 documents still workable
- Search speed depends on size

## Troubleshooting

### Search returns no results

**Issue:** Knowledge node returns empty array

**Causes:**
- No documents uploaded
- Query terms don't match documents
- Documents not processed yet
- Wrong knowledge base selected

**Fix:**
1. Verify documents uploaded in KB details
2. Check document list shows items
3. Try simpler search query
4. Wait for processing to complete
5. Check knowledge base is attached to agent

### Slow searches

**Issue:** Knowledge search takes 10+ seconds

**Causes:**
- Very large knowledge base
- Complex queries
- Server overloaded
- Network latency

**Fix:**
1. Split large KB into smaller ones
2. Use simpler queries
3. Close other applications
4. Check network speed
5. Reduce total documents

### Wrong or irrelevant results

**Issue:** Search returns unrelated documents

**Causes:**
- Poor chunk boundaries
- Similar terms in different contexts
- Poor document quality
- Embedding model limitations

**Fix:**
1. Improve document quality
2. Re-organize documents
3. Try different queries
4. Use more specific search terms
5. Check embedding model

### Can't upload file

**Issue:** File upload fails

**Causes:**
- File too large (>50 MB)
- Unsupported format
- Corrupted file
- Server out of disk space

**Fix:**
1. Check file size
2. Use supported format (PDF, TXT, MD, DOCX)
3. Try smaller file
4. Check server disk space

### Documents disappeared

**Issue:** Documents no longer in KB

**Causes:**
- Accidentally deleted
- Knowledge base deleted
- Database corruption
- Sync issues

**Prevention:**
1. Backup important KBs
2. Export documents
3. Create copy of KB before major changes

## Advanced Usage

### Multi-KB Searches

Search multiple knowledge bases:

```
Trigger: "${query}"
   ↓
Knowledge1: Search "Product Docs"
   ↓
Knowledge2: Search "Company Policies"
   ↓
Merge: Combine results
   ↓
Agent: "Answer using: ${merged}"
```

### Filtered Searches

Search only specific documents:

```
Agent: 
  Search knowledge for "${query}"
  Filter to documents after 2024-01-01
  Return top 3 results
```

### Re-ranking Results

Use agent to re-rank search results:

```
Knowledge: Get top 10 matches for "${query}"
   ↓
Agent: "Re-rank by relevance: ${results}"
   ↓
Condition: Top result score > 0.8?
   └─ Yes → Use result
   └─ No → Ask human or fail
```

## Integration with Agents

### Claude Agent

Claude automatically uses search_knowledge tool.

**Prompt:**
```
Use the knowledge bases to answer: "${question}"
Be specific and cite documents.
```

**Claude will:**
- Automatically search KBs
- Find relevant documents
- Use in response
- Cite sources

### Ollama Agent

Ollama also gets search_knowledge tool via MCP bridge.

**Prompt:**
```
Search knowledge bases for: "${topic}"
Return top 5 most relevant documents
```

### OpenAI-Compatible

All providers support knowledge base searching.

Works the same as Claude.

## Monitoring & Analytics

### Knowledge Base Stats

In Knowledge page:
- Total documents
- Total chunks
- Creation date
- Last modified
- Size

### Usage Tracking

Monitor in Settings:
- Knowledge searches per day
- Average search time
- Embedding costs
- Popular KBs

## Exporting Knowledge

### Export as JSON

```json
{
  "knowledge_base": "Company Handbook",
  "documents": [
    {
      "name": "handbook.pdf",
      "chunks": [
        {"text": "...", "embedding": [...]}
      ]
    }
  ]
}
```

### Export Documents

Right-click knowledge base → Export documents

Downloads originals as ZIP.

## Next Steps

- ⚙️ [Settings & Configuration](08-settings.md)
- 🤖 [AI Providers Guide](09-ai-providers.md)
- 💡 [Common Patterns](10-patterns.md)

---

**Knowledge bases unlock intelligent, document-aware workflows.** [Back to Index →](README.md)
