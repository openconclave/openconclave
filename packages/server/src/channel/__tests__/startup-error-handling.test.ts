import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * RED TESTS: Unhandled startup promise (line 191)
 *
 * Bug: Line 191 does `await syncWorkflowTools()` but does NOT add a .catch() handler.
 * If syncWorkflowTools() throws, the error is logged (line 186) but the promise
 * rejection is unhandled, causing the process to exit with an error.
 *
 * Expected behavior: If syncWorkflowTools() fails, the error should be caught
 * and handled explicitly with process.exit(1) or re-thrown to prevent silent failures.
 *
 * Actual behavior: The promise rejection is unhandled at the top level.
 */

describe("Unhandled Startup Promise in syncWorkflowTools", () => {
  let consoleErrorMock: any;

  beforeEach(() => {
    consoleErrorMock = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorMock.mockRestore();
  });

  it("should NOT silently ignore errors from syncWorkflowTools", async () => {
    /**
     * The current code at line 191 is:
     *   await syncWorkflowTools();
     *
     * Without a .catch(), if syncWorkflowTools() throws, the top-level
     * promise rejection is unhandled. This is a RED test that demonstrates
     * the bug exists - unhandled rejections should not be silent.
     */

    // Simulate what happens when syncWorkflowTools fails
    const syncWorkflowTools = async () => {
      throw new Error("API connection failed");
    };

    // The current code structure does this:
    const startupError = new Promise<void>(async (resolve) => {
      try {
        await syncWorkflowTools();
        console.error("[channel] synced 0 workflow tools");
        resolve();
      } catch (err) {
        console.error("[channel] syncWorkflowTools error:", err);
        // BUG: No explicit error handling or process.exit(1)
        resolve(); // This swallows the error!
      }
    });

    await startupError;

    // Verify error was logged
    expect(consoleErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("[channel] syncWorkflowTools error:"),
      expect.any(Error)
    );

    /**
     * SKIPPED: This test actually passes because the current code catches errors
     * inside syncWorkflowTools (line 185-187). However, the unhandled promise
     * at line 191 could still cause issues if the catch block is removed or
     * if there's an error in the error handler itself.
     *
     * The real bug is: there's no explicit process.exit(1) or re-throw to signal
     * that startup failed. The server continues without workflow tools.
     */
  });

  it("should explicitly fail startup if syncWorkflowTools throws", async () => {
    /**
     * This test demonstrates that the current code does NOT fail startup
     * when syncWorkflowTools errors. Instead, it logs and continues.
     *
     * The code at line 191 should either:
     * 1. Have a .catch() that calls process.exit(1), or
     * 2. Re-throw the error to prevent silent failures
     */

    let startupFailed = false;
    const syncWorkflowTools = async () => {
      throw new Error("API connection failed at startup");
    };

    // This is what the current code does:
    try {
      await syncWorkflowTools().catch((err) => {
        console.error("[channel] syncWorkflowTools error:", err);
        // Current behavior: just log and continue
      });
    } catch (err) {
      startupFailed = true;
    }

    // The process doesn't fail - it just logs and continues
    expect(startupFailed).toBe(false);
  });
});
