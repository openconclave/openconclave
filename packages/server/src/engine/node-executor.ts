import { join, isAbsolute } from "path";
import { mkdirSync, existsSync, readFileSync, appendFileSync } from "fs";
import { eq } from "drizzle-orm";

import { db } from "../db/client";
import { settings } from "../db/schema";
import { getIncomingEdges, getOutgoingEdges } from "./graph";
import { evaluateExpression } from "../lib/expression";
import { registerPrompt } from "./prompt-registry";
import { logger } from "../lib/logger";
import { SESSIONS_DIR } from "../lib/workspace";
import { AppError, ErrorCode } from "@openconclave/shared";
import type {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowEdge,
  AgentConfig,
  ConditionConfig,
  CodeConfig,
  TriggerConfig,
  OutputConfig,
} from "@openconclave/shared";

import { executeAgent } from "./agent-executor";
import type { RunEvent } from "./types";

// Agent working directory = where the server process was started
const AGENT_CWD = process.cwd();

// ── Node Execution ──────────────────────────────────────────

export async function executeNode(
  runId: number,
  nodeId: string,
  nodeMap: Map<string, WorkflowNode>,
  edges: WorkflowEdge[],
  nodeOutputs: Map<string, unknown>,
  agentSessions: Map<string, string>,
  workflowContext: string | null,
  workflow: WorkflowDefinition,
  emit: (event: RunEvent) => void,
  triggerPayload?: unknown,
  triggeredBy?: string | null,
  callerCwd?: string
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

  emit({ type: "node:started", runId, nodeId });

  try {
    let output: unknown;

    switch (node.data.type) {
      case "trigger":
        output = executeTrigger(node, input, triggerPayload, workflow, runId, nodeId, emit);
        break;

      case "agent":
        output = await executeAgentNode(
          runId, nodeId, node, nodeMap, edges, nodeOutputs, agentSessions,
          workflowContext, input, emit, callerCwd
        );
        break;

      case "condition":
        output = executeCondition(node, input);
        break;

      case "transform":
        output = await executeCode(node.data.config as CodeConfig, input);
        break;

      case "merge":
        output = executeMerge(nodeId, edges, nodeMap, nodeOutputs);
        break;

      case "prompt":
        output = await executePrompt(node, input, workflow, runId, nodeId, triggeredBy, nodeMap, emit);
        break;

      case "file":
        output = executeFile(node, callerCwd);
        break;

      case "output":
        output = await executeOutput(node, input, runId, nodeId, workflow.name, emit);
        break;
    }

    nodeOutputs.set(nodeId, output);
    emit({ type: "node:completed", runId, nodeId, data: output });
    return output;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: "node:failed", runId, nodeId, data: { error: message } });
    throw err;
  }
}

// ── Per-type handlers ───────────────────────────────────────

function executeTrigger(
  node: WorkflowNode,
  input: unknown,
  triggerPayload: unknown,
  workflow: WorkflowDefinition,
  runId: number,
  nodeId: string,
  emit: (event: RunEvent) => void
): unknown {
  const config = node.data.config as TriggerConfig;
  if (config.type === "chat" && input !== undefined && input !== null) {
    // Chat trigger received a response back from the workflow — emit and STOP
    const content = typeof input === "string" ? input : JSON.stringify(input, null, 2);
    emit({
      type: "chat:response",
      runId,
      nodeId,
      data: {
        content,
        workflowName: workflow.name,
        nodeLabel: node.data.label,
      },
    });
    // Return __chatTerminal to signal the walker should not propagate
    return { __chatTerminal: true };
  }
  return triggerPayload ?? config.prompt ?? null;
}

