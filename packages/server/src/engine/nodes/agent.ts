import { join, basename } from "path";
import { existsSync, appendFileSync } from "fs";
import type { ConclaveNode, ConclaveEdge, AgentConfig, ResolvedAgentConfig, ToolConfig } from "@openconclave/shared";
import { executeAgent } from "../agent-executor";
import { sessionDirForRun } from "../../lib/workspace";
import type { RunEvent } from "../types";
import type { Workspace } from "../workspace";

export async function executeAgentNode(
  runId: number,
  nodeId: string,
  node: ConclaveNode,
  nodeMap: Map<string, ConclaveNode>,
  edges: ConclaveEdge[],
  _nodeOutputs: Map<string, unknown>,
  agentSessions: Map<string, string>,
  conclaveContext: string | null,
  input: unknown,
  emit: (event: RunEvent) => void,
  workspace?: Workspace
): Promise<unknown> {
  const agentConfig = node.data.config as AgentConfig;
  const connectedTools: string[] = [];
  const connectedMcpServers: string[] = [];
  const connectedMcpTools: ToolConfig[] = [];
  const connectedKnowledgeBases: string[] = [];

  for (const tool of agentConfig.tools ?? []) {
    if (tool.toolType === "builtin") {
      connectedTools.push(tool.toolId);
    } else if (tool.toolType === "mcp") {
      connectedMcpServers.push(tool.toolId);
      connectedMcpTools.push(tool);
    } else if (tool.toolType === "knowledge") {
      connectedKnowledgeBases.push(tool.toolId);
    }
  }

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

  const mergedConfig: ResolvedAgentConfig = {
    ...agentConfig,
    allowedTools: connectedTools,
    mcpServers: connectedMcpServers,
    mcpTools: connectedMcpTools,
    knowledgeBases: connectedKnowledgeBases,
  };

  const systemParts: string[] = [];
  if (mergedConfig.systemPrompt) systemParts.push(mergedConfig.systemPrompt);
  if (conclaveContext) systemParts.push(`\nConclave context: ${conclaveContext}`);
  const fullSystemPrompt = systemParts.join("\n\n");

  const chatConfig = {
    ...mergedConfig,
    systemPrompt: fullSystemPrompt,
  };

  const engine = mergedConfig.engine ?? "claude";
  let output: unknown;

  if (engine === "claude") {
    const existingSessionId = agentSessions.get(`${nodeId}:claude`);
    const agentResult = await executeAgent(runId, nodeId, chatConfig, userMessage ?? input, emit, undefined, existingSessionId, workspace, edges, nodeMap);
    output = agentResult.output;
    if (agentResult.sessionId) {
      agentSessions.set(`${nodeId}:claude`, agentResult.sessionId);
    }
  } else {
    const safeId = basename(nodeId).replace(/[^\w.\-]/g, "_");
    const sessionFile = agentSessions.get(`${nodeId}:${engine}`) ?? join(sessionDirForRun(runId), `${safeId}.jsonl`);

    if (!existsSync(sessionFile)) {
      appendFileSync(sessionFile, JSON.stringify({ role: "system", content: fullSystemPrompt }) + "\n");
    }

    const agentResult = await executeAgent(runId, nodeId, chatConfig, userMessage ?? input, emit, undefined, sessionFile, workspace, edges, nodeMap);
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

    agentSessions.set(`${nodeId}:${engine}`, sessionFile);
  }

  return output;
}
