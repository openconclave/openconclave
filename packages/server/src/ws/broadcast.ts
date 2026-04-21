import type { RunEvent } from "../engine/types";
import { maybeEmitPluginEvent } from "../plugin/event-emitter";

let serverRef: ReturnType<typeof Bun.serve> | null = null;

export function setServer(s: ReturnType<typeof Bun.serve>) {
  serverRef = s;
}

export function broadcastRunEvent(event: RunEvent) {
  maybeEmitPluginEvent(event);
  if (!serverRef) return;
  const json = JSON.stringify(event);
  serverRef.publish(`run:${event.runId}`, json);
  serverRef.publish("dashboard", json);
}

export function broadcastToTopic(topic: string, data: unknown) {
  if (!serverRef) return;
  serverRef.publish(topic, JSON.stringify(data));
}
