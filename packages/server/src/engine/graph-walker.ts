import { eq, desc } from "drizzle-orm";

import { db } from "../db/client";
import { runs, checkpoints, agentTasks } from "../db/schema";
import { getIncomingEdges, getOutgoingEdges } from "./graph";
import { executeNode } from "./node-executor";
import { normalizeWorkflowNodeTypes } from "./normalize-workflow";
import { logger } from "../lib/logger";
import { AppError, ErrorCode, MAX_WORKFLOW_ITERATIONS } from "@openconclave/shared";
import type { WorkflowDefinition, WorkflowNode, WorkflowEdge } from "@openconclave/shared";

import type { QueueEntry, RunEvent } from "./types";
import { Workspace } from "./workspace";

// Persistent session store for chat workflows — in-memory cache keyed by runId:nodeId.
// Falls back to DB checkpoint on miss (survives server restarts).
// Capped at MAX_PERSISTENT_SESSIONS entries; oldest entry is evicted when the limit is
// reached to prevent unbounded memory growth on long-running servers.
const MAX_PERSISTENT_SESSIONS = 256;
const persistentSessions = new Map<string, string>();

export function getPersistentSession(runId: number, nodeId: string): string | undefined {
  return persistentSessions.get(`${runId}:${nodeId}`);
}

export function setPersistentSession(runId: number, nodeId: string, sessionId: string): void {
  if (persistentSessions.size >= MAX_PERSISTENT_SESSIONS) {
    // Map preserves insertion order — delete the oldest entry first (FIFO eviction).
    const oldestKey = persistentSessions.keys().next().value;
    if (oldestKey !== undefined) persistentSessions.delete(oldestKey);
  }
  persistentSessions.set(`${runId}:${nodeId}`, sessionId);
}

// Active run workspaces — allows the API to update cwd dynamically (e.g. from a code node).
const activeWorkspaces = new Map<number, Workspace>();

export function getRunWorkspace(runId: number): Workspace | undefined {
  return activeWorkspaces.get(runId);
}

// ── Graph Walker ────────────────────────────────────────────

/**
 * Returns true when ALL of a node's outgoing edges target discussion nodes via the
 * "participants" handle — meaning this node exists only as a discussion participant and
 * must NOT be treated as a graph entry point.
 *
 * Without this: participant agents (0 incoming edges) are queued as entry nodes, run
 * standalone, then re-invoked internally by the discussion executor → double execution,
 * double LLM billing.
 */
function isParticipantOnlyNode(nodeId: string, edges: WorkflowEdge[]): boolean {
  const outgoing = getOutgoingEdges(nodeId, edges);
  return (
    outgoing.length > 0 &&
    outgoing.every((e) => e.targetHandle === "participants")
  );
}

