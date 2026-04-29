import { test, expect, describe, mock, beforeEach } from "bun:test";
import { Hono } from "hono";
import { cors } from "hono/cors";

// ── DB mock ───────────────────────────────────────────────────
// Configured per-test via `mockGetResult`.
let mockGetResult: unknown = null;

const selectChain = {
  from: () => selectChain,
  where: () => selectChain,
  get: () => mockGetResult,
};

const deleteWhereResult = { run: mock(() => undefined) };
const deleteChain = { where: () => deleteWhereResult };

const transactionMock = mock((fn: (tx: unknown) => unknown) => {
  const tx = { delete: () => deleteChain };
  return fn(tx);
});

mock.module("../../db/client", () => ({
  db: {
    select: () => selectChain,
    delete: () => deleteChain,
    transaction: transactionMock,
  },
}));

// ── Knowledge helpers mocks ───────────────────────────────────
const ingestFileMock = mock(async (_id: number, _path: string) => 42);
const ingestTextMock = mock(async (_id: number, _file: string, _text: string) => 42);
mock.module("../../knowledge/ingest", () => ({
  ingestFile: ingestFileMock,
  ingestText: ingestTextMock,
}));

const searchKBMock = mock(async (_id: number, _query: string, _topK: number) => []);
mock.module("../../knowledge/search", () => ({
  searchKnowledgeBase: searchKBMock,
}));

// Dynamic import AFTER mocks are in place
const { knowledgeRoutes } = await import("../../routes/knowledge");
const { errorHandler } = await import("../../lib/errors");
const app = new Hono();
app.onError(errorHandler);
app.route("/", knowledgeRoutes);

