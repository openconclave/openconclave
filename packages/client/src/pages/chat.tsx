import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Send, Loader2, Bot, User } from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  runId?: string;
  status?: "pending" | "done" | "error";
}

interface WorkflowInfo {
  id: string;
  name: string;
  description?: string;
}

export function ChatPage() {
  const toolName = window.location.pathname.split("/")[1];
  const [workflow, setWorkflow] = useState<WorkflowInfo | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load workflow info
  useEffect(() => {
    api.get<{ workflow: { id: string; name: string; definition: Record<string, unknown> } }>(`/workflows/by-tool/${toolName}`)
      .then((data) => {
        const def = data.workflow.definition;
        setWorkflow({
          id: data.workflow.id,
          name: (def.name as string) ?? data.workflow.name,
          description: def.description as string | undefined,
        });
      })
      .catch(() => setError(`Workflow "${toolName}" not found`));
  }, [toolName]);

  // Listen for chat:response events via WebSocket
  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "subscribe", topics: ["dashboard"] }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "chat:response" && data.data?.content) {
          setMessages((prev) => {
            // Find the pending message for this runId and mark it done
            const updated = prev.map((m) =>
              m.runId === data.runId && m.role === "assistant" && m.status === "pending"
                ? { ...m, content: data.data.content, status: "done" as const }
                : m
            );
            // If no pending message found, add a new one
            if (!updated.some((m) => m.runId === data.runId && m.status === "done")) {
              updated.push({ role: "assistant", content: data.data.content, runId: data.runId, status: "done" });
            }
            return updated;
          });
          setLoading(false);
        }

        // Also handle run completion (success/failure) to update pending messages
        if (data.type === "run:completed" && data.data) {
          setMessages((prev) =>
            prev.map((m) =>
              m.runId === data.runId && m.status === "pending"
                ? {
                    ...m,
                    content: data.data.status === "failure"
                      ? `Error: ${data.data.error ?? "Workflow failed"}`
                      : m.content,
                    status: data.data.status === "failure" ? "error" as const : m.status,
                  }
                : m
            )
          );
          if (data.data.status === "failure") setLoading(false);
        }
      } catch { /* ignore parse errors */ }
    };

    ws.onclose = () => {
      // Could reconnect here
    };

    return () => ws.close();
  }, []);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || !workflow || loading) return;

    const userMessage = input.trim();
    setInput("");
    setLoading(true);

    // Add user message
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);

    try {
      const data = await api.post<{ runId: string }>(`/workflows/${workflow.id}/run`, {
        payload: userMessage,
      });

      // Add pending assistant message
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "", runId: data.runId, status: "pending" },
      ]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${message}`, status: "error" },
      ]);
      setLoading(false);
    }
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold">{workflow.name}</h1>
        {workflow.description && (
          <p className="text-xs text-muted-foreground mt-0.5">{workflow.description}</p>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Bot className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm">Send a message to start</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "assistant" && (
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                <Bot className="h-4 w-4 text-primary" />
              </div>
            )}
            <div
              className={`max-w-[70%] rounded-lg px-4 py-2.5 text-sm whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : msg.status === "error"
                    ? "bg-destructive/10 text-destructive border border-destructive/20"
                    : "bg-card border border-border"
              }`}
            >
              {msg.status === "pending" ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Running...</span>
                </div>
              ) : (
                msg.content
              )}
            </div>
            {msg.role === "user" && (
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-foreground/10 flex items-center justify-center">
                <User className="h-4 w-4 text-foreground/60" />
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border px-6 py-4">
        <div className="flex gap-2 max-w-3xl mx-auto">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder="Type a message..."
            disabled={loading}
            className="flex-1 rounded-lg border border-input bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="rounded-lg bg-primary px-4 py-2.5 text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