export async function executeGraph(
  runId: number,
  workflow: WorkflowDefinition,
  emit: (event: RunEvent) => void,
  triggerPayload?: unknown,
  triggerNodeId?: string,
  resumeFromCheckpointId?: number // undefined = fresh run
): Promise<void> {
  // Normalize workflow to handle legacy type names (e.g., "transform" → "code")
  // This ensures all downstream code sees consistent, current node types.
  const normalizedWorkflow = normalizeWorkflowNodeTypes(workflow);
  const { nodes, edges } = normalizedWorkflow;
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const nodeOutputs = new Map<string, unknown>();
  // Session IDs per agent — Claude: SDK session ID, non-Claude: JSONL file path
  const agentSessions = new Map<string, string>();
  // Tracks nodes that completed successfully (used for checkpoint tracking)
  const completedNodes = new Set<string>();
  // Nodes loaded from checkpoint — only these are skipped on resume.
  // Separate from completedNodes so that loop-back targets re-execute during
  // normal execution instead of being skipped indefinitely.
  const resumeSkipNodes = new Set<string>();
  // Raw executeNode outputs — never mutated by resolveNextEntries (which overwrites nodeOutputs
  // for condition/routing nodes with passthrough). Checkpoints store these raw values so that
  // on any subsequent resume the skip path can always call resolveNextEntries correctly.
  const checkpointOutputs = new Map<string, unknown>();

  // For chat workflows, restore persistent sessions from previous runs
  const isChatWorkflow = nodes.some((n) => {
    const cfg = n.data.config as Record<string, unknown> | undefined;
    return n.data.type === "trigger" && (cfg?.type === "chat" || cfg?.type === "telegram");
  });
  if (isChatWorkflow) {
    // Restore Claude SDK sessions for chat continuation (same runId).
    // First try in-memory cache, then fall back to latest checkpoint in DB
    // (survives server restarts).
    let checkpointSessions: Record<string, string> | null = null;

    for (const node of nodes) {
      if (node.data.type === "agent") {
        const agentCfg = node.data.config as Record<string, unknown>;
        // Only Claude agents need SDK session resume — Ollama/OpenAI use JSONL files
        if ((agentCfg.engine ?? "claude") !== "claude") continue;
        const existing = getPersistentSession(runId, node.id);
        if (existing) {
          agentSessions.set(node.id, existing);
        } else {
          // Lazy-load checkpoint sessions on first miss
          if (checkpointSessions === null) {
            const [latestCp] = await db
              .select()
              .from(checkpoints)
              .where(eq(checkpoints.runId, runId))
              .orderBy(desc(checkpoints.id))
              .limit(1);
            checkpointSessions = (latestCp?.agentSessions as Record<string, string>) ?? {};
          }
          const fromCheckpoint = checkpointSessions[node.id];
          if (fromCheckpoint) {
            agentSessions.set(node.id, fromCheckpoint);
            setPersistentSession(runId, node.id, fromCheckpoint);
          }
        }
      }
    }
  }
  // Resume: hydrate accumulated state from the latest checkpoint
  if (resumeFromCheckpointId !== undefined) {
    const [cp] = await db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.id, resumeFromCheckpointId));
    if (cp) {
      for (const [k, v] of Object.entries(cp.nodeOutputs as Record<string, unknown>)) {
        nodeOutputs.set(k, v);
        checkpointOutputs.set(k, v); // checkpoint only ever stored raw outputs
      }
      for (const nodeId of cp.completedNodes as string[]) {
        completedNodes.add(nodeId);
        resumeSkipNodes.add(nodeId);
      }
      for (const [k, v] of Object.entries(cp.agentSessions as Record<string, string>)) {
        agentSessions.set(k, v);
      }
    }
  }

  // Resolve workspace (working directory) from trigger payload / config
  const triggerNode = triggerNodeId
    ? nodes.find((n) => n.id === triggerNodeId)
    : nodes.find((n) => n.data.type === "trigger");
  const triggerCfg = triggerNode?.data.config as Record<string, unknown> | undefined;
  const { workspace, cleanPayload } = Workspace.fromTrigger(
    triggerPayload,
    triggerCfg?.workingDirectory as string | undefined,
  );
  activeWorkspaces.set(runId, workspace);
  // Workflow context from trigger — injected into every agent's system prompt
  const workflowContext = cleanPayload
    ? (typeof cleanPayload === "string" ? cleanPayload : JSON.stringify(cleanPayload))
    : null;

  try {
    // Find entry point
    let entryNodes: WorkflowNode[];
    if (triggerNodeId) {
      const triggerNode = nodes.find((n) => n.id === triggerNodeId);
      entryNodes = triggerNode ? [triggerNode] : [];
    } else {
      entryNodes = nodes.filter(
        (n) =>
          getIncomingEdges(n.id, edges).length === 0 &&
          !isParticipantOnlyNode(n.id, edges)
      );
    }

    if (entryNodes.length === 0) {
      throw new AppError(ErrorCode.WORKFLOW_NO_ENTRY, "No entry nodes found");
    }

    const queue: QueueEntry[] = entryNodes.map((n) => ({
      nodeId: n.id,
      triggeredBy: null,
    }));

    // Fan-in tracking: count how many inputs each node has received
    // Nodes with multiple incoming edges wait until all have arrived
    const pendingInputs = new Map<string, Map<string, unknown>>(); // nodeId -> (sourceId -> output)
    // Track which merge nodes have already fired to prevent double-execution.
    // Do NOT pre-seed from completedNodes — that would block the skip-and-traverse
    // path at the `resumeSkipNodes.has(entry.nodeId)` check below, causing downstream
    // nodes after a merge-in-checkpoint to be silently dropped on resume.
    const firedMerges = new Set<string>();
    let iterations = 0;

    while (queue.length > 0) {
      iterations++;
      if (iterations > MAX_WORKFLOW_ITERATIONS) {
        throw new AppError(
          ErrorCode.WORKFLOW_MAX_ITERATIONS,
          `Exceeded max iterations (${MAX_WORKFLOW_ITERATIONS})`
        );
      }

      // Check cancellation
      const [run] = await db.select().from(runs).where(eq(runs.id, runId));
      if (run?.status === "cancelled") {
        emit({ type: "run:completed", runId, data: { status: "cancelled" } });
        return;
      }

      // Batch: take all entries from the current queue and run in parallel
      const batch = queue.splice(0, queue.length);

      // Check fan-in: filter out entries that need to wait for more inputs
      const ready: QueueEntry[] = [];

      for (const entry of batch) {
        const node = nodeMap.get(entry.nodeId);
        if (!node) continue;

        if (node.data.type === "merge") {
          // Resume: merge nodes from checkpoint need to pass through for skip traversal,
          // not get blocked by firedMerges. Only let the first arrival through —
          // add to firedMerges immediately so subsequent arrivals are dropped.
          if (resumeSkipNodes.has(entry.nodeId) && !firedMerges.has(entry.nodeId)) {
            firedMerges.add(entry.nodeId);
            ready.push(entry);
          } else if (firedMerges.has(entry.nodeId)) {
            // Skip merge nodes that have already fired in THIS run
            continue;
          } else {
            // Merge nodes: wait for ALL incoming edges before executing once
            const incomingEdges = getIncomingEdges(entry.nodeId, edges);

            if (!pendingInputs.has(entry.nodeId)) {
              pendingInputs.set(entry.nodeId, new Map());
            }
            const inputs = pendingInputs.get(entry.nodeId)!;
            if (entry.triggeredBy) {
              inputs.set(entry.triggeredBy, nodeOutputs.get(entry.triggeredBy));
            }

            if (inputs.size >= incomingEdges.length) {
              ready.push(entry);
              pendingInputs.delete(entry.nodeId);
              firedMerges.add(entry.nodeId);
            }
          }
        } else {
          // All other nodes: run once per trigger
          ready.push(entry);
        }
      }

      if (ready.length === 0 && pendingInputs.size === 0) {
        break;
      }
      if (ready.length === 0) {
        break;
      }

      // Pre-compute skip decisions synchronously before launching the async batch.
      // Doing the delete here (single-threaded) prevents a race where the same node ID
      // appears twice in `ready` (e.g. two parallel parents were both skipped and both
      // route to the same child): the first async callback would delete the node from
      // resumeSkipNodes, causing the second callback to fall through and execute it.
      const skipDecisions = new Set<string>();
      for (const entry of ready) {
        if (resumeSkipNodes.has(entry.nodeId)) {
          skipDecisions.add(entry.nodeId);
          resumeSkipNodes.delete(entry.nodeId); // one-time skip; loops re-execute
        }
      }

      const results = await Promise.all(
        ready.map(async (entry) => {
          const node = nodeMap.get(entry.nodeId);
          if (!node) return [];

          // Resume: skip nodes that completed in a previous execution attempt.
          // Only nodes loaded from the checkpoint are skipped — nodes that completed
          // earlier in THIS run are NOT skipped, allowing condition-driven loops
          // (e.g. reviewer → condition:false → developer) to re-execute correctly.
          if (skipDecisions.has(entry.nodeId)) {
            emit({ type: "node:skipped", runId, nodeId: entry.nodeId });
            return resolveNextEntries(
              entry,
              node,
              checkpointOutputs.get(entry.nodeId),
              edges,
              nodeMap,
              nodeOutputs
            );
          }

          const output = await executeNode(
            runId,
            entry.nodeId,
            nodeMap,
            edges,
            nodeOutputs,
            agentSessions,
            workflowContext,
            workflow,
            emit,
            cleanPayload,
            entry.triggeredBy,
            workspace
          );

          // ORDERING INVARIANT: checkpoint MUST come before resolveNextEntries.
          // For condition nodes, resolveNextEntries calls nodeOutputs.set(nodeId, passthrough),
          // overwriting the raw {__conditionResult, __passthrough} output. Same for agent routing
          // nodes that strip __routeTo. If checkpoint ran after, it would store the mutated value.
          // checkpointOutputs is a separate map that only ever holds raw executeNode outputs —
          // it is never touched by resolveNextEntries, so subsequent checkpoints are always safe.
          checkpointOutputs.set(entry.nodeId, output);
          completedNodes.add(entry.nodeId);
          await writeCheckpoint(runId, entry.nodeId, checkpointOutputs, completedNodes, agentSessions);

          return resolveNextEntries(entry, node, output, edges, nodeMap, nodeOutputs);
        })
      );

      // Flatten next entries back into the queue
      for (const next of results) {
        queue.push(...next);
      }
    }

    // Persist Claude agent sessions for chat workflows
    if (isChatWorkflow) {
      for (const [nodeId, sessionId] of agentSessions) {
        const node = nodeMap.get(nodeId);
        if (node?.data.type === "agent") {
          const agentCfg = node.data.config as Record<string, unknown>;
          if ((agentCfg.engine ?? "claude") === "claude") {
            setPersistentSession(runId, nodeId, sessionId);
          }
        }
      }
    }

    // Invariant check before marking the run as success: every node that has an
    // interrupted/running task for this run must also have a successful task for
    // the same node (meaning the resume re-executed it). Nodes whose ONLY tasks
    // are interrupted are orphans — the resume skipped them without re-running.
    // This guards against the bug where resume marks runs success without
    // actually executing everything. See issue #27.
    const allTasks = await db
      .select({ nodeId: agentTasks.nodeId, status: agentTasks.status })
      .from(agentTasks)
      .where(eq(agentTasks.runId, runId));
    const successfulNodes = new Set<string>();
    const orphanCandidates = new Set<string>();
    for (const t of allTasks) {
      if (t.status === "success") successfulNodes.add(t.nodeId);
      else if (t.status === "interrupted" || t.status === "running") {
        orphanCandidates.add(t.nodeId);
      }
    }
    const orphanedNodes = [...orphanCandidates].filter((n) => !successfulNodes.has(n));

    const now = new Date().toISOString();
    if (orphanedNodes.length > 0) {
      const message = `Run has ${orphanedNodes.length} orphaned node(s) with no successful task: ${orphanedNodes.join(", ")}`;
      await db
        .update(runs)
        .set({ status: "failure", completedAt: now, error: message })
        .where(eq(runs.id, runId));
      emit({
        type: "run:completed",
        runId,
        data: { status: "failure", error: message },
      });
      return;
    }

    await db
      .update(runs)
      .set({ status: "success", completedAt: now })
      .where(eq(runs.id, runId));
    emit({ type: "run:completed", runId, data: { status: "success" } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const now = new Date().toISOString();
    await db
      .update(runs)
      .set({ status: "failure", completedAt: now, error: message })
      .where(eq(runs.id, runId));
    emit({ type: "run:completed", runId, data: { status: "failure", error: message } });
  } finally {
    activeWorkspaces.delete(runId);
  }
}

// ── Checkpoint writer ──────────────────────────────────────────

/**
 * Writes a full-snapshot checkpoint after each successfully completed node.
 *
 * `nodeOutputs` here is the `checkpointOutputs` map — raw `executeNode` return values,
 * never overwritten by `resolveNextEntries`. This invariant ensures every checkpoint row
 * stores values that can be safely passed back to `resolveNextEntries` on any future resume
 * cycle, preserving `__conditionResult` and `__routeTo` for conditional/routing nodes.
 *
 * Each row is a complete accumulated snapshot (O(n²) storage for n nodes). Acceptable for
 * Phase 1. Phase 3 cleanup: delete all but the latest checkpoint row once a run succeeds.
 *
 * Never throws — a missed checkpoint must not abort workflow execution. The run falls back
 * to an earlier checkpoint (or re-executes from scratch) on the next resume.
 */
async function writeCheckpoint(
  runId: number,
  nodeId: string,
  nodeOutputs: Map<string, unknown>,
  completedNodes: Set<string>,
  agentSessions: Map<string, string>
): Promise<void> {
  try {
    await db.insert(checkpoints).values({
      runId,
      nodeId,
      nodeOutputs: Object.fromEntries(nodeOutputs),
      completedNodes: Array.from(completedNodes),
      agentSessions: Object.fromEntries(agentSessions),
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("Failed to write checkpoint", { runId, nodeId, error: String(err) });
    // Intentionally not re-throwing — a missed checkpoint degrades resume granularity,
    // but must never abort workflow execution.
  }
}

// ── Next-node resolution ────────────────────────────────────

function resolveNextEntries(
  entry: QueueEntry,
  node: WorkflowNode,
  output: unknown,
  edges: WorkflowEdge[],
  nodeMap: Map<string, WorkflowNode>,
  nodeOutputs: Map<string, unknown>
): QueueEntry[] {
  const next: QueueEntry[] = [];

  // Chat trigger terminal — don't propagate
  if ((output as Record<string, unknown>)?.__chatTerminal) {
    return next;
  }

  const outgoing = getOutgoingEdges(entry.nodeId, edges);

  if (node.data.type === "condition") {
    const condResult = (output as { __conditionResult?: boolean })?.__conditionResult;
    const passthrough = (output as { __passthrough?: unknown })?.__passthrough;
    // Override nodeOutputs so downstream nodes see the passthrough, not the internal struct
    nodeOutputs.set(entry.nodeId, passthrough);

    for (const edge of outgoing) {
      if (edge.sourceHandle === "true" && condResult) {
        next.push({ nodeId: edge.target, triggeredBy: entry.nodeId });
      } else if (edge.sourceHandle === "false" && !condResult) {
        next.push({ nodeId: edge.target, triggeredBy: entry.nodeId });
      } else if (!edge.sourceHandle) {
        next.push({ nodeId: edge.target, triggeredBy: entry.nodeId });
      }
    }
  } else if (node.data.type === "agent" && outgoing.length >= 2) {
    // Filter out prompt connections — these are ask_user tool connections, not forward routes.
    const forwardEdges = outgoing.filter((e) => {
      const target = nodeMap.get(e.target);
      return target?.data.type !== "prompt";
    });

    // If filtering reduced to <2 edges, treat as simple forward (no routing needed)
    if (forwardEdges.length < 2) {
      for (const edge of forwardEdges) {
        next.push({ nodeId: edge.target, triggeredBy: entry.nodeId });
      }
      return next;
    }

    // Agent with routing — check for __routeTo in output
    let routeTo: string | null = null;
    try {
      const parsed = typeof output === "string" ? JSON.parse(output) : output;
      if (parsed?.__routeTo) {
        routeTo = parsed.__routeTo as string;
        const cleanOutput = parsed.content ?? output;
        // Override nodeOutputs so downstream nodes see clean output, not routing metadata
        nodeOutputs.set(entry.nodeId, cleanOutput);
      }
    } catch {
      // Not JSON, no routing metadata
    }

    if (routeTo) {
      // Route to the chosen edge — match by node ID or label (case-insensitive)
      const routeLower = routeTo.toLowerCase();
      const targetEdge = outgoing.find((e) => {
        if (e.target === routeTo) return true;
        const targetNode = nodeMap.get(e.target);
        return targetNode?.data.label?.toLowerCase() === routeLower;
      });
      if (targetEdge) {
        next.push({ nodeId: targetEdge.target, triggeredBy: entry.nodeId });
      } else {
        logger.warn("Agent routed to invalid target", { routeTo, nodeId: entry.nodeId });
        throw new Error(`Agent "${node.data.label}" routed to unknown target "${routeTo}"`);
      }
    } else {
      // No routing metadata — fan out to all forward targets (parallel execution)
      for (const edge of forwardEdges) {
        next.push({ nodeId: edge.target, triggeredBy: entry.nodeId });
      }
    }
  } else {
    for (const edge of outgoing) {
      if (edge.targetHandle === "participants") continue; // discussion participant edges are never data-flow
      next.push({ nodeId: edge.target, triggeredBy: entry.nodeId });
    }
  }

  return next;
}