async function executeAgentNode(
  runId: number,
  nodeId: string,
  node: WorkflowNode,
  nodeMap: Map<string, WorkflowNode>,
  edges: WorkflowEdge[],
  nodeOutputs: Map<string, unknown>,
  agentSessions: Map<string, string>,
  workflowContext: string | null,
  input: unknown,
  emit: (event: RunEvent) => void,
  callerCwd?: string
): Promise<unknown> {
  const outEdges = getOutgoingEdges(nodeId, edges);
  const routeTargets = outEdges.length >= 2
    ? outEdges.map((e) => {
        const target = nodeMap.get(e.target);
        const targetConfig = target?.data.config as Record<string, unknown> | undefined;
        const description = targetConfig?.description as string | undefined;
        return {
          nodeId: e.target,
          label: target?.data.label ?? e.target,
          type: target?.data.type ?? "unknown",
          description,
        };
      })
    : undefined;

  // Clean input — strip routing metadata
  let userMessage: string | null = null;
  if (input !== undefined && input !== null) {
    const inputStr = typeof input === "string" ? input : JSON.stringify(input);
    try {
      const parsed = JSON.parse(inputStr);
      userMessage = parsed?.__routeTo ? (parsed.content ?? inputStr) : inputStr;
    } catch {
      userMessage = inputStr;
    }
  }

  // Build system prompt: agent's instructions + workflow context
  const agentConfig = node.data.config as AgentConfig;
  const systemParts: string[] = [];
  if (agentConfig.systemPrompt) systemParts.push(agentConfig.systemPrompt);
  if (workflowContext) systemParts.push(`\nWorkflow context: ${workflowContext}`);
  const fullSystemPrompt = systemParts.join("\n\n");

  const chatConfig = {
    ...agentConfig,
    systemPrompt: fullSystemPrompt,
  };

  const engine = agentConfig.engine ?? "claude";
  let output: unknown;

  if (engine === "claude") {
    // Claude agents: SDK handles session via resume — no history management needed
    const existingSessionId = agentSessions.get(nodeId);
    const agentResult = await executeAgent(runId, nodeId, chatConfig, userMessage ?? input, emit, routeTargets, existingSessionId, callerCwd);
    output = agentResult.output;
    if (agentResult.sessionId) {
      agentSessions.set(nodeId, agentResult.sessionId);
    }
  } else {
    // Non-Claude agents: executor manages session JSONL file
    const sessionDir = SESSIONS_DIR;
    mkdirSync(sessionDir, { recursive: true });
    const sessionFile = agentSessions.get(nodeId) ?? join(sessionDir, `${runId}-${nodeId}.jsonl`);

    // Write system prompt only if session file is new (not a continuation)
    if (!existsSync(sessionFile)) {
      appendFileSync(sessionFile, JSON.stringify({ role: "system", content: fullSystemPrompt }) + "\n");
    }

    // Append user message
    const userContent = userMessage ?? workflowContext ?? "Start";
    appendFileSync(sessionFile, JSON.stringify({ role: "user", content: userContent }) + "\n");

    // Execute agent — it reads the session file for messages
    const agentResult = await executeAgent(runId, nodeId, chatConfig, userMessage ?? input, emit, routeTargets, sessionFile, callerCwd);
    output = agentResult.output;

    // Append assistant response (with thinking) to session file
    let cleanOutput = typeof output === "string" ? output : JSON.stringify(output);
    try {
      const parsed = JSON.parse(cleanOutput);
      if (parsed?.__routeTo) cleanOutput = parsed.content ?? cleanOutput;
    } catch { /* not JSON */ }

    let assistantContent = cleanOutput;
    if (agentResult.thinking && agentResult.thinking.length > 0) {
      const thinkingText = agentResult.thinking.map((t) => t.thinking).join("\n");
      assistantContent = `<think>${thinkingText}</think>\n${cleanOutput}`;
    }
    appendFileSync(sessionFile, JSON.stringify({ role: "assistant", content: assistantContent }) + "\n");

    agentSessions.set(nodeId, sessionFile);
  }

  return output;
}

