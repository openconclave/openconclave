import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ConclaveNode } from "@openconclave/shared";
import { executeFile } from "../file";
import { Workspace } from "../../workspace";

let tmpDir: string;
let workspace: Workspace;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "file-node-test-"));
  workspace = new Workspace(tmpDir);
});

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function makeNode(config: Record<string, unknown>): ConclaveNode {
  return {
    id: "f1",
    type: "file",
    position: { x: 0, y: 0 },
    data: { label: "File", type: "file", config: config as never },
  };
}

describe("executeFile — workspace containment (MAJOR)", () => {
  test("absolute path outside workspace throws", async () => {
    const outside = process.platform === "win32"
      ? "C:\\Windows\\System32\\drivers\\etc\\hosts"
      : "/etc/passwd";
    await expect(
      executeFile(makeNode({ path: outside, mode: "read" }), null, workspace),
    ).rejects.toThrow(/outside workspace/);
  });

  test(".. traversal that escapes the workspace throws", async () => {
    await expect(
      executeFile(makeNode({ path: "../../../etc/passwd", mode: "read" }), null, workspace),
    ).rejects.toThrow(/outside workspace/);
  });

  test("write to absolute path outside workspace throws (and does not create dirs)", async () => {
    const outside = process.platform === "win32"
      ? "C:\\Windows\\Temp\\oc-evil-dir\\evil.txt"
      : "/tmp/oc-evil-dir/evil.txt";
    await expect(
      executeFile(makeNode({ path: outside, mode: "write" }), "data", workspace),
    ).rejects.toThrow(/outside workspace/);
  });
});

describe("executeFile — I/O failures throw, never returned as data (MAJOR)", () => {
  test("reading a missing file rejects instead of returning a string", async () => {
    const result = executeFile(
      makeNode({ path: "missing.txt", mode: "read" }),
      null,
      workspace,
    );
    await expect(result).rejects.toThrow();
  });
});

describe("executeFile — write returns input unchanged (MAJOR)", () => {
  test("string input is returned verbatim on success", async () => {
    const result = await executeFile(
      makeNode({ path: "out.txt", mode: "write" }),
      "hello",
      workspace,
    );
    expect(result).toBe("hello");
  });

  test("object input is returned by reference on success", async () => {
    const obj = { a: 1, b: "two" };
    const result = await executeFile(
      makeNode({ path: "out.json", mode: "write" }),
      obj,
      workspace,
    );
    expect(result).toBe(obj);
  });
});

describe("executeFile — read size cap (MINOR)", () => {
  test("file exceeding the read cap throws", async () => {
    const big = "x".repeat(5 * 1024 * 1024);
    writeFileSync(join(tmpDir, "big.txt"), big);
    await expect(
      executeFile(makeNode({ path: "big.txt", mode: "read" }), null, workspace),
    ).rejects.toThrow(/exceeds/);
  });
});

describe("executeFile — unknown mode (MINOR)", () => {
  test("unrecognised mode throws", async () => {
    await expect(
      executeFile(makeNode({ path: "x.txt", mode: "append" }), "data", workspace),
    ).rejects.toThrow();
  });
});

describe("executeFile — binary input (MINOR)", () => {
  test("Buffer input is written as raw bytes (no JSON, no utf8 corruption)", async () => {
    const buf = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x80, 0x7f]);
    await executeFile(
      makeNode({ path: "bin.dat", mode: "write" }),
      buf,
      workspace,
    );
    const written = readFileSync(join(tmpDir, "bin.dat"));
    expect(written.equals(buf)).toBe(true);
  });
});

describe("executeFile — async signature (MINOR)", () => {
  test("returns a Promise", async () => {
    writeFileSync(join(tmpDir, "ok.txt"), "hi");
    const p = executeFile(makeNode({ path: "ok.txt", mode: "read" }), null, workspace);
    expect(p).toBeInstanceOf(Promise);
    await p;
  });
});

describe("executeFile — missing path (MINOR)", () => {
  test("empty path throws instead of returning an error string", async () => {
    await expect(
      executeFile(makeNode({ path: "", mode: "read" }), null, workspace),
    ).rejects.toThrow();
  });
});
