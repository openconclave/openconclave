import { searchWeb } from "../../web-search/search";
import type { SearchResult } from "../../web-search/types";
import type { BuiltinTool } from "./types";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

export function buildWebSearchTool(): Record<string, BuiltinTool> {
  return {
    web_search: {
      tool: {
        type: "function",
        function: {
          name: "web_search",
          description:
            "Search the web and return a ranked list of matching pages with short snippets. Use this to DISCOVER URLs and get quick context; use `web_fetch` afterwards to read a specific page in full. Results come back inline as markdown — no attachments. Default 5 results, cap 10.",
          parameters: {
            type: "object",
            required: ["query"],
            properties: {
              query: {
                type: "string",
                description: "What to search for. Be specific — search engines reward focused queries.",
              },
              limit: {
                type: "number",
                description: `How many results to return (1–${MAX_LIMIT}, default ${DEFAULT_LIMIT}).`,
              },
              language: {
                type: "string",
                description: "Language hint like 'en', 'de', 'ja'. Default 'en'.",
              },
            },
          },
        },
      },
      execute: async (args) => {
        const query = String(args.query ?? "").trim();
        if (!query) return "Error: query is required";

        const limit = clampLimit(args.limit);
        const language = String(args.language ?? "en");

        try {
          const response = await searchWeb(query, { limit, language });
          return formatResults(query, response.results, response.provider, response.tookMs, response.engines);
        } catch (err) {
          return formatError(err, query);
        }
      },
    },
  };
}

function clampLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(n)));
}

function formatResults(
  query: string,
  results: SearchResult[],
  provider: string,
  tookMs: number,
  engines?: string[],
): string {
  if (results.length === 0) {
    return `No results for "${query}" (via ${provider}, ${tookMs}ms). Try a different query.`;
  }
  const head = `Found ${results.length} result${results.length === 1 ? "" : "s"} for "${query}" — ${provider}, ${tookMs}ms${engines && engines.length > 0 ? ` via ${engines.slice(0, 3).join(", ")}` : ""}.\n\n`;
  const body = results
    .map((r, i) => {
      const lines = [`${i + 1}. **${r.title || "(untitled)"}**`, `   ${r.url}`];
      if (r.snippet) lines.push(`   ${r.snippet}`);
      if (r.publishedDate) lines.push(`   _${r.publishedDate}_`);
      return lines.join("\n");
    })
    .join("\n\n");
  return head + body;
}

function formatError(err: unknown, query: string): string {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  const code = extractCode(err);

  if (message.includes("not configured")) {
    return "Web search is not configured. Open Settings → Web search, pick a provider, and save.";
  }
  if (code === "ECONNREFUSED" || lower.includes("econnrefused") || lower.includes("connection refused")) {
    return `Web search failed: the search endpoint refused the connection. If you're using SearXNG, check that Docker Desktop is running and the container is up — try 'docker start searxng'. Query was: "${query}"`;
  }
  if (code === "ENOTFOUND" || lower.includes("enotfound") || lower.includes("getaddrinfo")) {
    return `Web search failed: could not resolve the host. Check the URL in Settings → Web search. Query was: "${query}"`;
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return `Web search timed out. The provider may be slow or unreachable. Query was: "${query}"`;
  }
  if (message.startsWith("401") || message.startsWith("403")) {
    return `Web search failed: API key was rejected (${message}). Fix it in Settings → Web search. Query was: "${query}"`;
  }
  if (message.startsWith("429")) {
    return `Web search failed: rate-limited by the provider (429). Wait a moment and retry. Query was: "${query}"`;
  }
  return `Web search failed: ${message}. Query was: "${query}"`;
}

function extractCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const cause = (err as { cause?: unknown }).cause;
  if (cause && typeof cause === "object" && "code" in cause) {
    return String((cause as { code: unknown }).code);
  }
  if ("code" in err) return String((err as { code: unknown }).code);
  return undefined;
}
