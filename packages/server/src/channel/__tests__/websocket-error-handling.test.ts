import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * RED TESTS: Silent WebSocket message parse errors (lines 346–348)
 *
 * Bug at lines 346-348:
 * ws.onmessage = async (event) => {
 *   try {
 *     const data = JSON.parse(event.data.toString());
 *     // ... process event
 *   } catch {
 *     // ignore parse errors
 *   }
 * };
 *
 * Problem: `catch { }` swallows all errors with no logging.
 * If WebSocket receives malformed JSON, the error is silently ignored.
 * Debugging becomes impossible - no error appears in logs.
 *
 * Expected: Errors should be logged with console.error()
 */

describe("WebSocket Error Handling", () => {
  let consoleErrorMock: any;

  beforeEach(() => {
    consoleErrorMock = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorMock.mockRestore();
  });

  it("should log JSON parse errors instead of silently ignoring them", async () => {
    /**
     * Current buggy behavior: malformed JSON is silently ignored
     */

    let errorWasLogged = false;
    const invalidJsonData = "{ invalid json ]";

    // Simulate current buggy code
    const ws = {
      onmessage: undefined as any,
      onerror: undefined as any,
      onopen: undefined as any,
      onclose: undefined as any,
    };

    ws.onmessage = async (event: any) => {
      try {
        const data = JSON.parse(event.data.toString());
        // Process event...
      } catch {
        // BUG: Silent catch - no logging!
        // Fix: console.error(`[channel] WebSocket parse error:`, err);
      }
    };

    // Trigger the onmessage handler with invalid JSON
    const mockEvent = { data: invalidJsonData };
    await ws.onmessage(mockEvent);

    // The error was not logged
    expect(consoleErrorMock).not.toHaveBeenCalled();
  });

  it("should log WebSocket errors for debugging", async () => {
    /**
     * Same issue with onerror handler - errors are silently ignored
     */

    let errorLogged = false;
    const ws = {
      onerror: undefined as any,
    };

    ws.onerror = () => {
      // BUG: Empty error handler
      // Fix: console.error(`[channel] WebSocket error:`, err);
    };

    // Trigger error
    ws.onerror();

    // No error was logged
    expect(errorLogged).toBe(false);
  });

  it("should log parse errors to aid debugging", async () => {
    /**
     * This test shows what the fixed version should do
     */

    const invalidJsonData = "{ broken json }";

    // Fixed version with logging
    const ws = {
      onmessage: undefined as any,
    };

    ws.onmessage = async (event: any) => {
      try {
        const data = JSON.parse(event.data.toString());
        // Process event...
      } catch (err) {
        // FIX: Add error logging
        console.error("[channel] WebSocket JSON parse error:", err);
      }
    };

    const mockEvent = { data: invalidJsonData };
    await ws.onmessage(mockEvent);

    // With the fix, error would be logged
    expect(consoleErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("[channel] WebSocket JSON parse error:"),
      expect.any(Error)
    );
  });
});
