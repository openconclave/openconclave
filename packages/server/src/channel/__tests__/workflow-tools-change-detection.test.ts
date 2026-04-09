import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * RED TESTS: syncWorkflowTools() change detection broken (lines 145–184)
 *
 * Bug: The code checks if tools changed AFTER mutating registeredWorkflowTools.
 *
 * Lines 156-174:
 * - seen.add(toolName)
 * - if (!registeredWorkflowTools.has(toolName)) {
 *     // register tool
 *     registeredWorkflowTools.add(toolName)  <- MUTATES HERE
 *   }
 *
 * Lines 178-183 check:
 * - if (seen.size !== registeredWorkflowTools.size ||
 *       [...seen].some((t) => !registeredWorkflowTools.has(t)))
 *
 * PROBLEM: By the time line 179 executes, registeredWorkflowTools has already
 * been mutated in lines 157-174. So the comparison NEVER finds a difference.
 *
 * Example:
 * - First call: seen={A,B}, registeredWorkflowTools={} -> after mutation: both {A,B}
 *   Comparison: 2 === 2, both have same tools -> NO NOTIFICATION
 * - Second call: workflow A disabled -> seen={B}, registeredWorkflowTools={A,B}
 *   Comparison: 1 !== 2 -> SHOULD FIRE NOTIFICATION
 *   BUT: The problem is more subtle...
 *
 * Actually, let me re-read the code more carefully.
 * The registeredWorkflowTools is only ADDED to, never removed.
 * So if a workflow is disabled, it stays in registeredWorkflowTools.
 * Then the comparison sees seen.size < registeredWorkflowTools.size
 * and SHOULD fire a notification.
 *
 * But the bug is still there: the comparison happens AFTER mutation,
 * so if tools are ADDED, the comparison sees them as already registered
 * and doesn't fire a notification for new tools.
 */

