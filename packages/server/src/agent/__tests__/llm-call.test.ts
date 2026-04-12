/**
 * Tests for llm-call.ts -- SSRF guards and OpenAI tool-argument parsing.
 */

import { describe, it, expect, mock } from "bun:test";

// -- Mock heavy dependencies before importing the module under test --

mock.module("../../db/client", () => ({
  db: {
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    select: () => ({ from: () => ({ where: () => ({ get: () => Promise.resolve(null) }) }) }),
  },
}));

mock.module("../../db/schema", () => ({
  agentTasks: {},
  settings: {},
}));

mock.module("../runtime", () => ({
  cliPath: "/mock/cli",
  buildSubprocessEnv: () => ({}),
  ALLOWED_MODELS: new Set(["sonnet", "opus", "haiku"]),
}));

import { isPublicHttpUrl, isAcceptableOllamaUrl } from "../llm-call";

// -- isPublicHttpUrl - SSRF guard --

describe("isPublicHttpUrl", () => {
  it("blocks loopback 127.0.0.1", () => {
    expect(isPublicHttpUrl("http://127.0.0.1/api")).toBe(false);
  });

  it("blocks loopback ::1", () => {
    expect(isPublicHttpUrl("http://[::1]/api")).toBe(false);
  });

  it("blocks localhost", () => {
    expect(isPublicHttpUrl("http://localhost/api")).toBe(false);
  });

  it("blocks RFC1918 10.x", () => {
    expect(isPublicHttpUrl("http://10.0.0.1/api")).toBe(false);
  });

  it("blocks RFC1918 192.168.x", () => {
    expect(isPublicHttpUrl("http://192.168.1.1/api")).toBe(false);
  });

  it("blocks RFC1918 172.16.x", () => {
    expect(isPublicHttpUrl("http://172.16.0.1/api")).toBe(false);
  });

  it("blocks RFC1918 172.31.x", () => {
    expect(isPublicHttpUrl("http://172.31.255.255/api")).toBe(false);
  });

  it("blocks link-local / IMDS 169.254.169.254", () => {
    expect(isPublicHttpUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
  });

  it("blocks IPv4-mapped IPv6 for loopback [::ffff:127.0.0.1]", () => {
    expect(isPublicHttpUrl("http://[::ffff:127.0.0.1]/api")).toBe(false);
  });

  it("blocks IPv4-mapped IPv6 for IMDS [::ffff:169.254.169.254]", () => {
    expect(isPublicHttpUrl("http://[::ffff:169.254.169.254]/meta-data")).toBe(false);
  });

  it("blocks link-local IPv6 fe80::", () => {
    expect(isPublicHttpUrl("http://[fe80::1%25eth0]/api")).toBe(false);
  });

  it("blocks file:// URLs", () => {
    expect(isPublicHttpUrl("file:///etc/passwd")).toBe(false);
  });

  it("blocks invalid URL", () => {
    expect(isPublicHttpUrl("not-a-url")).toBe(false);
  });

  it("allows a public HTTPS URL", () => {
    expect(isPublicHttpUrl("https://api.openai.com/v1")).toBe(true);
  });

  it("allows a public HTTP URL", () => {
    expect(isPublicHttpUrl("http://example.com/api")).toBe(true);
  });
});

// -- isAcceptableOllamaUrl - also allows loopback --

describe("isAcceptableOllamaUrl", () => {
  it("allows localhost (local Ollama install)", () => {
    expect(isAcceptableOllamaUrl("http://localhost:11434")).toBe(true);
  });

  it("allows 127.0.0.1 (local Ollama install)", () => {
    expect(isAcceptableOllamaUrl("http://127.0.0.1:11434")).toBe(true);
  });

  it("allows ::1 (local Ollama install)", () => {
    expect(isAcceptableOllamaUrl("http://[::1]:11434")).toBe(true);
  });

  it("blocks RFC1918 address", () => {
    expect(isAcceptableOllamaUrl("http://192.168.1.5:11434")).toBe(false);
  });

  it("blocks IMDS address", () => {
    expect(isAcceptableOllamaUrl("http://169.254.169.254/ollama")).toBe(false);
  });

  it("blocks file:// URLs", () => {
    expect(isAcceptableOllamaUrl("file:///etc/passwd")).toBe(false);
  });

  it("allows a public HTTPS Ollama endpoint", () => {
    expect(isAcceptableOllamaUrl("https://my-ollama.example.com")).toBe(true);
  });
});

// -- OpenAI malformed JSON tool arguments --

describe("invokeWithTools -- OpenAI malformed tool arguments", () => {
  it("throws with tool name in error when OpenAI returns unparseable arguments", async () => {
    const providerJson = JSON.stringify({ baseUrl: "https://api.openai.com/v1", apiKey: "sk-test" });

    mock.module("../../db/client", () => ({
      db: {
        insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: 42 }]) }) }),
        update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
        select: () => ({
          from: () => ({
            where: () => ({ get: () => Promise.resolve({ key: "provider:p1", value: providerJson }) }),
          }),
        }),
      },
    }));

    (globalThis as Record<string, unknown>).fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      function: {
                        name: "route_to_node",
                        arguments: "{ truncated",
                      },
                    },
                  ],
                },
              },
            ],
          }),
        text: () => Promise.resolve(""),
      }),
    );

    const { invokeWithTools } = await import("../llm-call");
    const emit = mock(() => {});

    await expect(
      invokeWithTools({
        engine: "openai",
        config: { providerId: "p1", openaiModel: "gpt-4o" } as never,
        prompt: "pick a route",
        tools: [{ name: "route_to_node", description: "route", input_schema: { type: "object", properties: {} } }],
        runId: 1,
        nodeId: "n1",
        emit,
      }),
    ).rejects.toThrow("route_to_node");
  });
});
