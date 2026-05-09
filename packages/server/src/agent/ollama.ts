import { spawn } from "bun";
import { readFileSync, existsSync, appendFileSync } from "fs";
import { join } from "path";
import { SESSIONS_DIR } from "../lib/workspace";
import { AgentBase } from "./base";
import { createOllamaRoutingTool } from "./ollama-routing";
import { ROUTING_TOOL_NAME } from "./constants";
import { VIEW_IMAGE_SENTINEL } from "./builtin-tools/files";
import type { ResolvedAgentConfig } from "@openconclave/shared";

export type { OllamaStatus, OllamaModelInfo, OllamaRunOptions, ThinkingBlock, OllamaResult } from "./ollama-types";
import type { OllamaTool, OllamaRunOptions, OllamaResult, OllamaStatus, OllamaModelInfo, ThinkingBlock } from "./ollama-types";

const DEBUG = process.env.OPENCONCLAVE_DEBUG === "1";
const OLLAMA_LOG = join(SESSIONS_DIR, "ollama-debug.log");

function ollamaLog(label: string, data: unknown): void {
  if (!DEBUG) return;
  const line = `[${new Date().toISOString()}] ${label}: ${JSON.stringify(data, null, 2)}\n`;
  try {
    appendFileSync(OLLAMA_LOG, line);
  } catch { /* ignore write failures */ }
}

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";

/**
 * Force-unload a model from Ollama via the API. Used to recover from the
 * runner-hang bug (ollama/ollama#15950): after large/MoE models are pinned
 * in memory for hours, /api/generate begins accepting connections at the
 * kernel level but never delivers the request to the runner's work loop —
 * the request hangs forever (zero bytes returned). Listing endpoints stay
 * responsive, so it's not a daemon crash, it's a runner-receive failure.
 *
 * Sending /api/generate with `keep_alive: 0` and an empty prompt unloads
 * the model; the next real request reloads it fresh, bypassing the hung
 * runner state. Best-effort; if this call also hangs we just give up and
 * surface the original error.
 */
async function unloadOllamaModel(model: string): Promise<void> {
  try {
    await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: "", keep_alive: 0 }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    /* best-effort */
  }
}

export async function checkOllama(): Promise<OllamaStatus> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { installed: true, running: false, models: [] };

    const data = (await res.json()) as { models?: { name: string }[] };
    const models = (data.models ?? []).map((m) => m.name);

    // Fetch capabilities for each model in parallel
    const modelDetails: OllamaModelInfo[] = await Promise.all(
      models.map(async (name) => {
        try {
          const showRes = await fetch(`${OLLAMA_URL}/api/show`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: name }),
            signal: AbortSignal.timeout(3000),
          });
          if (showRes.ok) {
            const info = (await showRes.json()) as { capabilities?: string[] };
            return { name, capabilities: info.capabilities ?? [] };
          }
        } catch { /* ignore per-model failures */ }
        return { name, capabilities: [] };
      })
    );

    return { installed: true, running: true, models, modelDetails };
  } catch {
    try {
      const proc = spawn({ cmd: ["ollama", "--version"], stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      return { installed: true, running: false, models: [] };
    } catch {
      return { installed: false, running: false, models: [] };
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readOllamaStream(res: Response, onOutput?: (text: string) => void): Promise<any> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let thinking = "";
  let content = "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let toolCalls: any[] | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let finalMsg: any = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    const lines = buf.split("\n");
    buf = lines.pop()!;

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chunk = JSON.parse(line) as any;
        const msg = chunk.message;
        if (msg?.thinking) thinking += msg.thinking;
        if (msg?.content) {
          content += msg.content;
          onOutput?.(msg.content);
        }
        if (msg?.tool_calls) toolCalls = msg.tool_calls;
        if (chunk.done) finalMsg = chunk;
      } catch { /* skip malformed lines */ }
    }
  }

  if (buf.trim()) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chunk = JSON.parse(buf) as any;
      const msg = chunk.message;
      if (msg?.thinking) thinking += msg.thinking;
      if (msg?.content) content += msg.content;
      if (msg?.tool_calls) toolCalls = msg.tool_calls;
      if (chunk.done) finalMsg = chunk;
    } catch { /* skip */ }
  }

  return {
    ...(finalMsg?.message ?? {}),
    role: "assistant",
    // Override with accumulated values (streaming chunks are deltas)
    content: content || undefined,
    thinking: thinking || undefined,
    tool_calls: toolCalls,
  };
}

