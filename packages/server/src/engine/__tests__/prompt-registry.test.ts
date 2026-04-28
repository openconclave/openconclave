import { describe, test, expect } from "bun:test";
import {
  registerPrompt,
  respondToPrompt,
  clearPromptsForRun,
} from "../prompt-registry";

/** Flush all queued microtasks so promise callbacks have a chance to run. */
const tick = () => new Promise<void>(r => setTimeout(r, 0));

describe("registerPrompt / respondToPrompt — basic", () => {
  test("resolves when respondToPrompt is called", async () => {
    const p = registerPrompt(1000, "n1", "Q?", {});
    respondToPrompt(1000, "n1", "yes");
    await expect(p).resolves.toBe("yes");
  });

  test("rejects immediately when signal is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const p = registerPrompt(1001, "n2", "Q?", {}, ctrl.signal);
    await expect(p).rejects.toThrow("prompt aborted");
  });

  test("rejects when signal fires while waiting", async () => {
    const ctrl = new AbortController();
    const p = registerPrompt(1002, "n3", "Q?", {}, ctrl.signal);
    ctrl.abort();
    await expect(p).rejects.toThrow("prompt aborted");
  });
});

// MAJOR #1 — stale abort listener hang
describe("MAJOR #1: stale abort listener does not affect a successor call on the same key", () => {
  test("abort after second sequential call settles p2 with abort error (not hangs)", async () => {
    const ctrl = new AbortController();

    // First call — resolve normally (buggy code leaves a stale listener on ctrl.signal)
    const p1 = registerPrompt(2000, "nodeA", "Q1?", {}, ctrl.signal);
    respondToPrompt(2000, "nodeA", "answer1");
    await expect(p1).resolves.toBe("answer1");

    // Second sequential call on the same key
    const p2 = registerPrompt(2000, "nodeA", "Q2?", {}, ctrl.signal);

    // Track settlement without awaiting p2 directly (avoids hanging when buggy)
    let settled = false;
    let rejection: unknown = null;
    p2.then(() => { settled = true; }).catch(e => { settled = true; rejection = e; });

    // Fire abort — buggy code: stale listener deletes p2's entry; p2's own listener
    // finds nothing → p2 never settles → settled stays false → test fails correctly.
    ctrl.abort();
    await tick();

    expect(settled).toBe(true);
    expect((rejection as Error).message).toBe("prompt aborted");
  });

  test("abort after second call is already resolved is a no-op (regression guard)", async () => {
    const ctrl = new AbortController();

    const p1 = registerPrompt(2001, "nodeB", "Q1?", {}, ctrl.signal);
    respondToPrompt(2001, "nodeB", "answer1");
    await expect(p1).resolves.toBe("answer1");

    const p2 = registerPrompt(2001, "nodeB", "Q2?", {}, ctrl.signal);
    respondToPrompt(2001, "nodeB", "answer2");

    // Stale listener fires but p2 is already resolved — must be a no-op
    ctrl.abort();
    await expect(p2).resolves.toBe("answer2");
  });
});

// MAJOR #2 — duplicate registration
describe("MAJOR #2: duplicate registration on the same key rejects the new call", () => {
  test("second registerPrompt on same live key rejects immediately", async () => {
    const p1 = registerPrompt(3000, "nodeC", "Q1?", {});
    const p2 = registerPrompt(3000, "nodeC", "Q2?", {}); // duplicate

    // Track p2 settlement without awaiting (buggy code: p2 never rejects → hangs)
    let settled = false;
    let rejection: unknown = null;
    p2.then(() => { settled = true; }).catch(e => { settled = true; rejection = e; });

    await tick();

    expect(settled).toBe(true);
    expect((rejection as Error).message).toContain("duplicate prompt registration");

    // p1 must still be alive and resolvable
    respondToPrompt(3000, "nodeC", "first answer");
    await expect(p1).resolves.toBe("first answer");
  });
});

// MINOR #4 — clearPromptsForRun rejects instead of resolving with sentinel
describe("MINOR #4: clearPromptsForRun rejects pending promises", () => {
  test("pending promise rejects with 'run cancelled' error", async () => {
    const p = registerPrompt(4000, "nodeD", "Q?", {});
    clearPromptsForRun(4000);
    await expect(p).rejects.toThrow("run cancelled");
  });

  test("clears only prompts for the given runId", async () => {
    const pA = registerPrompt(5000, "nodeE", "Q?", {});
    const pB = registerPrompt(5001, "nodeF", "Q?", {});

    clearPromptsForRun(5000);

    await expect(pA).rejects.toThrow("run cancelled");

    // pB for a different run must still be resolvable
    respondToPrompt(5001, "nodeF", "still alive");
    await expect(pB).resolves.toBe("still alive");
  });

  test("returns the count of cleared entries", () => {
    // Attach no-op catch to suppress unhandled-rejection warnings
    registerPrompt(6000, "n1", "Q?", {}).catch(() => {});
    registerPrompt(6000, "n2", "Q?", {}).catch(() => {});
    registerPrompt(6001, "n3", "Q?", {}).catch(() => {});
    const count = clearPromptsForRun(6000);
    expect(count).toBe(2);
    clearPromptsForRun(6001);
  });
});

// MINOR #3 — dead export removed
describe("MINOR #3: getPendingPromptForRun is removed", () => {
  test("getPendingPromptForRun is not exported", () => {
    const mod = require("../prompt-registry") as Record<string, unknown>;
    expect(mod["getPendingPromptForRun"]).toBeUndefined();
  });
});
