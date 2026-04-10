import { Hono } from "hono";

import { registerPrompt, respondToPrompt, getPendingPrompts } from "../engine/prompt-registry";
import { broadcastRunEvent } from "../ws/broadcast";

export const promptRoutes = new Hono()
  .get("/pending", (c) => {
    return c.json({ prompts: getPendingPrompts() });
  })

  .post("/respond", async (c) => {
    const body = (await c.req.json()) as { runId: number; nodeId: string; response: string };
    const ok = respondToPrompt(body.runId, body.nodeId, body.response);
    if (!ok) return c.json({ error: "No pending prompt found" }, 404);
    return c.json({ ok: true });
  })

  // Blocking ask — used by conclave MCP server (out-of-process) for Claude agents.
  // Registers a prompt, emits the question event, and waits for the response.
  .post("/ask", async (c) => {
    const body = (await c.req.json()) as {
      runId: number;
      nodeId: string;
      question: string;
      senderNode?: string;
    };
    const { runId, nodeId, question, senderNode } = body;

    // Emit prompt:question event so channel listeners see it
    broadcastRunEvent({
      type: "prompt:question",
      runId,
      nodeId,
      data: {
        question,
        waitingForResponse: true,
        conclaveName: "",
        nodeLabel: nodeId,
        senderNode: senderNode ?? "agent",
        senderType: "agent",
      },
    });

    // Register and wait for response (blocks until respondToPrompt is called)
    const response = await registerPrompt(runId, nodeId, question, null);
    return c.json({ response });
  });
