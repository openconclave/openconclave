# 02 — Re-review verification

**Conclave**: 9 "Code Review" (`oc_review`)
**Runs this entry covers**: 46, 47
**No code commits this arc** — just a stress test of the write-back loop

## Objective

After manually applying the 12 fixes from entry 01, re-run the same reviews to check:

1. Do my fixes hold? (Did the blockers drop out of the findings list?)
2. Did the write-back loop actually compound? (Do new runs cite the lessons captured in earlier runs as `[KB hit]`?)
3. Does a richer KB surface new findings the first pass missed?

All three questions got strong "yes" answers.

## Runs

**Run 46 — llm-call.ts (re-review after fix pass)**

- 4 of my 9 applied fixes were cited as `[KB hit]` in Best Practices — "confirmed correct". Specifically: abort-controller wiring, minimal-env allowlist, no-magic-strings / `DYNAMIC_TOOLS_MCP_NAME` extraction, canonical-types import (indirect).
- **But** the specialists found **three new blockers** that my first fix pass missed:
  1. **CVE-backed IPv4-mapped IPv6 SSRF bypass in my own `isPublicHttpUrl`.** I blocked IPv4 RFC1918 and pure IPv6 loopback, but missed the IPv4-in-IPv6 notation (`[::ffff:127.0.0.1]`, `[::ffff:169.254.169.254]`). Same class as CVE-2026-26324. Best Practices found it by explicitly searching for CVEs against URL-validator patterns — exactly the kind of search I wouldn't think to do while focused on "make the fix work".
  2. **OpenAI `JSON.parse(tc.function.arguments)` still unguarded.** Flagged as minor in run 45, promoted to blocker in run 46. Same finding, different severity — specialist noise.
  3. **`jsonSchemaToZod` depth limit set to 20, but the captured lesson mandated ≤10.** I over-set the constant vs. what the write-back lesson from run 45 had specified. The specialist caught the cross-reference.

**Run 47 — runtime.ts (re-review after fix pass)**

- 3 of my fixes cited as `[KB hit]` — including my `buildSubprocessEnv()` allowlist, cited approvingly.
- Two more real blockers surfaced:
  1. **Error-path early return silently drops `routingState.routeTo`.** Non-success result subtypes (`error_max_turns`, etc.) return without copying `routingState` into the result. If an agent routes and then hits the turn limit, the routing decision is permanently lost.
  2. **`resolveCliPath` TOCTOU EPERM on honest concurrent race.** My `mode: 0o700` fix closed the adversarial case; this was the honest concurrent case (two processes resolving the same content hash simultaneously → second `renameSync` throws EPERM → catch returns the unresolvable bunfs path).

## Observations

**Finding counts going up across re-runs is the healthy signal, not failure.**

- Run 44 (first runtime.ts review): 10 findings
- Run 47 (re-review): 11 findings, different composition

More findings the second time around means the KB got richer and specialists learned to look for more patterns. Two new lessons written back after run 45 (`lesson-depth-limit-user-controlled-recursion`, `lesson-zod-max-agent-tool-inputs`) were cited by specialists in run 47 as the basis for catching things they'd missed on the first pass.

**The write-back loop is real.** Best Practices captured 6 new lessons across runs 44–47:

- `lesson-claude-agent-sdk-abort-controller-in-options`
- `lesson-minimal-env-for-agent-subprocesses`
- `lesson-tmpdir-mkdir-owner-only-mode`
- `lesson-no-tool-nudging-descriptions`
- `lesson-no-magic-strings-extract-constants`
- `lesson-import-canonical-types-no-local-forks`

Plus 5 more in the re-runs:
- `lesson-depth-limit-user-controlled-recursion`
- `lesson-zod-max-agent-tool-inputs`
- `lesson-validate-db-stored-urls-before-fetch`
- `lesson-ssrf-ipv4-mapped-ipv6-bypass` (**the CVE one — caught in my own fix**)
- `lesson-openai-tool-call-json-parse-guard`

**Best Practices catches things humans miss.** I wrote the SSRF guard by hand, thought I covered the bases, and introduced a CVE-class bypass. A Sonnet agent doing targeted security research on URL validators found it and captured a lesson about it. Net result: the KB is now explicitly smarter than me on this specific class of bug.

## What wasn't great

- **Specialist non-determinism between runs.** Run 45 flagged something as minor, run 46 flagged the same thing as blocker. Lead Reviewer is supposed to normalize this but can't fully — severity creep between sessions is a real risk.
- **Severity inflation over time.** The write-back loop growing the KB naturally makes every finding feel more important. Needs a calibration mechanism or the review will eventually flag everything as a blocker.
- **"Function hoisting" hallucination in run 47**: one specialist generated a nonsense reason ("safe — isAcceptableOllamaUrl is a regular function declaration, hoisted") for skipping the IPv4-mapped IPv6 finding. The Lead Reviewer caught it but didn't always produce a clean dedup. Real model reliability issue.

## Conclusions

The write-back loop works. Re-reviewing a fixed file catches new bugs because the KB is richer. This is the demo-able, defensible "why OC" answer.

But: I can't keep manually cherry-picking 12-finding batches from review files. Next arc: build a conclave that reads a review file and applies the fixes **skeptically**.

## Next

Entry 03: designing and building `oc_review_fix`, and discovering that its first run hit a much deeper bug than the one it was meant to fix.
