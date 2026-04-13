import { describe, test, expect } from "bun:test";
import { normalize, resolve, join } from "path";
import { Workspace } from "../workspace";

const SERVER_CWD = process.cwd();

// ── Constructor ─────────────────────────────────────────────

describe("Workspace constructor", () => {
  test("defaults to process.cwd() when no cwd given", () => {
    const ws = new Workspace();
    expect(ws.cwd).toBe(SERVER_CWD);
  });

  test("resolves and normalizes explicit cwd", () => {
    const ws = new Workspace("/tmp/test-project");
    expect(ws.cwd).toBe(normalize(resolve("/tmp/test-project")));
  });

  test("resolves relative cwd against process.cwd()", () => {
    const ws = new Workspace("relative/path");
    expect(ws.cwd).toBe(normalize(resolve("relative/path")));
  });
});

// ── fromTrigger: the critical _callerCwd flow ──────────────

describe("Workspace.fromTrigger", () => {
  test("extracts _callerCwd from payload and sets workspace.cwd", () => {
    const { workspace, cleanPayload } = Workspace.fromTrigger({
      _callerCwd: "/projects/my-repo",
      input: "packages/server/src/index.ts",
    });
    expect(workspace.cwd).toBe(normalize(resolve("/projects/my-repo")));
    expect(cleanPayload).toEqual({ input: "packages/server/src/index.ts" });
  });

  test("strips _callerCwd from cleanPayload — agents never see it", () => {
    const { cleanPayload } = Workspace.fromTrigger({
      _callerCwd: "/some/path",
      input: "hello",
      extra: 42,
    });
    const cp = cleanPayload as Record<string, unknown>;
    expect(cp).not.toHaveProperty("_callerCwd");
    expect(cp.input).toBe("hello");
    expect(cp.extra).toBe(42);
  });

  test("returns undefined cleanPayload when _callerCwd is the only key", () => {
    const { workspace, cleanPayload } = Workspace.fromTrigger({
      _callerCwd: "/projects/my-repo",
    });
    expect(workspace.cwd).toBe(normalize(resolve("/projects/my-repo")));
    expect(cleanPayload).toBeUndefined();
  });

  test("falls back to triggerWorkingDirectory when no _callerCwd", () => {
    const { workspace } = Workspace.fromTrigger(
      { input: "some file" },
      "/configured/working/dir",
    );
    expect(workspace.cwd).toBe(normalize(resolve("/configured/working/dir")));
  });

  test("_callerCwd takes precedence over triggerWorkingDirectory", () => {
    const { workspace } = Workspace.fromTrigger(
      { _callerCwd: "/from/payload", input: "x" },
      "/from/config",
    );
    expect(workspace.cwd).toBe(normalize(resolve("/from/payload")));
  });

  test("falls back to process.cwd() when neither cwd source is present", () => {
    const { workspace } = Workspace.fromTrigger({ input: "hello" });
    expect(workspace.cwd).toBe(SERVER_CWD);
  });

  test("handles undefined payload", () => {
    const { workspace, cleanPayload } = Workspace.fromTrigger(undefined);
    expect(workspace.cwd).toBe(SERVER_CWD);
    expect(cleanPayload).toBeUndefined();
  });

  test("handles null payload", () => {
    const { workspace, cleanPayload } = Workspace.fromTrigger(null);
    expect(workspace.cwd).toBe(SERVER_CWD);
    expect(cleanPayload).toBeNull();
  });

  test("handles string payload (not object)", () => {
    const { workspace, cleanPayload } = Workspace.fromTrigger("just a string");
    expect(workspace.cwd).toBe(SERVER_CWD);
    expect(cleanPayload).toBe("just a string");
  });

  test("handles number payload", () => {
    const { cleanPayload } = Workspace.fromTrigger(42);
    expect(cleanPayload).toBe(42);
  });

  test("handles array payload (not plain object)", () => {
    const arr = [1, 2, 3];
    const { cleanPayload } = Workspace.fromTrigger(arr);
    expect(cleanPayload).toEqual([1, 2, 3]);
  });

  // The exact bug we fixed: channel plugin sends _callerCwd inside payload,
  // API must NOT strip it before passing to executor, because fromTrigger
  // is the correct sanitization point.
  test("end-to-end: channel plugin payload shape works correctly", () => {
    // This is what the channel plugin sends as body.payload:
    const channelPayload = {
      input: "packages/server/src/agent/runtime.ts",
      _callerCwd: "C:\\Users\\beine\\source\\repos\\openconclave",
    };

    const { workspace, cleanPayload } = Workspace.fromTrigger(channelPayload);

    // Workspace gets the cwd
    expect(workspace.cwd).toBe(
      normalize(resolve("C:\\Users\\beine\\source\\repos\\openconclave")),
    );
    // Agent payload is clean — no _callerCwd
    const cp = cleanPayload as Record<string, unknown>;
    expect(cp).toEqual({ input: "packages/server/src/agent/runtime.ts" });
    expect(cp).not.toHaveProperty("_callerCwd");
  });

  test("Windows-style backslash path in _callerCwd is normalized", () => {
    const { workspace } = Workspace.fromTrigger({
      _callerCwd: "C:\\Users\\test\\project",
    });
    // Should be resolved to a valid path (exact format is OS-dependent)
    expect(workspace.cwd).toBeTruthy();
    expect(workspace.cwd).not.toBe(SERVER_CWD);
  });
});

