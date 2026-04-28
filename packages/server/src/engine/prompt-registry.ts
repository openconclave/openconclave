interface PendingPrompt {
  runId: number;
  nodeId: string;
  question: string;
  input: unknown;
  resolve: (response: string) => void;
  reject: (err: Error) => void;
  createdAt: string;
  abortSignal?: AbortSignal;
  abortListener?: () => void;
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
    if (pending.has(key)) {
      reject(new Error("duplicate prompt registration"));
      return;
    }

    const entry: PendingPrompt = {
      runId,
      nodeId,
      question,
      input,
      resolve,
      reject,
      createdAt: new Date().toISOString(),
    };
    pending.set(key, entry);

    if (abortSignal) {
      if (abortSignal.aborted) {
        pending.delete(key);
        reject(new Error("prompt aborted"));
        return;
      }
      const listener = () => {
        if (pending.get(key) === entry) {
          pending.delete(key);
          reject(new Error("prompt aborted"));
        }
      };
      entry.abortSignal = abortSignal;
      entry.abortListener = listener;
      abortSignal.addEventListener("abort", listener, { once: true });
    }
  });
}

export function respondToPrompt(runId: number, nodeId: string, response: string): boolean {
  const key = `${runId}:${nodeId}`;
  const entry = pending.get(key);
  if (!entry) return false;

  if (entry.abortSignal && entry.abortListener) {
    entry.abortSignal.removeEventListener("abort", entry.abortListener);
  }
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
  return [...pending.values()].map(({ runId, nodeId, question, input, createdAt }) => ({
    runId,
    nodeId,
    question,
    input,
    createdAt,
  }));
}

export function clearPromptsForRun(runId: number): number {
  let cleared = 0;
  for (const [key, entry] of pending) {
    if (entry.runId === runId) {
      if (entry.abortSignal && entry.abortListener) {
        entry.abortSignal.removeEventListener("abort", entry.abortListener);
      }
      entry.reject(new Error("run cancelled"));
      pending.delete(key);
      cleared++;
    }
  }
  return cleared;
}
