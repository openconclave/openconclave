type EventHandler = (event: unknown) => void;

class WebSocketClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<EventHandler>>();
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  connect() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    this.ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    this.ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        const type = data.type as string;
        this.handlers.get(type)?.forEach((h) => h(data));
        this.handlers.get("*")?.forEach((h) => h(data));
      } catch {
        // ignore
      }
    };

    this.ws.onclose = () => {
      this.reconnectTimeout = setTimeout(() => this.connect(), 3000);
    };
  }

  subscribe(topics: string[]) {
    this.ws?.send(JSON.stringify({ type: "subscribe", topics }));
  }

  on(type: string, handler: EventHandler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  disconnect() {
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.ws?.close();
  }
}

export const wsClient = new WebSocketClient();
