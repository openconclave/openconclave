import { describe, it, expect, vi } from "vitest";
import type { RunEvent, QueueEntry, RouteTarget, EventCallback } from "./types";

// ── RunEvent ─────────────────────────────────────────────────

describe("RunEvent", () => {
  describe("minimal required fields", () => {
    it("accepts an object with only type and runId", () => {
      const event: RunEvent = { type: "run:started", runId: 1 };
      expect(event.type).toBe("run:started");
      expect(event.runId).toBe(1);
    });

    it("stores runId as a number", () => {
      const event: RunEvent = { type: "run:completed", runId: 42 };
      expect(typeof event.runId).toBe("number");
    });

    it("stores type as a string", () => {
      const event: RunEvent = { type: "node:started", runId: 7 };
      expect(typeof event.type).toBe("string");
    });
  });

  describe("optional nodeId field", () => {
    it("is undefined when not provided", () => {
      const event: RunEvent = { type: "run:started", runId: 1 };
      expect(event.nodeId).toBeUndefined();
    });

    it("accepts a string nodeId", () => {
      const event: RunEvent = { type: "node:started", runId: 1, nodeId: "node-abc" };
      expect(event.nodeId).toBe("node-abc");
    });

    it("accepts an empty string nodeId", () => {
      const event: RunEvent = { type: "node:started", runId: 1, nodeId: "" };
      expect(event.nodeId).toBe("");
    });
  });

  describe("optional data field", () => {
    it("is undefined when not provided", () => {
      const event: RunEvent = { type: "run:started", runId: 1 };
      expect(event.data).toBeUndefined();
    });

    it("accepts a plain object as data", () => {
      const payload = { status: "success" };
      const event: RunEvent = { type: "run:completed", runId: 5, data: payload };
      expect(event.data).toEqual({ status: "success" });
    });

    it("accepts a string as data", () => {
      const event: RunEvent = { type: "agent:output", runId: 3, data: "hello" };
      expect(event.data).toBe("hello");
    });

    it("accepts a number as data", () => {
      const event: RunEvent = { type: "agent:output", runId: 3, data: 99 };
      expect(event.data).toBe(99);
    });

    it("accepts null as data", () => {
      const event: RunEvent = { type: "node:failed", runId: 2, data: null };
      expect(event.data).toBeNull();
    });

    it("accepts an array as data", () => {
      const event: RunEvent = { type: "agent:thinking", runId: 4, data: [1, 2, 3] };
      expect(event.data).toEqual([1, 2, 3]);
    });

    it("accepts a nested object as data", () => {
      const event: RunEvent = {
        type: "agent:completed",
        runId: 6,
        nodeId: "node-1",
        data: { taskId: 10, success: true, durationMs: 500 },
      };
      expect(event.data).toEqual({ taskId: 10, success: true, durationMs: 500 });
    });
  });

  describe("all fields present", () => {
    it("holds all four fields simultaneously", () => {
      const event: RunEvent = {
        type: "node:completed",
        runId: 99,
        nodeId: "node-xyz",
        data: { result: "done" },
      };
      expect(event.type).toBe("node:completed");
      expect(event.runId).toBe(99);
      expect(event.nodeId).toBe("node-xyz");
      expect(event.data).toEqual({ result: "done" });
    });
  });

  describe("known event type strings used in the engine", () => {
    const knownTypes = [
      "run:started",
      "run:completed",
      "node:started",
      "node:completed",
      "node:failed",
      "agent:started",
      "agent:output",
      "agent:completed",
      "agent:thinking",
    ];

    for (const type of knownTypes) {
      it(`accepts type "${type}"`, () => {
        const event: RunEvent = { type, runId: 1 };
        expect(event.type).toBe(type);
      });
    }
  });

  describe("runId boundary values", () => {
    it("accepts runId of 0", () => {
      const event: RunEvent = { type: "run:started", runId: 0 };
      expect(event.runId).toBe(0);
    });

    it("accepts a large integer runId", () => {
      const event: RunEvent = { type: "run:started", runId: 2_147_483_647 };
      expect(event.runId).toBe(2_147_483_647);
    });

    it("accepts a negative runId (no schema constraint at type level)", () => {
      const event: RunEvent = { type: "run:started", runId: -1 };
      expect(event.runId).toBe(-1);
    });
  });
});

// ── QueueEntry ───────────────────────────────────────────────

