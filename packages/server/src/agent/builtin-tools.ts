import { spawn } from "bun";
import { join } from "path";

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface BuiltinTool {
  tool: ToolDef;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

export function createBuiltinTools(cwd?: string): Record<string, BuiltinTool> {
  const resolvePath = (p: string) => cwd && !p.startsWith("/") && !p.match(/^[a-zA-Z]:/) ? join(cwd, p) : p;
  return {
    bash: {
      tool: {
        type: "function",
        function: {
          name: "bash",
          description: "Run a shell command and return its output",
          parameters: {
            type: "object",
            required: ["command"],
            properties: {
              command: { type: "string", description: "The shell command to execute" },
            },
          },
        },
      },
      execute: async (args) => {
        try {
          const proc = spawn({
            cmd: ["bash", "-c", args.command as string],
            cwd,
            stdout: "pipe",
            stderr: "pipe",
          });
          const stdout = await new Response(proc.stdout).text();
          const stderr = await new Response(proc.stderr).text();
          const exitCode = await proc.exited;
          return exitCode === 0
            ? stdout || "(no output)"
            : `Error (exit ${exitCode}): ${stderr || stdout}`;
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    read_file: {
      tool: {
        type: "function",
        function: {
          name: "read_file",
          description: "Read the contents of a file",
          parameters: {
            type: "object",
            required: ["path"],
            properties: {
              path: { type: "string", description: "Absolute or relative file path" },
            },
          },
        },
      },
      execute: async (args) => {
        try {
          const file = Bun.file(resolvePath(args.path as string));
          return await file.text();
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    write_file: {
      tool: {
        type: "function",
        function: {
          name: "write_file",
          description: "Write content to a file",
          parameters: {
            type: "object",
            required: ["path", "content"],
            properties: {
              path: { type: "string", description: "File path to write to" },
              content: { type: "string", description: "Content to write" },
            },
          },
        },
      },
      execute: async (args) => {
        try {
          await Bun.write(resolvePath(args.path as string), args.content as string);
          return `File written: ${args.path}`;
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    web_fetch: {
      tool: {
        type: "function",
        function: {
          name: "web_fetch",
          description: "Fetch content from a URL and return the text",
          parameters: {
            type: "object",
            required: ["url"],
            properties: {
              url: { type: "string", description: "The URL to fetch" },
            },
          },
        },
      },
      execute: async (args) => {
        try {
          const res = await fetch(args.url as string, { signal: AbortSignal.timeout(15000) });
          const text = await res.text();
          return text.length > 8000 ? text.slice(0, 8000) + "\n...(truncated)" : text;
        } catch (err: unknown) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  };
}

// Maps Claude Code tool names to builtin tool IDs
export const TOOL_NAME_MAP: Record<string, string> = {
  Bash: "bash",
  Read: "read_file",
  Write: "write_file",
  WebFetch: "web_fetch",
};
