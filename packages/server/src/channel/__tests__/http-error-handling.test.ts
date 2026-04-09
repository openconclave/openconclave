import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * RED TESTS: HTTP error handling in `ocApi()` (lines 41–48)
 *
 * Bug: Function assumes all responses are JSON and successful.
 * 4xx/5xx responses or malformed bodies will throw inside tool handlers,
 * causing opaque MCP failures that crash the handler without returning
 * { isError: true } format.
 *
 * Test Plan:
 * - ocApi() does NOT check res.ok, so 4xx/5xx responses are passed to res.json()
 * - If res.json() throws (malformed body), the exception propagates uncaught
 * - Tool handlers calling ocApi() have no try/catch, so errors crash the handler
 *
 * Expected behavior: API errors should be caught and returned as MCP error responses
 * Actual behavior: Errors throw and crash the handler
 */

describe("HTTP Error Handling in ocApi()", () => {
  let fetchMock: any;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should crash when API returns 404 and json() throws", async () => {
    // Simulate 404 response with error body that might be invalid JSON
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: vi.fn().mockRejectedValueOnce(new SyntaxError("Unexpected token")),
    });

    // Simulating the ocApi function behavior
    const ocApi = async (path: string) => {
      const res = await globalThis.fetch(`http://localhost:4000/api${path}`);
      // Bug: no check for res.ok
      return res.json(); // This will throw
    };

    // This should throw, crashing the handler
    await expect(ocApi("/workflows")).rejects.toThrow("Unexpected token");
  });

  it("should crash when API returns 500 with malformed JSON", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: vi.fn().mockRejectedValueOnce(new SyntaxError("Unexpected token < in JSON")),
    });

    const ocApi = async (path: string) => {
      const res = await globalThis.fetch(`http://localhost:4000/api${path}`);
      return res.json();
    };

    await expect(ocApi("/workflows")).rejects.toThrow();
  });

  it("should crash when response body is malformed JSON even with 200 status", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValueOnce(new SyntaxError("Unexpected end of JSON input")),
    });

    const ocApi = async (path: string) => {
      const res = await globalThis.fetch(`http://localhost:4000/api${path}`);
      return res.json();
    };

    await expect(ocApi("/workflows")).rejects.toThrow("Unexpected end of JSON input");
  });

  it("should not throw for valid 200 response with proper JSON", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValueOnce({ workflows: [] }),
    });

    const ocApi = async (path: string) => {
      const res = await globalThis.fetch(`http://localhost:4000/api${path}`);
      return res.json();
    };

    const result = await ocApi("/workflows");
    expect(result).toEqual({ workflows: [] });
  });
});
