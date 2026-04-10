import { Hono } from "hono";

import { broadcastToTopic } from "../ws/broadcast";

function broadcastAsChannelOutput(content: string, nodeLabel: string) {
  broadcastToTopic("dashboard", {
    type: "channel:output",
    runId: 0,
    nodeId: "improve",
    data: { content, workflowName: "Improve", nodeLabel },
  });
}

export const channelRoutes = new Hono()
  .post("/improve-prompt", async (c) => {
    const { workflowId, nodeId, nodeLabel, currentPrompt } = await c.req.json() as {
      workflowId: string;
      nodeId: string;
      nodeLabel: string;
      currentPrompt: string;
    };
    const content = [
      "A user wants you to improve an agent's system prompt in OpenConclave.",
      "",
      `Workflow ID: ${workflowId}`,
      `Node ID: ${nodeId}`,
      `Node Label: ${nodeLabel}`,
      "",
      "Current prompt:",
      currentPrompt || "(empty)",
      "",
      "Please write an improved version of this system prompt — make it clearer, more effective, and well-structured.",
      "Then call `update_node` to save it:",
      `  update_node(workflowId: "${workflowId}", nodeId: "${nodeId}", config: { systemPrompt: "your improved prompt" })`,
    ].join("\n");
    broadcastAsChannelOutput(content, "Improve Prompt");
    return c.json({ ok: true });
  })

  .post("/improve-description", async (c) => {
    const { workflowId, currentDescription } = await c.req.json() as {
      workflowId: string;
      currentDescription: string;
    };
    const content = [
      "A user wants you to improve the workflow-level Instructions for Claude in OpenConclave.",
      "",
      `Workflow ID: ${workflowId}`,
      "",
      "Current instructions:",
      currentDescription || "(empty)",
      "",
      "Please write an improved version — make it clearer, more effective, and well-structured.",
      "Then call `update_workflow` to save it:",
      `  update_workflow(workflowId: "${workflowId}", description: "your improved instructions")`,
    ].join("\n");
    broadcastAsChannelOutput(content, "Improve Description");
    return c.json({ ok: true });
  })

  .post("/improve-code", async (c) => {
    const { workflowId, nodeId, nodeLabel, runtime, currentCode } = await c.req.json() as {
      workflowId: string;
      nodeId: string;
      nodeLabel: string;
      runtime: string;
      currentCode: string;
    };
    const content = [
      "A user wants you to write or improve code for a Code node in OpenConclave.",
      "",
      `Workflow ID: ${workflowId}`,
      `Node ID: ${nodeId}`,
      `Node Label: ${nodeLabel}`,
      `Runtime: ${runtime}`,
      "",
      "Current code:",
      currentCode || "(empty — user may have typed a description of what they want)",
      "",
      "If the current code looks like a natural-language description, write the code from scratch.",
      "If it's already code, improve it — make it more robust, fix bugs, and clean it up.",
      `The runtime is ${runtime}. Input from the previous node is passed via stdin and $INPUT env var. Output must go to stdout as JSON.`,
      "",
      "Then call `update_node` to save it:",
      `  update_node(workflowId: "${workflowId}", nodeId: "${nodeId}", config: { code: "your code here" })`,
    ].join("\n");
    broadcastAsChannelOutput(content, "Improve Code");
    return c.json({ ok: true });
  });
