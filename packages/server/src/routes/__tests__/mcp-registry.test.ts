import { test, expect, describe, mock, jest, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";

// ── setInterval capture (must run before module import) ───────
// Captures the module-level sweep callback so tests can invoke it directly.
// TEST_LIMITATION: The module-level cache Map is unexported; we verify sweep
// registration structurally and invoke the callback to assert eviction logic.
const CACHE_TTL_MS = 5 * 60 * 1000;
const origSetInterval = globalThis.setInterval;
let registeredSweepFn: (() => void) | undefined;
(globalThis as Record<string, unknown>).setInterval = (fn: unknown, ms?: unknown): unknown => {
  if (typeof fn === "function" && ms === CACHE_TTL_MS) {
    registeredSweepFn = fn as () => void;
  }
  return origSetInterval(fn as TimerHandler, ms as number);
};

// ── Logger mock (before module import) ────────────────────────
mock.module("../../lib/logger", () => ({
  logger: {
    error: mock(() => undefined),
    info: mock(() => undefined),
    warn: mock(() => undefined),
  },
}));

// ── Module import ─────────────────────────────────────────────
const { mcpRegistryRoutes } = await import("../../routes/mcp-registry");
(globalThis as Record<string, unknown>).setInterval = origSetInterval;

const app = new Hono();
app.route("/", mcpRegistryRoutes);

// ── Fetch mock helpers ────────────────────────────────────────

let origFetch: typeof globalThis.fetch;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setFetch(impl: (...args: any[]) => unknown): void {
  globalThis.fetch = impl as typeof fetch;
}

function restoreFetch(): void {
  globalThis.fetch = origFetch;
}

// ── Test-data helpers ─────────────────────────────────────────

function okSearchResponse(servers: unknown[] = []): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ servers, metadata: { count: servers.length } }),
    text: async () => "",
  } as unknown as Response;
}

function makeServerEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    server: {
      name: "io.github.test/server",
      title: "Test Server",
      description: "A test server",
      packages: [
        { registryType: "npm", identifier: "@test/server", transport: { type: "stdio" } },
      ],
      ...overrides,
    },
  };
}

// ── MAJOR: AbortSignal.timeout passed to fetch ────────────────

describe("GET /search — AbortSignal.timeout is passed to fetch", () => {
  beforeEach(() => { origFetch = globalThis.fetch; });
  afterEach(() => { restoreFetch(); });

  test("signal is present in the RequestInit handed to fetch", async () => {
    let capturedSignal: unknown = undefined;
    setFetch(async (_url: unknown, init?: RequestInit) => {
      capturedSignal = init?.signal;
      return okSearchResponse();
    });
    await app.request("/search?q=timeout-signal-search-unique");
    expect(capturedSignal).toBeDefined();
  });
});

describe("GET /server/:name — AbortSignal.timeout is passed to fetch", () => {
  beforeEach(() => { origFetch = globalThis.fetch; });
  afterEach(() => { restoreFetch(); });

  test("signal is present in the RequestInit handed to fetch", async () => {
    let capturedSignal: unknown = undefined;
    setFetch(async (_url: unknown, init?: RequestInit) => {
      capturedSignal = init?.signal;
      return {
        ok: true,
        status: 200,
        json: async () => makeServerEntry(),
        text: async () => "",
      } as unknown as Response;
    });
    await app.request("/server/io.github.test%2Fsignal-detail-unique");
    expect(capturedSignal).toBeDefined();
  });
});

// ── MAJOR: malformed entry is filtered, not a crash ───────────

describe("GET /search — malformed registry entry is filtered without crashing", () => {
  beforeEach(() => { origFetch = globalThis.fetch; });
  afterEach(() => { restoreFetch(); });

  test("entry with absent name returns 200 with that entry filtered out (not 502)", async () => {
    setFetch(async () => okSearchResponse([
      { server: { packages: [{ transport: { type: "stdio" }, registryType: "npm", identifier: "@bad/no-name" }] } },
      makeServerEntry(),
    ]));
    const res = await app.request("/search?q=malformed-absent-name-unique");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { servers: Array<{ name: string }> };
    expect(body.servers).toHaveLength(1);
    expect(body.servers[0]!.name).toBe("io.github.test/server");
  });

  test("entry with null name is silently filtered without throwing", async () => {
    setFetch(async () => okSearchResponse([
      { server: { name: null, packages: [{ transport: { type: "stdio" }, registryType: "npm", identifier: "@null/name" }] } },
    ]));
    const res = await app.request("/search?q=malformed-null-name-unique");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { servers: unknown[] };
    expect(body.servers).toHaveLength(0);
  });
});

// ── MINOR: limit parameter validation ────────────────────────

