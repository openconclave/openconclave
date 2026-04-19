import { useEffect, useState } from "react";
import { Header, NewButton } from "@/components/layout/header";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { confirm } from "@/components/ui/confirm";
import type { KnowledgeBase, KnowledgeDocument, KnowledgeSearchResult } from "@openconclave/shared";
import {
  Brain,
  ChevronDown,
  ChevronRight,
  Trash2,
  Upload,
  Search,
  Pencil,
  FileText,
  Eye,
  X,
} from "lucide-react";
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

// ─── Search Results Panel ─────────────────────────────────────────────────────

function SearchResultCard({ result, kbId }: { result: KnowledgeSearchResult; kbId: number }) {
  const [expanded, setExpanded] = useState(false);
  const [fullContent, setFullContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (fullContent === null) {
      setLoading(true);
      try {
        const data = await api.get<{ data: { content: string } }>(`/knowledge/${kbId}/documents/${result.documentId}`);
        setFullContent(data.data?.content ?? "");
      } catch {
        toast("Failed to load document", "error");
      } finally {
        setLoading(false);
      }
    }
    setExpanded(true);
  };

  return (
    <div className="rounded-md border border-border bg-background text-xs overflow-hidden">
      <div className="p-3 space-y-1">
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="font-medium truncate">{result.documentName}</span>
          <div className="flex items-center gap-2 shrink-0 ml-2">
            <button
              onClick={toggle}
              className="text-muted-foreground/50 hover:text-foreground p-0.5 transition-colors"
              title="View full document"
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
            <span className="font-mono">score: {result.score.toFixed(3)}</span>
          </div>
        </div>
        <p className="text-foreground/80 line-clamp-3 whitespace-pre-wrap">{result.content}</p>
      </div>
      {expanded && (
        <div className="border-t border-border px-3 py-2 max-h-64 overflow-y-auto">
          {loading ? (
            <p className="text-xs text-muted-foreground">Loading...</p>
          ) : (
            <pre className="text-xs text-foreground/80 whitespace-pre-wrap font-mono">{fullContent}</pre>
          )}
        </div>
      )}
    </div>
  );
}

function SearchResultsPanel({ results, kbId }: { results: KnowledgeSearchResult[]; kbId: number }) {
  if (results.length === 0) {
    return <p className="text-xs text-muted-foreground py-2">No results found.</p>;
  }
  return (
    <div className="space-y-2 mt-2">
      {results.map((r, i) => (
        <SearchResultCard key={i} result={r} kbId={kbId} />
      ))}
    </div>
  );
}

// ─── Document List (paginated) ───────────────────────────────────────────────

const PAGE_SIZE = 20;

function DocumentRow({
  doc,
  kbId,
  onDelete,
}: {
  doc: KnowledgeDocument;
  kbId: number;
  onDelete: (doc: KnowledgeDocument) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (content === null) {
      setLoading(true);
      try {
        const data = await api.get<{ data: { content: string } }>(`/knowledge/${kbId}/documents/${doc.id}`);
        setContent(data.data?.content ?? "");
      } catch {
        toast("Failed to load document", "error");
      } finally {
        setLoading(false);
      }
    }
    setExpanded(true);
  };

  return (
    <div className="rounded-md border border-border bg-background overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-xs truncate">{doc.filename}</span>
        <button
          onClick={toggle}
          className="text-muted-foreground/50 hover:text-foreground p-1 transition-colors"
          title="View document"
        >
          <Eye className="h-3.5 w-3.5" />
        </button>
        <span className="text-[10px] text-muted-foreground shrink-0">
          {doc.chunkCount} chunks
        </span>
        <button
          onClick={() => onDelete(doc)}
          className="text-muted-foreground/50 hover:text-destructive p-1 transition-colors"
          title="Remove document"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {expanded && (
        <div className="border-t border-border px-3 py-2 max-h-64 overflow-y-auto">
          {loading ? (
            <p className="text-xs text-muted-foreground">Loading...</p>
          ) : (
            <pre className="text-xs text-foreground/80 whitespace-pre-wrap font-mono">{content}</pre>
          )}
        </div>
      )}
    </div>
  );
}

