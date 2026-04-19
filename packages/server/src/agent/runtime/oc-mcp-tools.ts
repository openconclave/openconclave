import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Workspace } from "../../engine/workspace";
import { createBuiltinTools } from "../builtin-tools";
import { createClaudeAttachmentTools } from "../attachment-tools";
import { createClaudeArtifactTools } from "../artifact-tools";
import { logger } from "../../lib/logger";

// Tool names that OC serves in-process under the mcp__oc__* namespace. These
// replace the Claude Code CLI's builtin Read/Write/Edit/Grep/Glob/Bash, whose
// path-resolution walks .git upward and escapes git worktrees (issue #30).
// WebFetch is handled separately because its registration is conditional on
// runId (per-run attachments folder).
const OC_REPLACED_BUILTINS = new Set(["Read", "Write", "Edit", "Grep", "Glob", "Bash"]);

/** Build the tool array for the in-process "oc" MCP server.
 *  Returns an empty array when the agent has none of these tools allowed. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildOcFsTools(ws: Workspace, runId: number | undefined, allowedTools: string[] | undefined): any[] {
  const ocBuiltins = createBuiltinTools(ws, runId);
  const allowedSet = new Set(allowedTools ?? []);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const OC_TOOL_MAP: Record<string, () => any> = {
    Read: () => tool(
      "read",
      "Read the contents of a file from disk and return it as text. Use this before editing a file so you know its exact current state, and any time you need to inspect source code, configuration, logs, or review output. Paths are resolved against your working directory unless absolute.",
      {
        path: z.string().describe("File path — relative to your working directory, or absolute. Example: 'packages/server/src/index.ts'"),
      },
      async ({ path }) => ({
        content: [{ type: "text" as const, text: await ocBuiltins.read_file!.execute({ path }) }],
      }),
    ),
    Write: () => tool(
      "write",
      "Create a new file or completely replace an existing file's contents. The entire file is overwritten — for surgical changes to an existing file, use `edit` instead. Parent directories are created if missing. Returns confirmation on success.",
      {
        path: z.string().describe("File path — relative to your working directory, or absolute"),
        content: z.string().describe("Full file contents to write. Overwrites any existing file at this path."),
      },
      async ({ path, content }) => ({
        content: [{ type: "text" as const, text: await ocBuiltins.write_file!.execute({ path, content }) }],
      }),
    ),
    Edit: () => tool(
      "edit",
      "Modify an existing file by replacing an exact substring. Prefer this over `write` for any change to an already-existing file — it keeps diffs minimal and preserves surrounding code. old_string must match the file character-for-character including all whitespace, newlines, and indentation. If old_string appears more than once, either widen it with more surrounding context to make it unique, or set replace_all to true to replace every occurrence.",
      {
        path: z.string().describe("File path — relative to your working directory, or absolute"),
        old_string: z.string().describe("Exact text to find. Whitespace, newlines, and indentation must match the file verbatim."),
        new_string: z.string().describe("Replacement text. Pass an empty string to delete old_string."),
        replace_all: z.boolean().optional().describe("Replace every occurrence. Default false — requires one unique match or the call errors."),
      },
      async ({ path, old_string, new_string, replace_all }) => ({
        content: [{ type: "text" as const, text: await ocBuiltins.edit!.execute({ path, old_string, new_string, replace_all }) }],
      }),
    ),
    Grep: () => tool(
      "grep",
      "Search file contents across the codebase for a JavaScript-flavor regular expression. Returns matches as `path:line:content`. Skips node_modules, .git, dist, build, .worktrees, and files larger than 2MB. Use this to locate symbol definitions, call sites, error messages, or any text pattern. For finding files by name (not content), use `glob` instead.",
      {
        pattern: z.string().describe("JavaScript regex. Example: 'export function \\\\w+' or 'TODO[^\\\\n]*'"),
        path: z.string().optional().describe("Subdirectory to search in. Default: your working directory."),
        glob: z.string().optional().describe("File-glob filter to restrict which files are searched. Example: '*.ts' or '**/*.{ts,tsx}'. Default: '**/*'."),
        ignore_case: z.boolean().optional().describe("Case-insensitive match. Default false."),
        max_results: z.number().int().optional().describe("Maximum number of match lines to return. Default 100."),
      },
      async (args) => ({
        content: [{ type: "text" as const, text: await ocBuiltins.grep!.execute(args as Record<string, unknown>) }],
      }),
    ),
    Glob: () => tool(
      "glob",
      "List files whose paths match a glob pattern. Returns sorted paths relative to the search base. Use this to discover files by name or extension — for example, finding every test file (`**/*.test.ts`), every component (`packages/*/src/components/**/*.tsx`), or every config (`**/tsconfig*.json`). For searching file *contents*, use `grep` instead.",
      {
        pattern: z.string().describe("Glob pattern. Examples: '**/*.ts', 'src/**/*.tsx', 'packages/*/package.json'"),
        path: z.string().optional().describe("Subdirectory to search in. Default: your working directory."),
      },
      async (args) => ({
        content: [{ type: "text" as const, text: await ocBuiltins.glob!.execute(args as Record<string, unknown>) }],
      }),
    ),
    Bash: () => tool(
      "bash",
      "Run a shell command in your working directory. Returns combined stdout/stderr with the exit code. Use this for git operations (status, diff, log, branch, commit), running tests, build commands, package managers, or any shell action. For reading/writing individual files, prefer the dedicated `read`/`write`/`edit` tools — they give cleaner output and stricter error reporting.",
      {
        command: z.string().describe("Shell command to execute. Example: 'git status', 'bun test packages/server', 'ls -la src/'"),
      },
      async ({ command }) => ({
        content: [{ type: "text" as const, text: await ocBuiltins.bash!.execute({ command }) }],
      }),
    ),
  };

  // WebFetch is populated by createBuiltinTools only when runId is defined
  // (attachments folder is per-run). Register the SDK tool only then, so a
  // caller that requests WebFetch without runId gets a clear "tool unavailable"
  // signal instead of a cryptic TypeError at invocation time.
  if (ocBuiltins.web_fetch) {
    const webFetch = ocBuiltins.web_fetch;
    OC_TOOL_MAP.WebFetch = () => tool(
      "web_fetch",
      "Fetch a URL with a real headless browser (handles JavaScript and SPAs), extract the main content as Markdown, and save it to this run's attachments folder. Returns a short status with the saved filename — the page content does NOT come back inline. Use list_attachments to see saved files; read_attachment or grep_attachment to read them. Repeated calls for the same URL within a run reuse the first fetch's saved file.",
      {
        url: z.string().describe("Absolute http(s) URL to fetch"),
      },
      async ({ url }) => ({
        content: [{ type: "text" as const, text: await webFetch.execute({ url }) }],
      }),
    );
  }

  // WebSearch is always available in ocBuiltins (not runId-conditional) — it
  // reads provider config from settings at execute time. Register it under
  // mcp__oc__web_search so Claude agents get OC's provider-aware search instead
  // of the Claude Code CLI's native US-only WebSearch tool.
  if (ocBuiltins.web_search) {
    const webSearch = ocBuiltins.web_search;
    OC_TOOL_MAP.WebSearch = () => tool(
      "web_search",
      "Search the web and return a ranked list of matching pages with short snippets. Use this to DISCOVER URLs and get quick context; use `web_fetch` afterwards to read a specific page in full. Results come back inline as markdown — no attachments. Default 5 results, cap 10.",
      {
        query: z.string().describe("What to search for. Be specific — search engines reward focused queries."),
        limit: z.number().int().optional().describe("How many results to return (1–10, default 5)."),
        language: z.string().optional().describe("Language hint like 'en', 'de', 'ja'. Default 'en'."),
      },
      async (args) => ({
        content: [{ type: "text" as const, text: await webSearch.execute(args as Record<string, unknown>) }],
      }),
    );
  }

  const out = Object.entries(OC_TOOL_MAP)
    .filter(([name]) => allowedSet.has(name))
    .map(([, factory]) => factory());

  // Attachment + artifact tools are always on when we know the runId. They
  // behave correctly on empty folders and populate when web_fetch or user
  // upload adds files mid-run.
  if (runId !== undefined) {
    out.push(...createClaudeAttachmentTools(runId));
    out.push(...createClaudeArtifactTools(runId));
  }

  return out;
}

/** Filter the agent's allowedTools list for the Claude Code CLI's passthrough
 *  channel: drop names OC replaces in-process so the CLI doesn't sneak its
 *  bugged versions back in, hard-block WebFetch so the CLI's native WebFetch
 *  (working-dir escape per issue #30) can never leak in, and hard-block
 *  WebSearch so the CLI's native Anthropic-server-side search (US-only, not
 *  user-provider-aware) can't replace OC's configurable web_search. */
export function filterPassthroughTools(
  allowedTools: string[] | undefined,
  runId: number | undefined,
): string[] {
  return (allowedTools ?? []).filter((t) => {
    if (t === "WebFetch") {
      if (runId === undefined) {
        logger.warn("WebFetch requested without runId; dropping to avoid CLI fallback", { runId });
      }
      return false;
    }
    if (t === "WebSearch") return false;
    return !OC_REPLACED_BUILTINS.has(t);
  });
}