export async function runOllamaAgent(options: OllamaRunOptions): Promise<OllamaResult> {
  const { model, abortSignal, onOutput } = options;
  const maxTurns = options.maxTurns ?? 25;
  const startTime = Date.now();

  const sessionFile = options.sessionFile;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [];

  if (sessionFile && existsSync(sessionFile)) {
    const lines = readFileSync(sessionFile, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (typeof parsed.role === "string") messages.push(parsed);
      } catch { /* skip malformed lines */ }
    }
    // Append new input so the model sees the current turn, not just old history
    const inputStr =
      options.input !== undefined
        ? typeof options.input === "string"
          ? options.input
          : JSON.stringify(options.input, null, 2)
        : options.prompt || "";
    if (inputStr) {
      const userMsg = { role: "user", content: inputStr };
      messages.push(userMsg);
      if (sessionFile) {
        appendFileSync(sessionFile, JSON.stringify(userMsg) + "\n");
      }
    }
  } else {
    if (options.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    const inputStr =
      options.input !== undefined
        ? typeof options.input === "string"
          ? options.input
          : JSON.stringify(options.input, null, 2)
        : options.prompt || "Start";
    messages.push({ role: "user", content: inputStr });
    if (sessionFile) {
      for (const msg of messages) {
        appendFileSync(sessionFile, JSON.stringify(msg) + "\n");
      }
    }
  }

  const resolvedConfig: ResolvedAgentConfig = {
    allowedTools: options.allowedTools ?? [],
    mcpServers: options.mcpServers ?? [],
    mcpTools: options.mcpTools,
    knowledgeBases: options.knowledgeBases ?? [],
  };
  const agent = new AgentBase(resolvedConfig, options.workspace, options.runId);

  try {
    await agent.connectMcpServers();

    const activeTools: OllamaTool[] = agent.toChatTools() as OllamaTool[];
    const toolExecutors = agent.toolExecutors;

    if (agent.tools.length > 0) {
      onOutput?.(`[Resolved ${agent.tools.length} tools via AgentBase]\n`);
    }

    if (options.routeTargets && options.routeTargets.length >= 1) {
      const routingTool = createOllamaRoutingTool(options.routeTargets);
      activeTools.push(routingTool.tool);
      toolExecutors.set(ROUTING_TOOL_NAME, routingTool.execute);
    }

    if (options.extraTools) {
      for (const et of options.extraTools) {
        activeTools.push(et.tool);
        toolExecutors.set(et.tool.function.name, et.execute);
      }
    }

    const hasTools = activeTools.length > 0;
    const thinkingBlocks: ThinkingBlock[] = [];

    for (let turn = 0; turn < maxTurns; turn++) {
      const body: Record<string, unknown> = {
        model,
        messages,
        stream: true,
        think: options.thinking ?? true,
        options: { num_ctx: 32768 },
      };

      if (hasTools) {
        body.tools = activeTools;
      }

      ollamaLog(`REQUEST turn ${turn + 1}`, {
        model,
        messages,
        tools: hasTools ? activeTools : undefined,
      });

      // Bun's fetch has a 30s default timeout — far too short for local LLM
      // inference (time-to-first-token on a 9B model with thinking can exceed 60s).
      // Combine the pool's cancellation signal with a 10-minute deadline.
      //
      // On timeout we retry once after force-unloading the model.
      // Long-running ollama sessions sometimes leave the runner accepting
      // TCP connections at the kernel level but never delivering the
      // request to the work loop, while listing endpoints stay responsive.
      // Unload+reload bypasses the bad runner state. Empirically this
      // recovers our long Dreamer/Indexer pipeline runs without human
      // intervention.
      const MAX_FETCH_ATTEMPTS = 2;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let assistantMsg: any;
      let attempt = 0;
      while (true) {
        attempt++;
        const timeoutSignal = AbortSignal.timeout(600_000);
        const fetchSignal = abortSignal
          ? AbortSignal.any([abortSignal, timeoutSignal])
          : timeoutSignal;

        try {
          const res = await fetch(`${OLLAMA_URL}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: fetchSignal,
          });

          if (!res.ok) {
            const errText = await res.text();
            await agent.disconnect();
            return {
              success: false,
              output: "",
              error: `Ollama API error ${res.status}: ${errText}`,
              durationMs: Date.now() - startTime,
            };
          }

          assistantMsg = await readOllamaStream(res, onOutput);
          break;
        } catch (err) {
          // User-cancellation always wins — never retry past it.
          if (abortSignal?.aborted) throw err;

          const msg = err instanceof Error ? err.message : String(err);
          const isTimeoutOrConn =
            err instanceof Error &&
            (err.name === "TimeoutError" ||
              err.name === "AbortError" ||
              /aborted|timed out|fetch failed|ECONNRESET|ECONNREFUSED/i.test(msg));

          if (attempt < MAX_FETCH_ATTEMPTS && isTimeoutOrConn) {
            ollamaLog(`TIMEOUT/CONN-ERROR — unloading model and retrying`, {
              model,
              attempt,
              error: msg,
            });
            onOutput?.(
              `[Ollama request hung (${msg}); unloading ${model} and retrying]\n`,
            );
            await unloadOllamaModel(model);
            // Brief settle before reload — gives Ollama time to release the
            // runner process before we re-request.
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }

          await agent.disconnect();
          return {
            success: false,
            output: "",
            error: `Ollama request failed after ${attempt} attempt(s): ${msg}`,
            durationMs: Date.now() - startTime,
          };
        }
      }
      ollamaLog(`RESPONSE turn ${turn + 1}`, {
        thinking: assistantMsg.thinking?.slice(0, 500),
        content: assistantMsg.content?.slice(0, 500),
        tool_calls: assistantMsg.tool_calls,
      });

      if (assistantMsg.thinking) {
        thinkingBlocks.push({ thinking: assistantMsg.thinking });
        onOutput?.(`[thinking: ${(assistantMsg.thinking as string).slice(0, 100)}...]\n`);
      }

      // Add assistant message to history — include thinking so model remembers its reasoning on resume
      const savedMsg = { ...assistantMsg };
      if (assistantMsg.thinking && !assistantMsg.content?.includes(assistantMsg.thinking)) {
        savedMsg.content = `<think>${assistantMsg.thinking}</think>\n${assistantMsg.content ?? ""}`;
        delete savedMsg.thinking;
      }
      messages.push(savedMsg);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((assistantMsg.tool_calls as any[])?.length > 0) {
        onOutput?.(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          `[Tool calls: ${(assistantMsg.tool_calls as any[]).map((tc: any) => tc.function.name).join(", ")}]\n`,
        );

        if (sessionFile) {
          appendFileSync(sessionFile, JSON.stringify(savedMsg) + "\n");
        }

        let routeTo: string | undefined;
        let routeContent: string | undefined;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const toolCall of assistantMsg.tool_calls as any[]) {
          const fnName = toolCall.function.name as string;
          let fnArgs: Record<string, unknown>;
          const rawArgs = toolCall.function.arguments;
          if (typeof rawArgs === "string") {
            try {
              fnArgs = JSON.parse(rawArgs);
            } catch {
              messages.push({ role: "tool", tool_call_id: toolCall.id, name: fnName, content: `Error: malformed JSON arguments for "${fnName}"` });
              continue;
            }
          } else {
            fnArgs = (rawArgs as Record<string, unknown>) ?? {};
          }

          if (fnName === ROUTING_TOOL_NAME && fnArgs?.node_id) {
            routeTo = fnArgs.node_id as string;
            routeContent = (fnArgs.content as string) ?? "";
          }

          const executor = toolExecutors.get(fnName);
          let result: string;
          if (executor) {
            onOutput?.(`[Executing ${fnName}...]\n`);
            result = await executor(fnArgs);
          } else {
            result = `Error: Unknown tool "${fnName}"`;
          }

          // view_image returns `<sentinel><mime>:<base64>`; lift the bytes into a
          // synthetic user message with the `images` field so the vision encoder
          // actually sees them. The tool message keeps a short status string so
          // the conversation log stays readable.
          let imagesForNextMsg: string[] | undefined;
          let toolMsgContent = result;
          if (result.startsWith(VIEW_IMAGE_SENTINEL)) {
            const payload = result.slice(VIEW_IMAGE_SENTINEL.length);
            const colon = payload.indexOf(":");
            if (colon > 0) {
              const b64 = payload.slice(colon + 1);
              imagesForNextMsg = [b64];
              toolMsgContent = `Image loaded (${Math.round((b64.length * 3) / 4)} bytes). Attached in the next message — describe what you see.`;
            }
          }

          const toolMsg = { role: "tool", tool_call_id: toolCall.id, name: fnName, content: toolMsgContent };
          messages.push(toolMsg);
          if (sessionFile) appendFileSync(sessionFile, JSON.stringify(toolMsg) + "\n");

          if (imagesForNextMsg) {
            const imgUserMsg = { role: "user", content: "(image attached via view_image)", images: imagesForNextMsg };
            messages.push(imgUserMsg);
            if (sessionFile) appendFileSync(sessionFile, JSON.stringify(imgUserMsg) + "\n");
          }

          onOutput?.(`[${fnName} result: ${toolMsgContent.slice(0, 200)}${toolMsgContent.length > 200 ? "..." : ""}]\n`);
        }

        if (routeTo) {
          await agent.disconnect();
          return {
            success: true,
            output: routeContent ?? "",
            routeTo,
            durationMs: Date.now() - startTime,
            thinking: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
          };
        }

        continue;
      }

      const output: string = assistantMsg.content ?? "";
      onOutput?.(output);
      if (sessionFile) {
        appendFileSync(sessionFile, JSON.stringify(savedMsg) + "\n");
      }

      await agent.disconnect();
      return {
        success: true,
        output,
        durationMs: Date.now() - startTime,
        thinking: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
      };
    }

    await agent.disconnect();
    return {
      success: false,
      output: "",
      error: `Exceeded max turns (${maxTurns})`,
      durationMs: Date.now() - startTime,
    };
  } catch (err: unknown) {
    await agent.disconnect();
    return {
      success: false,
      output: "",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime,
    };
  }
}
