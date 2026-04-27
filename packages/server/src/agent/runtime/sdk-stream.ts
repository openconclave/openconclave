import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ThinkingBlock } from "./types";

/** Terminal state of an SDK query stream, with no coupling to routing or the
 *  final AgentResult shape. The orchestrator combines this with routingState
 *  to build the AgentResult.
 *
 *  `thinking` is always returned (possibly empty) so the orchestrator can
 *  decide whether to emit it; if the stream threw mid-flight, partial
 *  thinking blocks and any init-captured sessionId still surface. */
export type StreamOutcome =
  | {
      kind: "success";
      output: string;
      costUsd?: number;
      sessionId?: string;
      thinking: ThinkingBlock[];
    }
  | {
      kind: "error";
      error: string;
      costUsd?: number;
      sessionId?: string;
      thinking: ThinkingBlock[];
    };

export async function consumeStream(
  agentQuery: AsyncIterable<SDKMessage>,
  onOutput: ((chunk: string) => void) | undefined,
): Promise<StreamOutcome> {
  const thinking: ThinkingBlock[] = [];
  // Captured from the init message as a fallback so a mid-stream throw still
  // surfaces a resumable id via the error branch — the final `result` message
  // is the authoritative source when the run completes.
  let sessionId: string | undefined;
  let resultOutput = "";
  let costUsd: number | undefined;

  try {
    for await (const message of agentQuery) {
      const msg = message as SDKMessage & { type: string; subtype?: string; [key: string]: unknown };

      if (msg.type === "system" && msg.subtype === "init") {
        const sid = (msg as { session_id?: string }).session_id;
        if (typeof sid === "string") sessionId = sid;
      }

      if (msg.type === "assistant") {
        handleAssistant(msg, thinking, onOutput);
      }

      if (msg.type === "user") {
        handleToolResults(msg, onOutput);
      }

      if (msg.type === "result") {
        const resultMsg = msg as unknown as {
          subtype?: string;
          result?: string;
          total_cost_usd?: number;
          session_id?: string;
          errors?: string[];
        };
        if (resultMsg.subtype === "success") {
          return {
            kind: "success",
            output: resultMsg.result ?? "",
            costUsd: resultMsg.total_cost_usd,
            sessionId: resultMsg.session_id ?? sessionId,
            thinking,
          };
        } else {
          return {
            kind: "error",
            error: resultMsg.errors?.join("\n") ?? "Agent failed",
            costUsd: resultMsg.total_cost_usd,
            sessionId: resultMsg.session_id ?? sessionId,
            thinking,
          };
        }
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: "error", error: message, sessionId, thinking };
  }

  return { kind: "success", output: resultOutput, costUsd, sessionId, thinking };
}

function handleAssistant(
  msg: unknown,
  thinking: ThinkingBlock[],
  onOutput: ((chunk: string) => void) | undefined,
): void {
  const assistantMsg = msg as {
    message?: {
      content?: Array<{
        type: string;
        thinking?: string;
        signature?: string;
        name?: string;
        input?: unknown;
      }>;
    };
  };
  if (!assistantMsg.message?.content) return;

  for (const block of assistantMsg.message.content) {
    if (block.type === "thinking" && block.thinking) {
      thinking.push({ thinking: block.thinking, signature: block.signature });
      const preview = block.thinking.length > 100
        ? [...block.thinking].slice(0, 100).join("") + "…"
        : block.thinking;
      onOutput?.(`[thinking: ${preview}]\n`);
    } else if (block.type === "tool_use" && block.name) {
      // Truncate args to keep run_events small — full input is in the SDK stream.
      const json = JSON.stringify(block.input ?? {});
      const argSummary = json.length > 200 ? [...json].slice(0, 200).join("") + "…" : json;
      onOutput?.(`[tool: ${block.name}(${argSummary})]\n`);
    }
  }
}

function handleToolResults(
  msg: unknown,
  onOutput: ((chunk: string) => void) | undefined,
): void {
  const userMsg = msg as {
    message?: {
      content?: Array<{
        type: string;
        tool_use_id?: string;
        content?: string | Array<{ type: string; text?: string }>;
        is_error?: boolean;
      }>;
    };
  };
  if (!userMsg.message?.content) return;

  for (const block of userMsg.message.content) {
    if (block.type !== "tool_result") continue;

    let resultText = "";
    if (typeof block.content === "string") {
      resultText = block.content;
    } else if (Array.isArray(block.content)) {
      resultText = block.content
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("");
    }
    // Truncate aggressively — full results are available via the session file
    // and may be large. Keep the event stream lightweight.
    const preview = resultText.length > 300
      ? [...resultText].slice(0, 300).join("") + "…"
      : resultText;
    const tag = block.is_error ? "tool_error" : "tool_result";
    onOutput?.(`[${tag}: ${preview}]\n`);
  }
}
