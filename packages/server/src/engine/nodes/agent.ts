import { join } from "path";
import { mkdirSync, existsSync, appendFileSync } from "fs";
import type { WorkflowNode, WorkflowEdge, AgentConfig, ResolvedAgentConfig, ToolConfig } from "@openconclave/shared";
import { executeAgent } from "../agent-executor";
import { SESSIONS_DIR } from "../../lib/workspace";
import type { RunEvent } from "../types";
import type { Workspace } from "../workspace";

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
  workspace?: Workspace
): Promise<unknown> {
  // Read tools directly from agent config
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

  // Route targets are now self-resolved by executeAgent from edges/nodeMap

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
  // Tools are read directly from agentConfig.tools[]
  const mergedConfig: ResolvedAgentConfig = {
    ...agentConfig,
    allowedTools: connectedTools,
    mcpServers: connectedMcpServers,
    mcpTools: connectedMcpTools,
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
    const agentResult = await executeAgent(runId, nodeId, chatConfig, userMessage ?? input, emit, undefined, existingSessionId, workspace, edges, nodeMap);
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

    agentSessions.set(nodeId, sessionFile);
  }

  return output;
}
