import { eq } from "drizzle-orm";

import { db } from "../db/client";
import { runs, checkpoints } from "../db/schema";
import { getIncomingEdges, getOutgoingEdges } from "./graph";
import { executeNode } from "./node-executor";
import { logger } from "../lib/logger";
import { AppError, ErrorCode, MAX_WORKFLOW_ITERATIONS } from "@openconclave/shared";
import type { WorkflowDefinition, WorkflowNode, WorkflowEdge } from "@openconclave/shared";

import type { QueueEntry, RunEvent } from "./types";

// Persistent session store for chat workflows — survives across runs
// Key: "workflowId:nodeId" → session ID (Claude SDK session or JSONL file path)
const persistentSessions = new Map<string, string>();

export function getPersistentSession(workflowId: string, nodeId: string): string | undefined {
  return persistentSessions.get(`${workflowId}:${nodeId}`);
}

export function setPersistentSession(workflowId: string, nodeId: string, sessionId: string): void {
  persistentSessions.set(`${workflowId}:${nodeId}`, sessionId);
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
  const { nodes, edges } = workflow;
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const nodeOutputs = new Map<string, unknown>();
  // Session IDs per agent — Claude: SDK session ID, non-Claude: JSONL file path
  const agentSessions = new Map<string, string>();
  // Tracks nodes that completed successfully (used for skip logic on resume)
  const completedNodes = new Set<string>();
  // Raw executeNode outputs — never mutated by resolveNextEntries (which overwrites nodeOutputs
  // for condition/routing nodes with passthrough). Checkpoints store these raw values so that
  // on any subsequent resume the skip path can always call resolveNextEntries correctly.
  const checkpointOutputs = new Map<string, unknown>();

  // For chat workflows, restore persistent sessions from previous runs
  const isChatWorkflow = nodes.some((n) => {
    const cfg = n.data.config as Record<string, unknown>;
    return n.data.type === "trigger" && cfg.type === "chat";
  });
  const workflowId = String(workflow.id);
  if (isChatWorkflow) {
    for (const node of nodes) {
      if (node.data.type === "agent") {
        const agentCfg = node.data.config as Record<string, unknown>;
        // Only Claude agents need SDK session resume — Ollama/OpenAI use JSONL files
        if ((agentCfg.engine ?? "claude") !== "claude") continue;
        const existing = getPersistentSession(workflowId, node.id);
        if (existing) agentSessions.set(node.id, existing);
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
      }
      for (const [k, v] of Object.entries(cp.agentSessions as Record<string, string>)) {
        agentSessions.set(k, v);
      }
    }
  }

  // Extract internal fields from trigger payload
  let callerCwd: string | undefined;
  let cleanPayload = triggerPayload;
  if (triggerPayload && typeof triggerPayload === "object" && "_callerCwd" in (triggerPayload as Record<string, unknown>)) {
    const { _callerCwd, ...rest } = triggerPayload as Record<string, unknown>;
    callerCwd = _callerCwd as string;
    cleanPayload = Object.keys(rest).length > 0 ? rest : undefined;
  }
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
    // Track which merge nodes have already fired to prevent double-execution
    const firedMerges = new Set<string>();
    // Resume: prevent already-completed merge nodes from waiting for inputs again
    for (const nodeId of completedNodes) {
      if (nodeMap.get(nodeId)?.data.type === "merge") firedMerges.add(nodeId);
    }
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
          // Skip merge nodes that have already fired
          if (firedMerges.has(entry.nodeId)) continue;

          // Merge nodes: wait for ALL incoming edges before executing once
          const incomingEdges = getIncomingEdges(entry.nodeId, edges);

          if (!pendingInputs.has(entry.nodeId)) {
            pendingInputs.set(entry.nodeId, new Map());
          }
          const inputs = pendingInputs.get(entry.nodeId)!;
          if (entry.triggeredBy) {
            inputs.set(entry.triggeredBy, nodeOutputs.get(entry.triggeredBy));
          }

          // Bug fix: use total incoming edge count, not just edges with existing outputs
          if (inputs.size >= incomingEdges.length) {
            ready.push(entry);
            pendingInputs.delete(entry.nodeId);
            firedMerges.add(entry.nodeId);
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

      const results = await Promise.all(
        ready.map(async (entry) => {
          const node = nodeMap.get(entry.nodeId);
          if (!node) return [];

          // Resume: skip nodes that already completed in a previous execution attempt.
          // We pass checkpointOutputs (raw executeNode values, never mutated) to resolveNextEntries
          // so that condition branching (__conditionResult) and agent routing (__routeTo) work
          // correctly even after multiple resume cycles — nodeOutputs may have been overwritten
          // by a prior resolveNextEntries call (e.g. condition passthrough).
          if (completedNodes.has(entry.nodeId)) {
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
            callerCwd
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
            setPersistentSession(workflowId, nodeId, sessionId);
          }
        }
      }
    }

    // Success
    const now = new Date().toISOString();
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
      // No routing metadata — fan out to all targets (parallel execution)
      for (const edge of outgoing) {
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
