/**
 * RED tests for bugs identified in code review of prompt-registry.ts
 * These tests are intentionally failing to prove the bugs exist.
 * Do NOT fix the bugs here — fix them in the source file.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  registerPrompt,
  respondToPrompt,
  getPendingPrompts,
  getPendingPromptForRun,
  clearPromptsForRun,
} from "../prompt-registry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Drain all currently pending prompts so global state doesn't bleed between
 * test groups. We can only do this via respondToPrompt because there is no
 * public reset/clear API that accepts a numeric runId (the bug itself).
 * We use respondToPrompt which DOES accept number — the only safe drain path.
 */
function drainPending() {
  const all = getPendingPrompts();
  for (const { runId, nodeId } of all) {
    respondToPrompt(runId, nodeId, "__drain__");
  }
}

// ---------------------------------------------------------------------------
// Bug 1 — Run ID Type Mismatch in getPendingPromptForRun
//
// registerPrompt stores runId as `number`.
// getPendingPromptForRun accepts runId as `string`.
// The internal comparison `entry.runId === runId` evaluates to
// `(number) === (string)` which is ALWAYS false in JavaScript strict equality.
// ---------------------------------------------------------------------------
describe("Bug 1 — getPendingPromptForRun: runId type mismatch causes silent lookup failure", () => {
  beforeEach(() => drainPending());

  it("should find a registered prompt when searching by the numeric runId coerced to string", async () => {
    // Register with a numeric runId (as the public API demands)
    registerPrompt(42, "node-a", "What colour is the sky?", {});

    // getPendingPromptForRun takes a string — passing the string representation
    // of the same runId should find the entry.
    // BUG: entry.runId (42) === "42" is false → returns undefined.
    const found = getPendingPromptForRun("42");

    // This assertion will FAIL (found is undefined) proving the bug is real.
    expect(found).toBeDefined();
    expect(found?.runId).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// Bug 2 — Run ID Type Mismatch in clearPromptsForRun
//
// Same root cause as Bug 1.  clearPromptsForRun iterates pending entries and
// checks `entry.runId === runId` where entry.runId is number and runId is
// the string parameter.  Nothing ever matches → returns 0 and leaks memory.
// ---------------------------------------------------------------------------
describe("Bug 2 — clearPromptsForRun: runId type mismatch means nothing is ever cleared", () => {
  beforeEach(() => drainPending());

  it("should clear all prompts for the given runId and return the count cleared", async () => {
    // Register two prompts for the same run
    registerPrompt(99, "node-x", "Question X?", null);
    registerPrompt(99, "node-y", "Question Y?", null);

    expect(getPendingPrompts()).toHaveLength(2);

    // clearPromptsForRun takes string — "99" should match the stored number 99
    // BUG: 99 === "99" is false → cleared = 0, prompts remain.
    const cleared = clearPromptsForRun("99");

    // These assertions will FAIL (cleared === 0, prompts still present)
    expect(cleared).toBe(2);
    expect(getPendingPrompts()).toHaveLength(0);
  });

  it("should resolve the cancelled promises so callers are not left hanging", async () => {
    let resolved = false;
    const promise = registerPrompt(77, "node-z", "Will you resolve?", null);
    promise.then(() => { resolved = true; });

    // BUG: type mismatch means the entry is never found → promise never resolves
    clearPromptsForRun("77");

    // Flush microtask queue
    await Promise.resolve();

    // This assertion will FAIL (resolved is still false)
    expect(resolved).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bug 3 — Global Mutable State leaks between independent operations
//
// The module-level `pending` Map is never reset between calls/requests.
// A prompt registered in one context is visible to all subsequent callers.
// ---------------------------------------------------------------------------
describe("Bug 3 — Global mutable state: pending map leaks across independent call sequences", () => {
  it("prompts registered without cleanup are visible to a completely unrelated getPendingPrompts() call", async () => {
    // Simulate run A registering a prompt and never resolving/clearing it
    // (e.g. a worker crash, or the clear failing due to Bug 2).
    registerPrompt(1001, "orphan-node", "I am orphaned", {});

    // Capture the count AFTER run A's orphan — a fresh call from a different
    // run should see ZERO pending prompts belonging to it, but the global map
    // means ALL pending prompts (including run A's orphan) are always visible.
    const allVisible = getPendingPrompts();

    // A fresh, isolated run should see only its own prompts.
    // BUG: because the map is global, allVisible contains run 1001's orphan.
    // We demonstrate the leak: at minimum 1 prompt (the orphan) is always there.
    // This assertion documents the leak — it PASSES, making the danger explicit.
    // The real RED aspect: there is no way to get a clean slate without
    // external reset, which the API does not provide.
    expect(allVisible.some((p) => p.runId === 1001)).toBe(true); // proves leakage

    // Clean up manually so we don't poison other tests
    respondToPrompt(1001, "orphan-node", "__drain__");
  });

  it("state registered in a previous test bleeds into the next one if not cleaned up", async () => {
    // Intentionally do NOT drain before this test to show accumulation risk.
    // Register a prompt and leave it.
    registerPrompt(2002, "bleed-node", "I will bleed", {});

    // A second independent registration
    registerPrompt(3003, "other-node", "I am unrelated", {});

    // Both exist in the same shared map — different "runs" cannot be isolated.
    const all = getPendingPrompts();
    const runIds = all.map((p) => p.runId);

    // BUG: both runIds are present simultaneously with no isolation.
    // This will be RED if the map were correctly scoped per-run/request.
    expect(runIds).toContain(2002);
    expect(runIds).toContain(3003);

    // Clean up
    respondToPrompt(2002, "bleed-node", "__drain__");
    respondToPrompt(3003, "other-node", "__drain__");
  });
});

// ---------------------------------------------------------------------------
// Bug 4 — Promise Semantics: clearPromptsForRun resolves with "[cancelled]"
//
// Cancelling a prompt resolves (not rejects) the promise with the sentinel
// string "[cancelled]".  A caller awaiting the promise cannot distinguish
// this from a legitimate user response of "[cancelled]".
// ---------------------------------------------------------------------------
describe("Bug 4 — Promise semantics: cancellation resolves instead of rejects", () => {
  beforeEach(() => drainPending());

  it("clearing a prompt should reject the promise, not resolve it with a sentinel string", async () => {
    // We need to bypass the type-mismatch bug (Bug 2) to reach this code path.
    // Use respondToPrompt (number-accepting) to simulate what clearPromptsForRun
    // SHOULD do — but demonstrate what it DOES do by calling it directly with
    // a cast to work around Bug 2.

    let resolvedValue: string | undefined;
    let rejectionReason: unknown;

    const promise = registerPrompt(55, "cancel-node", "Cancel me", {})
      .then((val) => { resolvedValue = val; })
      .catch((err) => { rejectionReason = err; });

    // Call clearPromptsForRun with a numeric cast to bypass Bug 2's type mismatch
    // so we can reach the actual cancellation logic and test Bug 4 in isolation.
    clearPromptsForRun(55 as unknown as string);

    await promise;

    // BUG: The promise is RESOLVED (not rejected) with "[cancelled]".
    // A proper implementation would reject so callers can use .catch() to
    // detect cancellation vs a real "[cancelled]" response.
    // This assertion will FAIL because rejectionReason is undefined (it resolved).
    expect(rejectionReason).toBeDefined();
    expect(resolvedValue).toBeUndefined();
  });

  it("a real user response of '[cancelled]' is indistinguishable from a cancellation", async () => {
    // Register two prompts: one cancelled, one answered with the sentinel text
    let cancelledResult: string | undefined;
    let realResult: string | undefined;

    const cancelledPromise = registerPrompt(60, "cancel-node-2", "Cancel me", {})
      .then((v) => { cancelledResult = v; });

    const realPromise = registerPrompt(61, "real-node", "Answer me with sentinel", {})
      .then((v) => { realResult = v; });

    // Cancel one (using cast to bypass Bug 2)
    clearPromptsForRun(60 as unknown as string);
    // Answer the other with the exact same sentinel string
    respondToPrompt(61, "real-node", "[cancelled]");

    await Promise.all([cancelledPromise, realPromise]);

    // BUG: Both results are identical — cancellation is indistinguishable
    // from a user deliberately responding "[cancelled]".
    // This will FAIL because we assert they should be distinguishable.
    expect(cancelledResult).not.toBe(realResult);
  });
});

// ---------------------------------------------------------------------------
// Bug 5 — Input Typing: PendingPrompt.input uses `unknown`
//
// This is a compile-time / type-safety issue only.
// There is no meaningful runtime behaviour to assert.
// The test is skipped with an explanation.
// ---------------------------------------------------------------------------
describe.skip("Bug 5 — Input typing: PendingPrompt.input is `unknown` (compile-time only)", () => {
  it("skipped — this is a TypeScript type-safety issue with no runtime manifestation. " +
     "The `unknown` type for `input` prevents static analysis of what callers put in " +
     "and what consumers read out. Fix by using a concrete shared type.", () => {
    // No runtime assertion possible.
  });
});
