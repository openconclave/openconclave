import { describe, test, expect, mock, beforeEach } from "bun:test";
import type { ConclaveNode } from "@openconclave/shared";

// ── DB mock — controlled per-test via tokenResult ────────────────────────────
let tokenResult: Array<{ key: string; value: string }> = [
  { key: "telegram_bot_token", value: "test-token" },
];

mock.module("../../../db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(tokenResult),
      }),
    }),
  },
}));

// ── Logger mock ───────────────────────────────────────────────────────────────
const loggerInfo = mock(() => {});
mock.module("../../../lib/logger", () => ({
  logger: { info: loggerInfo, error: mock(() => {}), debug: mock(() => {}) },
}));

// ── Global fetch mock ─────────────────────────────────────────────────────────
const fetchMock = mock(async (_url: string, _init?: RequestInit) =>
  new Response("", { status: 200 })
);
globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

// Dynamic import AFTER mocks are registered
const { executeOutput } = await import("../output");

// ── Node factories ────────────────────────────────────────────────────────────
function makeLogNode(): ConclaveNode {
  return {
    id: "out-log",
    type: "output",
    position: { x: 0, y: 0 },
    data: { label: "Output", type: "output", config: { type: "log", config: {} } },
  };
}

function makeTelegramNode(chatId = "123456789"): ConclaveNode {
  return {
    id: "out-tg",
    type: "output",
    position: { x: 0, y: 0 },
    data: {
      label: "Telegram Out",
      type: "output",
      config: { type: "telegram", chatId, config: {} },
    },
  };
}

function makeUnknownTypeNode(): ConclaveNode {
  return {
    id: "out-uk",
    type: "output",
    position: { x: 0, y: 0 },
    data: {
      label: "Unknown",
      type: "output",
      config: { type: "webhook" as any, config: {} },
    },
  };
}

const noEmit = () => {};

beforeEach(() => {
  fetchMock.mockClear();
  loggerInfo.mockClear();
  tokenResult = [{ key: "telegram_bot_token", value: "test-token" }];
});

// ── BLOCKER: JSON.stringify(undefined) crash in default ("log") branch ────────

describe("executeOutput — log branch — undefined input (BLOCKER)", () => {
  test("input === undefined resolves without throwing", async () => {
    await expect(
      executeOutput(makeLogNode(), undefined, 0, "n1", undefined, noEmit)
    ).resolves.toBeUndefined();
  });
});

// ── MINOR: JSON.stringify throws on BigInt / cyclic in "log" branch ───────────

describe("executeOutput — log branch — non-serializable inputs (MINOR)", () => {
  test("BigInt input resolves without throwing", async () => {
    const result = await executeOutput(makeLogNode(), BigInt(42), 0, "n1", undefined, noEmit);
    expect(result).toBe(BigInt(42));
  });

  test("cyclic object resolves without throwing", async () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    const result = await executeOutput(makeLogNode(), obj, 0, "n1", undefined, noEmit);
    expect(result).toBe(obj);
  });
});

// ── MINOR: default: used for "log" breaks exhaustiveness ──────────────────────

describe("executeOutput — switch exhaustiveness (MINOR)", () => {
  test("unknown output type throws instead of silently logging", async () => {
    await expect(
      executeOutput(makeUnknownTypeNode(), "data", 0, "n1", undefined, noEmit)
    ).rejects.toThrow();
  });
});

// ── BLOCKER: Telegram single-request ignores 4096-char limit ─────────────────

describe("executeOutput — Telegram — chunking (BLOCKER)", () => {
  test("text longer than 4096 chars triggers multiple fetch calls", async () => {
    const longText = "x".repeat(4097);
    await executeOutput(makeTelegramNode(), longText, 0, "n1", undefined, noEmit);
    expect(fetchMock.mock.calls.length).toBe(2);
  });

  test("each chunk body is at most 4096 chars", async () => {
    const longText = "y".repeat(9000);
    await executeOutput(makeTelegramNode(), longText, 0, "n1", undefined, noEmit);
    for (const call of fetchMock.mock.calls) {
      const body = JSON.parse((call[1] as RequestInit).body as string);
      expect(body.text.length).toBeLessThanOrEqual(4096);
    }
  });
});

// ── MINOR: fetch has no AbortSignal / timeout ─────────────────────────────────

describe("executeOutput — Telegram — fetch timeout (MINOR)", () => {
  test("each Telegram fetch call includes an AbortSignal", async () => {
    await executeOutput(makeTelegramNode(), "hello", 0, "n1", undefined, noEmit);
    expect(fetchMock.mock.calls.length).toBe(1);
    const options = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });
});

// ── MINOR: JSON.stringify throws on BigInt in Telegram branch ─────────────────

describe("executeOutput — Telegram — BigInt input (MINOR)", () => {
  test("BigInt data resolves without throwing", async () => {
    const result = await executeOutput(
      makeTelegramNode(),
      BigInt(42),
      0,
      "n1",
      undefined,
      noEmit
    );
    expect(result).toBe(BigInt(42));
  });
});
