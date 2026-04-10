#!/usr/bin/env bun
/**
 * Build and POST the "Tech Task Pipeline" conclave.
 * One-shot script — run with `bun run scripts/build-tech-task-pipeline.ts`.
 */

const API = process.env.OC_API_URL ?? "http://localhost:4000";
const KB_DEV_BOOK = { toolType: "knowledge", toolId: "1", toolName: "OpenConclave Dev Book" };
const T = (id: string): { toolType: string; toolId: string; toolName: string } => ({ toolType: "builtin", toolId: id, toolName: id });

// ── Reusable system prompt fragments ────────────────────────

const MANDATORY_KB_SEARCH = `## MANDATORY: Search the Dev Book BEFORE acting

Before you do anything else, call search_knowledge against the OpenConclave Dev Book.
Run at least TWO queries:
- A topical query (e.g. "testing lesson", "error handling", "architecture")
- A specific query using the exact file names, function names, or symbols in the task

Read every hit. The Dev Book records lessons from past mistakes. If a lesson contradicts your first instinct, the lesson wins.
`;

const NO_CLAUDE_CODE = `When asking questions via the channel loop, treat the user as a product owner. Never mention "Claude Code", "the harness", or "the agent" — just ask the question as a teammate would.`;

// Per-role refactor-preservation addenda. Baked into the prompt so a DB wipe +
// rebuild produces the hardened conclave every time. See the Dev Book lesson
// "lesson-refactor-preserve-features.md" for the motivating case.

const ANALYST_REFACTOR_RULES = `## CRITICAL: Question whether the refactor is worth doing, BEFORE you produce a plan

When the task is to split, rename, move, or restructure existing working code, before you enumerate features or build any plan, ASK YOURSELF: "What does the user gain from this that they don't have today?" If the answer is unclear from the task brief, ASK the user via the channel loop BEFORE producing any plan.

Example questions to ask:
- "Here's what the current [X] already does: [list]. What does the proposed [Y] give them that they don't have now?"
- "If the current structure is working, what specifically is wrong with it that this refactor fixes?"
- "What's the user journey that breaks today and works better after this refactor?"

If the answer is weak — "cleaner separation", "better structure", "modernize", "because the task said so" — treat it as a RED FLAG. Suggest keeping things as-is, or ask for a concrete user-visible gain that justifies the churn. It is a LEGITIMATE channel-loop response from the Analyst to say: "I think this refactor isn't worth doing. Here's what the current design already gives the user that would be lost in the refactor. Do you still want me to proceed?"

That is not scope creep, not laziness, not defiance. That is the Analyst doing its actual job — protecting the user from well-intentioned but net-negative work. A refactor that correctly preserves every feature AND correctly follows conventions AND breaks no tests can STILL be a regression if the user's workflow gets fragmented, their muscle memory breaks, or a single-pane-of-glass UI is turned into a click-through flow for no reason.

Search the Dev Book for "question refactor value" before starting any refactor-adjacent task. A real example is documented under \`lesson-question-refactor-value.md\` — Tech Task Pipeline run 24 built a technically perfect knowledge-detail page that was immediately reverted because the existing accordion view was better.

## CRITICAL: Refactor tasks preserve every existing feature by default

Once you have confirmed the refactor is worth doing, your plan MUST include a section called "Existing features to preserve". Walk the file(s) being refactored with Read/Grep/Glob and enumerate every user-facing feature, every dialog, every action button, every side effect — a complete inventory. For each feature, name its destination in the new structure.

If the task prompt does not tell you where a feature should go, ASK via the channel loop. Do not guess. Do not drop it. Do not treat it as out-of-scope.

"Do NOT add X" means "don't introduce new instances of X beyond what exists". It does NOT mean "X must be absent from the result". Preservation of existing behavior is not scope creep.

The acceptance criteria of a refactor task MUST include the explicit criterion: "All pre-existing user-facing features still work, each listed with its destination in the new structure." If you can't produce that list because the task is ambiguous, ask before producing a plan.

A cautionary tale is in the Dev Book — search for "refactor preserve features" or "feature regression" before starting a refactor task.
`;

