import { join } from "path";
import type { Workspace } from "../../engine/workspace";
import type { BuiltinTool } from "./types";

const GREP_WALLCLOCK_BUDGET_MS = 10_000;
// Source-code lines rarely exceed a few KB; 100KB covers all reasonable cases
// while still bounding regex runtime on truly pathological input. The tool
// description documents that lines past this length may miss matches.
const GREP_LINE_LENGTH_CAP = 100_000;

type PathResolver = (p: string) => string;

export function buildSearchTools(
  workspace: Workspace,
  resolveIn: PathResolver,
): Record<string, BuiltinTool> {
  return {
    glob: {
      tool: {
        type: "function",
        function: {
          name: "glob",
          description:
            "Find files matching a glob pattern. Returns paths relative to the search base, sorted alphabetically. Searches the agent's working directory unless a path is given.",
          parameters: {
            type: "object",
            required: ["pattern"],
            properties: {
              pattern: {
                type: "string",
                description: "Glob pattern, e.g. '**/*.ts', 'src/**/*.tsx'",
              },
              path: {
                type: "string",
                description: "Optional subdirectory to search (relative to cwd or absolute).",
              },
            },
          },
        },
      },
      execute: async (args) => {
        try {
          const pattern = args.pattern as string;
          const base = args.path ? resolveIn(args.path as string) : workspace.cwd;
          const glob = new Bun.Glob(pattern);
          const matches: string[] = [];
          const cap = 1000;
          // Memory ceiling: don't collect unbounded matches on a huge monorepo,
          // but collect well past `cap` so the sort reflects true alphabetical
          // order across the matched set instead of filesystem iteration order.
          const collectLimit = 10 * cap;
          for await (const file of glob.scan({ cwd: base, onlyFiles: true, dot: false })) {
            if (!workspace.isInsideAllowed(join(base, file))) continue;
            matches.push(file);
            if (matches.length >= collectLimit) break;
          }
          matches.sort();
          if (matches.length === 0) return `No files matching ${pattern} under ${base}`;
          if (matches.length > cap) {
            return `${cap}+ files matching ${pattern} (showing first ${cap} alphabetically):\n${matches.slice(0, cap).join("\n")}`;
          }
          return `${matches.length} file(s) matching ${pattern}:\n${matches.join("\n")}`;
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    grep: {
      tool: {
        type: "function",
        function: {
          name: "grep",
          description:
            "Search file contents for a regex pattern (JavaScript flavor). Returns matches as 'path:line:content'. Searches the agent's working directory unless a path is given. Skips node_modules, .git, dist, build, .worktrees, and files over 2MB. Lines longer than 100KB are truncated for the match test, so matches past that length on such lines may be missed.",
          parameters: {
            type: "object",
            required: ["pattern"],
            properties: {
              pattern: { type: "string", description: "Regex pattern (JavaScript)" },
              path: {
                type: "string",
                description: "Directory to search (relative to cwd or absolute).",
              },
              glob: {
                type: "string",
                description:
                  "File glob to restrict search, e.g. '*.ts' or '**/*.{ts,tsx}'. Defaults to '**/*'.",
              },
              ignore_case: {
                type: "boolean",
                description: "Case-insensitive matching (default false)",
              },
              max_results: {
                type: "number",
                description: "Max match lines returned (default 100)",
              },
            },
          },
        },
      },
      execute: async (args) => {
        try {
          const pattern = args.pattern as string;
          const baseDir = args.path ? resolveIn(args.path as string) : workspace.cwd;
          const fileGlob = typeof args.glob === "string" ? args.glob : "**/*";
          const ignoreCase = args.ignore_case === true;
          const maxResults = typeof args.max_results === "number" && args.max_results > 0
            ? args.max_results
            : 100;

          let re: RegExp;
          try {
            re = new RegExp(pattern, ignoreCase ? "i" : "");
          } catch (err) {
            return `Error: invalid regex: ${err instanceof Error ? err.message : String(err)}`;
          }

          const skipDirs = new Set([
            "node_modules",
            ".git",
            "dist",
            "build",
            ".next",
            ".worktrees",
          ]);

          const glob = new Bun.Glob(fileGlob);
          const matches: string[] = [];
          const startedAt = Date.now();
          let timedOut = false;

          outer: for await (const relPath of glob.scan({ cwd: baseDir, onlyFiles: true, dot: false })) {
            if (matches.length >= maxResults) break;
            if (Date.now() - startedAt > GREP_WALLCLOCK_BUDGET_MS) {
              timedOut = true;
              break;
            }
            if (relPath.split(/[\\/]/).some((seg) => skipDirs.has(seg))) continue;

            const absPath = join(baseDir, relPath);
            if (!workspace.isInsideAllowed(absPath)) continue;
            try {
              const file = Bun.file(absPath);
              if (file.size > 2 * 1024 * 1024) continue;
              const text = await file.text();
              for (const [i, line] of text.split("\n").entries()) {
                if (matches.length >= maxResults) break outer;
                if (Date.now() - startedAt > GREP_WALLCLOCK_BUDGET_MS) {
                  timedOut = true;
                  break outer;
                }
                const bounded = line.length > GREP_LINE_LENGTH_CAP ? line.slice(0, GREP_LINE_LENGTH_CAP) : line;
                if (re.test(bounded)) {
                  const trimmed = line.trim().slice(0, 300);
                  matches.push(`${relPath}:${i + 1}:${trimmed}`);
                }
              }
            } catch {
              // skip unreadable files (binary, permissions)
            }
          }

          if (matches.length === 0 && !timedOut) {
            return `No matches for /${pattern}/${ignoreCase ? "i" : ""} in ${baseDir}`;
          }
          const notes: string[] = [];
          if (matches.length >= maxResults) notes.push(`truncated at ${maxResults} matches`);
          if (timedOut) notes.push(`search budget ${GREP_WALLCLOCK_BUDGET_MS / 1000}s exceeded`);
          const note = notes.length ? `\n(${notes.join("; ")})` : "";
          return `${matches.length} match(es):\n${matches.join("\n")}${note}`;
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  };
}
