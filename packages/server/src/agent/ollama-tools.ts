import { createBuiltinTools } from "./builtin-tools";
import type { OllamaTool } from "./ollama-types";

export type OllamaBuiltinTool = {
  tool: OllamaTool;
  execute: (args: Record<string, unknown>) => Promise<string>;
};

/**
 * Creates builtin tool definitions for Ollama agents.
 * Extends the shared builtin tools (bash, read_file, write_file)
 * with Ollama-specific tools (send_telegram).
 */
export function createOllamaBuiltinTools(): Record<string, OllamaBuiltinTool> {
  const shared = createBuiltinTools() as Record<string, OllamaBuiltinTool>;

  return {
    ...shared,
    send_telegram: {
      tool: {
        type: "function",
        function: {
          name: "send_telegram",
          description: "Send a message to a Telegram chat",
          parameters: {
            type: "object",
            required: ["chat_id", "text"],
            properties: {
              chat_id: { type: "string", description: "Telegram chat ID" },
              text: { type: "string", description: "Message text to send" },
            },
          },
        },
      },
      execute: async (args: Record<string, unknown>) => {
        try {
          const botToken = process.env.TELEGRAM_BOT_TOKEN;
          if (!botToken) return "Error: TELEGRAM_BOT_TOKEN not set in environment";

          const res = await fetch(
            `https://api.telegram.org/bot${botToken}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: args.chat_id, text: args.text }),
            },
          );
          const data = (await res.json()) as {
            ok: boolean;
            result?: { message_id: number };
            description?: string;
          };
          return data.ok
            ? `Message sent (id: ${data.result?.message_id})`
            : `Error: ${data.description}`;
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  };
}
