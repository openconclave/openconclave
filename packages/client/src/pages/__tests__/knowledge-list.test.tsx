/**
 * TDD (RED phase) — KnowledgePage list-view acceptance criteria.
 *
 * AC: /knowledge is a flat list of clickable rows (no accordion).
 *   - One row per KB.
 *   - Each row shows: name, description, document count, chunk count.
 *   - Each row has an anchor linking to /knowledge/:id.
 *   - Header has a "Create Knowledge Base" button.
 *   - No accordion chevron expand buttons.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { KnowledgeBase } from "@openconclave/shared";

// ── Stub the api module ───────────────────────────────────────────────────────
vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

// Stub toast/confirm so modals don't blow up in jsdom
vi.mock("@/components/ui/toast", () => ({
  toast: vi.fn(),
  ToastContainer: () => null,
}));

vi.mock("@/components/ui/confirm", () => ({
  confirm: vi.fn(),
  ConfirmDialog: () => null,
}));

// Import AFTER mocks are declared
import { api } from "@/lib/api";
import { KnowledgePage } from "@/pages/knowledge";

const FAKE_KBS: KnowledgeBase[] = [
  {
    id: 1,
    name: "Alpha Docs",
    description: "First knowledge base",
    embeddingModel: "nomic-embed-text",
    chunkSize: 512,
    chunkOverlap: 64,
    documentCount: 3,
    chunkCount: 42,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
  {
    id: 2,
    name: "Beta Library",
    description: undefined,
    embeddingModel: "nomic-embed-text",
    chunkSize: 256,
    chunkOverlap: 32,
    documentCount: 7,
    chunkCount: 88,
    createdAt: "2024-01-02T00:00:00Z",
    updatedAt: "2024-01-02T00:00:00Z",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: FAKE_KBS });
});

describe("KnowledgePage — list view", () => {
  it("renders a row for each knowledge base returned by GET /api/knowledge", async () => {
    render(<KnowledgePage />);
    await waitFor(() => {
      expect(screen.getByText("Alpha Docs")).toBeInTheDocument();
    });
    expect(screen.getByText("Beta Library")).toBeInTheDocument();
  });

  it("shows the KB description in the row", async () => {
    render(<KnowledgePage />);
    await waitFor(() => {
      expect(screen.getByText("First knowledge base")).toBeInTheDocument();
    });
  });

  it("shows the document count in the row", async () => {
    render(<KnowledgePage />);
    await waitFor(() => {
      expect(screen.getByText(/3.*doc/i)).toBeInTheDocument();
    });
  });

  it("shows the chunk count in the row", async () => {
    render(<KnowledgePage />);
    await waitFor(() => {
      expect(screen.getByText(/42.*chunk/i)).toBeInTheDocument();
    });
  });

  it("each row has an anchor link pointing to /knowledge/:id", async () => {
    render(<KnowledgePage />);
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /alpha docs/i })).toBeInTheDocument();
    });
    const link = screen.getByRole("link", { name: /alpha docs/i });
    expect(link).toHaveAttribute("href", "/knowledge/1");
  });

  it("the header contains a 'Create Knowledge Base' button", async () => {
    render(<KnowledgePage />);
    expect(
      screen.getByRole("button", { name: /create knowledge base/i })
    ).toBeInTheDocument();
  });

  it("KB name is not wrapped in an accordion expand <button>", async () => {
    render(<KnowledgePage />);
    await waitFor(() => {
      expect(screen.getByText("Alpha Docs")).toBeInTheDocument();
    });
    // The old KbCard rendered each KB as an expandable <button> (accessible name
    // derived from its text content including the KB name).  The new list view
    // must render KB names inside <a> links, not inside <button> elements.
    expect(screen.queryByRole("button", { name: /alpha docs/i })).not.toBeInTheDocument();
  });

  it("does not render ingest controls on the list view", async () => {
    render(<KnowledgePage />);
    await waitFor(() => {
      expect(screen.getByText("Alpha Docs")).toBeInTheDocument();
    });
    expect(screen.queryByText(/ingest file/i)).not.toBeInTheDocument();
  });
});
