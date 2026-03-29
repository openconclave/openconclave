import { db } from "../db/client";
import { workflows, settings } from "../db/schema";
import { eq } from "drizzle-orm";
import { WorkflowExecutor } from "../engine/executor";

async function getBotToken(): Promise<string | null> {
  const result = await db.select().from(settings).where(eq(settings.key, "telegram_bot_token"));
  return result[0]?.value ?? process.env.TELEGRAM_BOT_TOKEN ?? null;
}

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
      console.log("⚡ Telegram trigger disabled (set token in Settings)");
      return;
    }

    console.log("⚡ Telegram trigger started");
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
            console.log(`⚡ Triggering workflow "${wf.name}" from Telegram`);
            try {
              await this.executor.execute(def, text, node.id);
            } catch (err: any) {
              console.error(`⚡ Failed to trigger "${wf.name}":`, err.message);
            }
          }
        }
      }
    }
  }
}