function DocumentList({
  documents,
  loading,
  onDelete,
  kbId,
}: {
  documents: KnowledgeDocument[];
  loading: boolean;
  onDelete: (doc: KnowledgeDocument) => void;
  kbId: number;
}) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const visible = documents.slice(0, visibleCount);
  const remaining = documents.length - visibleCount;

  return (
    <div>
      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
        Documents ({documents.length})
      </p>
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : documents.length === 0 ? (
        <p className="text-xs text-muted-foreground">No documents ingested yet.</p>
      ) : (
        <div className="space-y-1">
          {visible.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} kbId={kbId} onDelete={onDelete} />
          ))}
          {remaining > 0 && (
            <button
              onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              className={`${BTN} w-full justify-center text-muted-foreground hover:text-foreground hover:bg-accent/50 border border-border mt-1`}
            >
              Show more ({remaining} remaining)
            </button>
          )}
          {visibleCount > PAGE_SIZE && (
            <button
              onClick={() => setVisibleCount(PAGE_SIZE)}
              className={`${BTN} w-full justify-center text-muted-foreground hover:text-foreground text-[10px]`}
            >
              Collapse
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── KB Detail Panel ──────────────────────────────────────────────────────────

interface KbDetailPanelProps {
  kb: KnowledgeBase;
  onDelete: (kb: KnowledgeBase) => void;
  onEdit: (kb: KnowledgeBase) => void;
  onRefresh: () => void;
}

function KbDetailPanel({ kb, onDelete, onEdit, onRefresh }: KbDetailPanelProps) {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [ingestPath, setIngestPath] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<KnowledgeSearchResult[] | null>(null);

  const loadDocuments = () => {
    setLoadingDocs(true);
    api.get<{ data: KnowledgeDocument[] }>(`/knowledge/${kb.id}/documents`)
      .then((data) => setDocuments(data.data ?? []))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        toast(`Failed to load documents: ${message}`, "error");
        setDocuments([]);
      })
      .finally(() => setLoadingDocs(false));
  };

  useEffect(() => {
    loadDocuments();
  }, [kb.id]);

  const handleIngest = async () => {
    if (!ingestPath.trim()) {
      toast("Enter a file path", "error");
      return;
    }
    setIngesting(true);
    try {
      await api.post(`/knowledge/${kb.id}/ingest`, { filePath: ingestPath.trim() });
      toast("File ingested successfully", "success");
      setIngestPath("");
      loadDocuments();
      onRefresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast(`Ingest failed: ${message}`, "error");
    } finally {
      setIngesting(false);
    }
  };

  const handleFileIngest = async (file: File) => {
    setIngesting(true);
    try {
      const text = await file.text();
      await api.post(`/knowledge/${kb.id}/ingest`, { text, filename: file.name });
      toast(`"${file.name}" ingested successfully`, "success");
      loadDocuments();
      onRefresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast(`Ingest failed: ${message}`, "error");
    } finally {
      setIngesting(false);
    }
  };

  const handleDeleteDocument = async (doc: KnowledgeDocument) => {
    const confirmed = await confirm(
      "Delete document",
      `Remove "${doc.filename}" from this knowledge base? This cannot be undone.`
    );
    if (!confirmed) return;
    try {
      await api.delete(`/knowledge/${kb.id}/documents/${doc.id}`);
      toast("Document removed", "success");
      loadDocuments();
      onRefresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast(`Failed to delete: ${message}`, "error");
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchResults(null);
    try {
      const data = await api.post<{ data: KnowledgeSearchResult[] }>(`/knowledge/${kb.id}/search`, {
        query: searchQuery.trim(),
        topK: 5,
      });
      setSearchResults(data.data ?? []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast(`Search failed: ${message}`, "error");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="mt-3 border-t border-border pt-3 space-y-5">
      {/* Meta */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Model: <span className="font-mono text-foreground">{kb.embeddingModel}</span></span>
        <span>Chunk size: <span className="font-mono text-foreground">{kb.chunkSize}</span></span>
        <span>Overlap: <span className="font-mono text-foreground">{kb.chunkOverlap}</span></span>
        <span>{kb.chunkCount} chunks total</span>
      </div>

      {/* Ingest */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) handleFileIngest(file);
        }}
      >
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Ingest File</p>
        <div className={cn(
          "flex items-center gap-2 rounded-lg border-2 border-dashed p-2 transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-transparent"
        )}>
          <input
            type="text"
            value={ingestPath}
            onChange={(e) => setIngestPath(e.target.value)}
            placeholder={dragging ? "Drop file here..." : "C:\\path\\to\\file.txt  or drag & drop"}
            className={`${INPUT} font-mono flex-1`}
            onKeyDown={(e) => e.key === "Enter" && handleIngest()}
          />
          <input
            type="file"
            id={`file-upload-${kb.id}`}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileIngest(file);
              e.target.value = "";
            }}
          />
          <label
            htmlFor={`file-upload-${kb.id}`}
            className={`${BTN} bg-accent text-muted-foreground hover:text-foreground hover:bg-accent/80 cursor-pointer shrink-0`}
          >
            <FileText className="h-4 w-4" />
            Browse
          </label>
          <button
            onClick={handleIngest}
            disabled={ingesting || !ingestPath.trim()}
            className={`${BTN} bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 shrink-0`}
          >
            <Upload className="h-4 w-4" />
            {ingesting ? "Ingesting..." : "Ingest"}
          </button>
        </div>
      </div>

      {/* Documents */}
      <DocumentList
        documents={documents}
        loading={loadingDocs}
        onDelete={handleDeleteDocument}
        kbId={kb.id}
      />

      {/* Search */}
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Test Search</p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Enter a search query..."
            className={`${INPUT} flex-1`}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
          <button
            onClick={handleSearch}
            disabled={searching || !searchQuery.trim()}
            className={`${BTN} bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 shrink-0`}
          >
            <Search className="h-4 w-4" />
            {searching ? "Searching..." : "Search"}
          </button>
        </div>
        {searchResults !== null && <SearchResultsPanel results={searchResults} kbId={kb.id} />}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 border-t border-border">
        <button
          onClick={() => onEdit(kb)}
          className={`${BTN} text-muted-foreground hover:text-foreground hover:bg-accent/50`}
        >
          <Pencil className="h-4 w-4" />
          Edit
        </button>
        <button
          onClick={() => onDelete(kb)}
          className={`${BTN} text-muted-foreground hover:text-destructive hover:bg-destructive/10`}
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </button>
      </div>
    </div>
  );
}

