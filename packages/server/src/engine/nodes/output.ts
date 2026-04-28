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

    case "log": {
      let preview: string;
      if (input === undefined) {
        preview = "undefined";
      } else if (typeof input === "string") {
        preview = input.slice(0, 200);
      } else {
        try { preview = (JSON.stringify(input) ?? "undefined").slice(0, 200); }
        catch { preview = String(input).slice(0, 200); }
      }
      logger.info(`[Output: ${config.type}]`, { data: preview });
      break;
    }

    default:
      throw new Error(`Unhandled output type: ${(config as { type: string }).type}`);
  }

  return input;
}

const TELEGRAM_MAX = 4096;

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

  let text: string;
  if (typeof data === "string") {
    text = data;
  } else {
    try { text = JSON.stringify(data, null, 2); }
    catch { text = String(data); }
  }

  for (let i = 0; i < text.length; i += TELEGRAM_MAX) {
    const chunk = text.slice(i, i + TELEGRAM_MAX);
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: chunk }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new AppError(ErrorCode.TELEGRAM_SEND_FAILED, `Telegram API error: ${err}`);
    }
  }
}
