import { logger } from "../lib/logger";
import { db } from "../db/client";
import { conclaves, settings, runEvents } from "../db/schema";
import { eq } from "drizzle-orm";
import { ConclaveExecutor } from "../engine/executor";
import { broadcastRunEvent } from "../ws/broadcast";
import type { RunEvent } from "../engine/types";

async function getBotToken(): Promise<string | null> {
  const result = await db.select().from(settings).where(eq(settings.key, "telegram_bot_token"));
  return result[0]?.value ?? process.env.TELEGRAM_BOT_TOKEN ?? null;
}

/**
 * Active Telegram chat runs — maps `chatId:conclaveId` → runId.
 * When a subsequent message arrives for the same chat+conclave,
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
  private executor: ConclaveExecutor;
  private offset = 0;
  private running = false;
  private pollAbort: AbortController | null = null;
  private pollDone: Promise<void> | null = null;
  private sendQueues = new Map<string, Promise<void>>();

  constructor(executor: ConclaveExecutor) {
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
    this.pollAbort = new AbortController();
    this.pollDone = this.poll(this.pollAbort.signal);
  }

  async restart() {
    await this.stop();
    await this.start();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.pollAbort?.abort();
    await this.pollDone;
    this.pollDone = null;
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
        const chatId = meta.chatId;
        const prev = this.sendQueues.get(chatId) ?? Promise.resolve();
        const next = prev.then(() => this.sendMessage(chatId, text)).catch(() => {});
        this.sendQueues.set(chatId, next);
        await next;
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
        const chatId = meta.chatId;
        const prev = this.sendQueues.get(chatId) ?? Promise.resolve();
        const next = prev.then(() => this.sendMessage(chatId, text)).catch(() => {});
        this.sendQueues.set(chatId, next);
        await next;
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

  private async poll(signal: AbortSignal) {
    while (this.running) {
      try {
        const token = await getBotToken();
        if (!token) {
          logger.info("Telegram token removed, stopping");
          this.running = false;
          return;
        }

        const res = await fetch(
          `https://api.telegram.org/bot${token}/getUpdates?offset=${this.offset}&timeout=30`,
          { signal }
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
          logger.error("Telegram poll error", { error: err.message });
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    }
  }

  private async handleUpdate(update: any) {
    const message = update.message;
    if (!message?.text) return;

    const chatId = String(message.chat.id);
    const userId = message.from?.id != null ? String(message.from.id) : "";
    const text = message.text;
    const userName = message.from?.first_name ?? "Unknown";

    logger.info("Telegram message received", { from: userName, userId, chatId, preview: text.slice(0, 50) });

    // Built-in commands — always available, never trigger conclaves
    if (text === "/start" || text === "/chatid" || text === "/whoami") {
      await this.sendMessage(
        chatId,
        `🔮 OpenConclave\n\nChat ID: ${chatId}\nUser ID: ${userId || "(unknown)"}\n\nGive these to the OpenConclave owner so they can allowlist you in the trigger settings.`,
      );
      return;
    }

    if (text === "/restart" || text === "/new") {
      const cleared = this.clearChatRuns(chatId);
      await this.sendMessage(
        chatId,
        cleared > 0
          ? `🔄 Cleared ${cleared} active run${cleared === 1 ? "" : "s"}. Your next message will start a fresh conclave run.`
          : `No active run to clear. Your next message starts a fresh run.`,
      );
      return;
    }

    const allConclaves = await db.select().from(conclaves);

    for (const wf of allConclaves) {
      if (!wf.enabled) continue;
      const def = wf.definition as any;

      for (const node of def.nodes ?? []) {
        if (node.data?.type === "trigger" && node.data?.config?.type === "telegram") {
          const triggerChatId: string | undefined = node.data.config.chatId;
          const allowFromUsers: string[] = Array.isArray(node.data.config.allowFromUsers)
            ? node.data.config.allowFromUsers.map((s: unknown) => String(s).trim()).filter(Boolean)
            : [];

          // Default-deny: empty chatId means the trigger is not wired to a specific chat.
          // We refuse to accept arbitrary traffic — the owner must set a chat ID explicitly.
          if (!triggerChatId) {
            logger.warn("Telegram rejected: no chatId set (default-deny)", { conclave: wf.name });
            continue;
          }
          if (triggerChatId !== chatId) continue;

          // Optional per-user allowlist. Empty = allow everyone in the configured chat.
          if (allowFromUsers.length > 0 && !allowFromUsers.includes(userId)) {
            logger.warn("Telegram rejected: user not in allowFromUsers", { userId, userName, conclave: wf.name });
            continue;
          }

          const activeKey = `${chatId}:${wf.id}`;
          const existingRunId = activeChatRuns.get(activeKey);

          if (existingRunId) {
            logger.info("Continuing Telegram run", { runId: existingRunId, chatId });
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
            // Failure recovery is event-driven: graph errors are caught inside executeInRun
            // and surfaced as run:completed { status: "failure" } via onEvent.
            await this.executor.executeInRun(existingRunId, def, text, node.id);
          } else {
            await this.startNewRun(def, text, node.id, chatId, activeKey, wf.name);
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
    conclaveName: string
  ): Promise<void> {
    logger.info("Triggering conclave from Telegram", { conclave: conclaveName, chatId });
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
      const priorRunId = activeChatRuns.get(activeKey);
      if (priorRunId !== undefined) runMeta.delete(priorRunId);
      activeChatRuns.set(activeKey, runId);
      runMeta.set(runId, { chatId, agentNodeIds, nodeLabels });
    } catch (err: any) {
      logger.error("Failed to trigger conclave from Telegram", { conclave: conclaveName, error: err.message });
    }
  }

  /**
   * Clear all active run tracking for this Telegram chat, across every conclave.
   * Next inbound message from this chat starts a fresh run.
   * Does not cancel the underlying run — just detaches this chat from it.
   */
  private clearChatRuns(chatId: string): number {
    let cleared = 0;
    const prefix = `${chatId}:`;
    for (const [key, rid] of activeChatRuns) {
      if (key.startsWith(prefix)) {
        activeChatRuns.delete(key);
        runMeta.delete(rid);
        cleared++;
      }
    }
    return cleared;
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
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: chunk }),
        });
        await res.body?.cancel();
      } catch (err: any) {
        logger.error("Failed to send Telegram message", { chatId, error: err.message });
      }
    }
  }
}
