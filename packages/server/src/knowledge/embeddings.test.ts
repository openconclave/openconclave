import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.mock("../lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { generateEmbedding, generateEmbeddings } from "./embeddings";

// ── Mock fetch globally ──────────────────────────────────────

const originalFetch = globalThis.fetch;
const mockFetch = vi.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

afterAll(() => {
  globalThis.fetch = originalFetch;
});

// ── helpers ──────────────────────────────────────────────────

function makeOkResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(""),
  } as unknown as Response;
}

function makeErrorResponse(status: number, errorText: string): Response {
  return {
    ok: false,
    status,
    json: vi.fn(),
    text: vi.fn().mockResolvedValue(errorText),
  } as unknown as Response;
}

// ── generateEmbedding ─────────────────────────────────────────

describe("generateEmbedding", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns the first embedding vector from a successful Ollama response", async () => {
    const embedding = [0.1, 0.2, 0.3, 0.4];
    mockFetch.mockResolvedValue(makeOkResponse({ embeddings: [embedding] }));

    const result = await generateEmbedding("nomic-embed-text", "hello world");

    expect(result).toEqual(embedding);
  });

  it("POSTs to /api/embed with correct body", async () => {
    mockFetch.mockResolvedValue(makeOkResponse({ embeddings: [[1, 2, 3]] }));

    await generateEmbedding("my-model", "test input");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/embed");
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body as string) as { model: string; input: string };
    expect(body.model).toBe("my-model");
    expect(body.input).toBe("test input");
  });

  it("sends Content-Type: application/json header", async () => {
    mockFetch.mockResolvedValue(makeOkResponse({ embeddings: [[1]] }));

    await generateEmbedding("model", "text");

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("throws with status code when Ollama returns a non-ok response", async () => {
    mockFetch.mockResolvedValue(makeErrorResponse(503, "Service Unavailable"));

    await expect(generateEmbedding("model", "text")).rejects.toThrow("503");
  });

  it("includes error text in the thrown error message", async () => {
    mockFetch.mockResolvedValue(makeErrorResponse(400, "model not found"));

    await expect(generateEmbedding("bad-model", "text")).rejects.toThrow("model not found");
  });

  it("throws when Ollama returns an empty embeddings array", async () => {
    mockFetch.mockResolvedValue(makeOkResponse({ embeddings: [] }));

    await expect(generateEmbedding("model", "text")).rejects.toThrow(
      "Ollama returned no embeddings",
    );
  });

  it("throws when embeddings field is missing from response", async () => {
    mockFetch.mockResolvedValue(makeOkResponse({}));

    await expect(generateEmbedding("model", "text")).rejects.toThrow(
      "Ollama returned no embeddings",
    );
  });

  it("calls the Ollama embed endpoint URL", async () => {
    mockFetch.mockResolvedValue(makeOkResponse({ embeddings: [[1, 2]] }));

    await generateEmbedding("model", "text");
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("/api/embed");
  });
});

// ── generateEmbeddings ────────────────────────────────────────

describe("generateEmbeddings", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns empty array immediately for empty input texts", async () => {
    const result = await generateEmbeddings("model", []);
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns correct number of embeddings for a batch", async () => {
    const embeddings = [
      [0.1, 0.2],
      [0.3, 0.4],
      [0.5, 0.6],
    ];
    mockFetch.mockResolvedValue(makeOkResponse({ embeddings }));

    const result = await generateEmbeddings("model", ["text1", "text2", "text3"]);

    expect(result).toHaveLength(3);
    expect(result).toEqual(embeddings);
  });

  it("sends all texts in a single batch request", async () => {
    const texts = ["alpha", "beta", "gamma"];
    mockFetch.mockResolvedValue(makeOkResponse({ embeddings: [[1], [2], [3]] }));

    await generateEmbeddings("batch-model", texts);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as { model: string; input: string[] };
    expect(body.input).toEqual(texts);
    expect(body.model).toBe("batch-model");
  });

  it("throws when API returns non-ok status", async () => {
    mockFetch.mockResolvedValue(makeErrorResponse(500, "Internal Server Error"));

    await expect(generateEmbeddings("model", ["text"])).rejects.toThrow("500");
  });

  it("throws when returned embedding count does not match input count", async () => {
    mockFetch.mockResolvedValue(makeOkResponse({ embeddings: [[1, 2], [3, 4]] }));

    await expect(
      generateEmbeddings("model", ["a", "b", "c"]),
    ).rejects.toThrow("Expected 3 embeddings, got 2");
  });

  it("throws when embeddings field is missing from response", async () => {
    mockFetch.mockResolvedValue(makeOkResponse({}));

    await expect(generateEmbeddings("model", ["a"])).rejects.toThrow(
      "Expected 1 embeddings, got 0",
    );
  });

  it("returns embeddings in the same order as input texts", async () => {
    const embeddings = [[1, 0], [0, 1], [1, 1]];
    mockFetch.mockResolvedValue(makeOkResponse({ embeddings }));

    const result = await generateEmbeddings("model", ["first", "second", "third"]);

    expect(result[0]).toEqual([1, 0]);
    expect(result[1]).toEqual([0, 1]);
    expect(result[2]).toEqual([1, 1]);
  });

  it("handles single-text batch correctly", async () => {
    mockFetch.mockResolvedValue(makeOkResponse({ embeddings: [[0.5, 0.5]] }));

    const result = await generateEmbeddings("model", ["only one"]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual([0.5, 0.5]);
  });
});
