import { Hono } from "hono";

import { broadcastToTopic } from "../ws/broadcast";

export const channelRoutes = new Hono()
  .post("/improve-prompt", async (c) => {
    const body = await c.req.json() as {
      workflowId: string;
      nodeId: string;
      nodeLabel: string;
      currentPrompt: string;
    };
    broadcastToTopic("dashboard", {
      type: "channel:improve-prompt",
      data: body,
    });
    return c.json({ ok: true });
  })

  .post("/improve-description", async (c) => {
    const body = await c.req.json() as {
      workflowId: string;
      currentDescription: string;
    };
    broadcastToTopic("dashboard", {
      type: "channel:improve-description",
      data: body,
    });
    return c.json({ ok: true });
  })

  .post("/improve-code", async (c) => {
    const body = await c.req.json() as {
      workflowId: string;
      nodeId: string;
      nodeLabel: string;
      runtime: string;
      currentCode: string;
    };
    broadcastToTopic("dashboard", {
      type: "channel:improve-code",
      data: body,
    });
    return c.json({ ok: true });
  });
