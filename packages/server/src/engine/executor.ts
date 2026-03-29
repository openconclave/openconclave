import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { runs, agentTasks, runEvents } from "../db/schema";
import { agentPool } from "../agent/pool";
import { runOllamaAgent } from "../agent/ollama";
import { topologicalSort, getIncomingEdges, getOutgoingEdges } from "./graph";
import type {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowEdge,
  AgentConfig,
  ConditionConfig,
  TransformConfig,
} from "@openconclave/shared";

type EventCallback = (event: RunEvent) => void;

type RunEvent = {
  type: string;
  runId: string;
  nodeId?: string;
  data?: unknown;
};

export class WorkflowExecutor {
  private onEvent?: EventCallback;

  constructor(onEvent?: EventCallback) {
    this.onEvent = onEvent;
  }

  async execute(
    workflow: WorkflowDefinition,
    triggerPayload?: unknown
  ): Promise<string> {
    const runId = nanoid();
    const now = new Date().toISOString();

    // Create run record
    await db.insert(runs).values({
      id: runId,
      workflowId: workflow.id,
      status: "running",
      triggerType: "manual",
      triggerPayload: triggerPayload ?? null,
      startedAt: now,
      createdAt: now,
    });

    this.emit({ type: "run:started", runId });

    // Execute asynchronously
    this.executeGraph(runId, workflow, triggerPayload).catch((err) => {
      console.error(`Run ${runId} failed:`, err);
    });

    return runId;
  }

  private async executeGraph(
    runId: string,
    workflow: WorkflowDefinition,
    triggerPayload?: unknown
  ) {
    const { nodes, edges } = workflow;
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const nodeOutputs = new Map<string, unknown>();

    try {
      const layers = topologicalSort(nodes, edges);

      for (const layer of layers) {
        // Execute all nodes in this layer in parallel
        await Promise.all(
          layer.nodeIds.map((nodeId) =>
            this.executeNode(runId, nodeId, nodeMap, edges, nodeOutputs, triggerPayload)
          )
        );

        // Check if run was cancelled
        const run = await db.select().from(runs).where(eq(runs.id, runId));
        if (run[0]?.status === "cancelled") {
          this.emit({ type: "run:completed", runId, data: { status: "cancelled" } });
          return;
        }
      }

      // Mark run as success
      const now = new Date().toISOString();
      await db
        .update(runs)
        .set({ status: "success", completedAt: now })
        .where(eq(runs.id, runId));

      this.emit({ type: "run:completed", runId, data: { status: "success" } });
    } catch (err: any) {
      const now = new Date().toISOString();
      await db
        .update(runs)
        .set({ status: "failure", completedAt: now, error: err.message })
        .where(eq(runs.id, runId));

      this.emit({
        type: "run:completed",
        runId,
        data: { status: "failure", error: err.message },
      });
    }
  }

  private async executeNode(
    runId: string,
    nodeId: string,
    nodeMap: Map<string, WorkflowNode>,
    edges: WorkflowEdge[],
    nodeOutputs: Map<string, unknown>,
    triggerPayload?: unknown
  ) {
    const node = nodeMap.get(nodeId);
    if (!node) return;

    // Gather input from predecessor nodes
    const incomingEdges = getIncomingEdges(nodeId, edges);
    let input: unknown;

    if (incomingEdges.length === 1) {
      input = nodeOutputs.get(incomingEdges[0].source);
    } else if (incomingEdges.length > 1) {
      input = incomingEdges.map((e) => ({
        from: e.source,
        data: nodeOutputs.get(e.source),
      }));
    }

    this.emit({ type: "node:started", runId, nodeId });

    try {
      let output: unknown;

      switch (node.data.type) {
        case "trigger":
          output = triggerPayload ?? { triggered: true, timestamp: new Date().toISOString() };
          break;

        case "agent":
          output = await this.executeAgentNode(runId, nodeId, node.data.config as AgentConfig, input);
          break;

        case "condition":
          output = await this.executeConditionNode(node.data.config as ConditionConfig, input, nodeId, edges, nodeOutputs);
          break;

        case "transform":
          output = this.executeTransformNode(node.data.config as TransformConfig, input);
          break;

        case "output": {
          const outputConfig = node.data.config as any;
          output = input;
          if (outputConfig.type === "claude-code") {
            this.emit({ type: "channel:output", runId, nodeId, data: output });
          } else {
            console.log(`[Output: ${node.data.label}]`, JSON.stringify(input, null, 2));
          }
          break;
        }
      }

      nodeOutputs.set(nodeId, output);
      this.emit({ type: "node:completed", runId, nodeId, data: output });
    } catch (err: any) {
      this.emit({ type: "node:failed", runId, nodeId, data: { error: err.message } });
      throw err;
    }
  }

