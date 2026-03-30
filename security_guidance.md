# Security Guidance for OpenConclave

## Context

OpenConclave is a self-hosted AI agent orchestration platform. Agents execute with real tools (file read/write, bash, web fetch, Playwright) and can be chained in multi-step workflows. This document captures security risks and mitigations relevant to our architecture.

---

## 1. Lessons from OpenClaw

OpenClaw — a similar AI agent platform — has been a case study in what goes wrong when agent security is an afterthought.

### What happened

- **60+ CVEs disclosed** in 2026, including CVSS 9.9 (safeBins bypass) and CVSS 8.8 (gateway URL injection)
- **40,000+ exposed instances** found on the internet; 63% were vulnerable to RCE
- **12% of ClawHub skills were malicious** (341 out of 2,857) — no pre-publication code review
- Key vulnerabilities: command injection (CVE-2026-24763), SSRF (CVE-2026-26322), path traversal (CVE-2026-26329), prompt-injection-driven code execution (CVE-2026-30741)
- Agents connected to Slack, Google Workspace, and other SaaS apps could access OAuth tokens, enabling lateral movement

### Lessons for OpenConclave

| OpenClaw Problem | OpenConclave Mitigation |
|---|---|
| Exposed instances with default credentials | Self-hosted only, no public exposure by design |
| Malicious marketplace skills | No skill marketplace — workflows are local, user-created |
| Agent access to OAuth tokens / SaaS | Agents have only the tools explicitly configured per node |
| No code review for extensions | MCP servers are explicitly registered; no auto-discovery |
| Gateway URL injection from query string | No user-supplied URLs passed to agent internals |

---

## 2. Claude Code Security Risks

OpenConclave runs agents via `claude -p --dangerously-skip-permissions`. This is the highest-risk surface.

### Known risks with `--dangerously-skip-permissions`

- **No permission barriers** — Claude can execute any bash command, delete files, modify system config
- **Config file destruction** — reported cases of Claude overwriting config files with blank values
- **Prompt injection via documents** — hidden text in files can instruct Claude to exfiltrate data via allowed API calls
- **No rollback** — destructive actions have no undo mechanism

### The "Lethal Trifecta" (Simon Willison)

An agent is critically vulnerable when it has all three:
1. **Access to private data** (file system, environment variables, secrets)
2. **Exposure to untrusted content** (web pages, user input, external API responses)
3. **Exfiltration vector** (network access, tool calls to external services)

OpenConclave agents currently have all three when configured with Bash + WebFetch tools.

### Mitigations to implement

- [ ] **Isolated working directory** — agents should not operate in the server's own source directory (we already learned this: agent edits caused server hot-reload crash)
- [ ] **AllowedTools whitelist enforcement** — never give agents more tools than their task requires
- [ ] **Budget limits per agent** — `--max-budget-usd` prevents runaway costs and limits damage window
- [ ] **Read-only mode for review agents** — agents that only review should not have Write/Edit/Bash
- [ ] **Container isolation** — run agents in Docker/devcontainer for production deployments
- [ ] **Secret scrubbing** — strip environment variables and .env content before passing to agents
- [ ] **Output validation** — validate agent outputs before passing to downstream nodes

---

## 3. Multi-Agent Orchestration Risks

### Cascading failures

In a workflow like Planner → Developer → Reviewer → Tester → Committer:
- A compromised Planner can instruct Developer to write malicious code
- Reviewer may not catch it if the prompt injection is subtle
- Committer auto-commits it to the repo

### Prompt injection through data flow

- Node A's output becomes Node B's input (user message)
- If Node A processes untrusted content (web page, user input), that content flows downstream
- A malicious web page could embed instructions that cascade through the entire pipeline

### Agent-to-agent trust

Currently all agents trust input from previous nodes implicitly. There is no validation layer between nodes.

### Mitigations to implement

- [ ] **Input sanitization between nodes** — strip known prompt injection patterns
- [ ] **Privilege boundaries** — different agents should have different permission levels (reviewer = read-only, developer = read-write, committer = git-only)
- [ ] **Human-in-the-loop at critical points** — Channel Loop nodes before destructive actions (commit, deploy)
- [ ] **Output size limits** — prevent memory exhaustion from agents producing enormous outputs
- [ ] **Rate limiting** — limit how many workflows/agents can run concurrently
- [ ] **Audit trail** — all agent actions logged and reviewable (we have this via run events)

