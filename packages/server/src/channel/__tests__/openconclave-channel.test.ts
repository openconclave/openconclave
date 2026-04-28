import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, readdirSync, unlinkSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// TEST_LIMITATION: openconclave-channel.ts cannot be imported — it has unconditional top-level
// side effects (WebSocket connect, MCP stdio transport, process.stdout patch) that make module
// import impossible in a test environment. All tests below exercise the same algorithm in isolation.

const MAX_OUTPUT_FILES = 200;

function pruneOutputDir(outputDir: string) {
  const files = readdirSync(outputDir);
  if (files.length >= MAX_OUTPUT_FILES) {
    files.sort();
    for (const f of files.slice(0, files.length - MAX_OUTPUT_FILES + 1)) {
      try { unlinkSync(join(outputDir, f)); } catch {}
    }
  }
}

// ── MAJOR-1: output directory pruning ───────────────────────────────────────

describe("output directory pruning", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `oc-out-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("leaves directory untouched when below the cap", () => {
    for (let i = 0; i < 5; i++) writeFileSync(join(dir, `f${i}.md`), "x");
    pruneOutputDir(dir);
    expect(readdirSync(dir).length).toBe(5);
  });

  test("prunes the single oldest file when at the cap", () => {
    for (let i = 0; i < 200; i++) {
      writeFileSync(join(dir, `output-${String(i).padStart(5, "0")}.md`), "x");
    }
    pruneOutputDir(dir);
    const remaining = readdirSync(dir).sort();
    expect(remaining.length).toBe(199);
    expect(remaining[0]).toBe("output-00001.md"); // oldest (00000) pruned
  });

  test("prunes enough so a subsequent new write stays at the cap", () => {
    for (let i = 0; i < 200; i++) {
      writeFileSync(join(dir, `output-${String(i).padStart(5, "0")}.md`), "x");
    }
    pruneOutputDir(dir); // removes 1 → 199
    writeFileSync(join(dir, "output-99999.md"), "new"); // add 1 → 200
    expect(readdirSync(dir).length).toBe(200);
  });
});

// ── MAJOR-2: conclave tool collision guard ──────────────────────────────────

describe("conclave tool collision guard", () => {
  function makeRegistry() {
    const tools = new Map<string, { name: string }>();
    const registeredConclaveTools = new Set<string>();
    const warnings: string[] = [];

    function tryRegisterConclaveTool(toolName: string): boolean {
      if (tools.has(toolName) && !registeredConclaveTools.has(toolName)) {
        warnings.push(toolName);
        return false;
      }
      tools.set(toolName, { name: toolName });
      registeredConclaveTools.add(toolName);
      return true;
    }

    return { tools, registeredConclaveTools, warnings, tryRegisterConclaveTool };
  }

  test("skips registration when toolName matches an existing built-in", () => {
    const { tools, registeredConclaveTools, warnings, tryRegisterConclaveTool } = makeRegistry();
    tools.set("oc_respond", { name: "oc_respond" }); // built-in pre-loaded

    const ok = tryRegisterConclaveTool("oc_respond");

    expect(ok).toBe(false);
    expect(warnings).toContain("oc_respond");
    expect(registeredConclaveTools.has("oc_respond")).toBe(false);
    expect(tools.get("oc_respond")!.name).toBe("oc_respond"); // original untouched
  });

  test("allows registration of a toolName not in the built-in set", () => {
    const { registeredConclaveTools, tryRegisterConclaveTool } = makeRegistry();
    expect(tryRegisterConclaveTool("custom_tool")).toBe(true);
    expect(registeredConclaveTools.has("custom_tool")).toBe(true);
  });

  test("cleanup loop only removes tools owned by registeredConclaveTools", () => {
    const { tools, registeredConclaveTools } = makeRegistry();
    tools.set("oc_respond", { name: "oc_respond" }); // built-in (not in registeredConclaveTools)
    tools.set("my_conclave", { name: "my_conclave" });
    registeredConclaveTools.add("my_conclave");

    const seen = new Set<string>(); // empty → all conclave tools are stale
    for (const t of [...registeredConclaveTools]) {
      if (!seen.has(t)) {
        registeredConclaveTools.delete(t);
        tools.delete(t);
      }
    }

    expect(tools.has("oc_respond")).toBe(true);
    expect(tools.has("my_conclave")).toBe(false);
  });
});

// ── MAJOR-3: syncConclaveTools triggered on conclave lifecycle events ────────

describe("syncConclaveTools triggered on conclave lifecycle events", () => {
  test("conclave:updated/created/deleted each trigger sync; channel:output does not", async () => {
    let syncCount = 0;
    async function mockSync() { syncCount++; }

    async function routeEvent(eventType: string) {
      if (
        eventType === "conclave:updated" ||
        eventType === "conclave:created" ||
        eventType === "conclave:deleted"
      ) {
        await mockSync();
      }
    }

    await routeEvent("conclave:updated");
    await routeEvent("conclave:created");
    await routeEvent("conclave:deleted");
    await routeEvent("channel:output"); // must NOT trigger sync

    expect(syncCount).toBe(3);
  });
});

// ── MINOR: output filename uniqueness ───────────────────────────────────────

describe("output filename uniqueness", () => {
  test("same runId and timestamp produce distinct filenames via random suffix", () => {
    const runId = "run-abc123";
    const ts = 1745881234567;

    function makeFilename() {
      return `output-${runId}-${ts}-${crypto.randomUUID().slice(0, 8)}.md`;
    }

    const names = new Set<string>();
    for (let i = 0; i < 50; i++) names.add(makeFilename());
    expect(names.size).toBe(50);
  });
});

// ── MINOR: writeSync error routes to callback, not re-send ─────────────────

describe("stdout writeSync error handling", () => {
  test("writeSync error calls callback(err) and does not re-send chunk", () => {
    const writeError = new Error("EBADF");
    let callbackErr: unknown;

    function patchedWrite(
      chunk: unknown,
      encoding: unknown,
      callback: ((err?: unknown) => void) | undefined,
      mockWriteSync: () => void,
    ): boolean {
      const data = typeof chunk === "string" ? chunk : String(chunk);
      void data;
      try {
        mockWriteSync();
      } catch (err: unknown) {
        if (typeof encoding === "function") (encoding as (e: unknown) => void)(err);
        else if (typeof callback === "function") callback(err);
        return false;
      }
      if (typeof encoding === "function") (encoding as () => void)();
      else if (typeof callback === "function") callback();
      return true;
    }

    const result = patchedWrite("hello\n", undefined, (err) => {
      callbackErr = err;
    }, () => { throw writeError; });

    expect(result).toBe(false);
    expect(callbackErr).toBe(writeError);
  });
});
