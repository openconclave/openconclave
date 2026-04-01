/**
 * Registry for pending prompt responses.
 * When a Prompt node fires, it registers a pending question and waits.
 * When a response arrives (via API/MCP), the promise resolves and the workflow continues.
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
  input: unknown
): Promise<string> {
  const key = `${runId}:${nodeId}`;

  return new Promise<string>((resolve) => {
    pending.set(key, {
      runId,
      nodeId,
      question,
      input,
      resolve,
      createdAt: new Date().toISOString(),
    });
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

export function getPendingPromptForRun(runId: string): PendingPrompt | undefined {
  for (const entry of pending.values()) {
    if (entry.runId === runId) return entry;
  }
  return undefined;
}

export function clearPromptsForRun(runId: string): number {
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