describe("QueueEntry", () => {
  describe("required nodeId field", () => {
    it("accepts a non-empty nodeId", () => {
      const entry: QueueEntry = { nodeId: "node-1", triggeredBy: null };
      expect(entry.nodeId).toBe("node-1");
    });

    it("accepts an empty string as nodeId", () => {
      const entry: QueueEntry = { nodeId: "", triggeredBy: null };
      expect(entry.nodeId).toBe("");
    });
  });

  describe("triggeredBy field", () => {
    it("accepts null for entry-point nodes (no parent)", () => {
      const entry: QueueEntry = { nodeId: "trigger-node", triggeredBy: null };
      expect(entry.triggeredBy).toBeNull();
    });

    it("accepts a string for nodes triggered by a parent", () => {
      const entry: QueueEntry = { nodeId: "agent-node", triggeredBy: "trigger-node" };
      expect(entry.triggeredBy).toBe("trigger-node");
    });

    it("stores triggeredBy as a string when present", () => {
      const entry: QueueEntry = { nodeId: "node-b", triggeredBy: "node-a" };
      expect(typeof entry.triggeredBy).toBe("string");
    });

    it("stores null when triggeredBy is explicitly null", () => {
      const entry: QueueEntry = { nodeId: "node-a", triggeredBy: null };
      expect(entry.triggeredBy).toBeNull();
    });
  });

  describe("usage pattern: entry-point queue construction", () => {
    it("can build an array of QueueEntries from node IDs", () => {
      const nodeIds = ["node-1", "node-2", "node-3"];
      const queue: QueueEntry[] = nodeIds.map((id) => ({
        nodeId: id,
        triggeredBy: null,
      }));

      expect(queue).toHaveLength(3);
      expect(queue[0]).toEqual({ nodeId: "node-1", triggeredBy: null });
      expect(queue[1]).toEqual({ nodeId: "node-2", triggeredBy: null });
      expect(queue[2]).toEqual({ nodeId: "node-3", triggeredBy: null });
    });

    it("can construct a downstream QueueEntry linking parent to child", () => {
      const parent: QueueEntry = { nodeId: "parent", triggeredBy: null };
      const child: QueueEntry = { nodeId: "child", triggeredBy: parent.nodeId };

      expect(child.triggeredBy).toBe("parent");
    });
  });

  describe("deep equality", () => {
    it("two entries with the same fields are deeply equal", () => {
      const a: QueueEntry = { nodeId: "node-x", triggeredBy: "node-y" };
      const b: QueueEntry = { nodeId: "node-x", triggeredBy: "node-y" };
      expect(a).toEqual(b);
    });

    it("two entries with different nodeIds are not equal", () => {
      const a: QueueEntry = { nodeId: "node-x", triggeredBy: null };
      const b: QueueEntry = { nodeId: "node-z", triggeredBy: null };
      expect(a).not.toEqual(b);
    });

    it("null vs string triggeredBy produces unequal entries", () => {
      const a: QueueEntry = { nodeId: "node-x", triggeredBy: null };
      const b: QueueEntry = { nodeId: "node-x", triggeredBy: "node-y" };
      expect(a).not.toEqual(b);
    });
  });
});

// ── RouteTarget ──────────────────────────────────────────────

