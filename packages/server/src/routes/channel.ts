import { Hono } from "hono";

import { broadcastToTopic } from "../ws/broadcast";

const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_TEXT = 8_000;

export const channelRoutes = new Hono()
  .use(async (c, next) => {
    // Browsers set Sec-Fetch-Site on all fetches; "cross-site" means the
    // request originates from a different site — block it to prevent CSRF.
    // Non-browser clients (curl, MCP tools) omit the header entirely and are
    // intentionally allowed through.
    if (c.req.header("sec-fetch-site") === "cross-site") {
      return c.json({ error: "Forbidden" }, 403);
    }
    await next();
  })
  .post("/improve-prompt", async (c) => {
    const { conclaveId, nodeId, nodeLabel, currentPrompt } = await c.req.json() as {
      conclaveId: string;
      nodeId: string;
      nodeLabel: string;
      currentPrompt: string;
    };
    if (!ID_RE.test(conclaveId) || !ID_RE.test(nodeId)) {
      return c.json({ error: "Invalid ID" }, 400);
    }
    broadcastToTopic("dashboard", {
      type: "channel:improve-prompt",
      data: {
        conclaveId,
        nodeId,
        nodeLabel: String(nodeLabel ?? "").slice(0, MAX_TEXT),
        currentPrompt: String(currentPrompt ?? "").slice(0, MAX_TEXT),
      },
    });
    return c.json({ ok: true });
  })

  .post("/improve-description", async (c) => {
    const { conclaveId, currentDescription } = await c.req.json() as {
      conclaveId: string;
      currentDescription: string;
    };
    if (!ID_RE.test(conclaveId)) {
      return c.json({ error: "Invalid ID" }, 400);
    }
    broadcastToTopic("dashboard", {
      type: "channel:improve-description",
      data: {
        conclaveId,
        currentDescription: String(currentDescription ?? "").slice(0, MAX_TEXT),
      },
    });
    return c.json({ ok: true });
  })

  .post("/improve-code", async (c) => {
    const { conclaveId, nodeId, nodeLabel, runtime, currentCode } = await c.req.json() as {
      conclaveId: string;
      nodeId: string;
      nodeLabel: string;
      runtime: string;
      currentCode: string;
    };
    if (!ID_RE.test(conclaveId) || !ID_RE.test(nodeId)) {
      return c.json({ error: "Invalid ID" }, 400);
    }
    broadcastToTopic("dashboard", {
      type: "channel:improve-code",
      data: {
        conclaveId,
        nodeId,
        nodeLabel: String(nodeLabel ?? "").slice(0, MAX_TEXT),
        runtime: String(runtime ?? "").slice(0, 64),
        currentCode: String(currentCode ?? "").slice(0, MAX_TEXT),
      },
    });
    return c.json({ ok: true });
  });
