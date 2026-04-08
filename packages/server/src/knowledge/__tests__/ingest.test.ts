import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// Mock Bun global for vitest (runs under Node, not Bun)
const mockBunFile = vi.fn();
if (typeof globalThis.Bun === "undefined") {
  (globalThis as Record<string, unknown>).Bun = { file: mockBunFile };
} else {
  const originalBunFile = Bun.file;
  // @ts-expect-error — overriding read-only Bun.file for testing
  Bun.file = mockBunFile;
  afterAll(() => {
    // @ts-expect-error — restoring original
    Bun.file = originalBunFile;
  });
}

// Mock database
vi.mock("../db/client", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  },
}));

// Mock embeddings module
vi.mock("./embeddings", () => ({
  generateEmbeddings: vi.fn(),
}));

// Mock chunker module
vi.mock("./chunker", () => ({
  chunkText: vi.fn(),
}));

// Mock logger
vi.mock("../lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { ingestText, ingestFile } from "../ingest";
import { db } from "../../db/client";
import { generateEmbeddings } from "../embeddings";
import { chunkText } from "../chunker";

// ── helpers ──────────────────────────────────────────────────

const mockKb = {
  id: 1,
  name: "Test KB",
  embeddingModel: "nomic-embed-text",
  chunkSize: 512,
  chunkOverlap: 50,
};

function makeSelectChain(returnValue: unknown) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    get: vi.fn().mockReturnValue(returnValue),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  return chain;
}

