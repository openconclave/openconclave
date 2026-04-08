/**
 * run-detail.test.tsx
 * Tests for the RunDetailPage component, covering checkpoint/resume UI
 * introduced in Phase 1+2 of the checkpointing feature.
 *
 * KEY LESSONS:
 * 1. Do NOT call vi.useFakeTimers() globally — it intercepts waitFor's internal
 *    setInterval and causes every test to time out.
 * 2. The polling effect re-fires when data?.run.status changes (it's a dep).
 *    This means api.get is called a SECOND time for /runs/:id after data loads.
 *    Use URL-routing mocks to handle this correctly.
 * 3. Use vi.resetAllMocks() in afterEach to clear implementations from
 *    mockResolvedValue/mockRejectedValue calls that persist across tests.
 */

import { render, screen, waitFor, act, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { RunDetailPage } from "../run-detail";
import type { RunDetailResponse } from "@openconclave/shared";

// ── Module mocks ────────────────────────────────────────────────────────────

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock("@/components/ui/toast", () => ({
  toast: vi.fn(),
}));

// Simplify react-markdown to avoid complex HTML rendering in jsdom
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <span data-testid="md">{children}</span>,
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

import { api } from "@/lib/api";
import { toast } from "@/components/ui/toast";

const mockApi = api as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const mockToast = toast as ReturnType<typeof vi.fn>;

function makeRunDetail(overrides: Partial<RunDetailResponse> = {}): RunDetailResponse {
  return {
    run: {
      id: 42,
      workflowId: 7,
      status: "failure",
      triggerType: "manual",
      startedAt: "2026-04-04T10:00:00.000Z",
      completedAt: "2026-04-04T10:01:00.000Z",
      error: "Node agent-1 failed",
      createdAt: "2026-04-04T10:00:00.000Z",
    },
    tasks: [],
    events: [],
    checkpoint: {
      completedNodes: ["trigger-1", "agent-1"],
      createdAt: "2026-04-04T10:00:30.000Z",
    },
    ...overrides,
  };
}

/**
 * Set up a URL-routing mock for api.get.
 * Routes /runs/:id calls to runData, /workflows/:id calls to workflowData.
 *
 * IMPORTANT: Because the polling effect re-fires when data?.run.status
 * changes (it's in the dependency array), api.get is called at least TWICE
 * for /runs/:id during a test. A catch-all mockResolvedValue({nodes:[]})
 * would serve wrong data on the second run call, crashing the component.
 */
function setupGetMock(
  runData: RunDetailResponse,
  workflowNodes: Array<{ id: string; data?: { label?: string } }> = []
) {
  mockApi.get.mockImplementation((path: string) => {
    if ((path as string).startsWith("/runs/")) {
      return Promise.resolve(runData);
    }
    if ((path as string).startsWith("/workflows/")) {
      return Promise.resolve({ definition: { nodes: workflowNodes } });
    }
    return Promise.resolve({});
  });
}

/** Set window.location.pathname for the component's URL parsing. */
function setPathname(path: string) {
  Object.defineProperty(window, "location", {
    value: { pathname: path, href: "" },
    writable: true,
    configurable: true,
  });
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe("RunDetailPage", () => {
  beforeEach(() => {
    setPathname("/runs/42");
  });

  afterEach(() => {
    cleanup();
    vi.resetAllMocks();  // clears call history AND implementations
  });

  // ── Loading / error states ─────────────────────────────────────────────

  describe("loading and error states", () => {
    it("shows loading message while data is being fetched", () => {
      mockApi.get.mockReturnValue(new Promise(() => {}));

      render(<RunDetailPage />);

      expect(screen.getByText("Loading...")).toBeInTheDocument();
    });

    it("shows error message when initial fetch fails", async () => {
      mockApi.get.mockRejectedValue(new Error("Network error"));

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("Failed to load run details")).toBeInTheDocument();
      });
    });

    it("renders run summary after successful fetch", async () => {
      setupGetMock(makeRunDetail());

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("failure")).toBeInTheDocument();
      });

      // Run ID shown in monospace span
      expect(screen.getByText("42")).toBeInTheDocument();
    });
  });

  // ── Resume button visibility ───────────────────────────────────────────

  describe("Resume button visibility", () => {
    it("shows Resume button for failure status with checkpoint", async () => {
      setupGetMock(makeRunDetail());

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /resume from checkpoint/i })
        ).toBeInTheDocument();
      });
    });

    it("shows Resume button for interrupted status with checkpoint", async () => {
      setupGetMock(
        makeRunDetail({ run: { ...makeRunDetail().run, status: "interrupted" } })
      );

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /resume from checkpoint/i })
        ).toBeInTheDocument();
      });
    });

    it("hides Resume button when checkpoint is null", async () => {
      setupGetMock(makeRunDetail({ checkpoint: null }));

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("failure")).toBeInTheDocument();
      });
      expect(
        screen.queryByRole("button", { name: /resume from checkpoint/i })
      ).not.toBeInTheDocument();
    });

    it("hides Resume button when checkpoint is undefined (missing from response)", async () => {
      const data = makeRunDetail();
      const { checkpoint: _removed, ...dataNoCheckpoint } = data;
      setupGetMock(dataNoCheckpoint as RunDetailResponse);

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("failure")).toBeInTheDocument();
      });
      expect(
        screen.queryByRole("button", { name: /resume from checkpoint/i })
      ).not.toBeInTheDocument();
    });

    it("hides Resume button for success status even when checkpoint is present", async () => {
      setupGetMock(
        makeRunDetail({ run: { ...makeRunDetail().run, status: "success" } })
      );

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("success")).toBeInTheDocument();
      });
      expect(
        screen.queryByRole("button", { name: /resume from checkpoint/i })
      ).not.toBeInTheDocument();
    });

    it("hides Resume button for running status", async () => {
      setupGetMock(
        makeRunDetail({
          run: { ...makeRunDetail().run, status: "running" },
          checkpoint: null,
        })
      );

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("running")).toBeInTheDocument();
      });
      expect(
        screen.queryByRole("button", { name: /resume from checkpoint/i })
      ).not.toBeInTheDocument();
    });

    it("hides Resume button for cancelled status", async () => {
      setupGetMock(
        makeRunDetail({
          run: { ...makeRunDetail().run, status: "cancelled" },
          checkpoint: null,
        })
      );

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("cancelled")).toBeInTheDocument();
      });
      expect(
        screen.queryByRole("button", { name: /resume from checkpoint/i })
      ).not.toBeInTheDocument();
    });
  });

  // ── Cancel button visibility ───────────────────────────────────────────

  describe("Cancel (Stop) button visibility", () => {
    it("shows Stop button for running status", async () => {
      setupGetMock(
        makeRunDetail({
          run: { ...makeRunDetail().run, status: "running" },
          checkpoint: null,
        })
      );

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
      });
    });

    it("shows Stop button for queued status", async () => {
      setupGetMock(
        makeRunDetail({
          run: { ...makeRunDetail().run, status: "queued" },
          checkpoint: null,
        })
      );

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
      });
    });

    it("hides Stop button for failure status", async () => {
      setupGetMock(makeRunDetail());

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("failure")).toBeInTheDocument();
      });
      expect(screen.queryByRole("button", { name: /stop/i })).not.toBeInTheDocument();
    });

    it("hides Stop button for interrupted status", async () => {
      setupGetMock(
        makeRunDetail({ run: { ...makeRunDetail().run, status: "interrupted" } })
      );

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("interrupted")).toBeInTheDocument();
      });
      expect(screen.queryByRole("button", { name: /stop/i })).not.toBeInTheDocument();
    });
  });

  // ── handleResume ───────────────────────────────────────────────────────

  describe("handleResume", () => {
    it("calls POST /runs/:id/resume and navigates to the new run on success", async () => {
      setupGetMock(makeRunDetail());
      mockApi.post.mockResolvedValue({ runId: 99 });

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /resume from checkpoint/i })
        ).toBeInTheDocument();
      });

      await act(async () => {
        await userEvent.click(
          screen.getByRole("button", { name: /resume from checkpoint/i })
        );
      });

      await waitFor(() => {
        expect(mockApi.post).toHaveBeenCalledWith("/runs/42/resume", {});
        expect(window.location.href).toBe("/runs/99");
      });
    });

    it("shows error toast when resume API call fails with an Error instance", async () => {
      setupGetMock(makeRunDetail());
      mockApi.post.mockRejectedValue(new Error("Resume failed: no checkpoint"));

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /resume from checkpoint/i })
        ).toBeInTheDocument();
      });

      await act(async () => {
        await userEvent.click(
          screen.getByRole("button", { name: /resume from checkpoint/i })
        );
      });

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          "Resume failed: no checkpoint",
          "error"
        );
      });
    });

    it("shows generic error toast when a non-Error is thrown", async () => {
      setupGetMock(makeRunDetail());
      mockApi.post.mockRejectedValue("string rejection");

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /resume from checkpoint/i })
        ).toBeInTheDocument();
      });

      await act(async () => {
        await userEvent.click(
          screen.getByRole("button", { name: /resume from checkpoint/i })
        );
      });

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith("Failed to resume run", "error");
      });
    });

    it("shows error toast when server returns a non-numeric runId", async () => {
      setupGetMock(makeRunDetail());
      mockApi.post.mockResolvedValue({ runId: "not-a-number" });

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /resume from checkpoint/i })
        ).toBeInTheDocument();
      });

      await act(async () => {
        await userEvent.click(
          screen.getByRole("button", { name: /resume from checkpoint/i })
        );
      });

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith("Invalid server response", "error");
      });
    });

    it("button shows 'Resuming…' and is disabled while the request is in-flight", async () => {
      setupGetMock(makeRunDetail());
      let resolvePost!: (v: { runId: number }) => void;
      mockApi.post.mockReturnValue(
        new Promise<{ runId: number }>((r) => {
          resolvePost = r;
        })
      );

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /resume from checkpoint/i })
        ).toBeInTheDocument();
      });

      // Click without awaiting so we can inspect mid-flight state
      userEvent.click(screen.getByRole("button", { name: /resume from checkpoint/i }));

      await waitFor(() => {
        const btn = screen.getByRole("button", { name: /resuming/i });
        expect(btn).toBeInTheDocument();
        expect(btn).toBeDisabled();
      });

      // Resolve to avoid leaking pending promise
      await act(async () => {
        resolvePost({ runId: 100 });
      });
    });
  });

  // ── handleCancel ──────────────────────────────────────────────────────

  describe("handleCancel", () => {
    it("calls POST /runs/:id/cancel when Stop is clicked", async () => {
      const runningData = makeRunDetail({
        run: { ...makeRunDetail().run, status: "running" },
        checkpoint: null,
      });
      setupGetMock(runningData);
      mockApi.post.mockResolvedValue({});

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
      });

      await act(async () => {
        await userEvent.click(screen.getByRole("button", { name: /stop/i }));
      });

      await waitFor(() => {
        expect(mockApi.post).toHaveBeenCalledWith("/runs/42/cancel", {});
      });
    });
  });

  // ── Run metadata display ───────────────────────────────────────────────

  describe("run metadata display", () => {
    it("shows run error message when run.error is set", async () => {
      setupGetMock(
        makeRunDetail({ run: { ...makeRunDetail().run, error: "Something exploded" } })
      );

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("Something exploded")).toBeInTheDocument();
      });
    });

    it("shows duration when both startedAt and completedAt are present", async () => {
      setupGetMock(
        makeRunDetail({
          run: {
            ...makeRunDetail().run,
            startedAt: "2026-04-04T10:00:00.000Z",
            completedAt: "2026-04-04T10:00:30.000Z",
          },
        })
      );

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(screen.getByText(/30\.0s/)).toBeInTheDocument();
      });
    });

    it("shows em dash for duration when completedAt is absent", async () => {
      setupGetMock(
        makeRunDetail({
          run: {
            ...makeRunDetail().run,
            status: "running",
            completedAt: undefined,
          },
          checkpoint: null,
        })
      );

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("running")).toBeInTheDocument();
      });

      // Duration and cost cells both show "—" when values are absent
      const dashes = screen.getAllByText("—");
      expect(dashes.length).toBeGreaterThan(0);
    });

    it("shows the triggerType value", async () => {
      setupGetMock(
        makeRunDetail({ run: { ...makeRunDetail().run, triggerType: "schedule" } })
      );

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("schedule")).toBeInTheDocument();
      });
    });

    it("defaults trigger type label to 'manual' when triggerType is undefined", async () => {
      setupGetMock(
        makeRunDetail({ run: { ...makeRunDetail().run, triggerType: undefined } })
      );

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("manual")).toBeInTheDocument();
      });
    });
  });

  // ── Agent tasks section ───────────────────────────────────────────────

  describe("agent tasks section", () => {
    it("shows empty state message when there are no tasks", async () => {
      setupGetMock(makeRunDetail({ tasks: [] }));

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("No agent tasks in this run.")).toBeInTheDocument();
      });
    });

    it("renders task prompt and status badge", async () => {
      setupGetMock(
        makeRunDetail({
          tasks: [
            {
              id: 1,
              runId: 42,
              nodeId: "agent-1",
              status: "success",
              prompt: "Summarise the document",
              model: "claude-3-5-sonnet",
              costUsd: 0.0012,
              createdAt: "2026-04-04T10:00:00.000Z",
            },
          ],
        })
      );

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("Summarise the document")).toBeInTheDocument();
      });

      expect(screen.getAllByText("success").length).toBeGreaterThanOrEqual(1);
    });

    it("expands task output when the task row is clicked", async () => {
      setupGetMock(
        makeRunDetail({
          tasks: [
            {
              id: 1,
              runId: 42,
              nodeId: "agent-1",
              status: "success",
              prompt: "Analyse data",
              output: "Analysis complete",
              createdAt: "2026-04-04T10:00:00.000Z",
            },
          ],
        })
      );

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("Analyse data")).toBeInTheDocument();
      });

      // Click task row button
      const taskBtn = screen.getAllByRole("button").find((b) =>
        b.textContent?.includes("Analyse data")
      )!;
      await userEvent.click(taskBtn);

      await waitFor(() => {
        expect(screen.getByText("Analysis complete")).toBeInTheDocument();
      });
    });

    it("shows task error when task.error is set", async () => {
      setupGetMock(
        makeRunDetail({
          tasks: [
            {
              id: 1,
              runId: 42,
              nodeId: "agent-1",
              status: "failure",
              prompt: "Do something",
              error: "Agent timed out",
              createdAt: "2026-04-04T10:00:00.000Z",
            },
          ],
        })
      );

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("Do something")).toBeInTheDocument();
      });

      const taskBtn = screen.getAllByRole("button").find((b) =>
        b.textContent?.includes("Do something")
      )!;
      await userEvent.click(taskBtn);

      await waitFor(() => {
        expect(screen.getByText("Agent timed out")).toBeInTheDocument();
      });
    });

    it("shows task costUsd in the task row", async () => {
      setupGetMock(
        makeRunDetail({
          tasks: [
            {
              id: 1,
              runId: 42,
              nodeId: "agent-1",
              status: "success",
              prompt: "Do work",
              costUsd: 0.0025,
              createdAt: "2026-04-04T10:00:00.000Z",
            },
          ],
        })
      );

      render(<RunDetailPage />);

      // costUsd appears both in the task row and in the run-level total cost cell,
      // so we use getAllByText and assert at least one match.
      await waitFor(() => {
        expect(screen.getAllByText("$0.0025").length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  // ── Events timeline ───────────────────────────────────────────────────

  describe("events timeline", () => {
    it("shows event count in section header", async () => {
      setupGetMock(
        makeRunDetail({
          events: [
            { id: 1, runId: 42, type: "run:started", createdAt: "2026-04-04T10:00:00.000Z" },
            {
              id: 2,
              runId: 42,
              type: "run:completed",
              data: { status: "failure" },
              createdAt: "2026-04-04T10:01:00.000Z",
            },
          ],
        })
      );

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(screen.getByText(/Events \(2\)/)).toBeInTheDocument();
      });
    });

    it("expands events section when header button is clicked", async () => {
      setupGetMock(
        makeRunDetail({
          events: [
            { id: 1, runId: 42, type: "run:started", createdAt: "2026-04-04T10:00:00.000Z" },
          ],
        })
      );

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(screen.getByText(/Events \(1\)/)).toBeInTheDocument();
      });

      // Events section is collapsed by default; click header to expand
      await userEvent.click(screen.getByText(/Events \(1\)/));

      // Expand the node group that appears
      await waitFor(() => {
        const groupBtn = screen.getAllByRole("button").find((b) =>
          b.textContent?.includes("1 event")
        );
        expect(groupBtn).toBeDefined();
      });

      const groupBtn = screen.getAllByRole("button").find((b) =>
        b.textContent?.includes("1 event")
      )!;
      await userEvent.click(groupBtn);

      await waitFor(() => {
        expect(screen.getByText("Run started")).toBeInTheDocument();
      });
    });

    it("labels node:skipped events as 'Skipped (resumed)'", async () => {
      setupGetMock(
        makeRunDetail({
          events: [
            {
              id: 1,
              runId: 42,
              nodeId: "agent-1",
              type: "node:skipped",
              createdAt: "2026-04-04T10:00:00.000Z",
            },
          ],
        })
      );

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(screen.getByText(/Events \(1\)/)).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText(/Events \(1\)/));

      await waitFor(() => {
        const groupBtn = screen.getAllByRole("button").find((b) =>
          b.textContent?.includes("1 event")
        );
        expect(groupBtn).toBeDefined();
      });

      const groupBtn = screen.getAllByRole("button").find((b) =>
        b.textContent?.includes("1 event")
      )!;
      await userEvent.click(groupBtn);

      await waitFor(() => {
        expect(screen.getByText("Skipped (resumed)")).toBeInTheDocument();
      });
    });
  });

  // ── Total cost display ───────────────────────────────────────────────

  describe("total cost display", () => {
    it("shows combined cost summed across all tasks", async () => {
      setupGetMock(
        makeRunDetail({
          tasks: [
            {
              id: 1, runId: 42, nodeId: "a-1", status: "success",
              prompt: "Task 1", costUsd: 0.001,
              createdAt: "2026-04-04T10:00:00.000Z",
            },
            {
              id: 2, runId: 42, nodeId: "a-2", status: "success",
              prompt: "Task 2", costUsd: 0.0015,
              createdAt: "2026-04-04T10:00:10.000Z",
            },
          ],
        })
      );

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("$0.0025")).toBeInTheDocument();
      });
    });

    it("shows em dash in the cost cell when total cost is zero", async () => {
      setupGetMock(makeRunDetail({ tasks: [] }));

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("failure")).toBeInTheDocument();
      });

      const dashes = screen.getAllByText("—");
      expect(dashes.length).toBeGreaterThan(0);
    });
  });

  // ── URL parsing ──────────────────────────────────────────────────────

  describe("URL parsing", () => {
    it("extracts run ID from /runs/:id path", async () => {
      setPathname("/runs/99");
      setupGetMock(makeRunDetail({ run: { ...makeRunDetail().run, id: 99 } }));

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(mockApi.get).toHaveBeenCalledWith("/runs/99");
      });
    });

    it("extracts run ID from /runs/:id/ path with trailing slash", async () => {
      setPathname("/runs/55/");
      setupGetMock(makeRunDetail({ run: { ...makeRunDetail().run, id: 55 } }));

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(mockApi.get).toHaveBeenCalledWith("/runs/55");
      });
    });
  });

  // ── Node label resolution ────────────────────────────────────────────

  describe("node label resolution", () => {
    it("fetches workflow definition and shows node label on tasks", async () => {
      setupGetMock(
        makeRunDetail({
          tasks: [
            {
              id: 1, runId: 42, nodeId: "node-abc", status: "success",
              prompt: "Do work", createdAt: "2026-04-04T10:00:00.000Z",
            },
          ],
        }),
        [{ id: "node-abc", data: { label: "My Friendly Label" } }]
      );

      render(<RunDetailPage />);

      await waitFor(() => {
        expect(screen.getByText("My Friendly Label")).toBeInTheDocument();
      });
    });
  });

  // ── Polling behaviour ────────────────────────────────────────────────

  describe("polling", () => {
    it("does not make additional run fetches after reaching success status", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: false });

      const successData = makeRunDetail({
        run: { ...makeRunDetail().run, status: "success" },
        checkpoint: null,
      });
      setupGetMock(successData);

      render(<RunDetailPage />);

      // Flush the initial load (promises) without advancing timer
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      const runCallsBefore = mockApi.get.mock.calls.filter((c) =>
        typeof c[0] === "string" && (c[0] as string).startsWith("/runs/42")
      ).length;

      // Advance past the 2-second polling interval twice
      act(() => vi.advanceTimersByTime(5000));

      const runCallsAfter = mockApi.get.mock.calls.filter((c) =>
        typeof c[0] === "string" && (c[0] as string).startsWith("/runs/42")
      ).length;

      // Terminal status — interval should not fire extra calls
      expect(runCallsAfter).toBe(runCallsBefore);

      vi.useRealTimers();
    });
  });
});
