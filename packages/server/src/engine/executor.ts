import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { resolve } from "path";

import { db } from "../db/client";
import { runs, agentTasks, runEvents, settings } from "../db/schema";
import { agentPool } from "../agent/pool";
import { runOllamaAgent } from "../agent/ollama";
import { getIncomingEdges, getOutgoingEdges } from "./graph";
import { evaluateExpression } from "../lib/expression";
import { registerPrompt } from "./prompt-registry";
import { logger } from "../lib/logger";
import {
  AppError,
  ErrorCode,
  MAX_WORKFLOW_ITERATIONS,
} from "@openconclave/shared";
import type {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowEdge,
  AgentConfig,
  ConditionConfig,
  CodeConfig,
  TriggerConfig,
  PromptConfig,
  OutputConfig,
} from "@openconclave/shared";

const PROJECT_ROOT = resolve(import.meta.dir, "../../../");

// ── Types ────────────────────────────────────────────────────

interface RunEvent {
  type: string;
  runId: string;
  nodeId?: string;
  data?: unknown;
}

interface QueueEntry {
  nodeId: string;
  triggeredBy: string | null;
}

interface RouteTarget {
  nodeId: string;
  label: string;
  type: string;
}

interface AgentOutput {
  content: string;
  routeTo: string | null; // nodeId chosen by the agent — required when routeTargets exist
}

interface AgentResult {
  success: boolean;
  output: string;
  error?: string;
  costUsd?: number;
  durationMs: number;
}

type EventCallback = (event: RunEvent) => void;

// ── Executor ─────────────────────────────────────────────────

export class WorkflowExecutor {
  private readonly onEvent?: EventCallback;

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

