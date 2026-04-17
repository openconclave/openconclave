import { describe, test, expect } from "bun:test";
import { createBuiltinTools, runBash } from "../builtin-tools";
import { Workspace } from "../../engine/workspace";
import { writeFileSync, mkdtempSync, unlinkSync, symlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function makeWorkspace(): Workspace {
  return new Workspace(mkdtempSync(join(tmpdir(), "oc-builtin-test-")));
}

// ── bash: env allowlist ─────────────────────────────────────

describe("runBash: env allowlist", () => {
  test("blocks ANTHROPIC_API_KEY from leaking into subprocess", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-SHOULD-NOT-LEAK";
    try {
      const ws = makeWorkspace();
      const result = await runBash('echo "key=$ANTHROPIC_API_KEY"', ws.cwd);
      expect(result).not.toContain("sk-ant-test-SHOULD-NOT-LEAK");
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  test("blocks DATABASE_URL", async () => {
    const saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://user:hunter2@host/db";
    try {
      const ws = makeWorkspace();
      const result = await runBash('echo "db=$DATABASE_URL"', ws.cwd);
      expect(result).not.toContain("hunter2");
    } finally {
      if (saved === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = saved;
    }
  });

  test("passes PATH through", async () => {
    const ws = makeWorkspace();
    const result = await runBash("echo \"has=$PATH\"", ws.cwd);
    expect(result).toContain("has=");
    expect(result.length).toBeGreaterThan("has=".length);
  });
});

// ── bash: timeout ───────────────────────────────────────────

describe("runBash: timeout", () => {
  test("kills a command that exceeds the budget", async () => {
    const ws = makeWorkspace();
    const start = Date.now();
    // `exec` replaces bash with sleep so proc.kill() hits sleep directly.
    // Without exec, on Windows the kill only terminates bash.exe and sleep.exe
    // survives until its natural duration.
    const result = await runBash("exec sleep 10", ws.cwd, { timeoutMs: 500 });
    const elapsed = Date.now() - start;
    expect(result).toContain("timed out");
    expect(elapsed).toBeLessThan(5_000);
  }, 10_000);

  test("subsequent run after a timeout is not blocked", async () => {
    const ws = makeWorkspace();
    // If the previous timeout leaked a reader lock or a zombie process, a quick
    // follow-up run might hang or fail. This guards against M6 regressing.
    await runBash("exec sleep 10", ws.cwd, { timeoutMs: 300 });
    const ok = await runBash("echo still-alive", ws.cwd, { timeoutMs: 5_000 });
    expect(ok).toContain("still-alive");
  }, 15_000);
});

// ── bash: output cap ────────────────────────────────────────

describe("runBash: output cap", () => {
  test("truncates stdout over the cap", async () => {
    const ws = makeWorkspace();
    // Generate ~16KB of output, cap at 1KB.
    const result = await runBash(
      'for i in $(seq 1 1000); do echo "line $i xxxxxxxxxxxxxxxxxxxx"; done',
      ws.cwd,
      { outputCapBytes: 1024 },
    );
    expect(result).toContain("truncated");
  }, 10_000);

  test("large stderr does not deadlock (concurrent drain)", async () => {
    const ws = makeWorkspace();
    // ~200KB of stderr — well past the 64KB pipe buffer. Sequential drain
    // would deadlock here. Promise.all must drain both streams.
    const result = await runBash(
      'for i in $(seq 1 2000); do echo "err $i xxxxxxxxxxxxxxxxxxxx" >&2; done; echo done',
      ws.cwd,
      { timeoutMs: 10_000 },
    );
    expect(result).toContain("done");
  }, 15_000);
});

// ── bash: failure surfaces both streams ─────────────────────

describe("runBash: failure output", () => {
  test("includes both stdout and stderr on non-zero exit", async () => {
    const ws = makeWorkspace();
    const result = await runBash("echo stdout-line; echo stderr-line >&2; exit 3", ws.cwd);
    expect(result).toContain("exit 3");
    expect(result).toContain("stdout-line");
    expect(result).toContain("stderr-line");
  });
});

// ── bash tool: empty command ────────────────────────────────

describe("bash tool: arg validation", () => {
  test("empty string command returns error (not a subprocess call)", async () => {
    const ws = makeWorkspace();
    const tools = createBuiltinTools(ws);
    const result = await tools.bash!.execute({ command: "" });
    expect(result).toContain("Error");
    expect(result).toContain("command is required");
  });

  test("non-string command returns error", async () => {
    const ws = makeWorkspace();
    const tools = createBuiltinTools(ws);
    const result = await tools.bash!.execute({ command: 42 });
    expect(result).toContain("Error");
  });
});

// ── read_file: path containment + size cap ──────────────────

describe("read_file: containment", () => {
  test("accepts a path inside the workspace", async () => {
    const ws = makeWorkspace();
    const p = join(ws.cwd, "inside.txt");
    writeFileSync(p, "hello");
    try {
      const tools = createBuiltinTools(ws);
      const result = await tools.read_file!.execute({ path: "inside.txt" });
      expect(result).toBe("hello");
    } finally {
      unlinkSync(p);
    }
  });

  test("rejects absolute path outside the workspace", async () => {
    const ws = makeWorkspace();
    const tools = createBuiltinTools(ws);
    const outside = process.platform === "win32"
      ? "C:\\Windows\\System32\\drivers\\etc\\hosts"
      : "/etc/passwd";
    const result = await tools.read_file!.execute({ path: outside });
    expect(result).toContain("Error");
    expect(result).toContain("outside workspace");
  });

  test("rejects .. traversal", async () => {
    const ws = makeWorkspace();
    const tools = createBuiltinTools(ws);
    const result = await tools.read_file!.execute({ path: "../../../etc/passwd" });
    expect(result).toContain("Error");
    expect(result).toContain("outside workspace");
  });

  test("rejects symlink inside workspace pointing outside", async () => {
    const ws = makeWorkspace();
    const outsideDir = mkdtempSync(join(tmpdir(), "oc-outside-"));
    const secret = join(outsideDir, "secret.txt");
    writeFileSync(secret, "LEAKED-DATA");
    const linkPath = join(ws.cwd, "sneaky");
    try {
      try {
        symlinkSync(secret, linkPath);
      } catch {
        // Windows needs admin for symlinks unless developer mode is on. Skip.
        return;
      }
      const tools = createBuiltinTools(ws);
      const result = await tools.read_file!.execute({ path: "sneaky" });
      expect(result).not.toContain("LEAKED-DATA");
      expect(result).toContain("outside workspace");
    } finally {
      try { unlinkSync(linkPath); } catch { /* ok */ }
      try { unlinkSync(secret); } catch { /* ok */ }
    }
  });
});

describe("read_file: size cap", () => {
  test("rejects files above the 5MB cap", async () => {
    const ws = makeWorkspace();
    const p = join(ws.cwd, "big.bin");
    // Write ~6MB of zeros. Using Uint8Array keeps this fast.
    writeFileSync(p, new Uint8Array(6 * 1024 * 1024));
    try {
      const tools = createBuiltinTools(ws);
      const result = await tools.read_file!.execute({ path: "big.bin" });
      expect(result).toContain("Error");
      expect(result).toContain("cap");
    } finally {
      unlinkSync(p);
    }
  });
});

// ── edit: empty old_string rejected ─────────────────────────

describe("edit tool: empty old_string", () => {
  test("rejects empty old_string even with replace_all (would destroy the file)", async () => {
    const ws = makeWorkspace();
    const p = join(ws.cwd, "victim.txt");
    writeFileSync(p, "stay intact");
    try {
      const tools = createBuiltinTools(ws);
      const result = await tools.edit!.execute({
        path: "victim.txt",
        old_string: "",
        new_string: "X",
        replace_all: true,
      });
      expect(result).toContain("Error");
      expect(result).toContain("empty");
      const after = await Bun.file(p).text();
      expect(after).toBe("stay intact");
    } finally {
      unlinkSync(p);
    }
  });

  test("rejects empty old_string without replace_all too", async () => {
    const ws = makeWorkspace();
    const p = join(ws.cwd, "victim2.txt");
    writeFileSync(p, "also intact");
    try {
      const tools = createBuiltinTools(ws);
      const result = await tools.edit!.execute({
        path: "victim2.txt",
        old_string: "",
        new_string: "X",
      });
      expect(result).toContain("Error");
      const after = await Bun.file(p).text();
      expect(after).toBe("also intact");
    } finally {
      unlinkSync(p);
    }
  });
});

// ── grep: max_results = 0 still uses default ────────────────

describe("grep: max_results edge case", () => {
  test("max_results: 0 does not truncate to zero", async () => {
    const ws = makeWorkspace();
    const p = join(ws.cwd, "a.txt");
    writeFileSync(p, "match\nmatch\nmatch");
    try {
      const tools = createBuiltinTools(ws);
      const result = await tools.grep!.execute({ pattern: "match", max_results: 0 });
      // Should return the matches, not "No matches" and not "truncated at 0"
      expect(result).toContain("match(es)");
      expect(result).not.toContain("truncated at 0");
    } finally {
      unlinkSync(p);
    }
  });
});
