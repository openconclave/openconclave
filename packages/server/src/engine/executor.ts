import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { runs, agentTasks, runEvents, settings } from "../db/schema";
import { agentPool } from "../agent/pool";
import { runOllamaAgent } from "../agent/ollama";
import { getIncomingEdges, getOutgoingEdges } from "./graph";
import { resolve } from "path";

const PROJECT_ROOT = resolve(import.meta.dir, "../../../");
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

const MAX_ITERATIONS = 100; // safety limit to prevent infinite loops

export class WorkflowExecutor {
  private onEvent?: EventCallback;

  constructor(onEvent?: EventCallback) {
    this.onEvent = onEvent;
  }

  async execute(
    workflow: WorkflowDefinition,
    triggerPayload?: unknown,
    triggerNodeId?: string
  ): Promise<string> {
    const runId = nanoid();
    const now = new Date().toISOString();

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
    this.executeGraph(runId, workflow, triggerPayload, triggerNodeId).catch((err) => {
      console.error(`Run ${runId} failed:`, err);
    });

    return runId;
  }

  private async executeGraph(
    runId: string,
    workflow: WorkflowDefinition,
    triggerPayload?: unknown,
    triggerNodeId?: string
  ) {
    const { nodes, edges } = workflow;
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const nodeOutputs = new Map<string, unknown>();

    try {
      // Find entry point — use specific trigger node if provided, otherwise all entry nodes
      let entryNodes: WorkflowNode[];
      if (triggerNodeId) {
        const triggerNode = nodes.find((n) => n.id === triggerNodeId);
        entryNodes = triggerNode ? [triggerNode] : [];
      } else {
        entryNodes = nodes.filter(
          (n) => getIncomingEdges(n.id, edges).length === 0
        );
      }

      if (entryNodes.length === 0) {
        throw new Error("No entry nodes found");
      }

      // Walk the graph starting from entry nodes
      // Queue entries track which node triggered them for correct input resolution
      type QueueEntry = { nodeId: string; triggeredBy: string | null };
      const queue: QueueEntry[] = entryNodes.map((n) => ({ nodeId: n.id, triggeredBy: null }));
      let iterations = 0;

      while (queue.length > 0) {
        iterations++;
        if (iterations > MAX_ITERATIONS) {
          throw new Error(`Exceeded max iterations (${MAX_ITERATIONS}). Possible infinite loop.`);
        }

        // Check if run was cancelled
        const run = await db.select().from(runs).where(eq(runs.id, runId));
        if (run[0]?.status === "cancelled") {
          this.emit({ type: "run:completed", runId, data: { status: "cancelled" } });
          return;
        }

        const entry = queue.shift()!;
        const node = nodeMap.get(entry.nodeId);
        if (!node) continue;

        // Execute the node with the specific triggering source
        const output = await this.executeNode(
          runId, entry.nodeId, nodeMap, edges, nodeOutputs, triggerPayload, entry.triggeredBy
        );

        // Determine next nodes based on output
        const outgoing = getOutgoingEdges(entry.nodeId, edges);

        if (node.data.type === "condition") {
          const condResult = (output as any)?.__conditionResult;
          nodeOutputs.set(entry.nodeId, (output as any)?.__passthrough);
          for (const edge of outgoing) {
            if (edge.sourceHandle === "true" && condResult) {
              queue.push({ nodeId: edge.target, triggeredBy: entry.nodeId });
            } else if (edge.sourceHandle === "false" && !condResult) {
              queue.push({ nodeId: edge.target, triggeredBy: entry.nodeId });
            } else if (!edge.sourceHandle) {
              queue.push({ nodeId: edge.target, triggeredBy: entry.nodeId });
            }
          }
        } else {
          for (const edge of outgoing) {
            queue.push({ nodeId: edge.target, triggeredBy: entry.nodeId });
          }
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
    triggerPayload?: unknown,
    triggeredBy?: string | null
  ): Promise<unknown> {
    const node = nodeMap.get(nodeId);
    if (!node) return undefined;

    // Gather input — use the specific triggering node's output if known
    let input: unknown;

    if (triggeredBy) {
      input = nodeOutputs.get(triggeredBy);
    } else {
      const incomingEdges = getIncomingEdges(nodeId, edges);
      if (incomingEdges.length === 1) {
        input = nodeOutputs.get(incomingEdges[0].source);
      } else if (incomingEdges.length > 1) {
        for (const e of incomingEdges) {
          const val = nodeOutputs.get(e.source);
          if (val !== undefined) input = val;
        }
      }
    }

    this.emit({ type: "node:started", runId, nodeId });

    try {
      let output: unknown;

      switch (node.data.type) {
        case "trigger": {
          const triggerConfig = node.data.config as any;
          // Priority: webhook/API payload > configured prompt > default
          output = triggerPayload ?? triggerConfig.prompt ?? { triggered: true, timestamp: new Date().toISOString() };
          break;
        }

        case "agent":
          output = await this.executeAgentNode(runId, nodeId, node.data.config as AgentConfig, input);
          break;

        case "condition": {
          const condResult = this.executeConditionNode(node.data.config as ConditionConfig, input);
          // Store the full result for routing, but pass through original input as output
          output = { __conditionResult: condResult.conditionResult, __passthrough: input };
          break;
        }

        case "transform":
          output = await this.executeCodeNode(node.data.config as TransformConfig, input);
          break;

        case "output": {
          const outputConfig = node.data.config as any;
          output = input;
          if (outputConfig.type === "claude-code") {
            this.emit({ type: "channel:output", runId, nodeId, data: output });
          } else if (outputConfig.type === "telegram") {
            await this.sendTelegram(outputConfig.chatId, output);
          } else {
            console.log(`[Output: ${node.data.label}]`, JSON.stringify(input, null, 2));
          }
          break;
        }
      }

      nodeOutputs.set(nodeId, output);
      this.emit({ type: "node:completed", runId, nodeId, data: output });
      return output;
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

    // Inject context into the agent's config as an appended system prompt
    const augmentedConfig = config;

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
        prompt: augmentedConfig.prompt,
        systemPrompt: augmentedConfig.systemPrompt,
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
        config: augmentedConfig,
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

  private executeConditionNode(
    config: ConditionConfig,
    input: unknown,
  ): { conditionResult: boolean; input: unknown } {
    // Evaluate condition expression
    const fn = new Function("input", `return Boolean(${config.expression})`);
    const result = fn(input);
    return { conditionResult: result, input };
  }

  private async executeCodeNode(config: TransformConfig, input: unknown): Promise<unknown> {
    const { runtime, code } = config;
    const inputStr = typeof input === "string" ? input : JSON.stringify(input);
    const cmdMap: Record<string, string[]> = {
      python: ["python3", "-c", code],
      node: ["node", "-e", code],
      bash: ["bash", "-c", code],
    };

    const cmd = cmdMap[runtime];
    if (!cmd) throw new Error(`Unknown runtime: ${runtime}`);

    const proc = Bun.spawn(cmd, {
      cwd: PROJECT_ROOT,
      stdin: new Blob([inputStr]),
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        INPUT: inputStr,
      },
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new Error(`Code node failed (${runtime}, exit ${exitCode}): ${stderr}`);
    }

    // Try to parse as JSON, otherwise return as string
    try {
      return JSON.parse(stdout.trim());
    } catch {
      return stdout.trim();
    }
  }

  private async sendTelegram(chatId: string | undefined, data: unknown) {
    const tokenResult = await db.select().from(settings).where(eq(settings.key, "telegram_bot_token"));
    const token = tokenResult[0]?.value;
    if (!token) {
      console.error("[Output: Telegram] No bot token configured in Settings");
      return;
    }
    if (!chatId) {
      console.error("[Output: Telegram] No chat ID configured on output node");
      return;
    }

    const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
    } catch (err: any) {
      console.error("[Output: Telegram] Send failed:", err.message);
    }
  }

  private emit(event: RunEvent) {
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

    this.onEvent?.(event);
  }
}
