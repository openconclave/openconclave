#!/usr/bin/env node
/**
 * openconclave-web-fetch-mcp
 *
 * MCP stdio server exposing one tool: web_fetch(url, maxBytes?) → Markdown.
 * See lib.ts for the fetch+extract logic.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { fetchAndExtract, DEFAULT_MAX_BYTES, closeBrowser } from "./lib";

const server = new McpServer({ name: "openconclave-web-fetch", version: "0.1.0" });

server.registerTool(
  "web_fetch",
  {
    title: "Fetch a URL and return its main content as Markdown",
    description: [
      "Fetches a URL with a real headless browser (handles JavaScript and SPAs), extracts the main article via Mozilla Readability, and returns Markdown.",
      "Returns ~5–15 KB of clean text per typical page, truncated at maxBytes (default 100000).",
      "Blocks localhost and private IP ranges for safety.",
      "Use for reading articles, blog posts, docs, landing pages. For interactive flows (clicks, forms, auth), use playwright-mcp instead.",
    ].join(" "),
    inputSchema: {
      url: z.string().url().describe("Absolute http(s) URL to fetch"),
      maxBytes: z.number().int().positive().max(500_000).optional().describe("Max bytes of Markdown to return (default 100000)"),
    },
  },
  async ({ url, maxBytes }) => {
    try {
      const text = await fetchAndExtract(url, maxBytes ?? DEFAULT_MAX_BYTES);
      return { content: [{ type: "text" as const, text }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
    }
  },
);

process.on("SIGINT", async () => {
  await closeBrowser();
  process.exit(0);
});

const transport = new StdioServerTransport();
await server.connect(transport);
