import { vi } from "vitest";

// Mock @openconclave/shared constants FIRST so normalize-workflow can import it
vi.mock("@openconclave/shared/src/constants", () => ({
  NODE_TYPE_ALIASES: {},
}), { virtual: true });

// Mock bun packages globally for all tests
vi.mock("bun:sqlite", () => {
  class MockDatabase {
    exec() {}
    prepare() { return { all: () => [], run: () => {}, get: () => null }; }
    transaction() {}
    close() {}
  }
  return {
    Database: MockDatabase,
  };
}, { virtual: true });

vi.mock("bun", () => ({
  spawn: vi.fn(),
  file: vi.fn(),
  write: vi.fn(),
  read: vi.fn(),
  stdin: { pipe: vi.fn() },
  stdout: { pipe: vi.fn() },
  stderr: { pipe: vi.fn() },
}), { virtual: true });

vi.mock("drizzle-orm/bun-sqlite", () => ({
  drizzle: vi.fn((db) => db),
}), { virtual: true });

// Mock global Bun API
(global as any).Bun = {
  which: vi.fn(() => null),
  env: {},
  spawn: vi.fn(),
  file: vi.fn(),
  write: vi.fn(),
  read: vi.fn(),
};