// ─── KB Card ──────────────────────────────────────────────────────────────────

interface KbCardProps {
  kb: KnowledgeBase;
  onDelete: (kb: KnowledgeBase) => void;
  onEdit: (kb: KnowledgeBase) => void;
  onRefresh: () => void;
}

function KbCard({ kb, onDelete, onEdit, onRefresh }: KbCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left p-4 flex items-start gap-3 hover:bg-accent/30 transition-colors"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--color-node-knowledge)]/15 mt-0.5">
          <Brain className="h-4 w-4 text-[var(--color-node-knowledge)]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold truncate">{kb.name}</h3>
          </div>
          {kb.description && (
            <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">{kb.description}</p>
          )}
          <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
            <span>{kb.documentCount} docs</span>
            <span>&middot;</span>
            <span>{kb.chunkCount} chunks</span>
            <span>&middot;</span>
            <span className="font-mono">{kb.embeddingModel}</span>
          </div>
        </div>
        <div className="shrink-0 text-muted-foreground mt-1">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4">
          <KbDetailPanel kb={kb} onDelete={onDelete} onEdit={onEdit} onRefresh={onRefresh} />
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function KnowledgePage({ embedded = false }: { embedded?: boolean } = {}) {
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingKb, setEditingKb] = useState<KnowledgeBase | null>(null);

  const loadKbs = () => {
    api.get<{ data: KnowledgeBase[] }>("/knowledge")
      .then((data) => setKbs(data.data ?? []))
      .catch(() => setKbs([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadKbs();
  }, []);

  const handleDelete = async (kb: KnowledgeBase) => {
    const confirmed = await confirm(
      "Delete knowledge base",
      `Delete "${kb.name}" and all its documents? This cannot be undone.`
    );
    if (!confirmed) return;
    try {
      await api.delete(`/knowledge/${kb.id}`);
      toast(`Deleted "${kb.name}"`, "success");
      loadKbs();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast(`Failed to delete: ${message}`, "error");
    }
  };

  return (
    <>
      {!embedded && (
        <Header
          title="Knowledge Bases"
          actions={
            <NewButton label="Create Knowledge Base" onClick={() => setShowCreate(true)} />
          }
        />
      )}

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl space-y-3">
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
              <KbCard
                key={kb.id}
                kb={kb}
                onDelete={handleDelete}
                onEdit={(k) => setEditingKb(k)}
                onRefresh={loadKbs}
              />
            ))
          )}
        </div>
      </div>

      {showCreate && (
        <CreateKbDialog onClose={() => setShowCreate(false)} onCreated={loadKbs} />
      )}

      {editingKb && (
        <EditKbDialog
          kb={editingKb}
          onClose={() => setEditingKb(null)}
          onSaved={loadKbs}
        />
      )}
    </>
  );
}