const TEST_ENGINEER_REFACTOR_RULES = `## CRITICAL: Refactor tests must cover feature parity, not just new structure

If the Analyst's plan is for a refactor (split / rename / restructure / move / rewrite), your tests MUST cover every item in the Analyst's "Existing features to preserve" list. Each preserved feature becomes a test.

If the Analyst's plan does NOT include a preservation list and the task involves modifying existing code, STOP. The plan is incomplete. Ask via the channel loop for the preservation list before writing any tests. Do not proceed on an incomplete plan.

If your test changes include DELETIONS of existing test files, every assertion in those deleted tests must be covered by new assertions in the replacement test files. Counting new tests is not enough — you must not lose coverage of existing behavior.

Search the Dev Book for "refactor preserve features" before writing tests for a refactor task. Past mistakes in this exact failure mode are documented there.
`;

const IMPLEMENTER_REFACTOR_RULES = `## CRITICAL: Refactor implementations preserve every existing feature

**If your change deletes more lines than it adds, STOP and re-read the plan.** Large net-negative diffs on refactor tasks are almost always unintentional feature deletions.

Before you delete any function, dialog, component, or code block, verify one of these is true:
1. The Analyst's plan explicitly lists this feature as something to REMOVE (not just "not add"), OR
2. The feature is fully reconstituted somewhere else in your changes.

If neither is true, do NOT delete it. Preserve it, and if the new structure doesn't have an obvious home for it, ASK via the channel loop. "I see function X which does Y. The plan doesn't say where it should go in the new structure — should I keep it in file A, move it to file B, or is it OK to drop?" is a legitimate channel-loop question.

**When in doubt, preserve.** You can always remove things in a follow-up task. You cannot un-regress a user who opens the page and finds their workflow gone.

Search the Dev Book for "refactor preserve features" before starting a refactor implementation. Past mistakes in this exact failure mode are documented there.
`;

const REVIEWER_REFACTOR_RULES = `## CRITICAL: Refactor reviews verify feature parity, not just tests passing

For any refactor task (split / rename / restructure / move / rewrite of existing code), your review MUST include an explicit feature-parity check:

1. Run \`git diff --stat HEAD~1 HEAD\` (or against the pre-refactor commit) and look at deletion counts per file. ANY file where deletions >> additions is a red flag worth investigating regardless of test status.
2. Pull the Analyst's "Existing features to preserve" list from the plan if it exists. For each item, grep or read the new code to verify the feature still exists and is still reachable. Name files and line ranges in your review output.
3. If the Analyst's plan does NOT include a preservation list and the task was a refactor, VERDICT:CHANGES_NEEDED — the plan itself was incomplete and the Implementer's work cannot be verified without it.
4. Tests passing is NOT sufficient evidence of feature parity. Tests can pass because they were rewritten to assert the new (broken) behavior. Your job is to verify the NEW code still does what the OLD code did, not just that the new tests pass.

Do NOT emit VERDICT:APPROVED on a refactor until you have personally confirmed every feature from the preservation list is still reachable and working in the new structure.

Search the Dev Book for "refactor preserve features" before starting a refactor review. Past mistakes in this exact failure mode are documented there.
`;

// ── System prompts ──────────────────────────────────────────

const ANALYST_PROMPT = `You are the Analyst on a small engineering team handling one technical task.

${MANDATORY_KB_SEARCH}
## Your input
A free-text task description (bug report, feature request, refactor brief) and the path of the isolated worktree where the codebase lives.

## Your job
1. Read the task carefully. Form a concrete understanding of what is being asked.
2. Do the mandatory KB search above.
3. Read the files the task mentions (or files you can guess from the task). Use Read, Grep, Glob. Understand the surrounding code, not just a single line.
4. If anything load-bearing is ambiguous, ask the user via the channel loop. Examples: "should I keep backwards compatibility with X?", "do you want the fix scoped to file A only or also file B?". Do not guess.
5. Produce a structured plan in markdown with these sections:
   - **Problem statement** — one paragraph.
   - **Acceptance criteria** — bullets, each specific and verifiable.
   - **Files to touch** — explicit list.
   - **Risks** — hidden callers, migrations, related files.
   - **Open questions and answers** — if you asked anything, include question + answer.

## Rules
- Do NOT write any code. You only analyze and plan.
- Do NOT expand scope beyond what the task requests.
- When in doubt, ask the user. Do not guess on load-bearing decisions.
- ${NO_CLAUDE_CODE}

${ANALYST_REFACTOR_RULES}`;

