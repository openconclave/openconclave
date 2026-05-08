import { Hono } from "hono";

import { broadcastToTopic } from "../ws/broadcast";
import { maybeEmitPluginEvent } from "../plugin/event-emitter";

const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_TEXT = 8_000;

// UI Improve buttons emit channel:output plugin events at runId=0 so Claude
// Code receives them through the same __OC_EVENT__ stdout path that real
// run outputs use. Going via WebSocket + server.notification(claude/channel)
// silently drops — that custom MCP method has no Claude Code surface.
const IMPROVE_RUN_ID = 0;

function buildImprovePromptDirective(d: {
  conclaveId: string;
  nodeId: string;
  nodeLabel: string;
  currentPrompt: string;
}): string {
  return [
    "A user wants you to improve an agent's system prompt in OpenConclave.",
    "",
    `Conclave ID: ${d.conclaveId}`,
    `Node ID: ${d.nodeId}`,
    `Node Label: ${d.nodeLabel}`,
    "",
    "Current prompt:",
    d.currentPrompt || "(empty)",
    "",
    "Please write an improved version of this system prompt — make it clearer, more effective, and well-structured.",
    "Then call `update_node` to save it:",
    `  update_node(conclaveId: "${d.conclaveId}", nodeId: "${d.nodeId}", config: { systemPrompt: "your improved prompt" })`,
  ].join("\n");
}

function buildImproveDescriptionDirective(d: {
  conclaveId: string;
  currentDescription: string;
}): string {
  return [
    "A user wants you to improve the conclave-level Instructions for Claude in OpenConclave.",
    "",
    `Conclave ID: ${d.conclaveId}`,
    "",
    "Current instructions:",
    d.currentDescription || "(empty)",
    "",
    "Please write an improved version — make it clearer, more effective, and well-structured.",
    "Then call `update_conclave` to save it:",
    `  update_conclave(conclaveId: "${d.conclaveId}", description: "your improved instructions")`,
  ].join("\n");
}

function buildImproveCodeDirective(d: {
  conclaveId: string;
  nodeId: string;
  nodeLabel: string;
  runtime: string;
  currentCode: string;
}): string {
  return [
    "A user wants you to write or improve code for a Code node in OpenConclave.",
    "",
    `Conclave ID: ${d.conclaveId}`,
    `Node ID: ${d.nodeId}`,
    `Node Label: ${d.nodeLabel}`,
    `Runtime: ${d.runtime}`,
    "",
    "Current code:",
    d.currentCode || "(empty — user may have typed a description of what they want)",
    "",
    "If the current code looks like a natural-language description, write the code from scratch.",
    "If it's already code, improve it — make it more robust, fix bugs, and clean it up.",
    `The runtime is ${d.runtime}. Input from the previous node is passed via stdin and $INPUT env var. Output must go to stdout as JSON.`,
    "",
    "Then call `update_node` to save it:",
    `  update_node(conclaveId: "${d.conclaveId}", nodeId: "${d.nodeId}", config: { code: "your code here" })`,
  ].join("\n");
}

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
    const safeLabel = String(nodeLabel ?? "").slice(0, MAX_TEXT);
    const safePrompt = String(currentPrompt ?? "").slice(0, MAX_TEXT);

    broadcastToTopic("dashboard", {
      type: "channel:improve-prompt",
      data: { conclaveId, nodeId, nodeLabel: safeLabel, currentPrompt: safePrompt },
    });

    maybeEmitPluginEvent({
      type: "channel:output",
      runId: IMPROVE_RUN_ID,
      nodeId,
      data: {
        content: buildImprovePromptDirective({ conclaveId, nodeId, nodeLabel: safeLabel, currentPrompt: safePrompt }),
        nodeLabel: "Improve Prompt",
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
    const safeDescription = String(currentDescription ?? "").slice(0, MAX_TEXT);

    broadcastToTopic("dashboard", {
      type: "channel:improve-description",
      data: { conclaveId, currentDescription: safeDescription },
    });

    maybeEmitPluginEvent({
      type: "channel:output",
      runId: IMPROVE_RUN_ID,
      nodeId: "improve-description",
      data: {
        content: buildImproveDescriptionDirective({ conclaveId, currentDescription: safeDescription }),
        nodeLabel: "Improve Description",
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
    const safeLabel = String(nodeLabel ?? "").slice(0, MAX_TEXT);
    const safeRuntime = String(runtime ?? "").slice(0, 64);
    const safeCode = String(currentCode ?? "").slice(0, MAX_TEXT);

    broadcastToTopic("dashboard", {
      type: "channel:improve-code",
      data: { conclaveId, nodeId, nodeLabel: safeLabel, runtime: safeRuntime, currentCode: safeCode },
    });

    maybeEmitPluginEvent({
      type: "channel:output",
      runId: IMPROVE_RUN_ID,
      nodeId,
      data: {
        content: buildImproveCodeDirective({ conclaveId, nodeId, nodeLabel: safeLabel, runtime: safeRuntime, currentCode: safeCode }),
        nodeLabel: "Improve Code",
      },
    });

    return c.json({ ok: true });
  });
