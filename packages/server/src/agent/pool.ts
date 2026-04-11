import { runClaudeAgent, type AgentRunOptions, type AgentResult } from "./runtime";

type QueuedTask = {
  id: string;
  options: AgentRunOptions;
  resolve: (result: AgentResult) => void;
  reject: (error: Error) => void;
  abortController: AbortController;
};

export class AgentPool {
  private maxConcurrent: number;
  private running = new Map<string, AbortController>();
  private queue: QueuedTask[] = [];

  constructor(maxConcurrent = 3) {
    this.maxConcurrent = maxConcurrent;
  }

  get stats() {
    return {
      running: this.running.size,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
    };
  }

  async submit(taskId: string, options: AgentRunOptions): Promise<AgentResult> {
    const abortController = new AbortController();

    return new Promise<AgentResult>((resolve, reject) => {
      const task: QueuedTask = {
        id: taskId,
        options: { ...options, abortController },
        resolve,
        reject,
        abortController,
      };

      if (this.running.size < this.maxConcurrent) {
        this.execute(task);
      } else {
        this.queue.push(task);
      }
    });
  }

  cancel(taskId: string): boolean {
    // Check running tasks
    const controller = this.running.get(taskId);
    if (controller) {
      controller.abort();
      this.running.delete(taskId);
      return true;
    }

    // Check queue
    const idx = this.queue.findIndex((t) => t.id === taskId);
    if (idx !== -1) {
      const task = this.queue.splice(idx, 1)[0];
      task.reject(new Error("Task cancelled"));
      return true;
    }

    return false;
  }

  cancelAll() {
    for (const [id, controller] of this.running) {
      controller.abort();
    }
    this.running.clear();

    for (const task of this.queue) {
      task.reject(new Error("All tasks cancelled"));
    }
    this.queue = [];
  }

  private async execute(task: QueuedTask) {
    this.running.set(task.id, task.abortController);

    try {
      const result = await runClaudeAgent(task.options);
      task.resolve(result);
    } catch (err: any) {
      task.reject(err);
    } finally {
      this.running.delete(task.id);
      this.processQueue();
    }
  }

  private processQueue() {
    while (this.queue.length > 0 && this.running.size < this.maxConcurrent) {
      const next = this.queue.shift()!;
      this.execute(next);
    }
  }
}

// Singleton pool
export const agentPool = new AgentPool(
  parseInt(process.env.MAX_CONCURRENT_AGENTS ?? "3")
);
