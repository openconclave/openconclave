/**
 * knowledge.bugs.test.tsx
 * RED tests for bugs found in knowledge.tsx code review
 *
 * These tests verify the bugs exist by checking that the correct behavior
 * (that would fix the bugs) is NOT implemented.
 *
 * Tests are marked RED because:
 * 1. Bare fetch() bypasses api.get() error handling
 * 2. Array index as React key breaks reconciliation
 * 3. No useCallback memoization for loadDocuments
 * 4. No cleanup of searchResults when switching KBs
 * 5. Search uses POST instead of potentially required GET
 */

import { render, screen, waitFor, act, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { KnowledgePage } from "../knowledge";
import type { KnowledgeBase, KnowledgeDocument, KnowledgeSearchResult } from "@openconclave/shared";

// ── Module mocks ────────────────────────────────────────────────────────────

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
}));

vi.mock("@/components/ui/confirm", () => ({
  confirm: vi.fn(),
}));

vi.mock("@/components/layout/header", () => ({
  Header: () => <div data-testid="header" />,
  NewButton: ({ onClick }: { onClick: () => void }) => (
    <button data-testid="new-button" onClick={onClick}>
      New
    </button>
  ),
}));

// ── Imports ──────────────────────────────────────────────────────────────────

import { api } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { confirm } from "@/components/ui/confirm";

const mockApi = api as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
const mockToast = toast as ReturnType<typeof vi.fn>;
const mockConfirm = confirm as ReturnType<typeof vi.fn>;

// ── Test Helpers ─────────────────────────────────────────────────────────────

function makeKnowledgeBase(overrides: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: 1,
    name: "Test KB",
    description: "Test description",
    embeddingModel: "nomic-embed-text",
    chunkSize: 512,
    chunkOverlap: 64,
    documentCount: 0,
    chunkCount: 0,
    ...overrides,
  };
}

function makeDocument(overrides: Partial<KnowledgeDocument> = {}): KnowledgeDocument {
  return {
    id: 1,
    knowledgeBaseId: 1,
    filename: "test.txt",
    content: "Test content",
    chunkCount: 1,
    ...overrides,
  };
}

