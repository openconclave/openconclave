import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { ConclaveNode } from "@openconclave/shared";

import { db } from "../db/client";
import { runs, conclaves } from "../db/schema";
import { registerPrompt, respondToPrompt, getPendingPrompts } from "../engine/prompt-registry";
import { broadcastRunEvent } from "../ws/broadcast";

const askSchema = z.object({
  runId: z.number().int(),
  nodeId: z.string().min(1),
  question: z.string(),
  senderNode: z.string().optional(),
});

const respondSchema = z.object({
  runId: z.number().int(),
  nodeId: z.string().min(1),
  response: z.string(),
});

export const promptRoutes = new Hono()
  .get("/pending", (c) => {
    return c.json({ prompts: getPendingPrompts() });
  })

  .post("/respond", zValidator("json", respondSchema), async (c) => {
    const { runId, nodeId, response } = c.req.valid("json");
    const ok = respondToPrompt(runId, nodeId, response);
    if (!ok) return c.json({ error: "No pending prompt found" }, 404);
    return c.json({ ok: true });
  })

  // Blocking ask — used by conclave MCP server (out-of-process) for Claude agents.
  .post("/ask", zValidator("json", askSchema), async (c) => {
    const { runId, nodeId, question, senderNode } = c.req.valid("json");

    let conclaveName = "";
    let nodeLabel = nodeId;
    const [run] = await db.select().from(runs).where(eq(runs.id, runId));
    if (run) {
      const [conclave] = await db.select().from(conclaves).where(eq(conclaves.id, run.conclaveId));
      if (conclave) {
        conclaveName = conclave.name;
        const definition =
          typeof conclave.definition === "string"
            ? JSON.parse(conclave.definition)
            : conclave.definition;
        const node = (definition.nodes as ConclaveNode[]).find((n) => n.id === nodeId);
        if (node) nodeLabel = node.data.label;
      }
    }

    // Register before broadcast so a fast UI + fast user can't post a response
    // that arrives before registerPrompt stashes the resolver.
    const responsePromise = registerPrompt(runId, nodeId, question, null, c.req.raw.signal);
    broadcastRunEvent({
      type: "prompt:question",
      runId,
      nodeId,
      data: {
        question,
        waitingForResponse: true,
        conclaveName,
        nodeLabel,
        senderNode: senderNode ?? "agent",
        senderType: "agent",
      },
    });
    const response = await responsePromise;
    return c.json({ response });
  });
