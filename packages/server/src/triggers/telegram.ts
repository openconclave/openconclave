import { logger } from "../lib/logger";
import { db } from "../db/client";
import { workflows, settings, runEvents } from "../db/schema";
import { eq } from "drizzle-orm";
import { WorkflowExecutor } from "../engine/executor";
import { broadcastRunEvent } from "../ws/broadcast";
import type { RunEvent } from "../engine/types";

async function getBotToken(): Promise<string | null> {
  const result = await db.select().from(settings).where(eq(settings.key, "telegram_bot_token"));
  return result[0]?.value ?? process.env.TELEGRAM_BOT_TOKEN ?? null;
}

/**
 * Active Telegram chat runs — maps `chatId:workflowId` → runId.
 * When a subsequent message arrives for the same chat+workflow,
 * we continue the existing run instead of creating a new one.
 */
const activeChatRuns = new Map<string, number>();

/**
 * Reverse map: runId → { chatId, agentNodeIds } so we can route agent output
 * back to the correct Telegram chat. agentNodeIds lists which nodes are agents
 * so we can forward their node:completed events.
 */
const runMeta = new Map<number, { chatId: string; agentNodeIds: Set<string>; nodeLabels: Map<string, string> }>();

export class TelegramTrigger {
  private executor: WorkflowExecutor;
  private offset = 0;
  private running = false;

  constructor(executor: WorkflowExecutor) {
    this.executor = executor;
  }

  async start() {
    const token = await getBotToken();
    if (!token) {
      logger.debug("Telegram trigger disabled (no token)");
      return;
    }

    logger.debug("Telegram trigger started");
    this.running = true;
    this.poll();
  }

  async restart() {
    this.stop();
    await this.start();
  }

  stop() {
    this.running = false;
  }

  /**
   * Called by the executor's event callback for every run event.
   * Forwards agent responses back to the Telegram chat:
   * - chat:response — when agent output loops back to the trigger node
   * - node:completed — when agent nodes finish (no loop-back edges needed)
   */
  async onEvent(event: RunEvent): Promise<void> {
    const meta = runMeta.get(event.runId);
    if (!meta) return;

    if (event.type === "chat:response") {
      const data = event.data as { content?: string } | undefined;
      const text = data?.content ?? "";
      if (text) {
        await this.sendMessage(meta.chatId, text);
      }
      return;
    }

    // Forward agent node:completed output to Telegram
    if (event.type === "node:completed" && event.nodeId && meta.agentNodeIds.has(event.nodeId)) {
      const body = typeof event.data === "string"
        ? event.data
        : event.data ? JSON.stringify(event.data, null, 2) : "";
      if (body) {
        const label = meta.nodeLabels.get(event.nodeId);
        const text = label ? `[${label}]\n${body}` : body;
        await this.sendMessage(meta.chatId, text);
      }
      return;
    }

    // Clean up tracking only on failure/cancellation — successful runs stay tracked
    // so subsequent Telegram messages can continue the same chat session.
    // (The graph-walker sets status "success" after each message cycle, same as WebChatUI.)
    if (event.type === "run:completed") {
      const status = (event.data as { status?: string })?.status;
      if (status === "failure" || status === "cancelled") {
        for (const [key, rid] of activeChatRuns) {
          if (rid === event.runId) {
            activeChatRuns.delete(key);
            break;
          }
        }
        runMeta.delete(event.runId);
      }
    }
  }

