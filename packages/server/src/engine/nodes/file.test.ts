import { describe, it, expect, vi, beforeEach } from "vitest";
import { sep } from "path";
import { executeFile } from "./file";
import type { WorkflowNode } from "@openconclave/shared";

// Mock fs module
vi.mock("fs", () => ({
  readFileSync: vi.fn(),
}));

// Mock logger to suppress output
vi.mock("../../lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { readFileSync } from "fs";

// ── Helpers ──────────────────────────────────────────────────

function makeFileNode(filePath: string): WorkflowNode {
  return {
    id: "file-1",
    type: "file",
    position: { x: 0, y: 0 },
    data: {
      label: "File Node",
      type: "file",
      config: { path: filePath },
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe("executeFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Happy path ───────────────────────────────────────────────

  describe("successful file reads", () => {
    it("returns file contents for an absolute path", () => {
      (readFileSync as any).mockReturnValue("file contents here");
      const node = makeFileNode("/absolute/path/to/file.txt");

      const result = executeFile(node);

      expect(result).toBe("file contents here");
    });

    it("reads a relative path by joining with callerCwd", () => {
      (readFileSync as any).mockReturnValue("relative file contents");
      const node = makeFileNode("subdir/file.txt");

      const result = executeFile(node, "/some/working/dir");

      expect(result).toBe("relative file contents");
      // Should have been called with an absolute path (use sep for cross-platform)
      const callArg = (readFileSync as any).mock.calls[0][0] as string;
      expect(callArg).toContain(`subdir${sep}file.txt`);
    });

    it("reads a relative path using process.cwd() when callerCwd is not provided", () => {
      (readFileSync as any).mockReturnValue("cwd file");
      const node = makeFileNode("relative/file.txt");

      const result = executeFile(node);

      expect(result).toBe("cwd file");
      const callArg = (readFileSync as any).mock.calls[0][0] as string;
      expect(callArg).toContain(`relative${sep}file.txt`);
      expect(callArg).toContain(process.cwd());
    });

    it("uses absolute path as-is ignoring callerCwd", () => {
      (readFileSync as any).mockReturnValue("absolute contents");
      const node = makeFileNode("/usr/local/data.json");

      executeFile(node, "/some/cwd");

      const callArg = (readFileSync as any).mock.calls[0][0] as string;
      expect(callArg).toBe("/usr/local/data.json");
    });

    it("calls readFileSync with utf8 encoding", () => {
      (readFileSync as any).mockReturnValue("content");
      const node = makeFileNode("/some/file.txt");

      executeFile(node);

      expect(readFileSync).toHaveBeenCalledWith(expect.any(String), "utf8");
    });

    it("returns multi-line file contents intact", () => {
      const multiLine = "line1\nline2\nline3\n";
      (readFileSync as any).mockReturnValue(multiLine);
      const node = makeFileNode("/tmp/multi.txt");

      const result = executeFile(node);

      expect(result).toBe(multiLine);
    });

    it("returns an empty string for an empty file", () => {
      (readFileSync as any).mockReturnValue("");
      const node = makeFileNode("/tmp/empty.txt");

      const result = executeFile(node);

      expect(result).toBe("");
    });
  });

  // ── Error handling ───────────────────────────────────────────

  describe("error handling", () => {
    it("returns an error string when file does not exist", () => {
      (readFileSync as any).mockImplementation(() => {
        throw new Error("ENOENT: no such file or directory, open '/missing.txt'");
      });
      const node = makeFileNode("/missing.txt");

      const result = executeFile(node);

      expect(typeof result).toBe("string");
      expect(result as string).toContain("Error reading file:");
      expect(result as string).toContain("ENOENT");
    });

    it("returns an error string for permission denied", () => {
      (readFileSync as any).mockImplementation(() => {
        throw new Error("EACCES: permission denied");
      });
      const node = makeFileNode("/protected/file.txt");

      const result = executeFile(node);

      expect(result as string).toContain("Error reading file:");
      expect(result as string).toContain("EACCES");
    });

    it("handles non-Error objects thrown by readFileSync", () => {
      (readFileSync as any).mockImplementation(() => {
        throw "raw string error";
      });
      const node = makeFileNode("/some/file.txt");

      const result = executeFile(node);

      expect(result as string).toContain("Error reading file:");
      expect(result as string).toContain("raw string error");
    });

    it("does not throw — always returns a string on failure", () => {
      (readFileSync as any).mockImplementation(() => {
        throw new Error("any error");
      });
      const node = makeFileNode("/any/path");

      expect(() => executeFile(node)).not.toThrow();
    });

    it("logs the error path and message using logger.error", async () => {
      const { logger } = await import("../../lib/logger");
      (readFileSync as any).mockImplementation(() => {
        throw new Error("ENOENT: file not found");
      });
      const node = makeFileNode("/logged/path.txt");

      executeFile(node);

      expect(logger.error).toHaveBeenCalledOnce();
      const logArgs = (logger.error as any).mock.calls[0];
      expect(logArgs[0]).toBe("File node read failed");
      expect(logArgs[1]).toMatchObject({ path: "/logged/path.txt" });
    });
  });

  // ── Path resolution edge cases ────────────────────────────────

  describe("path resolution", () => {
    it("a dot-relative path like './file.txt' is resolved relative to callerCwd", () => {
      (readFileSync as any).mockReturnValue("content");
      const node = makeFileNode("./data/config.json");

      executeFile(node, "/project/root");

      const callArg = (readFileSync as any).mock.calls[0][0] as string;
      expect(callArg).toContain(`data${sep}config.json`);
    });

    it("handles callerCwd with trailing slash", () => {
      (readFileSync as any).mockReturnValue("content");
      const node = makeFileNode("file.txt");

      // path.join handles trailing slashes correctly
      executeFile(node, "/some/dir/");

      const callArg = (readFileSync as any).mock.calls[0][0] as string;
      expect(callArg).toContain("file.txt");
    });
  });
});
