import type { ServerWebSocket } from "bun";

type WSData = { topics: Set<string> };

export const wsHandler = {
  open(ws: ServerWebSocket<WSData>) {
    ws.data = { topics: new Set() };
  },

  message(ws: ServerWebSocket<WSData>, message: string | Buffer) {
    try {
      const msg = JSON.parse(message.toString());

      if (msg.type === "subscribe" && Array.isArray(msg.topics)) {
        for (const topic of msg.topics) {
          ws.subscribe(topic);
          ws.data.topics.add(topic);
        }
      }

      if (msg.type === "unsubscribe" && Array.isArray(msg.topics)) {
        for (const topic of msg.topics) {
          ws.unsubscribe(topic);
          ws.data.topics.delete(topic);
        }
      }
    } catch {
      // ignore malformed messages
    }
  },

  close(ws: ServerWebSocket<WSData>) {
    for (const topic of ws.data.topics) {
      ws.unsubscribe(topic);
    }
  },
};

export function publishEvent(server: ReturnType<typeof Bun.serve>, topic: string, event: unknown) {
  server.publish(topic, JSON.stringify(event));
}
