import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Send, Loader2, Bot, User, PlusCircle, Users } from "lucide-react";
import { MarkdownContent } from "@/components/ui/markdown-content";

interface ChatMessage {
  role: "user" | "assistant" | "agent" | "moderator";
  content: string;
  label?: string;
  runId?: number;
  status?: "pending" | "done" | "error";
}

interface ConclaveNode {
  id: string;
  data: { label: string; type: string };
}

interface ConclaveInfo {
  id: string;
  name: string;
  description?: string;
  nodes: ConclaveNode[];
}

export function ChatPage() {
  const parts = window.location.pathname.split("/");
  const toolName = parts[1];
  const urlRunId = parts[3]; // /:toolName/chat/:runId — set after first message
  const [conclave, setConclave] = useState<ConclaveInfo | null>(null);
  const conclaveRef = useRef<ConclaveInfo | null>(null);
  const [chatRunId, setChatRunId] = useState<number | null>(urlRunId ? Number(urlRunId) : null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hydratedRef = useRef(!urlRunId); // true if new chat, false until history loads

  // Load conclave info
  useEffect(() => {
    api.get<{ conclave: { id: string; name: string; definition: Record<string, unknown> } }>(`/conclaves/by-tool/${toolName}`)
      .then((data) => {
        const def = data.conclave.definition;
        const wf = {
          id: data.conclave.id,
          name: (def.name as string) ?? data.conclave.name,
          description: def.description as string | undefined,
          nodes: (def.nodes as ConclaveNode[]) ?? [],
        };
        setConclave(wf);
        conclaveRef.current = wf;
      })
      .catch(() => setError(`Conclave "${toolName}" not found`));
  }, [toolName]);

  // Hydrate conversation history when loading an existing run
  useEffect(() => {
    if (!chatRunId || !conclave || hydratedRef.current) return;

    interface RunEvent {
      type: string;
      nodeId?: string;
      data?: Record<string, unknown>;
    }
    interface RunDetail {
      run: { triggerPayload?: unknown; status?: string };
      events: RunEvent[];
    }

    api.get<RunDetail>(`/runs/${chatRunId}`)
      .then(({ run, events }) => {
        const restored: ChatMessage[] = [];

        // First user message comes from run.triggerPayload
        if (run.triggerPayload != null) {
          const content = typeof run.triggerPayload === "string"
            ? run.triggerPayload
            : JSON.stringify(run.triggerPayload);
          restored.push({ role: "user", content });
        }

        // Walk events chronologically to rebuild the conversation
        for (const ev of events) {
          const d = ev.data;
          if (ev.type === "chat:userMessage" && d?.content) {
            restored.push({ role: "user", content: d.content as string });
          } else if (ev.type === "chat:response" && d?.content) {
            restored.push({ role: "assistant", content: d.content as string, runId: chatRunId, status: "done" });
          } else if (ev.type === "node:completed" && ev.nodeId) {
            const node = conclave.nodes.find((n: ConclaveNode) => n.id === ev.nodeId);
            if (node && node.data.type === "agent") {
              let content = typeof d === "string" ? d : JSON.stringify(d, null, 2);
              try {
                const parsed = JSON.parse(content);
                if (parsed?.__routeTo) content = parsed.content ?? content;
              } catch { /* not JSON */ }
              restored.push({ role: "agent", content, label: node.data.label, runId: chatRunId, status: "done" });
            }
          } else if (ev.type === "discussion:speech" && d?.message) {
            restored.push({
              role: "agent",
              content: d.message as string,
              label: `${d.agentName} (Round ${d.round})`,
              runId: chatRunId,
              status: "done",
            });
          } else if (ev.type === "discussion:moderator" && d?.summary) {
            restored.push({
              role: "moderator",
              content: d.summary as string,
              label: `Moderator${d.action === "end_discussion" ? " — Ending discussion" : ""}`,
              runId: chatRunId,
              status: "done",
            });
          }
        }

        if (restored.length > 0) {
          setMessages(restored);
        }
        if (run.status === "running") {
          setLoading(true);
        }
        hydratedRef.current = true;
      })
      .catch((err) => {
        console.error("Failed to load conversation history:", err);
        hydratedRef.current = true; // allow WebSocket events even if hydration fails
      });
  }, [chatRunId, conclave]);

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
        // Skip WebSocket events while hydration is in progress to avoid duplicates
        if (!hydratedRef.current) return;
        // Show intermediate agent outputs
        if (data.type === "node:completed" && data.nodeId && data.runId) {
          setMessages((prev) => {
            const node = conclaveRef.current?.nodes.find((n: ConclaveNode) => n.id === data.nodeId);
            if (!node || node.data.type !== "agent") return prev;
            const content = typeof data.data === "string" ? data.data : JSON.stringify(data.data, null, 2);
            // Strip routing metadata from content
            let cleanContent = content;
            try {
              const parsed = JSON.parse(content);
              if (parsed?.__routeTo) cleanContent = parsed.content ?? content;
            } catch { /* not JSON */ }
            // Insert agent message before the pending message
            const pendingIdx = prev.findIndex((m) => m.status === "pending");
            const agentMsg: ChatMessage = { role: "agent", content: cleanContent, label: node.data.label, runId: data.runId, status: "done" };
            if (pendingIdx >= 0) {
              const updated = [...prev];
              updated.splice(pendingIdx, 0, agentMsg);
              return updated;
            }
            return [...prev, agentMsg];
          });
        }

        // Show discussion agent speeches
        if (data.type === "discussion:speech" && data.data?.message) {
          setMessages((prev) => {
            const agentMsg: ChatMessage = {
              role: "agent",
              content: data.data.message,
              label: `${data.data.agentName} (Round ${data.data.round})`,
              runId: data.runId,
              status: "done",
            };
            const pendingIdx = prev.findIndex((m) => m.status === "pending");
            if (pendingIdx >= 0) {
              const updated = [...prev];
              updated.splice(pendingIdx, 0, agentMsg);
              return updated;
            }
            return [...prev, agentMsg];
          });
        }

        // Show moderator reasoning
        if (data.type === "discussion:moderator" && data.data?.summary) {
          setMessages((prev) => {
            const modMsg: ChatMessage = {
              role: "moderator",
              content: data.data.summary,
              label: `Moderator${data.data.action === "end_discussion" ? " — Ending discussion" : ""}`,
              runId: data.runId,
              status: "done",
            };
            const pendingIdx = prev.findIndex((m) => m.status === "pending");
            if (pendingIdx >= 0) {
              const updated = [...prev];
              updated.splice(pendingIdx, 0, modMsg);
              return updated;
            }
            return [...prev, modMsg];
          });
        }

        if (data.type === "chat:response" && data.data?.content) {
          setMessages((prev) => {
            // Replace the pending message with the actual response
            const updated = prev.map((m) =>
              m.status === "pending" && m.runId === data.runId
                ? { ...m, content: data.data.content, status: "done" as const }
                : m
            );
            // If no pending message was found, add as new
            if (!updated.some((m) => m.runId === data.runId && m.status === "done" && m.content === data.data.content)) {
              updated.push({ role: "assistant", content: data.data.content, runId: data.runId, status: "done" });
            }
            return updated;
          });
          setLoading(false);
        }

        // Handle run completion — clean up pending messages
        if (data.type === "run:completed" && data.data) {
          setMessages((prev) => {
            const updated = prev.filter((m) => !(m.status === "pending" && m.runId === data.runId));
            if (data.data.status === "failure") {
              updated.push({ role: "assistant", content: `Error: ${data.data.error ?? "Conclave failed"}`, runId: data.runId, status: "error" });
            }
            return updated;
          });
          setLoading(false);
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
    if (!input.trim() || !conclave || loading) return;

    const userMessage = input.trim();
    setInput("");
    setLoading(true);

    // Add user message
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);

    try {
      let runId: number;
      if (chatRunId) {
        // Continue existing run
        await api.post(`/runs/${chatRunId}/message`, { message: userMessage });
        runId = chatRunId;
      } else {
        // First message — create new run
        const data = await api.post<{ runId: number }>(`/conclaves/${conclave.id}/run`, { payload: userMessage });
        runId = data.runId;
        setChatRunId(runId);
        window.history.replaceState(null, "", `/${toolName}/chat/${runId}`);
      }

      // Add pending assistant message
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "", runId, status: "pending" },
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

  if (!conclave) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{conclave.name}</h1>
          {conclave.description && (
          <p className="text-xs text-muted-foreground mt-0.5">{conclave.description}</p>
        )}
        </div>
        <button
          onClick={() => { window.location.href = `/${toolName}/chat`; }}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 text-primary px-3 py-1.5 text-sm hover:bg-primary/20 transition-colors"
        >
          <PlusCircle className="h-4 w-4" />
          New Chat
        </button>
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
            {msg.role === "moderator" && (
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-node-discussion/20 flex items-center justify-center">
                <Users className="h-4 w-4 text-node-discussion" />
              </div>
            )}
            {(msg.role === "assistant" || msg.role === "agent") && (
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                <Bot className="h-4 w-4 text-primary" />
              </div>
            )}
            <div
              className={`max-w-[70%] rounded-lg px-4 py-2.5 text-sm ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground whitespace-pre-wrap"
                  : msg.status === "error"
                    ? "bg-destructive/10 text-destructive border border-destructive/20"
                    : msg.role === "moderator"
                      ? "bg-node-discussion/5 border border-node-discussion/30 italic"
                      : msg.role === "agent"
                        ? "bg-card/60 border border-border/50"
                        : "bg-card border border-border"
              }`}
            >
              {msg.label && (
                <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider block mb-1">{msg.label}</span>
              )}
              {msg.status === "pending" ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Running...</span>
                </div>
              ) : msg.role === "user" ? (
                msg.content
              ) : (
                <MarkdownContent content={msg.content} />
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
