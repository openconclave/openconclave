import { describe, test, expect, beforeEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Hono } from "hono";
import { errorHandler } from "../../lib/errors";

// TEST_LIMITATION: routes/settings.ts loads the singleton db client at module
// import time; mock.module replaces it with this in-memory instance.
const sqlite = new Database(":memory:");
sqlite.exec(
  `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`,
);

const testDb = drizzle(sqlite);
mock.module("../../db/client", () => ({ db: testDb }));

// listOpenAIModels is hoisted to a static import in settings.ts; stub it so
// loading settings.ts doesn't pull the full openai chat/responses graph.
mock.module("../../agent/openai", () => ({
  listOpenAIModels: async () => ["model-a", "model-b"],
}));

mock.module("../../agent/ollama", () => ({
  checkOllama: async () => ({ running: false }),
}));

const { settingsRoutes, providerRoutes } = await import("../settings");

const app = new Hono();
app.onError(errorHandler);
app.route("/settings", settingsRoutes);
app.route("/providers", providerRoutes);

beforeEach(() => {
  sqlite.exec("DELETE FROM settings");
});

function insertProviderRow(id: string, value: string) {
  const now = new Date().toISOString();
  sqlite.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)`,
    [`provider:${id}`, value, now],
  );
}

// ── MAJOR: PUT /settings uses zValidator (rejects non-string values) ─────────

describe("PUT /settings — zod-validated body", () => {
  test("rejects body whose values are not strings with 400", async () => {
    const res = await app.request("/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onboarding_completed: true }),
    });
    expect(res.status).toBe(400);
  });

  test("accepts string-valued body", async () => {
    const res = await app.request("/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onboarding_completed: "true" }),
    });
    expect(res.status).toBe(200);
  });
});

// ── MAJOR: POST /providers uses zValidator ──────────────────────────────────

describe("POST /providers — zod-validated body", () => {
  test("rejects non-string id with 400", async () => {
    const res = await app.request("/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: 123, name: "X", baseUrl: "https://x", apiKey: "k" }),
    });
    expect(res.status).toBe(400);
  });

  test("rejects missing baseUrl with 400", async () => {
    const res = await app.request("/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "p1", name: "P1", apiKey: "k" }),
    });
    expect(res.status).toBe(400);
  });
});

// ── MINOR: empty stored apiKey on update is rejected ────────────────────────

describe("POST /providers — empty stored apiKey doesn't silently persist", () => {
  test("returns 400 when apiKey is omitted and the existing record stores an empty key", async () => {
    insertProviderRow(
      "p-empty",
      JSON.stringify({
        id: "p-empty",
        name: "Old",
        baseUrl: "https://old",
        apiKey: "",
        apiType: "chat",
        supportsModelList: false,
      }),
    );

    const res = await app.request("/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "p-empty", name: "New", baseUrl: "https://new" }),
    });

    expect(res.status).toBe(400);
    const stored = sqlite
      .query<{ value: string }, [string]>(`SELECT value FROM settings WHERE key = ?`)
      .get("provider:p-empty");
    const parsed = JSON.parse(stored!.value);
    expect(parsed.name).toBe("Old");
  });

  test("preserves a non-empty stored key when apiKey is omitted", async () => {
    insertProviderRow(
      "p-ok",
      JSON.stringify({
        id: "p-ok",
        name: "Old",
        baseUrl: "https://old",
        apiKey: "secret-123",
        apiType: "chat",
        supportsModelList: false,
      }),
    );

    const res = await app.request("/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "p-ok", name: "Renamed", baseUrl: "https://new" }),
    });

    expect(res.status).toBe(200);
    const stored = sqlite
      .query<{ value: string }, [string]>(`SELECT value FROM settings WHERE key = ?`)
      .get("provider:p-ok");
    const parsed = JSON.parse(stored!.value);
    expect(parsed.apiKey).toBe("secret-123");
    expect(parsed.name).toBe("Renamed");
  });
});

// ── NIT (behavioral): GET /providers tolerates a single malformed row ───────

describe("GET /providers — malformed row doesn't break the list", () => {
  test("skips rows that fail JSON.parse and still returns healthy ones", async () => {
    insertProviderRow("good", JSON.stringify({ id: "good", name: "Good", baseUrl: "https://g", apiKey: "k" }));
    insertProviderRow("bad", "{not valid json");

    const res = await app.request("/providers");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { providers: Array<{ id: string }> };
    const ids = body.providers.map((p) => p.id);
    expect(ids).toContain("good");
    expect(ids).not.toContain("bad");
  });
});

// ── NIT: dynamic import hoisted (sanity — models route loads with stub) ─────

describe("GET /providers/:id/models", () => {
  test("uses the statically imported listOpenAIModels", async () => {
    insertProviderRow("m1", JSON.stringify({ id: "m1", name: "M", baseUrl: "https://m", apiKey: "k" }));
    const res = await app.request("/providers/m1/models");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: string[] };
    expect(body.models).toEqual(["model-a", "model-b"]);
  });
});

// ── MINOR: claude-code /status drains stderr + gates on exit code ───────────

describe("claudeCodeRoutes /status — patches landed", () => {
  // TEST_LIMITATION: Bun.spawn is non-trivial to mock and the test machine has no
  // controllable `claude` binary; assert the source contains the drain + exit-code
  // guards so a regression that re-introduces "stderr: pipe" without a reader, or
  // drops the exit-code check, is caught.
  test("source uses stderr: ignore and gates installed on exitCode", async () => {
    const src = await Bun.file(`${import.meta.dir}/../settings.ts`).text();
    expect(src).toContain('stderr: "ignore"');
    expect(src).toMatch(/exitCode\s*!==\s*0/);
  });
});