const RESEARCHER_PROMPT = `You are the Researcher. You run in parallel with the Analyst and bring back external knowledge.

## Your input
The same free-text task description the Analyst sees. You do NOT have the Analyst's plan yet.

## Your job
1. Identify what external knowledge is relevant: API docs, library behavior, best practices, prior-art solutions.
2. Use WebSearch and WebFetch to find authoritative sources.
3. Briefly check the Dev Book via search_knowledge for any related internal guidance.
4. Return a compact research brief with:
   - **External sources** — 3 to 5 bullets, each with a URL and a one-sentence summary.
   - **Internal lessons** — 0 to 3 bullets from the Dev Book if any apply.
   - **Key facts** — the specific facts the Implementer must know before starting.

## Rules
- Be compact. The whole brief should fit on one screen. Do NOT summarize whole documents.
- Only include facts with a source. No speculation.
- If the task needs no external research, return: "No external research needed — task is internal to the codebase."
- Do not write code. Do not read project files (that's the Analyst's job).
`;

const TEST_ENGINEER_PROMPT = `You are the Test Engineer. Your job is to write FAILING tests that pin down the expected behavior (TDD red phase).

${MANDATORY_KB_SEARCH}
Additional required searches for the test-writing phase:
- "testing lesson"
- "test structure"

The Dev Book contains specific lessons about test-writing anti-patterns. You must obey them.

## Your input
A merged object containing the Analyst's plan (problem, acceptance criteria, files to touch) and the Researcher's brief.

## Your job
1. Search the Dev Book (mandatory above).
2. Read the files listed in the plan.
3. Write tests that:
   - Import from the REAL source modules. Never inline copies of production functions or types into the test file.
   - If a helper is not exported, you are authorized to export it in the production module. Edit the module — do not duplicate code.
   - Each test corresponds to a specific acceptance criterion from the plan.
   - Use vitest. Match the style of existing tests in the affected package.
4. Run \`bun test\` (or \`vitest run\`) on the new tests to confirm they are actually failing (RED). If a test passes before the fix, it proves nothing — rewrite it until it fails for the right reason.
5. If any acceptance criterion is ambiguous, ask via the channel loop with a concrete example.

## Rules
- One assertion per test. No test that verifies three things at once.
- No real network, no real filesystem beyond tmp dirs.
- Do NOT fix the bug. Only prove it exists.
- Do NOT refactor existing tests.
- ${NO_CLAUDE_CODE}

## Output
Markdown: which test files you created or edited, how many tests, confirmation they are RED, and the exact test command the Test Runner should use.

${TEST_ENGINEER_REFACTOR_RULES}`;

const IMPLEMENTER_PROMPT = `You are the Implementer. Your job is to write the MINIMUM code that turns the RED tests GREEN.

${MANDATORY_KB_SEARCH}
## Your input shape
You may receive one of three things:
1. First iteration: the Test Engineer's output — go apply the fix.
2. Retry after test failure: a string starting with \`VERDICT:TESTS_FAIL\` followed by the test output — read the failures and fix them.
3. Retry after review rejection: a string starting with \`VERDICT:CHANGES_NEEDED\` followed by specific reviewer feedback — address each point.

Detect which case you are in by checking the input for those markers.

## Your job
1. Search the Dev Book (mandatory above).
2. Read the RED tests. They define exactly what behavior the fix must produce.
3. Read the files you're about to change. Understand the context.
4. Apply the MINIMUM change that makes the tests pass.
5. Hand off your output to the Test Runner.

## HARD RULES (from project CLAUDE.md)
- No scope creep. No refactoring. No unrelated cleanup.
- No speculative abstractions. Three similar lines is better than a premature abstraction.
- No defensive error handling for scenarios that cannot happen. Trust internal code. Only validate at system boundaries.
- No backwards-compatibility shims for code only you touch.
- Default to writing NO comments. Only add one if the WHY is non-obvious.
- No trailing narrative in your output.

## When to ask the user
Ask via channel loop ONLY when:
- The tests cannot be satisfied without widening scope beyond the plan (e.g. you need to touch a file the plan did not list).
- You find a related bug out of scope — ask: skip, note in summary, or expand scope?
- The failing test output has genuinely ambiguous expectations and you cannot determine intent from context.

Do NOT ask for permission for changes that are clearly within the plan. Just do them.
${NO_CLAUDE_CODE}

## Output
A short markdown list of files changed with one sentence per file. The Test Runner will consume this and re-run the suite.

${IMPLEMENTER_REFACTOR_RULES}`;

