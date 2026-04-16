/**
 * Registry for pending prompt responses.
 * When a Prompt node fires, it registers a pending question and waits.
 * When a response arrives (via API/MCP), the promise resolves and the conclave continues.
 */

interface PendingPrompt {
  runId: number;
  nodeId: string;
  question: string;
  input: unknown;
  resolve: (response: string) => void;
  createdAt: string;
}

const pending = new Map<string, PendingPrompt>();

export function registerPrompt(
  runId: number,
  nodeId: string,
  question: string,
  input: unknown,
  abortSignal?: AbortSignal,
): Promise<string> {
  const key = `${runId}:${nodeId}`;

  return new Promise<string>((resolve, reject) => {
    pending.set(key, {
      runId,
      nodeId,
      question,
      input,
      resolve,
      createdAt: new Date().toISOString(),
    });

    if (abortSignal) {
      if (abortSignal.aborted) {
        pending.delete(key);
        reject(new Error("prompt aborted"));
        return;
      }
      abortSignal.addEventListener(
        "abort",
        () => {
          if (pending.has(key)) {
            pending.delete(key);
            reject(new Error("prompt aborted"));
          }
        },
        { once: true },
      );
    }
  });
}

export function respondToPrompt(runId: number, nodeId: string, response: string): boolean {
  const key = `${runId}:${nodeId}`;
  const entry = pending.get(key);
  if (!entry) return false;

  entry.resolve(response);
  pending.delete(key);
  return true;
}

export function getPendingPrompts(): Array<{
  runId: number;
  nodeId: string;
  question: string;
  input: unknown;
  createdAt: string;
}> {
  return [...pending.values()].map(({ resolve, ...rest }) => rest);
}

export function getPendingPromptForRun(runId: number): PendingPrompt | undefined {
  for (const entry of pending.values()) {
    if (entry.runId === runId) return entry;
  }
  return undefined;
}

export function clearPromptsForRun(runId: number): number {
  let cleared = 0;
  for (const [key, entry] of pending) {
    if (entry.runId === runId) {
      entry.resolve("[cancelled]");
      pending.delete(key);
      cleared++;
    }
  }
  return cleared;
}