  private async executeAgentNode(
    runId: string,
    nodeId: string,
    config: AgentConfig,
    input: unknown
  ): Promise<unknown> {
    const taskId = nanoid();
    const now = new Date().toISOString();

    const engine = config.engine ?? "claude";
    if (engine === "ollama" && !config.ollamaModel) {
      throw new Error("No Ollama model selected. Edit the agent node and pick a model.");
    }
    const modelName = engine === "ollama" ? config.ollamaModel! : (config.model ?? "sonnet");

    // Create agent task record
    await db.insert(agentTasks).values({
      id: taskId,
      runId,
      nodeId,
      status: "running",
      prompt: config.prompt,
      systemPrompt: config.systemPrompt,
      model: `${engine}/${modelName}`,
      input: input ?? null,
      startedAt: now,
      createdAt: now,
    });

    this.emit({ type: "agent:started", runId, nodeId, data: { taskId, engine } });

    let result: { success: boolean; output: string; error?: string; costUsd?: number; durationMs: number };

    if (engine === "ollama") {
      // Map allowed tools + MCP servers to Ollama tool IDs
      const ollamaTools: string[] = [];
      if (config.allowedTools?.length) {
        const toolMap: Record<string, string> = {
          Bash: "bash", Read: "read_file", Write: "write_file",
          WebFetch: "web_fetch",
        };
        for (const t of config.allowedTools) {
          if (toolMap[t]) ollamaTools.push(toolMap[t]);
        }
      }
      if (config.mcpServers?.includes("telegram-voice")) {
        ollamaTools.push("send_telegram");
      }

      // Run via Ollama API with tool calling + MCP servers
      result = await runOllamaAgent({
        model: modelName,
        prompt: config.prompt,
        systemPrompt: config.systemPrompt,
        input,
        tools: ollamaTools.length > 0 ? ollamaTools : undefined,
        mcpServers: config.mcpServers,
        onOutput: (chunk) => {
          this.emit({ type: "agent:output", runId, nodeId, data: { taskId, chunk } });
        },
      });
    } else {
      // Run via Claude Code CLI through the agent pool
      result = await agentPool.submit(taskId, {
        config,
        input,
        onOutput: (chunk) => {
          this.emit({ type: "agent:output", runId, nodeId, data: { taskId, chunk } });
        },
      });
    }

    const completedAt = new Date().toISOString();

    // Update task record
    await db
      .update(agentTasks)
      .set({
        status: result.success ? "success" : "failure",
        output: result.output,
        error: result.error,
        costUsd: result.costUsd,
        completedAt,
      })
      .where(eq(agentTasks.id, taskId));

    this.emit({
      type: "agent:completed",
      runId,
      nodeId,
      data: { taskId, success: result.success, durationMs: result.durationMs },
    });

    if (!result.success) {
      throw new Error(`Agent task failed: ${result.error}`);
    }

    return result.output;
  }

  private async executeConditionNode(
    config: ConditionConfig,
    input: unknown,
    nodeId: string,
    edges: WorkflowEdge[],
    nodeOutputs: Map<string, unknown>
  ): Promise<unknown> {
    // Evaluate condition expression
    const fn = new Function("input", `return Boolean(${config.expression})`);
    const result = fn(input);

    // Mark downstream nodes on the non-taken branch as skipped
    // by not including them in outputs
    const outgoing = getOutgoingEdges(nodeId, edges);
    for (const edge of outgoing) {
      if (edge.sourceHandle === "true" && !result) {
        nodeOutputs.set(edge.target, undefined); // skip
      }
      if (edge.sourceHandle === "false" && result) {
        nodeOutputs.set(edge.target, undefined); // skip
      }
    }

    return { conditionResult: result, input };
  }

  private executeTransformNode(config: TransformConfig, input: unknown): unknown {
    const fn = new Function("input", `return (${config.expression})`);
    return fn(input);
  }

  private emit(event: RunEvent) {
    // Persist event
    const now = new Date().toISOString();
    db.insert(runEvents)
      .values({
        runId: event.runId,
        nodeId: event.nodeId,
        type: event.type,
        data: event.data ?? null,
        createdAt: now,
      })
      .catch((err) => console.error("Failed to persist event:", err));

    // Notify listeners
    this.onEvent?.(event);
  }
}
