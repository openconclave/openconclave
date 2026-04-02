/**
 * OpenAI-compatible agent runtime — public entry point.
 *
 * Callers import from this module; the implementation is split across:
 *   openai-types.ts          — shared interfaces
 *   openai-debug.ts          — debug logger
 *   openai-routing-tools.ts  — routing tool builders
 *   openai-responses.ts      — Responses API loop
 *   openai-chat.ts           — Chat Completions loop
 */

export type { OpenAIProvider, OpenAIRunOptions, OpenAIResult } from "./openai-types";

import { runResponsesAPI } from "./openai-responses";
import { runChatCompletions } from "./openai-chat";
import type { OpenAIProvider, OpenAIRunOptions, OpenAIResult } from "./openai-types";

// ── Main dispatcher ─────────────────────────────────────────

export async function runOpenAIAgent(options: OpenAIRunOptions): Promise<OpenAIResult> {
  if (options.provider.apiType === "responses") {
    return runResponsesAPI(options);
  }
  return runChatCompletions(options);
}

// ── List models from provider ───────────────────────────────

export async function listOpenAIModels(provider: OpenAIProvider): Promise<string[]> {
  try {
    const res = await fetch(`${provider.baseUrl}/models`, {
      headers: { "Authorization": `Bearer ${provider.apiKey}` },
    });
    if (!res.ok) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await res.json() as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((data.data ?? []) as any[]).map((m) => m.id as string).sort();
  } catch {
    return [];
  }
}
