import { test, expect, describe, mock, beforeEach } from "bun:test";
import { Hono } from "hono";

// ── Mutable state reset per test ──────────────────────────────
interface MockEntry {
  id: string;
  title: string;
  description: string;
  path: string;
  definitionUrl: string;
  imageUrl: null;
}
interface MockIndex {
  entries: MockEntry[];
  fetchedAt: number;
  error: string | null;
}

const STARTER: MockEntry = {
  id: "starter-1",
  title: "Test",
  description: "Test",
  path: "test.json",
  definitionUrl: "https://example.com/test.json",
  imageUrl: null,
};

let mockIndex: MockIndex = { entries: [STARTER], fetchedAt: Date.now(), error: null };
let mockDefinition: unknown = { name: "Test Conclave", nodes: [], edges: [] };
let fetchDefinitionShouldThrow = false;
let fetchDefinitionError = "connection refused";

// ── DB mock ───────────────────────────────────────────────────
const makeInsertChain = () => {
  const result = [{ id: 42 }];
  const returningChain = Object.assign(Promise.resolve(result), { all: () => result });
  return { values: () => ({ returning: () => returningChain }) };
};

const makeUpdateChain = () => ({
  set: () => ({
    where: () => Object.assign(Promise.resolve(undefined), { run: () => undefined }),
  }),
});

const transactionMock = mock((fn: (tx: unknown) => unknown) =>
  fn({ insert: () => makeInsertChain(), update: () => makeUpdateChain() }),
);

mock.module("../../db/client", () => ({
  db: {
    transaction: transactionMock,
    // present for pre-fix code that calls db.insert / db.update directly
    insert: () => makeInsertChain(),
    update: () => makeUpdateChain(),
  },
}));

// ── Marketplace mocks ─────────────────────────────────────────
const getMarketplaceIndexMock = mock(async () => mockIndex);
const getEntryByIdMock = mock(async (id: string) =>
  mockIndex.entries.find((e) => e.id === id) ?? null,
);
const fetchDefinitionMock = mock(async () => {
  if (fetchDefinitionShouldThrow) throw new Error(fetchDefinitionError);
  return mockDefinition;
});

mock.module("../../marketplace", () => ({
  getMarketplaceIndex: getMarketplaceIndexMock,
  getEntryById: getEntryByIdMock,
  fetchDefinition: fetchDefinitionMock,
}));

// Dynamic import AFTER mocks are in place
const { marketplaceRoutes } = await import("../../routes/marketplace");
const { errorHandler } = await import("../../lib/errors");
const app = new Hono();
app.onError(errorHandler);
app.route("/", marketplaceRoutes);

function postImport(id: string) {
  return app.request(`/${id}/import`, { method: "POST" });
}

beforeEach(() => {
  transactionMock.mockClear();
  getMarketplaceIndexMock.mockClear();
  getEntryByIdMock.mockClear();
  fetchDefinitionMock.mockClear();
  fetchDefinitionShouldThrow = false;
  fetchDefinitionError = "connection refused";
  mockIndex = { entries: [STARTER], fetchedAt: Date.now(), error: null };
  mockDefinition = { name: "Test Conclave", nodes: [], edges: [] };
});

// ── MAJOR: import is wrapped in db.transaction ────────────────
// TEST_LIMITATION: rollback on mid-write crash requires a live SQLite DB;
// this test only verifies that db.transaction() is invoked.
describe("POST /:id/import — transaction safety", () => {
  test("db.transaction is called for the insert+update pair", async () => {
    const res = await postImport("starter-1");
    expect(res.status).toBe(200);
    expect(transactionMock).toHaveBeenCalled();
  });
});

// ── MAJOR: error responses use AppError envelope ─────────────
describe("POST /:id/import — AppError envelope", () => {
  test("unknown starter id returns AppError shape, not { ok: false }", async () => {
    const res = await postImport("unknown-id");
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(404);
    expect(body.ok).toBeUndefined();
    expect((body.error as Record<string, unknown>).code).toBe("NOT_FOUND");
  });

  test("invalid definition returns AppError shape, not { ok: false }", async () => {
    mockDefinition = { name: 123, nodes: [], edges: [] }; // name must be string
    const res = await postImport("starter-1");
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(400);
    expect(body.ok).toBeUndefined();
    expect((body.error as Record<string, unknown>).code).toBe("VALIDATION");
  });
});

// ── MINOR: knowledge tool guard ───────────────────────────────
describe("POST /:id/import — knowledge tool rejection", () => {
  test("rejects 400 when an agent node carries a knowledge tool", async () => {
    mockDefinition = {
      name: "KB Starter",
      nodes: [
        {
          id: "n1",
          type: "agent",
          position: { x: 0, y: 0 },
          data: {
            label: "Agent",
            type: "agent",
            config: {
              tools: [{ toolType: "knowledge", toolId: "5", toolName: "My KB" }],
            },
          },
        },
      ],
      edges: [],
    };
    const res = await postImport("starter-1");
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(res.status).toBe(400);
    expect(body.error.message).toContain("knowledge");
  });
});

// ── MINOR: cached index error is not masked as 404 ────────────
describe("POST /:id/import — cached index error", () => {
  test("returns non-404 when the index cache holds an error", async () => {
    mockIndex = { entries: [], fetchedAt: Date.now(), error: "network timeout" };
    const res = await postImport("starter-1");
    // Before fix: getEntryById returns null → 404 "Unknown starter"
    // After fix: index.error is surfaced → 5xx, not a misleading 404
    expect(res.status).not.toBe(404);
  });
});
