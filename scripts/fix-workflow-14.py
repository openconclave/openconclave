"""Fix workflow #14 problems:
1. Setup: add marker file write (.oc-active-worktree.json)
2. Teardown: read from marker file instead of parsing agent text output
3. Agent prompts: replace CONTEXT:{...} with marker file reference
4. Developer prompts: add package.json warning (Pitfall 6)
5. Tester prompts: add mock leakage warning (Pitfall 7)
"""
import json, re, os

with open("logs/workflow-14.json", encoding="utf-8") as f:
    wf = json.load(f)

nodes = wf["definition"]["nodes"]
edges = wf["definition"]["edges"]

MARKER = "cat C:/Users/beine/source/repos/openconclave/.oc-active-worktree.json"
changes = []

for n in nodes:
    nid = n["id"]

    # === FIX 1: Setup - add marker file write ===
    if nid == "setup":
        old = n["data"]["config"]["code"]
        old_print = 'print(json.dumps({"worktreePath": worktree, "branch": branch, "featureName": feature_name, "planContent": plan, "repoPath": repo}))'
        new_lines = [
            'context = {"worktreePath": worktree, "branch": branch, "featureName": feature_name, "planContent": plan, "repoPath": repo}',
            '',
            '# Write marker file so all agents and teardown can find the worktree',
            'marker = os.path.join(repo, ".oc-active-worktree.json")',
            "with open(marker, 'w') as mf:",
            '    json.dump({"worktreePath": worktree, "branch": branch, "featureName": feature_name, "repoPath": repo}, mf)',
            '',
            'print(json.dumps(context))',
        ]
        new_print = "\n".join(new_lines)
        if old_print in old:
            n["data"]["config"]["code"] = old.replace(old_print, new_print)
            changes.append("setup: added marker file write")
        else:
            changes.append("setup: WARNING - print line not found")
        continue

    # === FIX 2: Teardown - read marker file ===
    if nid == "teardown":
        teardown_lines = [
            "import json, sys, os, subprocess",
            "",
            "data = json.load(sys.stdin)",
            'repo = r"C:\\Users\\beine\\source\\repos\\openconclave"',
            'marker = os.path.join(repo, ".oc-active-worktree.json")',
            "",
            'wt = br = feat = ""',
            "",
            "# Read context from marker file written by setup node",
            "if os.path.exists(marker):",
            "    with open(marker) as f:",
            "        ctx = json.load(f)",
            '    wt = ctx.get("worktreePath", "")',
            '    br = ctx.get("branch", "")',
            '    feat = ctx.get("featureName", "")',
            "    os.remove(marker)",
            "",
            'result = {"branch": br, "featureName": feat, "worktreePath": wt}',
            "DEVNULL = subprocess.DEVNULL",
            "",
            "if wt and os.path.exists(wt):",
            '    subprocess.run(["git", "add", "-A"], cwd=wt, stdout=DEVNULL, stderr=DEVNULL)',
            '    msg = "feat: " + feat + chr(10) + chr(10) + "Automated by OC dev workflow"',
            '    commit = subprocess.run(["git", "commit", "-m", msg], cwd=wt, capture_output=True, text=True)',
            "    if commit.returncode != 0:",
            '        result["commitNote"] = commit.stderr.strip()',
            '    push = subprocess.run(["git", "push", "-u", "origin", br], cwd=wt, capture_output=True, text=True)',
            "    if push.returncode != 0:",
            '        result["pushError"] = push.stderr.strip()',
            '    pr = subprocess.run(["gh", "pr", "create", "--title", "feat: " + feat, "--body", "Automated PR from OpenConclave dev workflow."], cwd=wt, capture_output=True, text=True)',
            '    result["prUrl"] = pr.stdout.strip()',
            "    if pr.returncode != 0:",
            '        result["prError"] = pr.stderr.strip()',
            "else:",
            '    result["error"] = "Worktree not found: " + wt',
            "",
            "print(json.dumps(result))",
        ]
        n["data"]["config"]["code"] = "\n".join(teardown_lines)
        changes.append("teardown: rewritten to use marker file + error handling")
        continue

    # === FIX 3: Agent prompts ===
    if n.get("type") != "agent":
        continue

    sp = n["data"]["config"]["systemPrompt"]
    original = sp

    # Remove CONTEXT output blocks (explorers)
    sp = re.sub(
        r"\nEnd output with this exact JSON block on its own line so the next agent has context:\nCONTEXT:\{[^\n]*\}",
        "",
        sp,
    )
    sp = re.sub(r"\nEnd with: CONTEXT:\{[^\n]*\}", "", sp)

    # Remove "Preserve" lines (various formats)
    sp = re.sub(
        r"\nPreserve (?:the )?CONTEXT:\{[^\}]*\} JSON line(?:\s+from previous agent's output)?\.?",
        "",
        sp,
    )
    sp = re.sub(r"\nPreserve CONTEXT:\{[^\}]*\} JSON line\.?", "", sp)

    # Replace CONTEXT references in cd instructions
    sp = sp.replace(
        "cd to worktreePath (find it in CONTEXT:{...} in input)",
        "cd to worktreePath (run: `" + MARKER + "`)",
    )
    sp = sp.replace(
        "cd to worktreePath (find in CONTEXT:{...})",
        "cd to worktreePath (run: `" + MARKER + "`)",
    )

    # For non-explorer agents with bare "cd to worktreePath"
    if "explorer" not in nid and MARKER not in sp:
        sp = re.sub(
            r"(cd to (?:the )?worktreePath)\b(?!\s*\()",
            r"\1 (run: `" + MARKER + "`)",
            sp,
        )

    # Developer: add package.json warning (Pitfall 6)
    if "developer" in nid and "package.json" not in sp:
        sp = sp.replace(
            "VERDICT:READY_FOR_REVIEW",
            "Do NOT modify package.json or bun.lock. Note needed deps in output instead.\n\nEnd output with: VERDICT:READY_FOR_REVIEW",
        )

    # Tester: add mock leakage warning (Pitfall 7)
    if "tester" in nid and "restoreAllMocks" not in sp:
        if "Run `bun test`" in sp:
            sp = sp.replace(
                "Run `bun test`",
                "Add afterEach(() => { vi.restoreAllMocks() }) to prevent mock leakage\n6. Run `bun test`",
            )
        elif "Run tests" in sp:
            sp = sp.replace(
                "Run tests",
                "Add afterEach(() => { vi.restoreAllMocks() }) to prevent mock leakage\n6. Run tests",
            )

    # Clean up excess newlines
    sp = re.sub(r"\n{3,}", "\n\n", sp)
    sp = sp.strip()

    if sp != original:
        n["data"]["config"]["systemPrompt"] = sp
        changes.append(f"{nid}: prompt updated")
    else:
        changes.append(f"{nid}: no changes needed")

# Write the fixed workflow body
body = {"nodes": nodes, "edges": edges}
with open("logs/workflow-14-fixed.json", "w", encoding="utf-8") as f:
    json.dump(body, f, ensure_ascii=False)

print("=== CHANGES ===")
for c in changes:
    print(f"  {c}")
print(f"\nWritten to logs/workflow-14-fixed.json ({os.path.getsize('logs/workflow-14-fixed.json')} bytes)")