function makeSelectArrayChain(returnValue: unknown[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(Promise.resolve(returnValue));
  return chain;
}

function makeInsertChain(returnValues: unknown[]) {
  const chain = {
    values: vi.fn(),
    returning: vi.fn().mockResolvedValue(returnValues),
  };
  chain.values.mockReturnValue(chain);
  return chain;
}

function makeInsertChainNoReturn() {
  const chain = {
    values: vi.fn().mockResolvedValue(undefined),
  };
  return chain;
}

// ── ingestText ────────────────────────────────────────────────

describe("ingestText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when knowledge base is not found", async () => {
    (db.select as ReturnType<typeof vi.fn>).mockReturnValueOnce(makeSelectChain(null));

    await expect(ingestText(999, "file.txt", "some text")).rejects.toThrow(
      "Knowledge base 999 not found",
    );
  });

  it("returns existing document ID when content hash matches (dedup)", async () => {
    const existingDoc = { id: 42, contentHash: "abc" };

    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeSelectChain(mockKb))
      .mockReturnValueOnce(makeSelectChain(existingDoc));

    const result = await ingestText(1, "file.txt", "some text");

    expect(result).toBe(42);
    expect(generateEmbeddings).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("chunks text using KB config and generates embeddings", async () => {
    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeSelectChain(mockKb))
      .mockReturnValueOnce(makeSelectChain(null));

    (chunkText as ReturnType<typeof vi.fn>).mockReturnValue(["chunk one", "chunk two"]);
    (generateEmbeddings as ReturnType<typeof vi.fn>).mockResolvedValue([[0.1, 0.2], [0.3, 0.4]]);

    (db.insert as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeInsertChain([{ id: 10 }]))
      .mockReturnValueOnce(makeInsertChainNoReturn())
      .mockReturnValueOnce(makeInsertChainNoReturn());

    await ingestText(1, "test.txt", "some long text content");

    expect(chunkText).toHaveBeenCalledWith(
      "some long text content",
      mockKb.chunkSize,
      mockKb.chunkOverlap,
    );
    expect(generateEmbeddings).toHaveBeenCalledWith(mockKb.embeddingModel, ["chunk one", "chunk two"]);
  });

  it("inserts a document record and returns its ID", async () => {
    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeSelectChain(mockKb))
      .mockReturnValueOnce(makeSelectChain(null));

    (chunkText as ReturnType<typeof vi.fn>).mockReturnValue(["single chunk"]);
    (generateEmbeddings as ReturnType<typeof vi.fn>).mockResolvedValue([[0.5, 0.6]]);

    (db.insert as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeInsertChain([{ id: 99 }]))
      .mockReturnValueOnce(makeInsertChainNoReturn());

    const result = await ingestText(1, "doc.txt", "content");

    expect(result).toBe(99);
  });

  it("inserts one chunk record per text chunk", async () => {
    const chunks = ["chunk a", "chunk b", "chunk c"];
    const embeddings = [[1, 0], [0, 1], [1, 1]];

    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeSelectChain(mockKb))
      .mockReturnValueOnce(makeSelectChain(null));

    (chunkText as ReturnType<typeof vi.fn>).mockReturnValue(chunks);
    (generateEmbeddings as ReturnType<typeof vi.fn>).mockResolvedValue(embeddings);

    (db.insert as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeInsertChain([{ id: 5 }]))
      .mockReturnValueOnce(makeInsertChainNoReturn())
      .mockReturnValueOnce(makeInsertChainNoReturn())
      .mockReturnValueOnce(makeInsertChainNoReturn());

    await ingestText(1, "multi.txt", "content with chunks");

    // insert called once for document + once per chunk
    expect(db.insert).toHaveBeenCalledTimes(4);
  });

  it("passes sourcePath to the document insert when provided", async () => {
    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeSelectChain(mockKb))
      .mockReturnValueOnce(makeSelectChain(null));

    (chunkText as ReturnType<typeof vi.fn>).mockReturnValue(["chunk"]);
    (generateEmbeddings as ReturnType<typeof vi.fn>).mockResolvedValue([[1]]);

    const insertMock = makeInsertChain([{ id: 7 }]);
    (db.insert as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(insertMock)
      .mockReturnValueOnce(makeInsertChainNoReturn());

    await ingestText(1, "file.txt", "text", "/absolute/path/file.txt");

    const valuesCall = insertMock.values.mock.calls[0][0] as { sourcePath: string };
    expect(valuesCall.sourcePath).toBe("/absolute/path/file.txt");
  });

  it("stores sourcePath as null when not provided", async () => {
    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeSelectChain(mockKb))
      .mockReturnValueOnce(makeSelectChain(null));

    (chunkText as ReturnType<typeof vi.fn>).mockReturnValue(["chunk"]);
    (generateEmbeddings as ReturnType<typeof vi.fn>).mockResolvedValue([[1]]);

    const insertMock = makeInsertChain([{ id: 8 }]);
    (db.insert as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(insertMock)
      .mockReturnValueOnce(makeInsertChainNoReturn());

    await ingestText(1, "file.txt", "text");

    const valuesCall = insertMock.values.mock.calls[0][0] as { sourcePath: null };
    expect(valuesCall.sourcePath).toBeNull();
  });

  it("stores embedding as JSON string in chunk record", async () => {
    const embedding = [0.1, 0.2, 0.3];

    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeSelectChain(mockKb))
      .mockReturnValueOnce(makeSelectChain(null));

    (chunkText as ReturnType<typeof vi.fn>).mockReturnValue(["content"]);
    (generateEmbeddings as ReturnType<typeof vi.fn>).mockResolvedValue([embedding]);

    const docInsert = makeInsertChain([{ id: 1 }]);
    const chunkInsert = makeInsertChainNoReturn();
    (db.insert as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(docInsert)
      .mockReturnValueOnce(chunkInsert);

    await ingestText(1, "file.txt", "content");

    const chunkValues = chunkInsert.values.mock.calls[0][0] as { embedding: string };
    expect(chunkValues.embedding).toBe(JSON.stringify(embedding));
  });

  it("stores chunk content, index, and knowledgeBaseId correctly", async () => {
    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeSelectChain(mockKb))
      .mockReturnValueOnce(makeSelectChain(null));

    (chunkText as ReturnType<typeof vi.fn>).mockReturnValue(["only chunk"]);
    (generateEmbeddings as ReturnType<typeof vi.fn>).mockResolvedValue([[0.9]]);

    const docInsert = makeInsertChain([{ id: 20 }]);
    const chunkInsert = makeInsertChainNoReturn();
    (db.insert as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(docInsert)
      .mockReturnValueOnce(chunkInsert);

    await ingestText(1, "single.txt", "text");

    const chunkValues = chunkInsert.values.mock.calls[0][0] as {
      content: string;
      chunkIndex: number;
      knowledgeBaseId: number;
      documentId: number;
    };
    expect(chunkValues.content).toBe("only chunk");
    expect(chunkValues.chunkIndex).toBe(0);
    expect(chunkValues.knowledgeBaseId).toBe(1);
    expect(chunkValues.documentId).toBe(20);
  });
});

// ── ingestFile ────────────────────────────────────────────────