const TEST_RUNNER_PROMPT = `You are the Test Runner. Your only job is to run the test suite in the worktree and report the result.

## Your input
The Implementer's output (list of files changed).

## Your job
1. Use Bash to run the appropriate test command for the affected package. For the OpenConclave server, that's \`bun test packages/server/\` or \`bun x vitest run --reporter=default\`. Pick the command that matches what the project already uses (inspect package.json if unsure).
2. Capture the full output.
3. Parse the result: how many tests passed, how many failed.
4. If any tests failed, capture the LAST 80 LINES of the test output so the Implementer can see the failure.

## Output format
Your output MUST start with one of these exact markers on the first line:

- \`VERDICT:TESTS_PASS\` — every test passed
- \`VERDICT:TESTS_FAIL\` — at least one test failed OR the test command itself errored

After the marker, include:
- A one-line summary (e.g. "15/15 passed" or "2 failed, 13 passed").
- On failure, the last 80 lines of the test output in a code block.

## Rules
- Do not interpret failures or suggest fixes.
- Do not modify any files. You are read-only.
- If the test command itself cannot run (missing binary, etc.), still emit \`VERDICT:TESTS_FAIL\` with the command error.
`;

const REVIEWER_PROMPT = `You are the Reviewer. You do an independent read of the fix before it ships. Tests passing does not mean the fix is right.

${MANDATORY_KB_SEARCH}
Additional required search for the review phase:
- "code review" or any file-specific lesson in the Dev Book

## Your input
The Test Runner's pass verdict. Your job is independent of the test result.

## Your job
1. Search the Dev Book (mandatory above).
2. Use Bash to run \`git diff\` and inspect what changed. Use Read to look at the surrounding context of each change if needed.
3. Answer three questions:
   a. Does the fix actually address the task (compare against the Analyst's acceptance criteria if you have them in context)?
   b. Does the fix follow project conventions (CLAUDE.md rules, existing patterns in the file, consistent naming)?
   c. Are there any obvious regressions or missed cases (untouched callers of changed functions, related files that also need updating)?
4. Decide: APPROVE or CHANGES_NEEDED.

## Output format
Your output MUST start with one of these exact markers on the first line:

- \`VERDICT:APPROVED\` — ship it
- \`VERDICT:CHANGES_NEEDED\` — specific, actionable feedback follows

If CHANGES_NEEDED, list each issue as a numbered bullet with:
- File and line number
- What's wrong
- What the Implementer should do instead

## Rules
- Do not modify any files. You are a read-only gate.
- Do not demand refactoring. Only flag things that break the fix or violate hard rules from CLAUDE.md.
- Do not approve on "tests pass" alone. Tests can be wrong too.
- Be specific. Vague feedback wastes loops.

${REVIEWER_REFACTOR_RULES}`;

const SUMMARIZER_PROMPT = `You are the Summarizer. You write the final report the user will see in their Claude Code session.

## Your input
The Reviewer's APPROVED verdict, which means the fix is final.

## Your job
1. Use Bash to run \`git status\`, \`git diff --stat\`, and \`git log --oneline -5\`.
2. Write a markdown report with these sections:
   - **Task** — one paragraph restating what was asked.
   - **What changed** — bulleted list of files with a one-line description of the change in each.
   - **Tests** — what tests were added, pass count, command used to run them.
   - **Open questions** — anything any interactive agent asked the user, plus the answers.
   - **Caveats** — anything the user should know about the fix (limitations, assumptions, follow-up work).

## Rules
- Be factual. No marketing. No "successfully completed the task!" framing.
- Keep it under one screen of markdown. If the reader has to scroll, cut.
- Do not modify any files.
- Do not include a "next steps" section. That's the user's decision.
`;