function executeCondition(node: WorkflowNode, input: unknown): unknown {
  const config = node.data.config as ConditionConfig;
  const result = evaluateExpression(config.expression, input);
  return { __conditionResult: result, __passthrough: input };
}

function executeMerge(
  nodeId: string,
  edges: WorkflowEdge[],
  nodeMap: Map<string, WorkflowNode>,
  nodeOutputs: Map<string, unknown>
): unknown {
  const inEdges = getIncomingEdges(nodeId, edges);
  const merged: Record<string, unknown> = {};
  for (const edge of inEdges) {
    const sourceNode = nodeMap.get(edge.source);
    const key = sourceNode?.data.label ?? edge.source;
    const val = nodeOutputs.get(edge.source);
    if (val !== undefined) merged[key] = val;
  }
  return merged;
}

async function executePrompt(
  node: WorkflowNode,
  input: unknown,
  workflow: WorkflowDefinition,
  runId: number,
  nodeId: string,
  triggeredBy: string | null | undefined,
  nodeMap: Map<string, WorkflowNode>,
  emit: (event: RunEvent) => void
): Promise<unknown> {
  // Channel Loop: send agent's output to channel, wait for response
  const content = typeof input === "string" ? input : JSON.stringify(input, null, 2);

  // Find which agent sent this (the node that triggered this prompt)
  const senderNode = triggeredBy ? nodeMap.get(triggeredBy) : null;

  emit({
    type: "prompt:question",
    runId,
    nodeId,
    data: {
      question: content,
      waitingForResponse: true,
      workflowName: workflow.name,
      nodeLabel: node.data.label,
      senderNode: senderNode?.data.label ?? triggeredBy ?? "unknown",
      senderType: senderNode?.data.type ?? "unknown",
    },
  });

  logger.info("Channel-in-the-loop waiting for response", { runId, nodeId });
  return registerPrompt(runId, nodeId, content, input);
}

function executeFile(node: WorkflowNode, callerCwd?: string): unknown {
  const fileConfig = node.data.config as { path: string };
  try {
    const filePath = fileConfig.path;
    // Resolve relative paths against callerCwd
    const resolvedPath = isAbsolute(filePath)
      ? filePath
      : join(callerCwd ?? process.cwd(), filePath);
    const content = readFileSync(resolvedPath, "utf8");
    return content;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("File node read failed", { path: fileConfig.path, error: msg });
    return `Error reading file: ${msg}`;
  }
}

async function executeOutput(
  node: WorkflowNode,
  input: unknown,
  runId: number,
  nodeId: string,
  workflowName: string | undefined,
  emit: (event: RunEvent) => void
): Promise<unknown> {
  const config = node.data.config as OutputConfig;
  await handleOutput(config, input, runId, nodeId, workflowName, node.data.label, emit);
  return input;
}

// ── Code Execution ──────────────────────────────────────────

async function executeCode(config: CodeConfig, input: unknown): Promise<unknown> {
  const { runtime, code } = config;
  // Bug fix: JSON.stringify(undefined) returns undefined, normalize to ""
  const inputStr = typeof input === "string" ? input : (JSON.stringify(input) ?? "");

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
    cwd: AGENT_CWD,
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

// ── Output Handling ─────────────────────────────────────────

async function handleOutput(
  config: OutputConfig,
  data: unknown,
  runId: number,
  nodeId: string,
  workflowName: string | undefined,
  nodeLabel: string | undefined,
  emit: (event: RunEvent) => void
): Promise<void> {
  switch (config.type) {
    case "claude-code":
      emit({ type: "channel:output", runId, nodeId, data: { content: data, workflowName, nodeLabel } });
      break;

    case "telegram":
      await sendTelegram(config.chatId, data);
      break;

    default:
      logger.info(`[Output: ${config.type}]`, {
        data: typeof data === "string" ? data.slice(0, 200) : JSON.stringify(data).slice(0, 200),
      });
  }
}

async function sendTelegram(chatId: string | undefined, data: unknown): Promise<void> {
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