---

## 4. Tool-Specific Risks

| Tool | Risk | Mitigation |
|---|---|---|
| **Bash** | Arbitrary command execution, system damage | Sandbox/container, command allowlist |
| **Write/Edit** | Overwrite critical files, inject backdoors | Restrict to working directory, exclude dotfiles |
| **WebFetch** | SSRF, data exfiltration, prompt injection from web content | URL allowlist, response size limits |
| **Playwright** | Navigate to malicious sites, screenshot sensitive data | Restrict to localhost/known domains |
| **Read** | Access secrets, .env files, SSH keys | File path allowlist, exclude sensitive patterns |
| **MCP servers** | Third-party code with full system access | Audit MCP servers, pin versions, no auto-install |

---

## 5. Security Review Workflow Design

A code security review workflow should follow these principles:

### Architecture
```
Trigger → Code Analyzer → [Channel Loop: confirm scope] → Security Reviewer → Vulnerability Classifier → [Channel Loop: review findings] → Report Generator → Output
```

### Agent isolation rules
1. **Code Analyzer** — Read + Grep only, no write access
2. **Security Reviewer** — Read + Bash (for running security tools), no write access
3. **Vulnerability Classifier** — No tools, pure LLM reasoning on input
4. **Report Generator** — Write access only to output directory

### What to scan for
- OWASP Top 10 (injection, broken auth, XSS, SSRF, etc.)
- Hardcoded secrets and credentials
- Dependency vulnerabilities (outdated packages with known CVEs)
- Insecure use of `eval()`, `exec()`, `spawn()` without sanitization
- Missing input validation at system boundaries
- Overly permissive file/network access
- Prompt injection vectors in AI-facing code

---

## 6. OpenConclave-Specific Risks

### Server self-modification
Agents with Write/Edit tools can modify the server's own source code, causing:
- Hot-reload crashes (already experienced)
- Backdoor injection into the orchestration layer
- Configuration tampering

**Mitigation**: Set agent CWD to an isolated workspace, not the project root. Or run in production mode without hot-reload.

### Database access
The SQLite database is in the working directory. An agent with Read could access workflow definitions, API keys in settings, conversation history.

**Mitigation**: Move database to a protected directory outside agent CWD.

### MCP server credentials
MCP server configs may contain API keys or tokens. These are written to temp files and passed to agents.

**Mitigation**: Clean up temp MCP config files immediately after use (already implemented). Ensure temp directory is not readable by other agents.

---

## Sources

- [Claude Code Security Docs](https://code.claude.com/docs/en/security)
- [Claude Code Auto Mode](https://www.anthropic.com/engineering/claude-code-auto-mode)
- [Claude Code --dangerously-skip-permissions Guide](https://www.ksred.com/claude-code-dangerously-skip-permissions-when-to-use-it-and-when-you-absolutely-shouldnt/)
- [Backslash: Claude Code Security Best Practices](https://www.backslash.security/blog/claude-code-security-best-practices)
- [OpenClaw Security Risks (Sangfor)](https://www.sangfor.com/blog/cybersecurity/openclaw-ai-agent-security-risks-2026)
- [OpenClaw Security (Reco.ai)](https://www.reco.ai/blog/openclaw-the-ai-agent-security-crisis-unfolding-right-now)
- [Kaspersky: OpenClaw Vulnerabilities](https://www.kaspersky.com/blog/openclaw-vulnerabilities-exposed/55263/)
- [Cisco: AI Agents Security Nightmare](https://blogs.cisco.com/ai/personal-ai-agents-like-openclaw-are-a-security-nightmare)
- [Trend Micro: What OpenClaw Reveals](https://www.trendmicro.com/en_us/research/26/b/what-openclaw-reveals-about-agentic-assistants.html)
- [OWASP AI Agent Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html)
- [AI Security 2026: Lethal Trifecta](https://airia.com/ai-security-in-2026-prompt-injection-the-lethal-trifecta-and-how-to-defend/)
- [DarkReading: Critical OpenClaw Vulnerability](https://www.darkreading.com/application-security/critical-openclaw-vulnerability-ai-agent-risks)