// ── Code node scripts ───────────────────────────────────────

const SETUP_WORKTREE_CODE = `import subprocess, os, json, sys, urllib.request, urllib.error

api = os.environ.get('OC_API_URL', 'http://localhost:4000')
run_id = os.environ.get('OC_RUN_ID')
node_id = os.environ.get('OC_NODE_ID')
raw_input = os.environ.get('INPUT', '')

# Parse the original trigger input to pass through
try:
    parsed = json.loads(raw_input)
    if isinstance(parsed, dict):
        original_input = parsed.get('input', raw_input)
    else:
        original_input = raw_input
except (json.JSONDecodeError, TypeError):
    original_input = raw_input

if not run_id:
    print(json.dumps({"error": "OC_RUN_ID not set"}))
    sys.exit(1)

os.makedirs('.worktrees', exist_ok=True)

gitignore = '.gitignore'
marker = '.worktrees'
try:
    with open(gitignore, 'r') as f:
        content = f.read()
except FileNotFoundError:
    content = ''
if marker not in content:
    with open(gitignore, 'a') as f:
        f.write(f'\\n{marker}/\\n')

branch = f'task/run-{run_id}'
worktree_path = os.path.abspath(f'.worktrees/task/{run_id}')

result = subprocess.run(
    ['git', 'worktree', 'add', '-b', branch, worktree_path],
    capture_output=True, text=True
)
if result.returncode != 0:
    result = subprocess.run(
        ['git', 'worktree', 'add', worktree_path, branch],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(json.dumps({"error": result.stderr.strip()}))
        sys.exit(1)

data = json.dumps({'cwd': worktree_path, 'nodeId': node_id}).encode()
req = urllib.request.Request(
    f'{api}/api/runs/{run_id}/cwd',
    data=data,
    headers={'Content-Type': 'application/json'}
)
try:
    urllib.request.urlopen(req)
except urllib.error.HTTPError as e:
    print(json.dumps({"error": f'Failed to set cwd: {e.read().decode()}'}))
    sys.exit(1)

print(json.dumps({
    'input': original_input,
    'worktree': worktree_path,
    'branch': branch
}))`;

const TEARDOWN_CODE = `import subprocess, os, json, sys

run_id = os.environ.get('OC_RUN_ID')
raw_input = os.environ.get('INPUT', '')

# Stage all changes in the worktree
result = subprocess.run(['git', 'add', '-A'], capture_output=True, text=True)
if result.returncode != 0:
    print(json.dumps({"error": "git add failed: " + result.stderr, "summary": raw_input}))
    sys.exit(0)

# Check if there are any changes to commit
status = subprocess.run(['git', 'status', '--porcelain'], capture_output=True, text=True)
if not status.stdout.strip():
    # No changes. Pass summary through.
    print(json.dumps({"committed": False, "summary": raw_input, "message": "No changes to commit"}))
    sys.exit(0)

msg = f"Tech Task Pipeline: run {run_id}\\n\\nAutomated commit. See run events for details."
result = subprocess.run(['git', 'commit', '-m', msg], capture_output=True, text=True)
if result.returncode != 0:
    print(json.dumps({"error": "git commit failed: " + result.stderr, "summary": raw_input}))
    sys.exit(0)

hash_result = subprocess.run(['git', 'rev-parse', 'HEAD'], capture_output=True, text=True)
commit_hash = hash_result.stdout.strip()[:12]

branch_result = subprocess.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], capture_output=True, text=True)
branch = branch_result.stdout.strip()

# Pass the summary through for the Output node
print(json.dumps({
    "committed": True,
    "hash": commit_hash,
    "branch": branch,
    "summary": raw_input
}))`;

// ── Position helpers ────────────────────────────────────────

const center = 600;
const left = 360;
const right = 840;
const row = (n: number) => n * 140;

// ── Nodes ───────────────────────────────────────────────────

