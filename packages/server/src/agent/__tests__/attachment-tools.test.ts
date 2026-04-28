import { describe, test, expect, afterEach } from "bun:test";
import * as mod from "../attachment-tools";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { sessionDirForRun } from "../../lib/workspace";

const TEST_RUN_ID = 999_999_998;

function ensureAttachDir(): string {
  const dir = join(sessionDirForRun(TEST_RUN_ID), "attachments");
  mkdirSync(dir, { recursive: true });
  return dir;
}

afterEach(() => {
  rmSync(sessionDirForRun(TEST_RUN_ID), { recursive: true, force: true });
});

// ── MAJOR: hasAttachments deleted ─────────────────────────────────────────────

describe("hasAttachments removed", () => {
  test("hasAttachments is not exported from attachment-tools", () => {
    expect((mod as Record<string, unknown>).hasAttachments).toBeUndefined();
  });
});

// ── MINOR: execute wrappers return Error strings (not rejections) ──────────────

describe("execute: invalid filename returns Error string", () => {
  test("read_attachment: path traversal resolves to Error string", async () => {
    const tools = mod.createAttachmentBuiltinTools(TEST_RUN_ID);
    const result = await tools.read_attachment!.execute({ filename: "../../etc/passwd" });
    expect(typeof result).toBe("string");
    expect(result as string).toContain("Error");
    expect(result as string).toContain("Invalid filename");
  });

  test("grep_attachment: path traversal resolves to Error string", async () => {
    const tools = mod.createAttachmentBuiltinTools(TEST_RUN_ID);
    const result = await tools.grep_attachment!.execute({ filename: "../../etc/passwd", pattern: "root" });
    expect(typeof result).toBe("string");
    expect(result as string).toContain("Error");
    expect(result as string).toContain("Invalid filename");
  });
});

// ── MINOR: readAttachment misleading footer past EOF ──────────────────────────

describe("readAttachment: offset past EOF", () => {
  test("returns past-end message instead of misleading line range", async () => {
    const dir = ensureAttachDir();
    writeFileSync(join(dir, "short.txt"), "line1\nline2\nline3\nline4\nline5");
    const result = await mod.readAttachment(TEST_RUN_ID, "short.txt", 100, 10);
    expect(result).toContain("past end");
    expect(result).not.toMatch(/\[lines 100-\d+ of 5/);
  });
});

// ── MINOR: listAttachments TOCTOU ─────────────────────────────────────────────

describe("listAttachments: TOCTOU safety", () => {
  // TEST_LIMITATION: the race (file deleted between filter and map) cannot be
  // reproduced deterministically in single-threaded JS; this tests correct behavior only.
  test("returns formatted list with filename and byte count", async () => {
    const dir = ensureAttachDir();
    writeFileSync(join(dir, "notes.txt"), "hello world");
    const result = await mod.listAttachments(TEST_RUN_ID);
    expect(result).toContain("notes.txt");
    expect(result).toContain("11 bytes");
  });
});

// ── MINOR: async I/O ──────────────────────────────────────────────────────────

describe("readAttachment / grepAttachment: async I/O", () => {
  // TEST_LIMITATION: event-loop blocking cannot be detected in a unit test;
  // this verifies functional correctness after the readFileSync → readFile change.
  test("readAttachment returns correct content after async I/O change", async () => {
    const dir = ensureAttachDir();
    writeFileSync(join(dir, "data.txt"), "alpha\nbeta\ngamma");
    const result = await mod.readAttachment(TEST_RUN_ID, "data.txt");
    expect(result).toContain("alpha");
    expect(result).toContain("beta");
    expect(result).toContain("gamma");
  });

  test("grepAttachment returns correct matches after async I/O change", async () => {
    const dir = ensureAttachDir();
    writeFileSync(join(dir, "log.txt"), "ERROR: bad\nINFO: ok\nERROR: also bad");
    const result = await mod.grepAttachment(TEST_RUN_ID, "log.txt", "ERROR");
    expect(result).toContain("ERROR: bad");
    expect(result).toContain("ERROR: also bad");
    expect(result).not.toContain("INFO");
  });
});