  private async poll() {
    while (this.running) {
      try {
        const token = await getBotToken();
        if (!token) {
          console.log("⚡ Telegram token removed, stopping");
          this.running = false;
          return;
        }

        const res = await fetch(
          `https://api.telegram.org/bot${token}/getUpdates?offset=${this.offset}&timeout=30`,
          { signal: AbortSignal.timeout(35000) }
        );
        const data = (await res.json()) as any;

        if (data.ok && data.result?.length > 0) {
          for (const update of data.result) {
            this.offset = update.update_id + 1;
            await this.handleUpdate(update);
          }
        }
      } catch (err: any) {
        if (this.running) {
          console.error("⚡ Telegram poll error:", err.message);
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    }
  }

  private async handleUpdate(update: any) {
    const message = update.message;
    if (!message?.text) return;

    const chatId = String(message.chat.id);
    const text = message.text;
    const userName = message.from?.first_name ?? "Unknown";

    console.log(`⚡ Telegram message from ${userName} (${chatId}): ${text.slice(0, 50)}`);

    // Built-in commands
    if (text === "/start" || text === "/chatid") {
      const token = await getBotToken();
      if (token) {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: `🔮 OpenConclave\n\nYour Chat ID: ${chatId}\n\nUse this ID in the Telegram trigger settings to connect workflows to this chat.`,
          }),
        });
      }
      return;
    }

    const allWorkflows = await db.select().from(workflows);

    for (const wf of allWorkflows) {
      if (!wf.enabled) continue;
      const def = wf.definition as any;

      for (const node of def.nodes ?? []) {
        if (node.data?.type === "trigger" && node.data?.config?.type === "telegram") {
          const triggerChatId = node.data.config.chatId;
          if (triggerChatId === chatId || !triggerChatId) {
            const activeKey = `${chatId}:${wf.id}`;
            const existingRunId = activeChatRuns.get(activeKey);

            if (existingRunId) {
              // Continue existing run (chat mode)
              console.log(`⚡ Continuing run ${existingRunId} for Telegram chat ${chatId}`);
              try {
                // Persist user message as event (same as WebChatUI /message route)
                const now = new Date().toISOString();
                await db.insert(runEvents).values({
                  runId: existingRunId,
                  nodeId: node.id,
                  type: "chat:userMessage",
                  data: { content: text },
                  createdAt: now,
                });
                broadcastRunEvent({
                  type: "chat:userMessage",
                  runId: existingRunId,
                  nodeId: node.id,
                  data: { content: text },
                });

                await this.executor.executeInRun(existingRunId, def, text, node.id);
              } catch (err: any) {
                console.error(`⚡ Failed to continue run ${existingRunId}:`, err.message);
                // Run might have been cancelled/failed — clear tracking and start fresh
                activeChatRuns.delete(activeKey);
                runMeta.delete(existingRunId);
                await this.startNewRun(def, text, node.id, chatId, activeKey, wf.name);
              }
            } else {
              // Start new run
              await this.startNewRun(def, text, node.id, chatId, activeKey, wf.name);
            }
          }
        }
      }
    }
  }

  private async startNewRun(
    def: any,
    text: string,
    triggerNodeId: string,
    chatId: string,
    activeKey: string,
    workflowName: string
  ): Promise<void> {
    console.log(`⚡ Triggering workflow "${workflowName}" from Telegram (chat ${chatId})`);
    try {
      const runId = await this.executor.execute(def, text, triggerNodeId);
      // Collect agent node IDs and labels so we can forward their output
      const agentNodeIds = new Set<string>();
      const nodeLabels = new Map<string, string>();
      for (const node of def.nodes ?? []) {
        if (node.data?.type === "agent") {
          agentNodeIds.add(node.id);
          if (node.data.label) nodeLabels.set(node.id, node.data.label);
        }
      }
      // Track this run for chat continuation + response forwarding
      activeChatRuns.set(activeKey, runId);
      runMeta.set(runId, { chatId, agentNodeIds, nodeLabels });
    } catch (err: any) {
      console.error(`⚡ Failed to trigger "${workflowName}":`, err.message);
    }
  }

  private async sendMessage(chatId: string, text: string): Promise<void> {
    const token = await getBotToken();
    if (!token) return;

    // Telegram message limit is 4096 chars — split if needed
    const chunks = [];
    for (let i = 0; i < text.length; i += 4096) {
      chunks.push(text.slice(i, i + 4096));
    }

    for (const chunk of chunks) {
      try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: chunk }),
        });
      } catch (err: any) {
        console.error(`⚡ Failed to send Telegram message to ${chatId}:`, err.message);
      }
    }
  }
}
