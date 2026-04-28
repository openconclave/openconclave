import { describe, test, expect } from "bun:test";
import { simplifyDockerError } from "../searxng-manager";

// ── simplifyDockerError: conflict / name-already-in-use branch ───────────────

describe('simplifyDockerError: "conflict" / "name already in use"', () => {
  test('stderr containing "Conflict" returns docker rm -f suggestion', () => {
    const raw =
      'Error response from daemon: Conflict. The container name "/searxng" is already in use.';
    expect(simplifyDockerError(raw)).toContain("docker rm -f searxng");
  });

  test('"name is already in use" phrase is also caught', () => {
    expect(simplifyDockerError("name is already in use")).toContain(
      "docker rm -f searxng",
    );
  });

  test("unrelated error is returned verbatim up to 240 chars (regression guard)", () => {
    expect(simplifyDockerError("some unrelated error")).toBe("some unrelated error");
  });

  test("empty stderr returns generic fallback (regression guard)", () => {
    expect(simplifyDockerError("")).toBe("docker command failed");
  });
});

// TEST_LIMITATION: startContainer spawns a Docker subprocess; verifying the loopback bind address requires a live Docker daemon or Bun.spawn mock.

// TEST_LIMITATION: writeSettingsYml mkdir/writeFile mode is only enforced on POSIX filesystems; reliable stat.mode verification requires writing to a real temp dir on Linux (not safe on Windows CI).

// TEST_LIMITATION: dockerExec concurrent-drain deadlock fix requires a subprocess that fills the OS pipe buffer (>64 KB); not achievable as a pure unit test without spawning a real process with large output.

// TEST_LIMITATION: restartContainer log emission on health failure requires a live Docker daemon and running container.

// TEST_LIMITATION: settingsDir WORKSPACE resolver — WORKSPACE is a module-level constant evaluated at import time; overriding OC_DATA_DIR per-test would require module cache isolation.
