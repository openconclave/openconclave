/**
 * TDD (RED phase) — KnowledgeDetailPage acceptance criteria.
 *
 * AC: /knowledge/:id fetches GET /api/knowledge/:id and renders:
 *   - KB metadata header: name, description, embedding model, chunk size, chunk overlap,
 *     document count, chunk count.
 *   - Document list: filename and chunk count per document (read-only).
 *   - "Edit KB" button that opens EditKbDialog.
 *   - "Delete KB" button that confirms then DELETEs and redirects to /knowledge.
 *   - "← Back to Knowledge Bases" link pointing to /knowledge.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { KnowledgeBase, KnowledgeDocument } from "@openconclave/shared";

// ── Stub modules ──────────────────────────────────────────────────────────────
vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/components/ui/toast", () => ({
  toast: vi.fn(),
  ToastContainer: () => null,
}));

vi.mock("@/components/ui/confirm", () => ({
  confirm: vi.fn().mockResolvedValue(true),
  ConfirmDialog: () => null,
}));

// ── The module under test — does not exist yet (RED) ─────────────────────────
import { KnowledgeDetailPage } from "@/pages/knowledge-detail";
import { api } from "@/lib/api";
import { confirm } from "@/components/ui/confirm";

// ── Stub window.location so we can assert navigation ─────────────────────────
const originalLocation = window.location;
beforeEach(() => {
  Object.defineProperty(window, "location", {
    writable: true,
    value: { ...originalLocation, href: "http://localhost/knowledge/1", pathname: "/knowledge/1" },
  });
  vi.clearAllMocks();
});

const FAKE_KB: KnowledgeBase & { documents: KnowledgeDocument[] } = {
  id: 1,
  name: "Alpha Docs",
  description: "A test knowledge base",
  embeddingModel: "nomic-embed-text",
  chunkSize: 512,
  chunkOverlap: 64,
  documentCount: 2,
  chunkCount: 25,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  documents: [
    {
      id: 10,
      knowledgeBaseId: 1,
      filename: "readme.md",
      contentHash: "abc",
      chunkCount: 12,
      createdAt: "2024-01-01T00:00:00Z",
    },
    {
      id: 11,
      knowledgeBaseId: 1,
      filename: "guide.txt",
      contentHash: "def",
      chunkCount: 13,
      createdAt: "2024-01-01T00:00:00Z",
    },
  ],
};

beforeEach(() => {
  (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: FAKE_KB });
});

describe("KnowledgeDetailPage", () => {
  it("displays the KB name in the metadata header", async () => {
    render(<KnowledgeDetailPage />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /alpha docs/i })).toBeInTheDocument();
    });
  });

  it("displays the KB description in the metadata header", async () => {
    render(<KnowledgeDetailPage />);
    await waitFor(() => {
      expect(screen.getByText("A test knowledge base")).toBeInTheDocument();
    });
  });

  it("displays the embedding model in the metadata header", async () => {
    render(<KnowledgeDetailPage />);
    await waitFor(() => {
      expect(screen.getByText(/nomic-embed-text/)).toBeInTheDocument();
    });
  });

  it("displays chunk size in the metadata header", async () => {
    render(<KnowledgeDetailPage />);
    await waitFor(() => {
      expect(screen.getByText(/512/)).toBeInTheDocument();
    });
  });

  it("displays chunk overlap in the metadata header", async () => {
    render(<KnowledgeDetailPage />);
    await waitFor(() => {
      expect(screen.getByText(/64/)).toBeInTheDocument();
    });
  });

  it("lists each document's filename", async () => {
    render(<KnowledgeDetailPage />);
    await waitFor(() => {
      expect(screen.getByText("readme.md")).toBeInTheDocument();
    });
    expect(screen.getByText("guide.txt")).toBeInTheDocument();
  });

  it("lists each document's chunk count", async () => {
    render(<KnowledgeDetailPage />);
    await waitFor(() => {
      expect(screen.getByText(/12.*chunk/i)).toBeInTheDocument();
    });
  });

  it("has a 'Back to Knowledge Bases' link pointing to /knowledge", async () => {
    render(<KnowledgeDetailPage />);
    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: /back to knowledge bases/i })
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole("link", { name: /back to knowledge bases/i })
    ).toHaveAttribute("href", "/knowledge");
  });

  it("has an 'Edit KB' button", async () => {
    render(<KnowledgeDetailPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
    });
  });

  it("has a 'Delete KB' button", async () => {
    render(<KnowledgeDetailPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
    });
  });

  it("clicking Delete KB calls DELETE /api/knowledge/:id after confirmation", async () => {
    (api.delete as ReturnType<typeof vi.fn>).mockResolvedValue({});
    render(<KnowledgeDetailPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith("/knowledge/1");
    });
  });

  it("after successful delete navigates to /knowledge", async () => {
    (api.delete as ReturnType<typeof vi.fn>).mockResolvedValue({});
    render(<KnowledgeDetailPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    await waitFor(() => {
      expect(window.location.href).toBe("/knowledge");
    });
  });

  it("does not render ingest controls", async () => {
    render(<KnowledgeDetailPage />);
    await waitFor(() => {
      expect(screen.getByText("Alpha Docs")).toBeInTheDocument();
    });
    expect(screen.queryByText(/ingest file/i)).not.toBeInTheDocument();
  });
});