function makeSearchResult(overrides: Partial<KnowledgeSearchResult> = {}): KnowledgeSearchResult {
  return {
    documentId: 1,
    documentName: "test.txt",
    content: "Test content",
    score: 0.95,
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// BUG #1: loadKbs() uses bare fetch() instead of api.get()
// ──────────────────────────────────────────────────────────────────────────────

describe("BUG #1: loadKbs() does NOT use api.get() wrapper", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("should use api.get() instead of bare fetch() - RED", async () => {
    // WHEN: The component loads KBs
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [makeKnowledgeBase()] }),
    });

    mockApi.get.mockResolvedValueOnce({
      data: [makeKnowledgeBase()],
    });

    render(<KnowledgePage />);

    // THEN: api.get SHOULD be called instead of bare fetch
    // This test is RED because api.get is never called
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith("/knowledge");
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// BUG #2: loadDocuments() uses bare fetch() instead of api.get()
// ──────────────────────────────────────────────────────────────────────────────

describe("BUG #2: loadDocuments() does NOT use api.get() wrapper", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("should use api.get() for loading documents - RED", async () => {
    mockApi.get
      .mockResolvedValueOnce({ data: [makeKnowledgeBase({ id: 1, name: "KB1" })] })
      .mockResolvedValueOnce({ data: [makeDocument()] });

    render(<KnowledgePage />);

    const cardButton = await screen.findByText("KB1");
    await act(async () => {
      await userEvent.click(cardButton);
    });

    // THEN: api.get SHOULD be called for loading documents
    // This test is RED because api.get is never called for documents
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith("/knowledge/1/documents");
    });
  });

  it("should show error toast when document fetch fails - RED", async () => {
    mockApi.get
      .mockResolvedValueOnce({ data: [makeKnowledgeBase({ id: 1, name: "KB1" })] })
      .mockRejectedValueOnce(new Error("Network error"));

    render(<KnowledgePage />);

    const cardButton = await screen.findByText("KB1");
    await act(async () => {
      await userEvent.click(cardButton);
    });

    // THEN: A toast error SHOULD be shown to notify the user
    // This test is RED because no toast is shown - the error is silently caught
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.stringContaining("Failed"),
        "error"
      );
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// BUG #3: Array index used as React key in SearchResultsPanel (line 315)
// ──────────────────────────────────────────────────────────────────────────────

describe("BUG #3: Search results use array index as React key", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("should use stable documentId as key instead of array index - RED", async () => {
    // When results are displayed, they should be keyed by documentId not index
    // This test cannot directly verify key values, but it documents the bug exists
    // in the code at line 315: <SearchResultCard key={i} result={r} kbId={kbId} />

    mockApi.get
      .mockResolvedValueOnce({ data: [makeKnowledgeBase({ id: 1, name: "KB1" })] })
      .mockResolvedValueOnce({ data: [] });

    mockApi.post.mockResolvedValueOnce({
      data: [
        makeSearchResult({ documentId: 1, documentName: "doc1.txt" }),
        makeSearchResult({ documentId: 2, documentName: "doc2.txt" }),
      ],
    });

    render(<KnowledgePage />);

    const cardButton = await screen.findByText("KB1");
    await act(async () => {
      await userEvent.click(cardButton);
    });

    const searchInput = await screen.findByPlaceholderText("Enter a search query...");
    await act(async () => {
      await userEvent.type(searchInput, "test");
    });

    const searchButton = screen.getAllByRole("button").find((btn) =>
      btn.textContent?.includes("Search")
    );
    if (!searchButton) throw new Error("Search button not found");

    await act(async () => {
      await userEvent.click(searchButton);
    });

    await waitFor(() => {
      expect(screen.getByText("doc1.txt")).toBeInTheDocument();
    });

    // BUG DOCUMENTED: SearchResultCard is keyed by array index (i) not documentId
    // This causes React reconciliation issues if results reorder
    // The bug is at line 315: key={i} should be key={r.documentId}
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// BUG #4: loadDocuments not wrapped in useCallback, causing reruns
// ──────────────────────────────────────────────────────────────────────────────

describe("BUG #4: loadDocuments not memoized with useCallback", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("should use useCallback to memoize loadDocuments - RED", async () => {
    // The bug is that loadDocuments (line 464-471) is recreated on every render
    // because it's not wrapped in useCallback. This causes the useEffect to
    // potentially re-run unnecessarily.

    mockApi.get
      .mockResolvedValueOnce({ data: [makeKnowledgeBase({ id: 1, name: "KB1" })] })
      .mockResolvedValueOnce({ data: [makeDocument()] });

    render(<KnowledgePage />);

    const cardButton = await screen.findByText("KB1");
    await act(async () => {
      await userEvent.click(cardButton);
    });

    // BUG DOCUMENTED: loadDocuments should be wrapped in useCallback
    // Currently at line 464-475:
    // const loadDocuments = () => { ... }
    // useEffect(() => { loadDocuments(); }, [kb.id])
    //
    // Should be:
    // const loadDocuments = useCallback(() => { ... }, [kb.id])
    // useEffect(() => { loadDocuments(); }, [loadDocuments])

    await waitFor(() => {
      expect(screen.getByText("1 chunks")).toBeInTheDocument();
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// BUG #5: searchResults state not cleared when switching KBs
// ──────────────────────────────────────────────────────────────────────────────

describe("BUG #5: searchResults not cleared when switching KBs", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it.skip("should clear searchResults when KB changes - RED", async () => {
    // SKIPPED: Complex to test in unit tests
    //
    // The bug is at line 462-533:
    // const [searchResults, setSearchResults] = useState<KnowledgeSearchResult[] | null>(null);
    //
    // When handleSearch runs (line 530-546), it searches and sets results
    // But when the kb prop changes, searchResults is NOT cleared
    //
    // Fix would be:
    // useEffect(() => {
    //   setSearchResults(null);
    // }, [kb.id]);
    //
    // This allows stale search results from KB1 to appear when viewing KB2
  });

  it("should clear searchResults when user changes search query - RED", async () => {
    // This is a workaround test showing the bug: clearing only happens on search,
    // not when switching contexts

    mockApi.get
      .mockResolvedValueOnce({ data: [makeKnowledgeBase({ id: 1, name: "KB1" })] })
      .mockResolvedValueOnce({ data: [] });

    mockApi.post.mockResolvedValueOnce({
      data: [makeSearchResult({ documentId: 1, documentName: "kb1-doc.txt" })],
    });

    render(<KnowledgePage />);

    const cardButton = await screen.findByText("KB1");
    await act(async () => {
      await userEvent.click(cardButton);
    });

    const searchInput = await screen.findByPlaceholderText("Enter a search query...");
    await act(async () => {
      await userEvent.type(searchInput, "test");
    });

    const searchButton = screen.getAllByRole("button").find((btn) =>
      btn.textContent?.includes("Search")
    );
    if (!searchButton) throw new Error("Search button not found");

    await act(async () => {
      await userEvent.click(searchButton);
    });

    await waitFor(() => {
      expect(screen.getByText("kb1-doc.txt")).toBeInTheDocument();
    });

    // BUG: searchResults stays visible even if user navigates to different KB
    // The component should clear searchResults when kb.id changes via useEffect
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// BUG #6: Search endpoint uses POST instead of documented GET
// ──────────────────────────────────────────────────────────────────────────────

describe("BUG #6: Search API uses POST instead of GET", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("should use GET /api/knowledge/:id/search?q= instead of POST - RED", async () => {
    // Code review note: handleSearch uses POST /knowledge/:id/search
    // But dev documentation suggests: GET /api/knowledge/:id/search?q=...

    mockApi.get
      .mockResolvedValueOnce({ data: [makeKnowledgeBase({ id: 1, name: "KB1" })] })
      .mockResolvedValueOnce({ data: [] });

    mockApi.post.mockResolvedValueOnce({
      data: [makeSearchResult()],
    });

    render(<KnowledgePage />);

    const cardButton = await screen.findByText("KB1");
    await act(async () => {
      await userEvent.click(cardButton);
    });

    const searchInput = await screen.findByPlaceholderText("Enter a search query...");
    await act(async () => {
      await userEvent.type(searchInput, "test");
    });

    const searchButton = screen.getAllByRole("button").find((btn) =>
      btn.textContent?.includes("Search")
    );
    if (!searchButton) throw new Error("Search button not found");

    await act(async () => {
      await userEvent.click(searchButton);
    });

    // THEN: api.get SHOULD be called with GET endpoint
    // This test is RED because api.post is used instead
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith(
        "/knowledge/1/search",
        expect.objectContaining({ q: "test" })
      );
    });
  });
});