describe("GET /search — limit parameter clamping and validation", () => {
  beforeEach(() => { origFetch = globalThis.fetch; });
  afterEach(() => { restoreFetch(); });

  test("non-numeric limit falls back to default 30", async () => {
    let capturedUrl = "";
    setFetch(async (url: unknown) => {
      capturedUrl = url as string;
      return okSearchResponse();
    });
    await app.request("/search?q=limit-nan-unique&limit=abc");
    const sentLimit = new URL(capturedUrl).searchParams.get("limit");
    expect(Number.isNaN(Number(sentLimit))).toBe(false);
    expect(Number(sentLimit)).toBe(30);
  });

  test("negative limit is clamped to at least 1", async () => {
    let capturedUrl = "";
    setFetch(async (url: unknown) => {
      capturedUrl = url as string;
      return okSearchResponse();
    });
    await app.request("/search?q=limit-negative-unique&limit=-5");
    const sentLimit = Number(new URL(capturedUrl).searchParams.get("limit"));
    expect(sentLimit).toBeGreaterThanOrEqual(1);
  });

  test("limit above 100 is clamped to 100", async () => {
    let capturedUrl = "";
    setFetch(async (url: unknown) => {
      capturedUrl = url as string;
      return okSearchResponse();
    });
    await app.request("/search?q=limit-overlarge-unique&limit=200");
    const sentLimit = Number(new URL(capturedUrl).searchParams.get("limit"));
    expect(sentLimit).toBeLessThanOrEqual(100);
  });
});

// ── MINOR: cache — periodic sweep is registered ───────────────
// TEST_LIMITATION: The module-level cache Map is unexported; we cannot directly
// assert entry counts. We verify (1) setInterval is registered at module-load time
// and (2) the captured sweep callback removes entries whose expiry has passed.

describe("cache — periodic sweep registration and eviction", () => {
  beforeEach(() => { origFetch = globalThis.fetch; });
  afterEach(() => {
    restoreFetch();
    jest.useRealTimers();
  });

  test("setInterval is registered during module initialization", () => {
    expect(registeredSweepFn).toBeDefined();
  });

  test("sweep callback evicts cache entries where Date.now() exceeds expiry", async () => {
    if (!registeredSweepFn) throw new Error("registeredSweepFn not set — was the sweep registered?");

    let callCount = 0;
    setFetch(async () => { callCount++; return okSearchResponse(); });

    await app.request("/search?q=__sweep-eviction-unique__");
    expect(callCount).toBe(1);

    const capturedNow = Date.now();
    jest.setSystemTime(capturedNow + CACHE_TTL_MS + 1);
    registeredSweepFn();
    jest.useRealTimers();

    await app.request("/search?q=__sweep-eviction-unique__");
    expect(callCount).toBe(2);
  });
});

// ── MINOR: non-stdio package fallback removed ─────────────────

describe("GET /server/:name — HTTP-only server has no package in launchConfig", () => {
  beforeEach(() => { origFetch = globalThis.fetch; });
  afterEach(() => { restoreFetch(); });

  test("when only a non-stdio package exists, launchConfig.package is absent", async () => {
    setFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        server: {
          name: "io.github.test/http-only-unique",
          packages: [
            { transport: { type: "http" }, registryType: "npm", identifier: "@test/http-only" },
          ],
          remotes: [{ type: "streamable-http", url: "https://example.com/mcp" }],
        },
      }),
      text: async () => "",
    } as unknown as Response));
    const res = await app.request("/server/io.github.test%2Fhttp-only-unique");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { launchConfig: { package?: unknown } };
    expect(body.launchConfig.package).toBeUndefined();
  });
});

// ── MINOR: non-array registry fields are dropped, not crashed ─

describe("GET /search — non-array environmentVariables / packageArguments are dropped", () => {
  beforeEach(() => { origFetch = globalThis.fetch; });
  afterEach(() => { restoreFetch(); });

  test("string environmentVariables is silently dropped", async () => {
    setFetch(async () => okSearchResponse([
      {
        server: {
          name: "io.github.test/bad-env-unique",
          packages: [{
            transport: { type: "stdio" },
            registryType: "npm",
            identifier: "@test/bad-env",
            environmentVariables: "not-an-array",
          }],
        },
      },
    ]));
    const res = await app.request("/search?q=bad-env-unique");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      servers: Array<{ launchConfig: { package?: { environmentVariables?: unknown } } }>;
    };
    expect(body.servers).toHaveLength(1);
    expect(body.servers[0]!.launchConfig.package?.environmentVariables).toBeUndefined();
  });

  test("object packageArguments is silently dropped", async () => {
    setFetch(async () => okSearchResponse([
      {
        server: {
          name: "io.github.test/bad-args-unique",
          packages: [{
            transport: { type: "stdio" },
            registryType: "npm",
            identifier: "@test/bad-args",
            packageArguments: { foo: "bar" },
          }],
        },
      },
    ]));
    const res = await app.request("/search?q=bad-args-unique");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      servers: Array<{ launchConfig: { package?: { packageArguments?: unknown } } }>;
    };
    expect(body.servers).toHaveLength(1);
    expect(body.servers[0]!.launchConfig.package?.packageArguments).toBeUndefined();
  });
});