describe("RouteTarget", () => {
  describe("required fields", () => {
    it("accepts an object with nodeId, label, and type", () => {
      const target: RouteTarget = { nodeId: "node-1", label: "Success Path", type: "agent" };
      expect(target.nodeId).toBe("node-1");
      expect(target.label).toBe("Success Path");
      expect(target.type).toBe("agent");
    });

    it("stores nodeId as a string", () => {
      const target: RouteTarget = { nodeId: "abc", label: "L", type: "output" };
      expect(typeof target.nodeId).toBe("string");
    });

    it("stores label as a string", () => {
      const target: RouteTarget = { nodeId: "abc", label: "My Label", type: "agent" };
      expect(typeof target.label).toBe("string");
    });

    it("stores type as a string", () => {
      const target: RouteTarget = { nodeId: "abc", label: "L", type: "condition" };
      expect(typeof target.type).toBe("string");
    });
  });

  describe("optional description field", () => {
    it("is undefined when not provided", () => {
      const target: RouteTarget = { nodeId: "n1", label: "Route A", type: "agent" };
      expect(target.description).toBeUndefined();
    });

    it("accepts a description string", () => {
      const target: RouteTarget = {
        nodeId: "n1",
        label: "Route A",
        type: "agent",
        description: "Handle happy path",
      };
      expect(target.description).toBe("Handle happy path");
    });

    it("accepts an empty string as description", () => {
      const target: RouteTarget = { nodeId: "n1", label: "Route A", type: "agent", description: "" };
      expect(target.description).toBe("");
    });
  });

  describe("all fields present", () => {
    it("holds all four fields simultaneously", () => {
      const target: RouteTarget = {
        nodeId: "output-node",
        label: "Final Output",
        type: "output",
        description: "Send result to user",
      };
      expect(target).toEqual({
        nodeId: "output-node",
        label: "Final Output",
        type: "output",
        description: "Send result to user",
      });
    });
  });

  describe("usage pattern: building a route list", () => {
    it("can be used in an array to represent multiple routing options", () => {
      const routes: RouteTarget[] = [
        { nodeId: "node-success", label: "Success", type: "output" },
        { nodeId: "node-failure", label: "Failure", type: "output", description: "Error branch" },
        { nodeId: "node-retry", label: "Retry", type: "agent" },
      ];

      expect(routes).toHaveLength(3);
      expect(routes[0].nodeId).toBe("node-success");
      expect(routes[1].description).toBe("Error branch");
      expect(routes[2].label).toBe("Retry");
    });

    it("can filter routes by type", () => {
      const routes: RouteTarget[] = [
        { nodeId: "n1", label: "Agent Route", type: "agent" },
        { nodeId: "n2", label: "Output Route", type: "output" },
        { nodeId: "n3", label: "Another Agent", type: "agent" },
      ];

      const agentRoutes = routes.filter((r) => r.type === "agent");
      expect(agentRoutes).toHaveLength(2);
      expect(agentRoutes.map((r) => r.nodeId)).toEqual(["n1", "n3"]);
    });

    it("can format routes into instruction strings as done in agent-executor", () => {
      const routes: RouteTarget[] = [
        { nodeId: "node-a", label: "Path A", type: "agent", description: "Go here if success" },
        { nodeId: "node-b", label: "Path B", type: "output" },
      ];

      const formatted = routes.map((r) => {
        const desc = r.description ? ` — ${r.description}` : "";
        return `  - "${r.nodeId}" → ${r.label} (${r.type})${desc}`;
      });

      expect(formatted[0]).toBe('  - "node-a" → Path A (agent) — Go here if success');
      expect(formatted[1]).toBe('  - "node-b" → Path B (output)');
    });
  });

  describe("deep equality", () => {
    it("two targets with identical fields are deeply equal", () => {
      const a: RouteTarget = { nodeId: "n1", label: "L", type: "agent", description: "D" };
      const b: RouteTarget = { nodeId: "n1", label: "L", type: "agent", description: "D" };
      expect(a).toEqual(b);
    });

    it("targets differing by description are not equal", () => {
      const a: RouteTarget = { nodeId: "n1", label: "L", type: "agent" };
      const b: RouteTarget = { nodeId: "n1", label: "L", type: "agent", description: "Extra" };
      expect(a).not.toEqual(b);
    });
  });
});

// ── EventCallback ────────────────────────────────────────────

