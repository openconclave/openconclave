import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { confirm } from "@/components/ui/confirm";
import type { KnowledgeBase, KnowledgeDocument } from "@openconclave/shared";
import { FileText, Pencil, Trash2, X } from "lucide-react";

const BTN = "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors";
const INPUT = "w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm";

// ─── Edit KB Dialog ───────────────────────────────────────────────────────────

function EditKbDialog({
  kb,
  onClose,
  onSaved,
}: {
  kb: KnowledgeBase;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(kb.name);
  const [description, setDescription] = useState(kb.description ?? "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      toast("Name is required", "error");
      return;
    }
    setSaving(true);
    try {
      await api.put(`/knowledge/${kb.id}`, {
        name: name.trim(),
        description: description.trim() || undefined,
      });
      toast("Knowledge base updated", "success");
      onSaved();
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast(`Failed to update: ${message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-[400px] rounded-xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 fade-in duration-150">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">Edit Knowledge Base</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={INPUT}
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className={`${INPUT} resize-none`}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className={`${BTN} text-muted-foreground hover:text-foreground`}>
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className={`${BTN} bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50`}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type KbWithDocuments = KnowledgeBase & { documents: KnowledgeDocument[] };

export function KnowledgeDetailPage() {
  const id = window.location.pathname.split("/")[2];
  const [kb, setKb] = useState<KbWithDocuments | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingKb, setEditingKb] = useState(false);

  const load = () => {
    api.get<{ data: KbWithDocuments }>(`/knowledge/${id}`)
      .then((data) => setKb(data.data ?? null))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        toast(`Failed to load: ${message}`, "error");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleDelete = async () => {
    if (!kb) return;
    const confirmed = await confirm(
      "Delete knowledge base",
      `Delete "${kb.name}" and all its documents? This cannot be undone.`
    );
    if (!confirmed) return;
    try {
      await api.delete(`/knowledge/${id}`);
      window.location.href = "/knowledge";
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast(`Failed to delete: ${message}`, "error");
    }
  };

  if (loading) {
    return <p className="p-6 text-sm text-muted-foreground">Loading...</p>;
  }

  if (!kb) {
    return <p className="p-6 text-sm text-muted-foreground">Not found.</p>;
  }

  return (
    <>
      <Header
        title={kb.name}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditingKb(true)}
              className={`${BTN} text-muted-foreground hover:text-foreground hover:bg-accent/50`}
            >
              <Pencil className="h-4 w-4" />
              Edit
            </button>
            <button
              onClick={handleDelete}
              className={`${BTN} text-muted-foreground hover:text-destructive hover:bg-destructive/10`}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl space-y-6">
          <a href="/knowledge" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← Back to Knowledge Bases
          </a>

          {kb.description && (
            <p className="text-muted-foreground">{kb.description}</p>
          )}

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Model: <span className="font-mono text-foreground">{kb.embeddingModel}</span></span>
            <span>Chunk size: <span className="font-mono text-foreground">{kb.chunkSize}</span></span>
            <span>Overlap: <span className="font-mono text-foreground">{kb.chunkOverlap}</span></span>
            <span>{kb.documentCount} docs</span>
            <span>{kb.chunkCount} chunks total</span>
          </div>

          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
              Documents ({kb.documents.length})
            </p>
            {kb.documents.length === 0 ? (
              <p className="text-xs text-muted-foreground">No documents ingested yet.</p>
            ) : (
              <div className="space-y-1">
                {kb.documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="rounded-md border border-border bg-card px-3 py-2 flex items-center gap-2"
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex-1 text-sm truncate">{doc.filename}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{doc.chunkCount} chunks</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {editingKb && (
        <EditKbDialog
          kb={kb}
          onClose={() => setEditingKb(false)}
          onSaved={load}
        />
      )}
    </>
  );
}
