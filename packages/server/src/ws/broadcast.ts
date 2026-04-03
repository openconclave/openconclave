import type { RunEvent } from "../engine/types";

let serverRef: ReturnType<typeof Bun.serve> | null = null;

export function setServer(s: ReturnType<typeof Bun.serve>) {
  serverRef = s;
}

export function broadcastRunEvent(event: RunEvent) {
  if (!serverRef) return;
  const json = JSON.stringify(event);
  serverRef.publish(`run:${event.runId}`, json);
  serverRef.publish("dashboard", json);
}