describe("EventCallback", () => {
  describe("invocation semantics", () => {
    it("can be assigned a function that receives a RunEvent", () => {
      const received: RunEvent[] = [];
      const callback: EventCallback = (event) => received.push(event);

      callback({ type: "run:started", runId: 1 });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ type: "run:started", runId: 1 });
    });

    it("receives all fields passed in the event", () => {
      let captured: RunEvent | null = null;
      const callback: EventCallback = (event) => {
        captured = event;
      };

      callback({ type: "node:completed", runId: 5, nodeId: "node-1", data: { result: 42 } });

      expect(captured).not.toBeNull();
      expect((captured as RunEvent).type).toBe("node:completed");
      expect((captured as RunEvent).runId).toBe(5);
      expect((captured as RunEvent).nodeId).toBe("node-1");
      expect((captured as RunEvent).data).toEqual({ result: 42 });
    });

    it("returns void (result of calling it is undefined)", () => {
      const callback: EventCallback = (_event) => {
        // intentionally returns nothing
      };

      const result = callback({ type: "run:started", runId: 1 });
      expect(result).toBeUndefined();
    });

    it("can be called multiple times accumulating events", () => {
      const log: string[] = [];
      const callback: EventCallback = (event) => log.push(event.type);

      callback({ type: "run:started", runId: 10 });
      callback({ type: "node:started", runId: 10, nodeId: "n1" });
      callback({ type: "node:completed", runId: 10, nodeId: "n1" });
      callback({ type: "run:completed", runId: 10 });

      expect(log).toEqual(["run:started", "node:started", "node:completed", "run:completed"]);
    });

    it("works when used as a vi.fn() spy", () => {
      const callback: EventCallback = vi.fn();
      const event: RunEvent = { type: "agent:started", runId: 3, nodeId: "agent-1" };

      callback(event);

      expect(callback).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledWith(event);
    });

    it("can be a no-op callback", () => {
      const noop: EventCallback = () => undefined;
      expect(() => noop({ type: "run:started", runId: 1 })).not.toThrow();
    });

    it("can be used to filter specific event types", () => {
      const nodeEvents: RunEvent[] = [];
      const callback: EventCallback = (event) => {
        if (event.type.startsWith("node:")) {
          nodeEvents.push(event);
        }
      };

      callback({ type: "run:started", runId: 1 });
      callback({ type: "node:started", runId: 1, nodeId: "n1" });
      callback({ type: "node:completed", runId: 1, nodeId: "n1" });
      callback({ type: "run:completed", runId: 1 });

      expect(nodeEvents).toHaveLength(2);
      expect(nodeEvents[0].type).toBe("node:started");
      expect(nodeEvents[1].type).toBe("node:completed");
    });
  });

  describe("optional callback pattern (onEvent?)", () => {
    it("can be stored as an optional property and called conditionally", () => {
      interface Holder {
        onEvent?: EventCallback;
      }

      const events: RunEvent[] = [];
      const withCallback: Holder = { onEvent: (e) => events.push(e) };
      const withoutCallback: Holder = {};

      withCallback.onEvent?.({ type: "run:started", runId: 1 });
      withoutCallback.onEvent?.({ type: "run:started", runId: 2 });

      expect(events).toHaveLength(1);
      expect(events[0].runId).toBe(1);
    });

    it("does not throw when optional EventCallback is undefined", () => {
      const cb: EventCallback | undefined = undefined;
      expect(() => cb?.({ type: "run:started", runId: 1 })).not.toThrow();
    });
  });
});

// ── Cross-type integration ────────────────────────────────────

describe("type interaction patterns", () => {
  it("EventCallback can emit events that carry QueueEntry-related nodeId values", () => {
    const entry: QueueEntry = { nodeId: "worker-node", triggeredBy: "trigger-node" };
    const emitted: RunEvent[] = [];
    const emit: EventCallback = (event) => emitted.push(event);

    emit({ type: "node:started", runId: 1, nodeId: entry.nodeId });

    expect(emitted[0].nodeId).toBe(entry.nodeId);
  });

  it("RouteTarget nodeId can be used as a QueueEntry nodeId", () => {
    const route: RouteTarget = { nodeId: "destination-node", label: "Dest", type: "agent" };
    const entry: QueueEntry = { nodeId: route.nodeId, triggeredBy: "source-node" };

    expect(entry.nodeId).toBe(route.nodeId);
  });

  it("RunEvent emitted for a RouteTarget carries the correct nodeId", () => {
    const route: RouteTarget = { nodeId: "output-1", label: "Output", type: "output" };
    const event: RunEvent = { type: "node:started", runId: 7, nodeId: route.nodeId };

    expect(event.nodeId).toBe("output-1");
  });

  it("a workflow step sequence can be modelled as RunEvents in order", () => {
    const runId = 42;
    const steps: RunEvent[] = [
      { type: "run:started", runId },
      { type: "node:started", runId, nodeId: "trigger-node" },
      { type: "node:completed", runId, nodeId: "trigger-node", data: "payload" },
      { type: "node:started", runId, nodeId: "agent-node" },
      { type: "agent:started", runId, nodeId: "agent-node", data: { taskId: 1 } },
      { type: "agent:completed", runId, nodeId: "agent-node", data: { success: true } },
      { type: "node:completed", runId, nodeId: "agent-node", data: "result" },
      { type: "run:completed", runId, data: { status: "success" } },
    ];

    expect(steps).toHaveLength(8);
    expect(steps[0].type).toBe("run:started");
    expect(steps[steps.length - 1].type).toBe("run:completed");
    expect(steps[steps.length - 1].data).toEqual({ status: "success" });
    // All events share the same runId
    expect(steps.every((e) => e.runId === runId)).toBe(true);
  });
});