// ── Request helpers ───────────────────────────────────────────
function post(path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function del(path: string) {
  return app.request(path, { method: "DELETE" });
}

beforeEach(() => {
  mockGetResult = null;
  ingestFileMock.mockClear();
  ingestTextMock.mockClear();
  searchKBMock.mockClear();
  transactionMock.mockClear();
  deleteWhereResult.run.mockClear();
});

// ── BLOCKER: filePath arbitrary file read ─────────────────────

describe("POST /:id/ingest — filePath removal", () => {
  test("body with only filePath returns 400", async () => {
    mockGetResult = { id: 1, name: "Test" }; // KB exists; body check is what must reject it
    const res = await post("/1/ingest", { filePath: "/etc/passwd" });
    expect(res.status).toBe(400);
  });

  test("filePath body never invokes ingestFile", async () => {
    mockGetResult = { id: 1, name: "Test" };
    await post("/1/ingest", { filePath: "/etc/passwd" });
    expect(ingestFileMock).not.toHaveBeenCalled();
  });
});

// ── BLOCKER: CORS allowlist ───────────────────────────────────
// TEST_LIMITATION: index.ts starts a full server so production cors() config can't
// be imported directly; the function below mirrors the fix that will be in index.ts.

describe("CORS origin allowlist logic", () => {
  const corsOrigin = (origin: string): string | null | undefined => {
    if (!origin) return undefined;
    const allowed = [
      "http://localhost:5173", "http://127.0.0.1:5173",
      "http://localhost:4000", "http://127.0.0.1:4000",
    ];
    return allowed.includes(origin) ? origin : null;
  };

  const corsApp = new Hono();
  corsApp.use("*", cors({ origin: corsOrigin, credentials: false }));
  corsApp.get("/test", (c) => c.json({ ok: true }));

  test("allowed origin is reflected in ACAO header", async () => {
    const res = await corsApp.request("/test", {
      headers: { Origin: "http://localhost:5173" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  test("attacker origin is not reflected in ACAO header", async () => {
    const res = await corsApp.request("/test", {
      headers: { Origin: "https://attacker.com" },
    });
    const header = res.headers.get("access-control-allow-origin");
    expect(header).not.toBe("https://attacker.com");
    expect(header).not.toBe("*");
  });

  test("no Origin header is not blocked", async () => {
    const res = await corsApp.request("/test");
    expect(res.status).toBe(200);
  });
});

// ── MINOR: embeddingModel validation ─────────────────────────

describe("POST / — embeddingModel validation", () => {
  test("path-traversal embeddingModel is rejected with 400", async () => {
    const res = await post("/", { name: "Test KB", embeddingModel: "../../etc/passwd" });
    expect(res.status).toBe(400);
  });

  test("valid embeddingModel passes validation (no 400)", async () => {
    // DB insert is not mocked; result may be 500 from DB, but NOT 400 from validation.
    const res = await post("/", { name: "Test KB", embeddingModel: "nomic-embed-text" });
    expect(res.status).not.toBe(400);
  });
});

// ── MAJOR: chunkSize/chunkOverlap validation ──────────────────

describe("POST / — chunkSize and chunkOverlap validation", () => {
  test("chunkSize: 0 is rejected with 400 (would infinite-loop in chunker hard-cut)", async () => {
    const res = await post("/", { name: "Test KB", chunkSize: 0 });
    expect(res.status).toBe(400);
  });

  test("negative chunkSize is rejected with 400", async () => {
    const res = await post("/", { name: "Test KB", chunkSize: -1 });
    expect(res.status).toBe(400);
  });

  test("non-integer chunkSize is rejected with 400", async () => {
    const res = await post("/", { name: "Test KB", chunkSize: 1.5 });
    expect(res.status).toBe(400);
  });

  test("negative chunkOverlap is rejected with 400", async () => {
    const res = await post("/", { name: "Test KB", chunkOverlap: -1 });
    expect(res.status).toBe(400);
  });

  test("non-integer chunkOverlap is rejected with 400", async () => {
    const res = await post("/", { name: "Test KB", chunkOverlap: 2.5 });
    expect(res.status).toBe(400);
  });

  test("chunkOverlap >= chunkSize is rejected with 400 (would 2x-balloon chunks)", async () => {
    const res = await post("/", { name: "Test KB", chunkSize: 512, chunkOverlap: 600 });
    expect(res.status).toBe(400);
  });

  test("chunkOverlap == chunkSize is rejected with 400", async () => {
    const res = await post("/", { name: "Test KB", chunkSize: 100, chunkOverlap: 100 });
    expect(res.status).toBe(400);
  });

  test("default values (no chunkSize / chunkOverlap supplied) pass validation", async () => {
    const res = await post("/", { name: "Test KB" });
    expect(res.status).not.toBe(400);
  });

  test("valid chunkSize + chunkOverlap pair passes validation", async () => {
    const res = await post("/", { name: "Test KB", chunkSize: 512, chunkOverlap: 50 });
    expect(res.status).not.toBe(400);
  });
});

// ── MINOR: topK clamping ──────────────────────────────────────

describe("POST /:id/search — topK clamping", () => {
  test("negative topK is clamped to ≥ 1 before reaching searchKnowledgeBase", async () => {
    mockGetResult = { id: 1, name: "Test" };
    await post("/1/search", { query: "hello", topK: -1 });
    expect(searchKBMock).toHaveBeenCalled();
    const calledTopK = (searchKBMock.mock.calls[0] as [number, string, number])[2];
    expect(calledTopK).toBeGreaterThanOrEqual(1);
  });

  test("topK above 100 is clamped to ≤ 100", async () => {
    mockGetResult = { id: 1, name: "Test" };
    await post("/1/search", { query: "hello", topK: 9999 });
    const calledTopK = (searchKBMock.mock.calls[0] as [number, string, number])[2];
    expect(calledTopK).toBeLessThanOrEqual(100);
  });
});

// ── MINOR: KB existence pre-check (ingest + search → 404) ────

describe("POST /:id/ingest — KB pre-check", () => {
  test("missing KB returns 404 not 500", async () => {
    mockGetResult = null;
    const res = await post("/999/ingest", { text: "hello", filename: "test.txt" });
    expect(res.status).toBe(404);
  });

  test("non-numeric id returns 404 not 500", async () => {
    mockGetResult = null;
    const res = await post("/abc/ingest", { text: "hello", filename: "test.txt" });
    expect(res.status).toBe(404);
  });
});

describe("POST /:id/search — KB pre-check", () => {
  test("missing KB returns 404 not 500", async () => {
    mockGetResult = null;
    const res = await post("/999/search", { query: "hello" });
    expect(res.status).toBe(404);
  });
});

// ── MINOR: empty-string text allowed ─────────────────────────

describe("POST /:id/ingest — empty string text", () => {
  test("empty string text is forwarded to ingestText (not rejected as 400)", async () => {
    mockGetResult = { id: 1, name: "Test" };
    const res = await post("/1/ingest", { text: "", filename: "empty.txt" });
    expect(res.status).not.toBe(400);
    expect(ingestTextMock).toHaveBeenCalled();
  });
});

// ── MINOR: cascade delete uses transaction ────────────────────
// TEST_LIMITATION: rollback semantics require a live SQLite DB; this test only
// verifies that db.transaction() is called (atomicity intent), not that a
// mid-delete crash rolls back.

describe("DELETE /:id — cascade is wrapped in db.transaction", () => {
  test("db.transaction is called for KB cascade delete", async () => {
    mockGetResult = { id: 1, name: "Test" };
    await del("/1");
    expect(transactionMock).toHaveBeenCalled();
  });
});

describe("DELETE /:id/documents/:docId — cascade is wrapped in db.transaction", () => {
  test("db.transaction is called for document cascade delete", async () => {
    mockGetResult = { id: 1, knowledgeBaseId: 1, filename: "test.txt" };
    await del("/1/documents/1");
    expect(transactionMock).toHaveBeenCalled();
  });
});
