import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { settings } from "../../db/schema";
import { logger } from "../../lib/logger";
import { AppError, ErrorCode } from "@openconclave/shared";
import type { ConclaveNode, OutputConfig } from "@openconclave/shared";
import type { RunEvent } from "../types";

export async function executeOutput(
  node: ConclaveNode,
  input: unknown,
  runId: number,
  nodeId: string,
  conclaveName: string | undefined,
  emit: (event: RunEvent) => void
): Promise<unknown> {
  const config = node.data.config as OutputConfig;

  switch (config.type) {
    case "claude-code":
      emit({ type: "channel:output", runId, nodeId, data: { content: input, conclaveName, nodeLabel: node.data.label } });
      break;

    case "telegram":
      await sendTelegram(config.chatId, input);
      break;

    default:
      logger.info(`[Output: ${config.type}]`, {
        data: typeof input === "string" ? input.slice(0, 200) : JSON.stringify(input).slice(0, 200),
      });
  }

  return input;
}

async function sendTelegram(chatId: string | undefined, data: unknown): Promise<void> {
  const [tokenRow] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "telegram_bot_token"));
  const token = tokenRow?.value;

  if (!token) {
    throw new AppError(ErrorCode.TELEGRAM_NO_TOKEN, "No Telegram bot token in Settings");
  }
  if (!chatId) {
    throw new AppError(ErrorCode.TELEGRAM_SEND_FAILED, "No chat ID on Telegram output node");
  }

  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new AppError(ErrorCode.TELEGRAM_SEND_FAILED, `Telegram API error: ${err}`);
  }
}
