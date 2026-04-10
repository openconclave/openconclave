import { useEffect, useState } from "react";
import { Header, NewButton } from "@/components/layout/header";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import type { KnowledgeBase } from "@openconclave/shared";
import { Brain, X } from "lucide-react";
import { cn } from "@/lib/utils";

const BTN = "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors";
const INPUT = "w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm";

// ─── Create KB Dialog ────────────────────────────────────────────────────────

interface CreateKbForm {
  name: string;
  description: string;
  embeddingModel: string;
  chunkSize: string;
  chunkOverlap: string;
}

function CreateKbDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<CreateKbForm>({
    name: "",
    description: "",
    embeddingModel: "nomic-embed-text",
    chunkSize: "512",
    chunkOverlap: "64",
  });
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!form.name.trim()) {
      toast("Name is required", "error");
      return;
    }
    setSaving(true);
    try {
      await api.post("/knowledge", {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        embeddingModel: form.embeddingModel.trim() || undefined,
        chunkSize: parseInt(form.chunkSize) || 512,
        chunkOverlap: parseInt(form.chunkOverlap) || 64,
      });
      toast(`Knowledge base "${form.name}" created`, "success");
      onCreated();
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast(`Failed to create: ${message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-[480px] rounded-xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 fade-in duration-150">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">Create Knowledge Base</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="My Knowledge Base"
              className={INPUT}
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1">Description (optional)</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What this knowledge base contains..."
              rows={2}
              className={`${INPUT} resize-none`}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Chunk Size</label>
              <input
                type="number"
                value={form.chunkSize}
                onChange={(e) => setForm({ ...form, chunkSize: e.target.value })}
                className={INPUT}
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Chunk Overlap</label>
              <input
                type="number"
                value={form.chunkOverlap}
                onChange={(e) => setForm({ ...form, chunkOverlap: e.target.value })}
                className={INPUT}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1">Embedding Model</label>
            <input
              type="text"
              value={form.embeddingModel}
              onChange={(e) => setForm({ ...form, embeddingModel: e.target.value })}
              placeholder="nomic-embed-text"
              className={INPUT}
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Ollama embedding model to use for chunking and retrieval.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className={`${BTN} text-muted-foreground hover:text-foreground`}>
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={saving}
            className={`${BTN} bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50`}
          >
            <Brain className="h-4 w-4" />
            {saving ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function KnowledgePage() {
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const loadKbs = () => {
    api.get<{ data: KnowledgeBase[] }>("/knowledge")
      .then((data) => setKbs(data.data ?? []))
      .catch(() => setKbs([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadKbs();
  }, []);

  return (
    <>
      <Header
        title="Knowledge Bases"
        actions={
          <NewButton label="Create Knowledge Base" onClick={() => setShowCreate(true)} />
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl space-y-2">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : kbs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Brain className="h-12 w-12 mb-4 opacity-30" />
              <p className="text-lg font-medium">No knowledge bases yet</p>
              <p className="text-sm mt-1">
                Create a knowledge base to let agents retrieve information from your documents.
              </p>
              <button
                onClick={() => setShowCreate(true)}
                className={cn(BTN, "mt-6 bg-primary text-primary-foreground hover:bg-primary/90")}
              >
                <Brain className="h-4 w-4" />
                Create Knowledge Base
              </button>
            </div>
          ) : (
            kbs.map((kb) => (
              <a
                key={kb.id}
                href={`/knowledge/${kb.id}`}
                className="block rounded-lg border border-border bg-card p-4 hover:bg-accent/30 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--color-node-knowledge)]/15 mt-0.5">
                    <Brain className="h-4 w-4 text-[var(--color-node-knowledge)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold truncate">{kb.name}</h3>
                    {kb.description && (
                      <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">{kb.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                      <span>{kb.documentCount} docs</span>
                      <span>&middot;</span>
                      <span>{kb.chunkCount} chunks</span>
                    </div>
                  </div>
                </div>
              </a>
            ))
          )}
        </div>
      </div>

      {showCreate && (
        <CreateKbDialog onClose={() => setShowCreate(false)} onCreated={loadKbs} />
      )}
    </>
  );
}
