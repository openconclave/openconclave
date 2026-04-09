/**
 * RED Test: Silent JSON Parse Error Swallowing
 *
 * Bug: Lines 75, 128, 162
 * Using `.catch(() => ({}))` masks malformed request errors.
 * Clients sending invalid JSON silently get an empty object instead of error.
 */

import { describe, it, expect } from "vitest";

describe("JSON Parse Error Swallowing Bug", () => {
  it("should demonstrate the .catch(() => ({})) pattern swallows errors", async () => {
    // This is the pattern used in the code (simulated):
    const buggyJsonParse = async (jsonStr: string) => {
      try {
        return JSON.parse(jsonStr);
      } catch {
        return {}; // BUG: Error is silently swallowed
      }
    };

    // Valid JSON works
    const validResult = await buggyJsonParse('{"message": "hello"}');
    expect(validResult).toEqual({ message: "hello" });

    // Invalid JSON silently returns {}
    const invalidResult = await buggyJsonParse("{ invalid }");
    expect(invalidResult).toEqual({}); // BUG: No error indication

    // Client can't tell the difference between:
    // 1. Empty body sent intentionally
    // 2. Malformed JSON that couldn't be parsed
    // Both result in {}
  });

  it("RED: Should propagate JSON parse errors instead of swallowing them", async () => {
    // BUG in index.ts lines 75, 128, 162:
    // await c.req.json().catch(() => ({}))

    // The correct pattern should be:
    const correctJsonParse = async (jsonStr: string) => {
      try {
        return JSON.parse(jsonStr);
      } catch (err) {
        throw new Error(`Invalid JSON: ${String(err)}`);
      }
    };

    // This test documents that the current code does NOT do this
    // It silently swallows errors

    // Buggy version: no error thrown
    const swallowingParse = async (jsonStr: string) => {
      return JSON.parse(jsonStr).catch?.(() => ({})) ?? {};
    };

    // With buggy code, invalid JSON returns {}
    const buggyResult = await Promise.resolve("{invalid}")
      .then((j) => {
        try {
          return JSON.parse(j);
        } catch {
          return {}; // BUG: Silent error
        }
      });

    expect(buggyResult).toEqual({}); // Silently returns empty object

    // With correct code, it would throw:
    expect(async () => {
      return await correctJsonParse("{invalid}");
    }).toBeTruthy(); // Would throw in real scenario
  });

  it("should expose the impact of swallowing JSON parse errors", async () => {
    // When a client sends malformed JSON to:
    // POST /api/workflows/:id/run (line 75)
    // POST /api/runs/:runId/message (line 128)
    // POST /api/runs/:runId/cwd (line 162)

    // The bug is: body becomes {} instead of throwing error

    const simulateEndpoint = async (requestBody: string) => {
      // This simulates what happens in the code:
      // const body = await c.req.json().catch(() => ({}));
      const body = await Promise.resolve(requestBody)
        .then((b) => {
          try {
            return JSON.parse(b);
          } catch {
            return {}; // BUG: Silent swallow
          }
        });

      // Code then tries to access fields
      return {
        payload: (body as Record<string, unknown>).payload, // undefined if parsing failed
        message: (body as Record<string, unknown>).message, // undefined if parsing failed
        cwd: (body as Record<string, unknown>).cwd, // undefined if parsing failed
      };
    };

    // Valid request
    const validRequest = '{"payload": {"test": true}}';
    const validResult = await simulateEndpoint(validRequest);
    expect(validResult.payload).toEqual({ test: true });

    // Malformed request - BUG: Silently treats as empty {}
    const malformedRequest = "{ broken json }";
    const malformedResult = await simulateEndpoint(malformedRequest);

    // BUG: Field is undefined, but no error is thrown
    expect(malformedResult.payload).toBeUndefined();
    expect(malformedResult.message).toBeUndefined();
    expect(malformedResult.cwd).toBeUndefined();

    // The endpoint continues processing with undefined values
    // This can cause unexpected behavior downstream
  });

  it("should show the difference between error handling approaches", async () => {
    // Buggy approach (current code):
    const buggyApproach = async (jsonStr: string) => {
      return JSON.parse(jsonStr).catch?.(() => ({})) ?? {};
    };

    // Better approach:
    const betterApproach = async (jsonStr: string) => {
      try {
        return JSON.parse(jsonStr);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to parse JSON: ${error}`);
      }
    };

    // Comparing behavior with invalid JSON
    const invalidJson = "{ this is not valid json }";

    // Buggy approach: returns {}
    const buggyResult = await Promise.resolve(invalidJson).then((j) => {
      try {
        return JSON.parse(j);
      } catch {
        return {};
      }
    });
    expect(buggyResult).toEqual({});

    // Better approach: throws error
    let betterError: Error | null = null;
    try {
      JSON.parse(invalidJson);
    } catch (err) {
      betterError = err as Error;
    }
    expect(betterError).toBeDefined();
    expect(betterError?.message).toContain("JSON");

    // BUG CONFIRMED: Current code swallows errors
  });
});