describe("ingestFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when file does not exist", async () => {
    mockBunFile.mockReturnValue({
      exists: vi.fn().mockResolvedValue(false),
      text: vi.fn(),
    });

    await expect(ingestFile(1, "/not/a/real/file.txt")).rejects.toThrow(
      "File not found: /not/a/real/file.txt",
    );
  });

  it("reads file text and delegates to ingestText", async () => {
    const fileContent = "file content here";
    mockBunFile.mockReturnValue({
      exists: vi.fn().mockResolvedValue(true),
      text: vi.fn().mockResolvedValue(fileContent),
    });

    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeSelectChain(mockKb))
      .mockReturnValueOnce(makeSelectChain(null));

    (chunkText as ReturnType<typeof vi.fn>).mockReturnValue(["chunk"]);
    (generateEmbeddings as ReturnType<typeof vi.fn>).mockResolvedValue([[1]]);

    (db.insert as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeInsertChain([{ id: 55 }]))
      .mockReturnValueOnce(makeInsertChainNoReturn());

    const result = await ingestFile(1, "/some/dir/document.txt");

    expect(result).toBe(55);
    expect(chunkText).toHaveBeenCalledWith(fileContent, mockKb.chunkSize, mockKb.chunkOverlap);
  });

  it("extracts filename from Unix-style path", async () => {
    mockBunFile.mockReturnValue({
      exists: vi.fn().mockResolvedValue(true),
      text: vi.fn().mockResolvedValue("text"),
    });

    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeSelectChain(mockKb))
      .mockReturnValueOnce(makeSelectChain(null));

    (chunkText as ReturnType<typeof vi.fn>).mockReturnValue(["chunk"]);
    (generateEmbeddings as ReturnType<typeof vi.fn>).mockResolvedValue([[1]]);

    const docInsert = makeInsertChain([{ id: 3 }]);
    (db.insert as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(docInsert)
      .mockReturnValueOnce(makeInsertChainNoReturn());

    await ingestFile(1, "/path/to/report.pdf");

    const docValues = docInsert.values.mock.calls[0][0] as { filename: string };
    expect(docValues.filename).toBe("report.pdf");
  });

  it("extracts filename from Windows-style path", async () => {
    mockBunFile.mockReturnValue({
      exists: vi.fn().mockResolvedValue(true),
      text: vi.fn().mockResolvedValue("windows content"),
    });

    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeSelectChain(mockKb))
      .mockReturnValueOnce(makeSelectChain(null));

    (chunkText as ReturnType<typeof vi.fn>).mockReturnValue(["chunk"]);
    (generateEmbeddings as ReturnType<typeof vi.fn>).mockResolvedValue([[1]]);

    const docInsert = makeInsertChain([{ id: 4 }]);
    (db.insert as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(docInsert)
      .mockReturnValueOnce(makeInsertChainNoReturn());

    await ingestFile(1, "C:\\Users\\data\\notes.txt");

    const docValues = docInsert.values.mock.calls[0][0] as { filename: string };
    expect(docValues.filename).toBe("notes.txt");
  });

  it("passes the full file path as sourcePath to ingestText", async () => {
    const filePath = "/absolute/path/source.md";
    mockBunFile.mockReturnValue({
      exists: vi.fn().mockResolvedValue(true),
      text: vi.fn().mockResolvedValue("content"),
    });

    (db.select as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(makeSelectChain(mockKb))
      .mockReturnValueOnce(makeSelectChain(null));

    (chunkText as ReturnType<typeof vi.fn>).mockReturnValue(["chunk"]);
    (generateEmbeddings as ReturnType<typeof vi.fn>).mockResolvedValue([[1]]);

    const docInsert = makeInsertChain([{ id: 6 }]);
    (db.insert as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(docInsert)
      .mockReturnValueOnce(makeInsertChainNoReturn());

    await ingestFile(1, filePath);

    const docValues = docInsert.values.mock.calls[0][0] as { sourcePath: string };
    expect(docValues.sourcePath).toBe(filePath);
  });

  it("calls Bun.file with the given path", async () => {
    mockBunFile.mockReturnValue({
      exists: vi.fn().mockResolvedValue(false),
    });

    await expect(ingestFile(1, "/check/this/path.txt")).rejects.toThrow();

    expect(mockBunFile).toHaveBeenCalledWith("/check/this/path.txt");
  });

  it("does not call ingestText when file does not exist", async () => {
    mockBunFile.mockReturnValue({
      exists: vi.fn().mockResolvedValue(false),
      text: vi.fn(),
    });

    await expect(ingestFile(1, "/missing/file.txt")).rejects.toThrow("File not found");

    expect(db.select).not.toHaveBeenCalled();
  });
});
