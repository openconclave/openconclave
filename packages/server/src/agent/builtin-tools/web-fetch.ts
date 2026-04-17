import { webFetch, formatFetchResult } from "../web-fetch";
import type { BuiltinTool } from "./types";

export function buildWebFetchTool(runId: number): Record<string, BuiltinTool> {
  return {
    web_fetch: {
      tool: {
        type: "function",
        function: {
          name: "web_fetch",
          description:
            "Fetch a URL with a real headless browser (handles JavaScript and SPAs), extract the main content as Markdown, and save it to this run's attachments folder. Returns a short status with the saved filename — the page content does NOT come back inline. Use list_attachments to see saved files; read_attachment or grep_attachment to read them. Repeated calls for the same URL within a run reuse the first fetch's saved file.",
          parameters: {
            type: "object",
            required: ["url"],
            properties: {
              url: { type: "string", description: "Absolute http(s) URL to fetch" },
            },
          },
        },
      },
      execute: async (args) => {
        try {
          const url = String(args.url ?? "");
          if (!url) return "Error: url is required";
          const result = await webFetch(runId, url);
          return formatFetchResult(result);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return `Error fetching URL: ${msg}`;
        }
      },
    },
  };
}