// ── resolve ─────────────────────────────────────────────────

describe("Workspace.resolve", () => {
  test("joins relative path to cwd", () => {
    const cwd = normalize(resolve("/projects/my-repo"));
    const ws = new Workspace(cwd);
    const result = ws.resolve("packages/server/src/index.ts");
    expect(result).toBe(normalize(join(cwd, "packages/server/src/index.ts")));
  });

  test("absolute path passes through normalized", () => {
    const ws = new Workspace(normalize(resolve("/projects/my-repo")));
    const abs = normalize(resolve("/etc/hosts"));
    expect(ws.resolve(abs)).toBe(abs);
  });

  test("Windows drive letter path passes through normalized", () => {
    const ws = new Workspace(normalize(resolve("/projects/my-repo")));
    const result = ws.resolve("C:\\Users\\test\\file.txt");
    expect(result).toBe(normalize("C:\\Users\\test\\file.txt"));
  });

  test("relative path with ../ resolves correctly", () => {
    const cwd = normalize(resolve("/projects/my-repo/packages/server"));
    const ws = new Workspace(cwd);
    const result = ws.resolve("../../README.md");
    expect(result).toBe(normalize(resolve(cwd, "../../README.md")));
  });

  test("dot path resolves to cwd", () => {
    const cwd = normalize(resolve("/projects/my-repo"));
    const ws = new Workspace(cwd);
    expect(ws.resolve(".")).toBe(cwd);
  });
});

// ── setCwd ──────────────────────────────────────────────────

describe("Workspace.setCwd", () => {
  test("updates cwd to new absolute path", () => {
    const ws = new Workspace("/original/path");
    ws.setCwd("/new/path");
    expect(ws.cwd).toBe(normalize(resolve("/new/path")));
  });

  test("resolve uses updated cwd after setCwd", () => {
    const ws = new Workspace(normalize(resolve("/original")));
    const updated = normalize(resolve("/updated"));
    ws.setCwd(updated);
    expect(ws.resolve("file.ts")).toBe(normalize(join(updated, "file.ts")));
  });
});

// ── getAllowedDirs ───────────────────────────────────────────

describe("Workspace.getAllowedDirs", () => {
  test("includes only cwd by default", () => {
    const ws = new Workspace("/projects/repo");
    expect(ws.getAllowedDirs()).toEqual([ws.cwd]);
  });

  test("includes extra dirs after setAllowedDirs", () => {
    const ws = new Workspace("/projects/repo");
    ws.setAllowedDirs(["/tmp/extra"]);
    const dirs = ws.getAllowedDirs();
    expect(dirs).toHaveLength(2);
    expect(dirs[0]).toBe(ws.cwd);
    expect(dirs[1]).toBe(normalize(resolve("/tmp/extra")));
  });
});

// ── getMcpServerConfigs (legacy) ────────────────────────────

describe("Workspace.getMcpServerConfigs", () => {
  test("returns empty for unknown server IDs", () => {
    const ws = new Workspace("/projects/repo");
    expect(ws.getMcpServerConfigs(["unknown"])).toEqual({});
  });

  test("injects allowed dirs into filesystem server args", () => {
    const ws = new Workspace("/projects/repo");
    const configs = ws.getMcpServerConfigs(["filesystem"]);
    expect(configs.filesystem).toBeDefined();
    expect(configs.filesystem!.args).toContain(ws.cwd);
  });

  test("does not inject dirs into non-filesystem servers", () => {
    const ws = new Workspace("/projects/repo");
    const configs = ws.getMcpServerConfigs(["playwright"]);
    expect(configs.playwright).toBeDefined();
    expect(configs.playwright!.args).not.toContain(ws.cwd);
  });
});

// ── Static helpers ──────────────────────────────────────────

describe("Workspace static helpers", () => {
  test("getMcpServerBaseConfig returns config for known servers", () => {
    expect(Workspace.getMcpServerBaseConfig("playwright")).toBeDefined();
    expect(Workspace.getMcpServerBaseConfig("playwright")!.command).toBe("npx");
  });

  test("getMcpServerBaseConfig returns undefined for unknown servers", () => {
    expect(Workspace.getMcpServerBaseConfig("nonexistent")).toBeUndefined();
  });

  test("knownMcpServerIds includes expected servers", () => {
    const ids = Workspace.knownMcpServerIds;
    expect(ids).toContain("playwright");
    expect(ids).toContain("filesystem");
    expect(ids).toContain("fetch");
  });
});
