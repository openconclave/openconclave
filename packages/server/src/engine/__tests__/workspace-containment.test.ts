import { describe, test, expect } from "bun:test";
import { Workspace } from "../workspace";

describe("Workspace.resolveInside", () => {
  test("accepts relative paths inside cwd", () => {
    const ws = new Workspace(process.cwd());
    const resolved = ws.resolveInside("package.json");
    expect(resolved).toContain("package.json");
  });

  test("accepts absolute paths that stay inside cwd", () => {
    const ws = new Workspace(process.cwd());
    // Re-resolving the workspace's own cwd must be allowed.
    expect(() => ws.resolveInside(ws.cwd)).not.toThrow();
  });

  test("accepts paths in extra allowed dirs", () => {
    const root = process.platform === "win32" ? "C:\\Users\\test\\proj" : "/home/test/proj";
    const extra = process.platform === "win32" ? "C:\\Users\\test\\data" : "/home/test/data";
    const ws = new Workspace(root);
    ws.setAllowedDirs([extra]);
    const target = process.platform === "win32"
      ? "C:\\Users\\test\\data\\file.txt"
      : "/home/test/data/file.txt";
    expect(() => ws.resolveInside(target)).not.toThrow();
  });

  test("rejects system paths outside cwd", () => {
    const root = process.platform === "win32" ? "C:\\Users\\test\\proj" : "/home/test/proj";
    const ws = new Workspace(root);
    const outside = process.platform === "win32"
      ? "C:\\Windows\\System32\\drivers\\etc\\hosts"
      : "/etc/passwd";
    expect(() => ws.resolveInside(outside)).toThrow(/outside workspace/);
  });

  test("rejects .. traversal that escapes the workspace", () => {
    const root = process.platform === "win32" ? "C:\\Users\\test\\proj" : "/home/test/proj";
    const ws = new Workspace(root);
    expect(() => ws.resolveInside("../../../etc/passwd")).toThrow(/outside workspace/);
  });

  test("is case-insensitive on Windows (matches filesystem)", () => {
    if (process.platform !== "win32") return;
    const ws = new Workspace("C:\\Users\\Test\\Proj");
    // Lowercase variant should still resolve inside.
    expect(() => ws.resolveInside("c:\\users\\test\\proj\\file.txt")).not.toThrow();
  });
});
