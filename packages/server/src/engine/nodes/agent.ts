import { join } from "path";
import { mkdirSync, existsSync, appendFileSync } from "fs";
import type { WorkflowNode, WorkflowEdge, AgentConfig, ResolvedAgentConfig, ToolConfig } from "@openconclave/shared";
import { getIncomingEdges, getOutgoingEdges } from "../graph";
import { executeAgent } from "../agent-executor";
import { SESSIONS_DIR } from "../../lib/workspace";
import type { RunEvent } from "../types";

export async function executeAgentNode(
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
  // Detect connected tool nodes and extract their configs
  const connectedTools: string[] = [];
  const connectedMcpServers: string[] = [];
  const connectedKnowledgeBases: string[] = [];

  const inEdges = getIncomingEdges(nodeId, edges);
  for (const edge of inEdges) {
    const sourceNode = nodeMap.get(edge.source);
    if (sourceNode?.data.type === "tool") {
      const toolConfig = sourceNode.data.config as ToolConfig;
      if (toolConfig.toolType === "builtin") {
        connectedTools.push(toolConfig.toolId);
      } else if (toolConfig.toolType === "mcp") {
        connectedMcpServers.push(toolConfig.toolId);
      } else if (toolConfig.toolType === "knowledge") {
        connectedKnowledgeBases.push(toolConfig.toolId);
      }
    }
  }

  const outEdges = getOutgoingEdges(nodeId, edges);
  for (const edge of outEdges) {
    const targetNode = nodeMap.get(edge.target);
    if (targetNode?.data.type === "tool") {
      const toolConfig = targetNode.data.config as ToolConfig;
      if (toolConfig.toolType === "builtin") {
        connectedTools.push(toolConfig.toolId);
      } else if (toolConfig.toolType === "mcp") {
        connectedMcpServers.push(toolConfig.toolId);
      } else if (toolConfig.toolType === "knowledge") {
        connectedKnowledgeBases.push(toolConfig.toolId);
      }
    }
  }

  // Filter out tool nodes from route targets — they're config-only
  const nonToolOutEdges = outEdges.filter((e) => {
    const target = nodeMap.get(e.target);
    return target?.data.type !== "tool";
  });
  const routeTargets = nonToolOutEdges.length >= 2
    ? nonToolOutEdges.map((e) => {
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

  // Tools come exclusively from connected tool nodes
  const mergedConfig: ResolvedAgentConfig = {
    ...agentConfig,
    allowedTools: connectedTools,
    mcpServers: connectedMcpServers,
    knowledgeBases: connectedKnowledgeBases,
  };

  const systemParts: string[] = [];
  if (mergedConfig.systemPrompt) systemParts.push(mergedConfig.systemPrompt);
  if (workflowContext) systemParts.push(`\nWorkflow context: ${workflowContext}`);
  const fullSystemPrompt = systemParts.join("\n\n");

  const chatConfig = {
    ...mergedConfig,
    systemPrompt: fullSystemPrompt,
  };

  const engine = mergedConfig.engine ?? "claude";
  let output: unknown;

  if (engine === "claude") {
    const existingSessionId = agentSessions.get(nodeId);
    const agentResult = await executeAgent(runId, nodeId, chatConfig, userMessage ?? input, emit, routeTargets, existingSessionId, callerCwd);
    output = agentResult.output;
    if (agentResult.sessionId) {
      agentSessions.set(nodeId, agentResult.sessionId);
    }
  } else {
    const sessionDir = SESSIONS_DIR;
    mkdirSync(sessionDir, { recursive: true });
    const sessionFile = agentSessions.get(nodeId) ?? join(sessionDir, `${runId}-${nodeId}.jsonl`);

    if (!existsSync(sessionFile)) {
      appendFileSync(sessionFile, JSON.stringify({ role: "system", content: fullSystemPrompt }) + "\n");
    }

    const userContent = userMessage ?? workflowContext ?? "Start";
    appendFileSync(sessionFile, JSON.stringify({ role: "user", content: userContent }) + "\n");

    const agentResult = await executeAgent(runId, nodeId, chatConfig, userMessage ?? input, emit, routeTargets, sessionFile, callerCwd);
    output = agentResult.output;

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
