/**
 * TDD (RED phase) — app.tsx routing acceptance criteria.
 *
 * AC: getPage() maps paths correctly:
 *   - /knowledge       → KnowledgePage  (no regression)
 *   - /knowledge/123   → KnowledgeDetailPage  (new route)
 *   - /knowledge/abc   → KnowledgeDetailPage  (any sub-path)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Stub heavy leaf pages so getPage() can be imported without side effects ───
vi.mock("@/pages/dashboard", () => ({ DashboardPage: () => null }));
vi.mock("@/pages/conclaves", () => ({ ConclavesPage: () => null }));
vi.mock("@/pages/conclave-editor", () => ({ ConclaveEditorPage: () => null }));
vi.mock("@/pages/runs", () => ({ RunsPage: () => null }));
vi.mock("@/pages/run-detail", () => ({ RunDetailPage: () => null }));
vi.mock("@/pages/settings", () => ({ SettingsPage: () => null }));
vi.mock("@/pages/chat", () => ({ ChatPage: () => null }));
vi.mock("@/pages/knowledge", () => ({ KnowledgePage: () => null }));
vi.mock("@/pages/knowledge-detail", () => ({ KnowledgeDetailPage: () => null }));
vi.mock("@/pages/onboarding", () => ({ OnboardingPage: () => null }));
vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import { getPage } from "@/app";
import React from "react";

function setPath(pathname: string) {
  Object.defineProperty(window, "location", {
    writable: true,
    value: { ...window.location, pathname },
  });
}

describe("app.tsx routing", () => {
  it("routes /knowledge to KnowledgePage (no regression)", () => {
    setPath("/knowledge");
    const element = getPage();
    // KnowledgePage is mocked to () => null; verify the type matches
    expect(React.isValidElement(element)).toBe(true);
    // @ts-expect-error — type prop not typed on JSX.Element
    expect(element.type.name).toBe("KnowledgePage");
  });

  it("routes /knowledge/123 to KnowledgeDetailPage", () => {
    setPath("/knowledge/123");
    const element = getPage();
    expect(React.isValidElement(element)).toBe(true);
    // @ts-expect-error — type prop not typed on JSX.Element
    expect(element.type.name).toBe("KnowledgeDetailPage");
  });

  it("routes /knowledge/abc to KnowledgeDetailPage", () => {
    setPath("/knowledge/abc");
    const element = getPage();
    expect(React.isValidElement(element)).toBe(true);
    // @ts-expect-error — type prop not typed on JSX.Element
    expect(element.type.name).toBe("KnowledgeDetailPage");
  });
});