    this.executeGraph(runId, workflow, triggerPayload, triggerNodeId).catch(
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Run ${runId} failed`, { error: message });
      }
    );

    return runId;
  }

  // ── Graph Walker ─────────────────────────────────────────

  private async executeGraph(
    runId: string,
    workflow: WorkflowDefinition,
    triggerPayload?: unknown,
    triggerNodeId?: string
  ): Promise<void> {
    const { nodes, edges } = workflow;
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const nodeOutputs = new Map<string, unknown>();
    // Conversation history for agent↔prompt loops: agentNodeId → [{role, content}]
    const conversationHistory = new Map<string, Array<{ role: string; content: string }>>();

    try {
      // Find entry point
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
        throw new AppError(ErrorCode.WORKFLOW_NO_ENTRY, "No entry nodes found");
      }

      const queue: QueueEntry[] = entryNodes.map((n) => ({
        nodeId: n.id,
        triggeredBy: null,
      }));

      // Fan-in tracking: count how many inputs each node has received
      // Nodes with multiple incoming edges wait until all have arrived
      const pendingInputs = new Map<string, Map<string, unknown>>(); // nodeId → (sourceId → output)
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
          this.emit({ type: "run:completed", runId, data: { status: "cancelled" } });
          return;
        }

        // Batch: take all entries from the current queue and run in parallel
        const batch = queue.splice(0, queue.length);

        // Check fan-in: filter out entries that need to wait for more inputs
        const ready: QueueEntry[] = [];
        const waiting: QueueEntry[] = [];

        for (const entry of batch) {
          const node = nodeMap.get(entry.nodeId);
          if (!node) continue;

          if (node.data.type === "merge") {
            // Merge nodes: wait for ALL inputs before executing once
            const incomingEdges = getIncomingEdges(entry.nodeId, edges);
            const activeIncoming = incomingEdges.filter(
              (e) => nodeOutputs.has(e.source) || e.source === entry.triggeredBy
            );

            if (!pendingInputs.has(entry.nodeId)) {
              pendingInputs.set(entry.nodeId, new Map());
            }
            const inputs = pendingInputs.get(entry.nodeId)!;
            if (entry.triggeredBy) {
              inputs.set(entry.triggeredBy, nodeOutputs.get(entry.triggeredBy));
            }

            if (inputs.size >= activeIncoming.length) {
              ready.push(entry);
              pendingInputs.delete(entry.nodeId);
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

            const output = await this.executeNode(
              runId,
              entry.nodeId,
              nodeMap,
              edges,
              nodeOutputs,
              conversationHistory,
              triggerPayload,
              entry.triggeredBy
            );

            // Determine next entries
            const next: QueueEntry[] = [];
            const outgoing = getOutgoingEdges(entry.nodeId, edges);

            if (node.data.type === "condition") {
              const condResult = (output as { __conditionResult?: boolean })?.__conditionResult;
              const passthrough = (output as { __passthrough?: unknown })?.__passthrough;
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
              let cleanOutput = output;
              try {
                const parsed = typeof output === "string" ? JSON.parse(output) : output;
                if (parsed?.__routeTo) {
                  routeTo = parsed.__routeTo as string;
                  cleanOutput = parsed.content ?? output;
                  nodeOutputs.set(entry.nodeId, cleanOutput);
                }
              } catch {
                // Not JSON, no routing metadata
              }

              if (routeTo) {
                // Route to the chosen edge only
                const targetEdge = outgoing.find((e) => e.target === routeTo);
                if (targetEdge) {
                  next.push({ nodeId: targetEdge.target, triggeredBy: entry.nodeId });
                } else {
                  // Invalid route — fall through to all edges
                  logger.warn("Agent routed to invalid target", { routeTo, nodeId: entry.nodeId });
                  for (const edge of outgoing) {
                    next.push({ nodeId: edge.target, triggeredBy: entry.nodeId });
                  }
                }
              } else {
                // No routing — trigger all edges (backward compat)
                for (const edge of outgoing) {
                  next.push({ nodeId: edge.target, triggeredBy: entry.nodeId });
                }
              }
            } else {
              for (const edge of outgoing) {
                next.push({ nodeId: edge.target, triggeredBy: entry.nodeId });
              }
            }

            return next;
          })
        );

        // Flatten next entries back into the queue
        for (const next of results) {
          queue.push(...next);
        }
      }

      // Success
      const now = new Date().toISOString();
      await db
        .update(runs)
        .set({ status: "success", completedAt: now })
        .where(eq(runs.id, runId));
      this.emit({ type: "run:completed", runId, data: { status: "success" } });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const now = new Date().toISOString();
      await db
        .update(runs)
        .set({ status: "failure", completedAt: now, error: message })
        .where(eq(runs.id, runId));
      this.emit({ type: "run:completed", runId, data: { status: "failure", error: message } });
    }
  }

  // ── Node Execution ───────────────────────────────────────

  private async executeNode(
    runId: string,
    nodeId: string,
    nodeMap: Map<string, WorkflowNode>,
    edges: WorkflowEdge[],
    nodeOutputs: Map<string, unknown>,
    conversationHistory: Map<string, Array<{ role: string; content: string }>>,
    triggerPayload?: unknown,
    triggeredBy?: string | null
  ): Promise<unknown> {
    const node = nodeMap.get(nodeId);
    if (!node) return undefined;

    // Resolve input — use triggeredBy first, then fan-in only for truly parallel sources
    let input: unknown;
    const incomingEdges = getIncomingEdges(nodeId, edges);

    if (triggeredBy) {
      // We know exactly which node triggered us — use its output directly
      input = nodeOutputs.get(triggeredBy);
    } else if (incomingEdges.length > 1) {
      // Fan-in: collect outputs from all predecessors that actually ran
      const inputs: unknown[] = [];
      for (const e of incomingEdges) {
        if (nodeOutputs.has(e.source)) {
          inputs.push(nodeOutputs.get(e.source));
        }
      }
      input = inputs.length === 1 ? inputs[0] : inputs;
    } else if (incomingEdges.length === 1) {
      input = nodeOutputs.get(incomingEdges[0].source);
    }

    this.emit({ type: "node:started", runId, nodeId });

    try {
      let output: unknown;

      switch (node.data.type) {
        case "trigger": {
          const config = node.data.config as TriggerConfig;
          output = triggerPayload ?? config.prompt ?? null;
          break;
        }

        case "agent": {
          const outEdges = getOutgoingEdges(nodeId, edges);
          const routeTargets = outEdges.length >= 2
            ? outEdges.map((e) => {
                const target = nodeMap.get(e.target);
                return {
                  nodeId: e.target,
                  label: target?.data.label ?? e.target,
                  type: target?.data.type ?? "unknown",
                };
              })
            : undefined;

          // Check if this agent connects to a Prompt node (conversational loop)
          const hasPromptOutput = outEdges.some((e) => {
            const target = nodeMap.get(e.target);
            return target?.data.type === "prompt";
          });

          // Get or create conversation history for this agent
          const history = hasPromptOutput
            ? (conversationHistory.get(nodeId) ?? [])
            : undefined;

          output = await this.executeAgent(runId, nodeId, node.data.config as AgentConfig, input, routeTargets, history);

          // Update conversation history if this agent is in a prompt loop
          if (hasPromptOutput && history) {
            // Add the user input (from prompt response) if it exists and is from a prompt
            const triggeredByNode = triggeredBy ? nodeMap.get(triggeredBy) : null;
            if (triggeredByNode?.data.type === "prompt" && input) {
              history.push({ role: "user", content: typeof input === "string" ? input : JSON.stringify(input) });
            }
            // Add the agent's output
            const agentOutput = typeof output === "string" ? output : JSON.stringify(output);
            // Strip routing markers from history
            const cleanOutput = agentOutput.replace(/\[\[ROUTE:[^\]]+\]\]/g, "").trim();
            history.push({ role: "assistant", content: cleanOutput });
            conversationHistory.set(nodeId, history);
          }
          break;
        }

        case "condition": {
          const config = node.data.config as ConditionConfig;
          const result = evaluateExpression(config.expression, input);
          output = { __conditionResult: result, __passthrough: input };
          break;
        }

        case "transform":
          output = await this.executeCode(node.data.config as CodeConfig, input);
          break;

        case "merge": {
          // Merge node: combine all inputs into a keyed object using source node labels
          const inEdges = getIncomingEdges(nodeId, edges);
          const merged: Record<string, unknown> = {};
          for (const edge of inEdges) {
            const sourceNode = nodeMap.get(edge.source);
            const key = sourceNode?.data.label ?? edge.source;
            const val = nodeOutputs.get(edge.source);
            if (val !== undefined) merged[key] = val;
          }
          output = merged;
          break;
        }

        case "prompt": {
          const config = node.data.config as PromptConfig;
          // Build the question — include input context if available
          const question = input
            ? `${config.question}\n\nContext:\n${typeof input === "string" ? input : JSON.stringify(input, null, 2)}`
            : config.question;

          // Send question via channel and wait for response
          this.emit({
            type: "prompt:question",
            runId,
            nodeId,
            data: { question, waitingForResponse: true },
          });

          logger.info(`Prompt node waiting for response`, { runId, nodeId });
          output = await registerPrompt(runId, nodeId, question, input);
          break;
        }

        case "output": {
          const config = node.data.config as OutputConfig;
          output = input;
          await this.handleOutput(config, input, runId, nodeId);
          break;
        }
      }

      nodeOutputs.set(nodeId, output);
      this.emit({ type: "node:completed", runId, nodeId, data: output });
      return output;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit({ type: "node:failed", runId, nodeId, data: { error: message } });
      throw err;
    }
  }

  // ── Agent Execution ──────────────────────────────────────

  private async executeAgent(
    runId: string,
    nodeId: string,
    config: AgentConfig,
    input: unknown,
    routeTargets?: RouteTarget[],
    conversationHistory?: Array<{ role: string; content: string }>
  ): Promise<string> {
    const taskId = nanoid();
    const now = new Date().toISOString();
    const engine = config.engine ?? "claude";

    if (engine === "ollama" && !config.ollamaModel) {
      throw new AppError(ErrorCode.AGENT_NO_MODEL, "No Ollama model selected");
    }

    const modelName = engine === "ollama" ? config.ollamaModel! : (config.model ?? "sonnet");

    // Build routing-aware config
    const augmentedConfig = { ...config };
    if (routeTargets && routeTargets.length >= 2) {
      const routeList = routeTargets
        .map((r) => `  - "${r.nodeId}" → ${r.label} (${r.type} node)`)
        .join("\n");
      const routeInstruction = [
        "\n\n## Routing",
        "You have multiple possible next steps. You MUST call the openconclave_next tool to choose where to route.",
        "Available routes:",
        routeList,
        "Call openconclave_next with node_id and content. You MUST call it exactly once.",
      ].join("\n");
      augmentedConfig.systemPrompt = (config.systemPrompt ?? "") + routeInstruction;
    }

    // Conversation history available via openconclave_history MCP tool
    // Also inject into system prompt as backup for models that don't call tools proactively
    if (conversationHistory && conversationHistory.length > 0) {
      const historyText = conversationHistory
        .map((h) => `${h.role === "user" ? "User" : "You"}: ${h.content}`)
        .join("\n");
      augmentedConfig.systemPrompt = (augmentedConfig.systemPrompt ?? "") +
        "\n\n## Conversation History\nPrevious turns (also available via openconclave_history tool):\n" + historyText;
    }

    await db.insert(agentTasks).values({
      id: taskId,
      runId,
      nodeId,
      status: "running",
      prompt: config.prompt,
      systemPrompt: augmentedConfig.systemPrompt,
      model: `${engine}/${modelName}`,
      input: input ?? null,
      startedAt: now,
      createdAt: now,
    });

    this.emit({ type: "agent:started", runId, nodeId, data: { taskId, engine } });

    const MAX_ROUTE_RETRIES = 3;
    let result: AgentResult;
    let routedTo: string | null = null;

    for (let attempt = 0; attempt <= MAX_ROUTE_RETRIES; attempt++) {
      if (engine === "ollama") {
        const ollamaTools = this.mapOllamaTools(augmentedConfig);

        // Add openconclave_next tool for routing
        if (routeTargets && routeTargets.length >= 2) {
          ollamaTools.push("openconclave_next");
        }

        result = await runOllamaAgent({
          model: modelName,
          prompt: attempt === 0 ? augmentedConfig.prompt : `Previous attempt failed: you must call openconclave_next to choose a route. Try again. ${augmentedConfig.prompt}`,
          systemPrompt: augmentedConfig.systemPrompt,
          input,
          tools: ollamaTools.length > 0 ? ollamaTools : undefined,
          mcpServers: config.mcpServers,
          onOutput: (chunk) => {
            this.emit({ type: "agent:output", runId, nodeId, data: { taskId, chunk } });
          },
        });
      } else {
        result = await agentPool.submit(taskId, {
          config: augmentedConfig,
          input,
          routeTargets,
          conversationHistory,
          onOutput: (chunk) => {
            this.emit({ type: "agent:output", runId, nodeId, data: { taskId, chunk } });
          },
        });
      }

      // If no routing needed, break immediately
      if (!routeTargets || routeTargets.length < 2) break;

      // Check if agent called openconclave_next (route written to state file)
      if (result.routeTo) {
        routedTo = result.routeTo;
        break;
      }

      // No route — retry if routing was required
      if (attempt < MAX_ROUTE_RETRIES) {
        logger.warn(`Agent didn't route, retry ${attempt + 1}/${MAX_ROUTE_RETRIES}`, { runId, nodeId });
      }
    }

    // Store route in output metadata
    if (routedTo) {
      result.output = JSON.stringify({ __routeTo: routedTo, content: result.output });
    }

    const completedAt = new Date().toISOString();
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

    // Emit thinking blocks as separate events for observability
    if (result.thinking && result.thinking.length > 0) {
      this.emit({
        type: "agent:thinking",
        runId,
        nodeId,
        data: { taskId, thinking: result.thinking },
      });
    }

    this.emit({
      type: "agent:completed",
      runId,
      nodeId,
      data: { taskId, success: result.success, durationMs: result.durationMs },
    });

    if (!result.success) {
      throw new AppError(ErrorCode.AGENT_FAILED, `Agent task failed: ${result.error}`);
    }

    return result.output;
  }

  private mapOllamaTools(config: AgentConfig): string[] {
    const tools: string[] = [];
    const toolMap: Record<string, string> = {
      Bash: "bash",
      Read: "read_file",
      Write: "write_file",
      WebFetch: "web_fetch",
    };

    if (config.allowedTools) {
      for (const t of config.allowedTools) {
        const mapped = toolMap[t];
        if (mapped) tools.push(mapped);
      }
    }

    if (config.mcpServers?.includes("telegram-voice")) {
      tools.push("send_telegram");
    }

    return tools;
  }


  // ── Code Execution ───────────────────────────────────────

  private async executeCode(config: CodeConfig, input: unknown): Promise<unknown> {
    const { runtime, code } = config;
    const inputStr = typeof input === "string" ? input : JSON.stringify(input);

    const cmdMap: Record<string, string[]> = {
      python: ["python3", "-c", code],
      node: ["node", "-e", code],
      bash: ["bash", "-c", code],
    };

    const cmd = cmdMap[runtime];
    if (!cmd) {
      throw new AppError(ErrorCode.CODE_INVALID_RUNTIME, `Unknown runtime: ${runtime}`);
    }

    const proc = Bun.spawn(cmd, {
      cwd: PROJECT_ROOT,
      stdin: new Blob([inputStr]),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, INPUT: inputStr },
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new AppError(
        ErrorCode.CODE_EXECUTION_FAILED,
        `Code node failed (${runtime}, exit ${exitCode}): ${stderr}`
      );
    }

    try {
      return JSON.parse(stdout.trim());
    } catch {
      return stdout.trim();
    }
  }

  // ── Output Handling ──────────────────────────────────────

  private async handleOutput(
    config: OutputConfig,
    data: unknown,
    runId: string,
    nodeId: string
  ): Promise<void> {
    switch (config.type) {
      case "claude-code":
        this.emit({ type: "channel:output", runId, nodeId, data });
        break;

      case "telegram":
        await this.sendTelegram(config.chatId, data);
        break;

      default:
        logger.info(`[Output: ${config.type}]`, {
          data: typeof data === "string" ? data.slice(0, 200) : JSON.stringify(data).slice(0, 200),
        });
    }
  }

  private async sendTelegram(chatId: string | undefined, data: unknown): Promise<void> {
    const [tokenRow] = await db
      .select()
      .from(settings)
      .where(eq(settings.key, "telegram_bot_token"));
    const token = tokenRow?.value;

    if (!token) {
      throw new AppError(ErrorCode.TELEGRAM_NO_TOKEN, "No Telegram bot token in Settings");
    }
    if (!chatId) {
      throw new AppError(ErrorCode.TELEGRAM_SEND_FAILED, "No chat ID on Telegram output node");
    }

    const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new AppError(ErrorCode.TELEGRAM_SEND_FAILED, `Telegram API error: ${err}`);
    }
  }

  // ── Events ───────────────────────────────────────────────

  private emit(event: RunEvent): void {
    const now = new Date().toISOString();
    db.insert(runEvents)
      .values({
        runId: event.runId,
        nodeId: event.nodeId,
        type: event.type,
        data: event.data ?? null,
        createdAt: now,
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("Failed to persist event", { error: message });
      });

    this.onEvent?.(event);
  }
}