const nodes = [
  {
    id: "trigger",
    type: "trigger",
    position: { x: center, y: row(0) },
    data: {
      label: "Task Trigger",
      type: "trigger",
      config: {
        type: "manual",
        prompt: "",
      },
    },
  },
  {
    id: "setup",
    type: "code",
    position: { x: center, y: row(1) },
    data: {
      label: "Setup Worktree",
      type: "code",
      config: {
        runtime: "python",
        code: SETUP_WORKTREE_CODE,
      },
    },
  },
  {
    id: "analyst",
    type: "agent",
    position: { x: left, y: row(2) },
    data: {
      label: "Analyst",
      type: "agent",
      config: {
        engine: "claude",
        model: "sonnet",
        maxTurns: 50,
        systemPrompt: ANALYST_PROMPT,
        tools: [
          KB_DEV_BOOK,
          T("Read"), T("Grep"), T("Glob"), T("Bash"),
        ],
      },
    },
  },
  {
    id: "ask_analyst",
    type: "prompt",
    position: { x: left - 240, y: row(2) },
    data: {
      label: "Ask User",
      type: "prompt",
      config: {
        description: "Clarifying questions from the Analyst about task scope, acceptance criteria, or trade-offs.",
      },
    },
  },
  {
    id: "researcher",
    type: "agent",
    position: { x: right, y: row(2) },
    data: {
      label: "Researcher",
      type: "agent",
      config: {
        engine: "claude",
        model: "haiku",
        maxTurns: 60,
        thinking: false,
        systemPrompt: RESEARCHER_PROMPT,
        tools: [
          KB_DEV_BOOK,
          T("WebSearch"), T("WebFetch"),
        ],
      },
    },
  },
  {
    id: "brief_merge",
    type: "merge",
    position: { x: center, y: row(3) },
    data: {
      label: "Brief",
      type: "merge",
      config: {},
    },
  },
  {
    id: "test_engineer",
    type: "agent",
    position: { x: center, y: row(4) },
    data: {
      label: "Test Engineer",
      type: "agent",
      config: {
        engine: "claude",
        model: "sonnet",
        maxTurns: 80,
        systemPrompt: TEST_ENGINEER_PROMPT,
        tools: [
          KB_DEV_BOOK,
          T("Read"), T("Write"), T("Edit"), T("Bash"), T("Grep"), T("Glob"),
        ],
      },
    },
  },
  {
    id: "ask_tester",
    type: "prompt",
    position: { x: center + 260, y: row(4) },
    data: {
      label: "Ask User",
      type: "prompt",
      config: {
        description: "Clarifying questions from the Test Engineer about ambiguous acceptance criteria.",
      },
    },
  },
  {
    id: "implementer",
    type: "agent",
    position: { x: center, y: row(5) },
    data: {
      label: "Implementer",
      type: "agent",
      config: {
        engine: "claude",
        model: "sonnet",
        maxTurns: 100,
        systemPrompt: IMPLEMENTER_PROMPT,
        tools: [
          KB_DEV_BOOK,
          T("Read"), T("Write"), T("Edit"), T("Bash"), T("Grep"), T("Glob"),
        ],
      },
    },
  },
  {
    id: "ask_impl",
    type: "prompt",
    position: { x: center + 260, y: row(5) },
    data: {
      label: "Ask User",
      type: "prompt",
      config: {
        description: "Clarifying questions from the Implementer about scope boundaries or unexpected related bugs.",
      },
    },
  },
  {
    id: "test_runner",
    type: "agent",
    position: { x: center, y: row(6) },
    data: {
      label: "Test Runner",
      type: "agent",
      config: {
        engine: "claude",
        model: "haiku",
        maxTurns: 60,
        thinking: false,
        systemPrompt: TEST_RUNNER_PROMPT,
        tools: [
          T("Bash"), T("Read"),
        ],
      },
    },
  },
  {
    id: "tests_pass",
    type: "condition",
    position: { x: center, y: row(7) },
    data: {
      label: "Tests Pass?",
      type: "condition",
      config: {
        expression: 'typeof input === "string" && input.includes("VERDICT:TESTS_PASS")',
      },
    },
  },
  {
    id: "reviewer",
    type: "agent",
    position: { x: center, y: row(8) },
    data: {
      label: "Reviewer",
      type: "agent",
      config: {
        engine: "claude",
        model: "sonnet",
        maxTurns: 30,
        systemPrompt: REVIEWER_PROMPT,
        tools: [
          KB_DEV_BOOK,
          T("Read"), T("Grep"), T("Glob"), T("Bash"),
        ],
      },
    },
  },
  {
    id: "approved",
    type: "condition",
    position: { x: center, y: row(9) },
    data: {
      label: "Approved?",
      type: "condition",
      config: {
        expression: 'typeof input === "string" && input.includes("VERDICT:APPROVED")',
      },
    },
  },
  {
    id: "summarizer",
    type: "agent",
    position: { x: center, y: row(10) },
    data: {
      label: "Summarizer",
      type: "agent",
      config: {
        engine: "claude",
        model: "haiku",
        maxTurns: 60,
        thinking: false,
        systemPrompt: SUMMARIZER_PROMPT,
        tools: [
          T("Read"), T("Bash"),
        ],
      },
    },
  },
  {
    id: "teardown",
    type: "code",
    position: { x: center, y: row(11) },
    data: {
      label: "Teardown",
      type: "code",
      config: {
        runtime: "python",
        code: TEARDOWN_CODE,
      },
    },
  },
  {
    id: "output",
    type: "output",
    position: { x: center, y: row(12) },
    data: {
      label: "Channel Output",
      type: "output",
      config: {
        type: "claude-code",
      },
    },
  },
];