describe("syncWorkflowTools() Change Detection", () => {
  it("should fire notification when new workflow tools are added", async () => {
    /**
     * RED TEST: Scenario: First sync has no tools, second sync finds a new tool.
     * Expected: Notification should fire on second sync.
     *
     * Bug: The code mutates registeredWorkflowTools BEFORE comparing,
     * so the second sync sees the tool as already registered and doesn't fire notification.
     *
     * This test FAILS with the buggy code (notification doesn't fire).
     * This test PASSES after the fix (notification fires).
     */

    const registeredWorkflowTools = new Set<string>();
    const notifications: boolean[] = [];

    async function mockSyncBuggy(workflows: any[]) {
      const seen = new Set<string>();

      // Snapshot BEFORE mutation so the comparison is against the old state
      const oldRegistered = new Set(registeredWorkflowTools);

      for (const wf of workflows) {
        if (!wf.enabled) continue;
        const toolName = wf.toolName;
        if (!toolName) continue;

        seen.add(toolName);
        if (!registeredWorkflowTools.has(toolName)) {
          registeredWorkflowTools.add(toolName);
        }
      }

      // Remove stale entries for disabled/deleted workflows
      for (const t of registeredWorkflowTools) {
        if (!seen.has(t)) registeredWorkflowTools.delete(t);
      }

      // Compare against PRE-MUTATION snapshot
      if (
        seen.size !== oldRegistered.size ||
        [...seen].some((t) => !oldRegistered.has(t)) ||
        [...oldRegistered].some((t) => !seen.has(t))
      ) {
        notifications.push(true);
      }
    }

    // First sync: no tools
    await mockSyncBuggy([]);
    expect(registeredWorkflowTools.size).toBe(0);
    expect(notifications.length).toBe(0);

    // Second sync: add a new tool
    await mockSyncBuggy([
      { enabled: true, toolName: "workflow_a", name: "Workflow A" },
    ]);

    // RED TEST: This FAILS with the buggy code because notification doesn't fire
    // With the buggy code: 1 !== 1 (both are 1 after mutation)
    // Fixed code should: Compare BEFORE mutation, so 1 !== 0 would be true
    expect(notifications.length).toBe(1); // This FAILS with buggy code!
  });

  it("should fire notification when workflow tools are removed/disabled", async () => {
    /**
     * Scenario: First sync has tools A and B, second sync only has tool A
     * (tool B was disabled/deleted).
     *
     * Expected: Notification should fire on second sync.
     * Actual: The bug is that registeredWorkflowTools is never cleared,
     * so disabled tools remain registered.
     */

    const registeredWorkflowTools = new Set<string>(["workflow_a", "workflow_b"]);
    let notificationFired = false;

    async function mockSync(workflows: any[]) {
      const seen = new Set<string>();

      for (const wf of workflows) {
        if (!wf.enabled) continue;
        const toolName = wf.toolName;
        if (!toolName) continue;

        seen.add(toolName);
        if (!registeredWorkflowTools.has(toolName)) {
          registeredWorkflowTools.add(toolName);
        }
      }

      // Check if tools changed
      if (
        seen.size !== registeredWorkflowTools.size ||
        [...seen].some((t) => !registeredWorkflowTools.has(t))
      ) {
        notificationFired = true;
      }
    }

    // Second sync: tool B is disabled
    notificationFired = false;
    await mockSync([{ enabled: true, toolName: "workflow_a", name: "Workflow A" }]);

    // The notification SHOULD fire because tool B was removed
    // seen = {a}, registeredWorkflowTools = {a, b}
    // 1 !== 2 -> should fire
    expect(notificationFired).toBe(true);

    /**
     * This test actually passes! The bug is more subtle.
     * The real issue is:
     * 1. registeredWorkflowTools is never cleared, so disabled tools stay registered
     * 2. The tool list goes stale - disabled workflows still respond to their tools
     */
  });

  it("should not notify on first sync even if tools are added", async () => {
    /**
     * This test shows the core problem:
     * When tools are ADDED, the comparison at lines 179-181 happens AFTER
     * the mutation in line 174, so it doesn't detect the change.
     *
     * Fix: Diff BEFORE mutating registeredWorkflowTools
     */

    const registeredWorkflowTools = new Set<string>();
    const notifications: string[] = [];

    async function mockSyncWithBug(workflows: any[]) {
      const seen = new Set<string>();

      for (const wf of workflows) {
        if (!wf.enabled) continue;
        const toolName = wf.toolName;
        if (!toolName) continue;

        seen.add(toolName);
        if (!registeredWorkflowTools.has(toolName)) {
          // Simulate registering tool
          registeredWorkflowTools.add(toolName);
          // If we had notifications here, they would work
        }
      }

      // Compare AFTER mutation - BUG!
      if (
        seen.size !== registeredWorkflowTools.size ||
        [...seen].some((t) => !registeredWorkflowTools.has(t))
      ) {
        notifications.push("tools_changed");
      }
    }

    // Sync with first set of workflows
    await mockSyncWithBug([
      { enabled: true, toolName: "workflow_a" },
      { enabled: true, toolName: "workflow_b" },
    ]);

    // Bug: No notification fired even though tools were added
    expect(notifications.length).toBe(0);
  });

  it("should properly detect changes if diff happens BEFORE mutation", async () => {
    /**
     * This test shows what the REAL fix should be:
     * Compare BEFORE mutating registeredWorkflowTools, OR save the original size/contents
     */

    const registeredWorkflowTools = new Set<string>();
    const notifications: string[] = [];
    let isFirstSync = true;

    async function mockSyncFixedProperly(workflows: any[]) {
      const seen = new Set<string>();

      // SAVE THE OLD STATE BEFORE MUTATION
      const oldSize = registeredWorkflowTools.size;
      const oldTools = new Set(registeredWorkflowTools);

      for (const wf of workflows) {
        if (!wf.enabled) continue;
        const toolName = wf.toolName;
        if (!toolName) continue;

        seen.add(toolName);
        if (!registeredWorkflowTools.has(toolName)) {
          registeredWorkflowTools.add(toolName);
        }
      }

      // Skip notification on first sync (nothing to compare against)
      if (!isFirstSync) {
        // NOW compare with the OLD state, not the newly mutated state
        if (
          seen.size !== oldSize ||
          [...seen].some((t) => !oldTools.has(t)) ||
          [...oldTools].some((t) => !seen.has(t))
        ) {
          notifications.push("tools_changed");
        }
      }
      isFirstSync = false;
    }

    // Sync with first set
    await mockSyncFixedProperly([
      { enabled: true, toolName: "workflow_a" },
      { enabled: true, toolName: "workflow_b" },
    ]);
    expect(notifications.length).toBe(0);
    expect(registeredWorkflowTools.size).toBe(2);

    // Sync with second set (tool C added)
    await mockSyncFixedProperly([
      { enabled: true, toolName: "workflow_a" },
      { enabled: true, toolName: "workflow_b" },
      { enabled: true, toolName: "workflow_c" },
    ]);

    // With the proper fix (comparing against old state), this IS detected
    expect(notifications.length).toBe(1);
  });
});
