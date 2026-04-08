import { describe, it, expect, vi, beforeEach } from "vitest";
import { sep } from "path";
import { executeFile } from "../file";
import type { WorkflowNode } from "@openconclave/shared";
import { Workspace } from "../../workspace";

// Mock fs module
vi.mock("fs", () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Mock logger to suppress output
vi.mock("../../lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { logger } from "../../../lib/logger";

// ── Helpers ──────────────────────────────────────────────────

function makeFileNode(filePath: string, mode?: "read" | "write"): WorkflowNode {
  return {
    id: "file-1",
    type: "file",
    position: { x: 0, y: 0 },
    data: {
      label: "File Node",
      type: "file",
      config: { path: filePath, ...(mode ? { mode } : {}) },
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe("executeFile", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ── Happy path: read mode ─────────────────────────────────────

  describe("successful file reads", () => {
    it("returns file contents for an absolute path", () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue("file contents here");
      const node = makeFileNode("/absolute/path/to/file.txt");

      const result = executeFile(node, undefined);

      expect(result).toBe("file contents here");
    });

    it("reads a relative path by joining with workspace cwd", () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue("relative file contents");
      const node = makeFileNode("subdir/file.txt");

      const result = executeFile(node, undefined, new Workspace("/some/working/dir"));

      expect(result).toBe("relative file contents");
      // Should have been called with the joined absolute path
      const callArg = (readFileSync as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(callArg).toContain(`subdir${sep}file.txt`);
      expect(callArg).toContain("some");
    });

    it("reads a relative path as-is when workspace is not provided", () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue("cwd file");
      const node = makeFileNode("relative/file.txt");

      const result = executeFile(node, undefined);

      expect(result).toBe("cwd file");
      const callArg = (readFileSync as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(callArg).toBe("relative/file.txt");
    });

    it("uses absolute path as-is ignoring workspace cwd", () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue("absolute contents");
      const node = makeFileNode("/usr/local/data.json");

      executeFile(node, undefined, new Workspace("/some/cwd"));

      const callArg = (readFileSync as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      // Workspace.resolve normalizes separators, so compare with platform-aware path
      expect(callArg).toContain("usr");
      expect(callArg).toContain("local");
      expect(callArg).toContain("data.json");
      expect(callArg).not.toContain("some"); // should NOT include the workspace cwd
    });

    it("calls readFileSync with utf8 encoding", () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue("content");
      const node = makeFileNode("/some/file.txt");

      executeFile(node, undefined);

      expect(readFileSync).toHaveBeenCalledWith(expect.any(String), "utf8");
    });

    it("returns multi-line file contents intact", () => {
      const multiLine = "line1\nline2\nline3\n";
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(multiLine);
      const node = makeFileNode("/tmp/multi.txt");

      const result = executeFile(node, undefined);

      expect(result).toBe(multiLine);
    });

    it("returns an empty string for an empty file", () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue("");
      const node = makeFileNode("/tmp/empty.txt");

      const result = executeFile(node, undefined);

      expect(result).toBe("");
    });

    it("defaults to read mode when no mode is configured", () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue("content");
      const node = makeFileNode("/tmp/file.txt");

      executeFile(node, "some input");

      // Should read, not write
      expect(readFileSync).toHaveBeenCalledOnce();
      expect(writeFileSync).not.toHaveBeenCalled();
    });
  });

  // ── Write mode ────────────────────────────────────────────────

  describe("write mode", () => {
    it("writes string input to the file and returns success message", () => {
      const node = makeFileNode("/tmp/output.txt", "write");

      const result = executeFile(node, "hello world");

      expect(writeFileSync).toHaveBeenCalledWith("/tmp/output.txt", "hello world", "utf8");
      expect(result as string).toContain("File saved to");
      expect(result as string).toContain("/tmp/output.txt");
    });

    it("serializes object input as JSON when writing", () => {
      const node = makeFileNode("/tmp/data.json", "write");
      const input = { key: "value", num: 42 };

      executeFile(node, input);

      const writtenContent = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
      expect(writtenContent).toBe(JSON.stringify(input, null, 2));
    });

    it("serializes array input as JSON when writing", () => {
      const node = makeFileNode("/tmp/list.json", "write");
      const input = [1, 2, 3];

      executeFile(node, input);

      const writtenContent = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
      expect(writtenContent).toBe(JSON.stringify(input, null, 2));
    });

    it("creates parent directories before writing", () => {
      const node = makeFileNode("/tmp/deep/nested/output.txt", "write");

      executeFile(node, "content");

      expect(mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining("deep"),
        { recursive: true },
      );
    });

    it("returns error string when write fails", () => {
      (writeFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("EACCES: permission denied");
      });
      const node = makeFileNode("/protected/file.txt", "write");

      const result = executeFile(node, "data");

      expect(typeof result).toBe("string");
      expect(result as string).toContain("Error writing file:");
      expect(result as string).toContain("EACCES");
    });

    it("does not throw on write failure — always returns a string", () => {
      (writeFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("disk full");
      });
      const node = makeFileNode("/tmp/out.txt", "write");

      expect(() => executeFile(node, "data")).not.toThrow();
    });

    it("resolves relative write path using workspace", () => {
      const node = makeFileNode("output/result.txt", "write");

      executeFile(node, "content", new Workspace("/project/root"));

      const writePath = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(writePath).toContain("output");
      expect(writePath).toContain("result.txt");
      expect(writePath).toContain("project");
    });

    it("logs info after successful write", () => {
      // Ensure writeFileSync doesn't throw (may have residual mock from prior test)
      (writeFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {});
      const node = makeFileNode("/tmp/logged.txt", "write");

      executeFile(node, "data");

      expect(logger.info).toHaveBeenCalledOnce();
      const logArgs = (logger.info as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(logArgs[0]).toBe("File node wrote output");
      expect(logArgs[1]).toMatchObject({ path: "/tmp/logged.txt" });
    });

    it("logs error after failed write", () => {
      (writeFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("ENOSPC: no space left");
      });
      const node = makeFileNode("/tmp/fail.txt", "write");

      executeFile(node, "data");

      expect(logger.error).toHaveBeenCalledOnce();
      const logArgs = (logger.error as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(logArgs[0]).toBe("File node write failed");
    });
  });

  // ── Error handling: read mode ─────────────────────────────────

  describe("error handling (read mode)", () => {
    it("returns an error string when file does not exist", () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("ENOENT: no such file or directory, open '/missing.txt'");
      });
      const node = makeFileNode("/missing.txt");

      const result = executeFile(node, undefined);

      expect(typeof result).toBe("string");
      expect(result as string).toContain("Error reading file:");
      expect(result as string).toContain("ENOENT");
    });

    it("returns an error string for permission denied", () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("EACCES: permission denied");
      });
      const node = makeFileNode("/protected/file.txt");

      const result = executeFile(node, undefined);

      expect(result as string).toContain("Error reading file:");
      expect(result as string).toContain("EACCES");
    });

    it("handles non-Error objects thrown by readFileSync", () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw "raw string error";
      });
      const node = makeFileNode("/some/file.txt");

      const result = executeFile(node, undefined);

      expect(result as string).toContain("Error reading file:");
      expect(result as string).toContain("raw string error");
    });

    it("does not throw — always returns a string on failure", () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("any error");
      });
      const node = makeFileNode("/any/path");

      expect(() => executeFile(node, undefined)).not.toThrow();
    });

    it("logs the error path and message using logger.error", () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("ENOENT: file not found");
      });
      const node = makeFileNode("/logged/path.txt");

      executeFile(node, undefined);

      expect(logger.error).toHaveBeenCalledOnce();
      const logArgs = (logger.error as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(logArgs[0]).toBe("File node read failed");
      expect(logArgs[1]).toMatchObject({ path: "/logged/path.txt" });
    });
  });

  // ── No file path configured ───────────────────────────────────

  describe("missing path configuration", () => {
    it("returns error string when path is empty string", () => {
      const node = makeFileNode("");

      const result = executeFile(node, undefined);

      expect(result).toBe("Error: no file path configured");
    });

    it("does not call readFileSync when path is empty", () => {
      const node = makeFileNode("");

      executeFile(node, undefined);

      expect(readFileSync).not.toHaveBeenCalled();
    });
  });

  // ── Path resolution edge cases ────────────────────────────────

  describe("path resolution", () => {
    it("a dot-relative path like './file.txt' is resolved relative to workspace cwd", () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue("content");
      const node = makeFileNode("./data/config.json");

      executeFile(node, undefined, new Workspace("/project/root"));

      const callArg = (readFileSync as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(callArg).toContain(`data${sep}config.json`);
    });

    it("handles workspace cwd with trailing slash", () => {
      (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue("content");
      const node = makeFileNode("file.txt");

      // Workspace.resolve() handles trailing slashes correctly
      executeFile(node, undefined, new Workspace("/some/dir/"));

      const callArg = (readFileSync as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(callArg).toContain("file.txt");
    });
  });
});