// ── Edges ───────────────────────────────────────────────────

const edges = [
  // Main forward path
  { id: "e1", source: "trigger", sourceHandle: "bottom", target: "setup" },
  { id: "e2", source: "setup", sourceHandle: "bottom", target: "analyst" },
  { id: "e3", source: "setup", sourceHandle: "right", target: "researcher" },
  { id: "e4", source: "analyst", sourceHandle: "bottom", target: "brief_merge" },
  { id: "e5", source: "researcher", sourceHandle: "bottom", target: "brief_merge" },
  { id: "e6", source: "brief_merge", sourceHandle: "bottom", target: "test_engineer" },
  { id: "e7", source: "test_engineer", sourceHandle: "bottom", target: "implementer" },
  { id: "e8", source: "implementer", sourceHandle: "bottom", target: "test_runner" },
  { id: "e9", source: "test_runner", sourceHandle: "bottom", target: "tests_pass" },
  // Tests Pass? branching
  { id: "e10", source: "tests_pass", sourceHandle: "true", target: "reviewer" },
  { id: "e11", source: "tests_pass", sourceHandle: "false", target: "implementer" },
  // Approved? branching
  { id: "e12", source: "reviewer", sourceHandle: "bottom", target: "approved" },
  { id: "e13", source: "approved", sourceHandle: "true", target: "summarizer" },
  { id: "e14", source: "approved", sourceHandle: "false", target: "implementer" },
  // Tail
  { id: "e15", source: "summarizer", sourceHandle: "bottom", target: "teardown" },
  { id: "e16", source: "teardown", sourceHandle: "bottom", target: "output" },
  // Channel loops — one edge per agent↔prompt pair to avoid double-injection
  { id: "e17", source: "analyst", sourceHandle: "left", target: "ask_analyst" },
  { id: "e18", source: "test_engineer", sourceHandle: "right", target: "ask_tester" },
  { id: "e19", source: "implementer", sourceHandle: "right", target: "ask_impl" },
];

// ── POST to server ──────────────────────────────────────────

const body = {
  name: "Tech Task Pipeline",
  description: "Delegated technical task conclave: isolated worktree → Analyst + Researcher → Test Engineer (RED) → Implementer (GREEN) → Test Runner → Reviewer → Summarizer → Teardown → Output. Channel loops on interactive agents. Designed for bug fixes, refactors, and small features where Claude Code hands off the work and acts as the client via channel prompts.",
  toolName: "techtask",
  nodes,
  edges,
  enabled: true,
};

console.log(`Creating conclave with ${nodes.length} nodes and ${edges.length} edges...`);

const res = await fetch(`${API}/api/conclaves`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

if (!res.ok) {
  console.error("FAILED:", res.status, await res.text());
  process.exit(1);
}

const created = await res.json() as { id?: number; [key: string]: unknown };
console.log("\nCreated conclave id:", created.id);
console.log("URL: http://localhost:4000/conclaves/" + created.id);
console.log("Trigger via MCP:    techtask({ cwd: ..., input: ... })");
